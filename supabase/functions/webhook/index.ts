import { createServiceClient } from "../_shared/supabase.ts";
import { TodoistClient } from "../_shared/todoist.ts";
import { buildMessages, executePrompt } from "../_shared/ai.ts";
import {
  AI_INDICATOR,
  ERROR_PREFIX,
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_MESSAGES,
} from "../_shared/constants.ts";
import { commentsToMessages, normalizeModel } from "../_shared/messages.ts";
import { withSentry, captureException } from "../_shared/sentry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function verifyHmac(
  secret: string,
  rawBody: string,
  signatureHeader: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (computed.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

async function handleNoteAdded(event: any, user: any): Promise<void> {
  const { event_data } = event;
  const taskId = event_data.item_id;
  const content: string = event_data.content ?? "";

  if (!taskId || !content) {
    console.warn("Missing required fields in note:added event");
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

  const todoist = new TodoistClient(user.todoist_token);
  const progressCommentId = await todoist.postProgressComment(taskId);

  try {
    // Fetch task and full comment history in parallel
    const [task, comments] = await Promise.all([
      todoist.getTask(taskId),
      todoist.getComments(taskId),
    ]);

    // Build conversation from Todoist comments
    const maxMessages = user.max_messages ?? DEFAULT_MAX_MESSAGES;
    let messages = commentsToMessages(comments, triggerWord, progressCommentId);
    if (messages.length > maxMessages) {
      messages = messages.slice(-maxMessages);
    }

    // Get image attachments from comments
    const images: { data: string; mediaType: string }[] = [];
    for (const comment of comments) {
      const att = comment.file_attachment;
      if (att?.resource_type === "image") {
        try {
          const bytes = await todoist.downloadFile(att.file_url);
          images.push({ data: uint8ToBase64(bytes), mediaType: att.file_type || "image/png" });
        } catch (e) {
          console.error("Failed to download image", att.file_name, e);
        }
      }
    }

    // Build AI config
    const aiConfig = {
      baseUrl: (
        user.custom_ai_base_url ||
        Deno.env.get("DEFAULT_AI_BASE_URL") ||
        "https://api.anthropic.com/v1"
      ).trim().replace(/\/$/, ""),
      apiKey:
        user.custom_ai_api_key ||
        Deno.env.get("DEFAULT_AI_API_KEY") ||
        "",
      model: normalizeModel(
        user.custom_ai_model ||
        Deno.env.get("DEFAULT_AI_MODEL") ||
        DEFAULT_AI_MODEL
      ),
      timeoutMs: 120_000,
      braveApiKey:
        user.custom_brave_key ||
        Deno.env.get("DEFAULT_BRAVE_KEY") ||
        undefined,
    };

    // Call AI
    const apiMessages = buildMessages(
      task.content,
      task.description,
      messages,
      images.length > 0 ? images : undefined
    );
    const response = await executePrompt(apiMessages, aiConfig);

    await todoist.updateComment(progressCommentId, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("note:added processing failed", { taskId, error: message });
    try {
      await todoist.updateComment(
        progressCommentId,
        `${ERROR_PREFIX} ${message}. Retry by adding a comment.`
      );
    } catch (e) {
      console.error("Failed to update progress comment with error", e);
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(withSentry(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-todoist-hmac-sha256");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Identify user from the event payload
  let event: any;
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

  const supabase = createServiceClient();
  const { data: user, error: userErr } = await supabase
    .from("users_config")
    .select("*")
    .eq("todoist_user_id", userId)
    .maybeSingle();

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const clientSecret = Deno.env.get("TODOIST_CLIENT_SECRET") ?? "";
  const valid = await verifyHmac(clientSecret, rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const processPromise = (async () => {
    try {
      if (event.event_name === "note:added") {
        await handleNoteAdded(event, user);
      }
      // item:completed no longer needs handling — no DB cleanup required
    } catch (error) {
      console.error("Async webhook processing failed", {
        event_name: event.event_name,
        error: error instanceof Error ? error.message : String(error),
      });
      await captureException(error);
    }
  })();

  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(processPromise);
  } else {
    processPromise.catch((e) => console.error("Background processing error", e));
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));
