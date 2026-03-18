import { createServiceClient } from "../_shared/supabase.ts";
import { TodoistClient } from "../_shared/todoist.ts";
import { buildMessages, executePrompt, isAnthropicUrl, type DocumentAttachment } from "../_shared/ai.ts";
import {
  AI_INDICATOR,
  ERROR_PREFIX,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_FALLBACK_MODEL,
  DEFAULT_MAX_MESSAGES,
  MAX_WEBHOOK_BODY_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_DOCUMENT_TYPES,
} from "../_shared/constants.ts";
import {
  getRateLimitConfig,
  checkRateLimitByTodoistId,
} from "../_shared/rate-limit.ts";
import { commentsToMessages, normalizeModel } from "../_shared/messages.ts";
import { captureException } from "../_shared/sentry.ts";
import { uint8ToBase64, verifyHmac, decrypt, decryptIfPresent } from "../_shared/crypto.ts";
import { sanitizeImageMediaType, sanitizeDocumentMediaType, isPrivateHostname, extractMarkdownImageUrls, guessMediaType } from "../_shared/validation.ts";
import type { TodoistComment, TodoistWebhookEvent, UserConfig } from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Shared AI processing
// ---------------------------------------------------------------------------

function sanitizeErrorForUser(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("Custom AI URL requires")) return msg;
    if (msg.includes("AbortError") || msg.includes("abort")) return "Request timed out.";
    if (/AI API error \d+/.test(msg)) return "AI service returned an error. Check your API key and model settings.";
  }
  return "Something went wrong while processing your request.";
}

async function runAiForTask(
  taskId: string,
  user: UserConfig,
  todoistUserId: string,
  requestId: string,
  prefetchedComments?: TodoistComment[],
): Promise<void> {
  const todoist = new TodoistClient(user.todoist_token);
  let progressCommentId: string | undefined;

  try {
    const [progressId, task, comments] = await Promise.all([
      todoist.postProgressComment(taskId),
      todoist.getTask(taskId),
      prefetchedComments ?? todoist.getComments(taskId),
    ]);
    progressCommentId = progressId;

    // Never send the default API key to a custom URL (SSRF protection)
    if (user.custom_ai_base_url && !user.custom_ai_api_key) {
      throw new Error("Custom AI URL requires a custom API key. Please add your API key in Settings.");
    }

    // Re-validate custom URL at request time to catch DNS rebinding / SSRF (#153)
    if (user.custom_ai_base_url) {
      try {
        const parsed = new URL(user.custom_ai_base_url);
        if (parsed.protocol !== "https:" || isPrivateHostname(parsed.hostname)) {
          throw new Error("Custom AI URL must use HTTPS and cannot target private networks.");
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("Custom AI URL")) throw e;
        throw new Error("Custom AI URL is invalid.");
      }
    }

    const triggerWord = user.trigger_word || "@ai";
    const maxMessages = user.max_messages ?? DEFAULT_MAX_MESSAGES;
    const result = commentsToMessages(comments, triggerWord, progressCommentId);
    let { messages } = result;
    let windowCommentIds: Set<string>;
    if (messages.length > maxMessages) {
      messages = messages.slice(-maxMessages);
      windowCommentIds = new Set(result.commentIds.slice(-maxMessages));
    } else {
      windowCommentIds = new Set(result.commentIds);
    }

    // Only download images from comments within the message window (#96)
    const imageComments = comments.filter(
      (c: TodoistComment) =>
        c.file_attachment?.file_type?.startsWith("image/") &&
        windowCommentIds.has(c.id)
    );
    const imageResults = await Promise.allSettled(
      imageComments.map(async (c: TodoistComment) => {
        const att = c.file_attachment!;
        const bytes = await todoist.downloadFile(att.file_url);
        return { data: uint8ToBase64(bytes), mediaType: sanitizeImageMediaType(att.file_type) };
      })
    );
    // Log image download failures (#151)
    const rejectedImages = imageResults.filter((r) => r.status === "rejected");
    if (rejectedImages.length > 0) {
      console.warn("Some image downloads failed", {
        requestId,
        taskId,
        failedCount: rejectedImages.length,
        errors: rejectedImages.map((r) =>
          (r as PromiseRejectedResult).reason instanceof Error
            ? (r as PromiseRejectedResult).reason.message
            : String((r as PromiseRejectedResult).reason)
        ),
      });
    }
    const images = imageResults
      .filter((r): r is PromiseFulfilledResult<{ data: string; mediaType: string }> => r.status === "fulfilled")
      .map((r) => r.value);

    // Download document attachments (PDF) from comments within the message window
    const docComments = comments.filter(
      (c: TodoistComment) =>
        c.file_attachment &&
        !c.file_attachment.file_type?.startsWith("image/") &&
        SUPPORTED_DOCUMENT_TYPES.has(c.file_attachment.file_type ?? "") &&
        windowCommentIds.has(c.id)
    );
    const docResults = await Promise.allSettled(
      docComments.map(async (c: TodoistComment) => {
        const att = c.file_attachment!;
        const bytes = await todoist.downloadFile(att.file_url);
        return { data: uint8ToBase64(bytes), mediaType: sanitizeDocumentMediaType(att.file_type), fileName: att.file_name };
      })
    );
    if (docResults.some((r) => r.status === "rejected")) {
      const rejectedDocs = docResults.filter((r) => r.status === "rejected");
      console.warn("Some document downloads failed", {
        requestId,
        taskId,
        failedCount: rejectedDocs.length,
        errors: rejectedDocs.map((r) =>
          (r as PromiseRejectedResult).reason instanceof Error
            ? (r as PromiseRejectedResult).reason.message
            : String((r as PromiseRejectedResult).reason)
        ),
      });
    }
    const documents: DocumentAttachment[] = docResults
      .filter((r): r is PromiseFulfilledResult<DocumentAttachment> => r.status === "fulfilled")
      .map((r) => r.value);

    // For non-supported file types, add placeholder documents so the AI knows a file was attached
    const unsupportedFileComments = comments.filter(
      (c: TodoistComment) =>
        c.file_attachment &&
        !c.file_attachment.file_type?.startsWith("image/") &&
        !SUPPORTED_DOCUMENT_TYPES.has(c.file_attachment.file_type ?? "") &&
        windowCommentIds.has(c.id)
    );
    for (const c of unsupportedFileComments) {
      documents.push({
        data: "",
        mediaType: c.file_attachment!.file_type,
        fileName: c.file_attachment!.file_name,
      });
    }

    // Download images embedded in task description via markdown syntax (cap at 5 to prevent DoS)
    if (task.description) {
      const descImageUrls = extractMarkdownImageUrls(task.description).slice(0, 5);
      if (descImageUrls.length > 0) {
        const descResults = await Promise.allSettled(
          descImageUrls.map(async (url: string) => {
            // Validate URL: HTTPS only, no private/internal hosts (SSRF prevention)
            try {
              const parsed = new URL(url);
              if (parsed.protocol !== "https:" || isPrivateHostname(parsed.hostname)) return null;
            } catch {
              return null;
            }
            // Plain fetch without auth — description images may be external
            // Reject redirects to prevent SSRF bypass via open redirectors
            const res = await fetch(url, { redirect: "error" });
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            const contentLength = res.headers.get("content-length");
            if (contentLength && Number(contentLength) > MAX_IMAGE_SIZE_BYTES) {
              throw new Error(`File exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`);
            }
            // Stream body to enforce size limit without buffering entire response
            if (!res.body) {
              const bytes = new Uint8Array(await res.arrayBuffer());
              if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
                throw new Error(`File exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`);
              }
              return { data: uint8ToBase64(bytes), mediaType: sanitizeImageMediaType(guessMediaType(url)) };
            }
            const chunks: Uint8Array[] = [];
            let totalSize = 0;
            const reader = res.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              totalSize += value.byteLength;
              if (totalSize > MAX_IMAGE_SIZE_BYTES) {
                reader.cancel();
                throw new Error(`File exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB`);
              }
              chunks.push(value);
            }
            const bytes = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return { data: uint8ToBase64(bytes), mediaType: sanitizeImageMediaType(guessMediaType(url)) };
          })
        );
        const descRejected = descResults.filter((r) => r.status === "rejected");
        if (descRejected.length > 0) {
          console.warn("Some description image downloads failed", {
            requestId,
            taskId,
            failedCount: descRejected.length,
            errors: descRejected.map((r) =>
              (r as PromiseRejectedResult).reason instanceof Error
                ? (r as PromiseRejectedResult).reason.message
                : String((r as PromiseRejectedResult).reason)
            ),
          });
        }
        for (const r of descResults) {
          if (r.status === "fulfilled" && r.value) images.push(r.value);
        }
      }
    }

    const resolvedBaseUrl = (
      user.custom_ai_base_url ||
      Deno.env.get("DEFAULT_AI_BASE_URL") ||
      "https://api.anthropic.com/v1"
    ).trim().replace(/\/$/, "");
    const resolvedModel = normalizeModel(
      user.custom_ai_model ||
      Deno.env.get("DEFAULT_AI_MODEL") ||
      DEFAULT_AI_MODEL
    );

    // Fallback only for the default Anthropic model (no custom overrides)
    // Empty env var disables fallback; unset env var uses the hardcoded default
    const fallbackModel = (isAnthropicUrl(resolvedBaseUrl) && resolvedModel === DEFAULT_AI_MODEL)
      ? (Deno.env.get("DEFAULT_AI_FALLBACK_MODEL") ?? DEFAULT_AI_FALLBACK_MODEL) || undefined
      : undefined;

    const aiConfig = {
      baseUrl: resolvedBaseUrl,
      apiKey: user.custom_ai_base_url
        ? user.custom_ai_api_key!
        : (user.custom_ai_api_key || Deno.env.get("DEFAULT_AI_API_KEY") || ""),
      model: resolvedModel,
      timeoutMs: 120_000,
      braveApiKey:
        user.custom_brave_key ||
        Deno.env.get("DEFAULT_BRAVE_KEY") ||
        undefined,
      fallbackModel,
    };

    const apiMessages = buildMessages(
      task.content,
      task.description,
      messages,
      images.length > 0 ? images : undefined,
      user.custom_prompt,
      documents.length > 0 ? documents : undefined,
    );
    const response = await executePrompt(apiMessages, aiConfig);

    // Increment AI request counter only after successful processing (#99)
    const supabase = createServiceClient();
    await supabase.rpc("increment_ai_requests", { p_todoist_user_id: todoistUserId });

    await todoist.updateComment(progressCommentId, response);
  } catch (error) {
    console.error("AI processing failed", { requestId, taskId, error: error instanceof Error ? error.message : String(error) });
    if (progressCommentId) {
      try {
        await todoist.updateComment(
          progressCommentId,
          `${ERROR_PREFIX} ${sanitizeErrorForUser(error)} Retry by adding a comment.`
        );
      } catch (e) {
        console.error("Failed to update progress comment with error", { requestId, error: e });
      }
    }
    await captureException(error);
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleNoteEvent(event: TodoistWebhookEvent, user: UserConfig, requestId: string): Promise<void> {
  const { event_data } = event;
  const taskId = "item_id" in event_data ? event_data.item_id : undefined;
  const content: string = event_data.content ?? "";

  if (!taskId || !content) {
    console.warn("Missing required fields in note event", { requestId });
    return;
  }

  // Ignore bot's own comments
  if (content.startsWith(AI_INDICATOR) || content.startsWith(ERROR_PREFIX)) {
    return;
  }

  // Check trigger word
  const triggerWord = user.trigger_word || "@ai";
  const triggerRegex = new RegExp(
    triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );
  if (!triggerRegex.test(content)) return;

  await runAiForTask(taskId, user, String(event.user_id), requestId);
}

async function handleItemEvent(event: TodoistWebhookEvent, user: UserConfig, requestId: string): Promise<void> {
  const { event_data } = event;
  const taskId = "id" in event_data ? event_data.id : undefined;
  const content: string = event_data.content ?? "";
  const description: string = "description" in event_data ? (event_data.description ?? "") : "";
  const labels: string[] = "labels" in event_data ? (event_data.labels ?? []) : [];

  if (!taskId) {
    console.warn("Missing task id in item event", { requestId });
    return;
  }

  // Check trigger in content, description, or labels
  const triggerWord = user.trigger_word || "@ai";
  const triggerRegex = new RegExp(
    triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );
  const labelTrigger = triggerWord.replace(/^@/, "").toLowerCase();
  const hasTrigger =
    triggerRegex.test(content) ||
    triggerRegex.test(description) ||
    labels.some((l: string) => l.toLowerCase() === labelTrigger);

  if (!hasTrigger) return;

  // For item:updated, skip if AI already responded to avoid re-triggering
  if (event.event_name === "item:updated") {
    const todoist = new TodoistClient(user.todoist_token);
    const comments = await todoist.getComments(taskId);
    if (comments.some((c: TodoistComment) => (c.content ?? "").startsWith(AI_INDICATOR))) {
      return;
    }
    await runAiForTask(taskId, user, String(event.user_id), requestId, comments);
    return;
  }

  await runAiForTask(taskId, user, String(event.user_id), requestId);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function webhookHandler(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Reject oversized payloads before reading body into memory (#141)
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  const signature = req.headers.get("x-todoist-hmac-sha256");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify HMAC immediately — before parsing JSON or querying DB
  const clientSecret = Deno.env.get("TODOIST_CLIENT_SECRET");
  if (!clientSecret) {
    console.error("TODOIST_CLIENT_SECRET is not configured", { requestId });
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const valid = await verifyHmac(clientSecret, rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse payload after signature is verified
  let event: TodoistWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = String(event.user_id ?? "");
  if (!userId) {
    return new Response(JSON.stringify({ error: "Missing user_id in payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch only the columns needed — avoid pulling encrypted fields unnecessarily
  const supabase = createServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users_config")
    .select("id, todoist_token, todoist_user_id, trigger_word, custom_ai_base_url, custom_ai_api_key, custom_ai_model, custom_brave_key, max_messages, custom_prompt")
    .eq("todoist_user_id", userId)
    .maybeSingle();

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Idempotency check — prevent duplicate AI responses from concurrent deliveries (#159: before rate limit)
  // For note events, use comment ID (event_data.id); for item events, use task ID (#140)
  const entityId = String(event.event_data?.id ?? "");
  if (entityId) {
    const eventKey = `${userId}:${event.event_name}:${entityId}`;
    const { data: claimed } = await supabase.rpc("try_claim_event", { p_event_id: eventKey });
    if (claimed === false) {
      return new Response(JSON.stringify({ ok: true, deduplicated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Rate limit check — before any processing or decryption
  const rlConfig = getRateLimitConfig();
  const rlResult = await checkRateLimitByTodoistId(supabase, userId, rlConfig);
  if (rlResult.blocked || !rlResult.allowed) {
    // Return 200 so Todoist does not retry — retries of 429 cause an infinite loop
    return new Response(JSON.stringify({ ok: true, rate_limited: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const decryptedUser: UserConfig = {
    ...user as UserConfig,
    todoist_token: await decrypt(user.todoist_token),
    custom_ai_api_key: await decryptIfPresent(user.custom_ai_api_key),
    custom_brave_key: await decryptIfPresent(user.custom_brave_key),
  };

  const processPromise = (async () => {
    try {
      if (event.event_name === "note:added" || event.event_name === "note:updated") {
        await handleNoteEvent(event, decryptedUser, requestId);
      } else if (event.event_name === "item:added" || event.event_name === "item:updated") {
        await handleItemEvent(event, decryptedUser, requestId);
      }
    } catch (error) {
      console.error("Async webhook processing failed", {
        requestId,
        event_name: event.event_name,
        error: error instanceof Error ? error.message : String(error),
      });
      await captureException(error);
    }
  })();

  const edgeRuntime = (globalThis as Record<string, unknown>).EdgeRuntime as { waitUntil?: (p: Promise<void>) => void } | undefined;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(processPromise);
  } else {
    console.warn("EdgeRuntime.waitUntil not available, processing in detached promise", { requestId });
    processPromise.catch((e) => console.error("Background processing error", { requestId, error: e }));
  }

  return new Response(JSON.stringify({ ok: true, request_id: requestId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
