import { createServiceClient } from "../_shared/supabase.ts";
import { TodoistClient } from "../_shared/todoist.ts";
import { buildMessages, executePrompt } from "../_shared/ai.ts";
import {
  AI_INDICATOR,
  ERROR_PREFIX,
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_MESSAGES,
} from "../_shared/constants.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base64-encode a Uint8Array (for image attachments). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** HMAC-SHA256 verify using Web Crypto (Deno). */
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

  // Constant-time comparison (compare every byte, avoid early exit)
  if (computed.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Extract image attachments from Todoist comments. */
async function getImageAttachments(
  todoist: TodoistClient,
  taskId: string
): Promise<{ data: string; mediaType: string }[]> {
  try {
    const comments = await todoist.getComments(taskId);
    const imageComments = comments.filter(
      (c: any) => c.file_attachment && c.file_attachment.resource_type === "image"
    );
    if (imageComments.length === 0) return [];

    const images: { data: string; mediaType: string }[] = [];
    for (const comment of imageComments) {
      const att = comment.file_attachment!;
      try {
        const bytes = await todoist.downloadFile(att.file_url);
        images.push({
          data: uint8ToBase64(bytes),
          mediaType: att.file_type || "image/png",
        });
      } catch (e) {
        console.error("Failed to download image", att.file_name, e);
      }
    }
    return images;
  } catch (error) {
    console.error("Failed to fetch comments for images", taskId, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleNoteAdded(
  event: any,
  user: any,
  supabase: any
): Promise<void> {
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

  // Check trigger word match (regex, case-insensitive)
  const triggerWord = user.trigger_word || "@ai";
  const triggerRegex = new RegExp(
    triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );
  if (!triggerRegex.test(content)) return;

  // Strip trigger word and normalise whitespace
  const stripped = content
    .replace(new RegExp(triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

  const todoist = new TodoistClient(user.todoist_token);
  const progressCommentId = await todoist.postProgressComment(taskId);

  try {
    // Fetch the task details
    const task = await todoist.getTask(taskId);

    // Load or create conversation
    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", user.id)
      .eq("task_id", taskId)
      .maybeSingle();

    let conversationId: string;
    const isNew = !existingConv;

    if (isNew) {
      const { data: newConv, error: convErr } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          task_id: taskId,
          title: task.content,
        })
        .select("id")
        .single();
      if (convErr) throw new Error(`Failed to create conversation: ${convErr.message}`);
      conversationId = newConv.id;
    } else {
      conversationId = existingConv.id;
    }

    // Seed conversation with task content if new
    if (isNew) {
      const taskContent = `Task: ${task.content}\n${task.description || ""}`.trim();
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: taskContent,
      });
    }

    // Add user message
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: stripped,
    });

    // Load recent messages (respect max_messages)
    const maxMessages = user.max_messages ?? DEFAULT_MAX_MESSAGES;
    const { data: dbMessages, error: msgErr } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgErr) throw new Error(`Failed to load messages: ${msgErr.message}`);

    // Prune: keep first message + last (maxMessages - 1) if exceeds limit
    let messages = dbMessages || [];
    if (messages.length > maxMessages) {
      const first = messages[0];
      const rest = messages.slice(-(maxMessages - 1));
      messages = [first, ...rest];
    }

    // Get image attachments from Todoist comments
    const images = await getImageAttachments(todoist, taskId);

    // Build AI config (user's custom keys or shared defaults from env)
    const aiConfig = {
      baseUrl:
        user.custom_ai_base_url ||
        Deno.env.get("DEFAULT_AI_BASE_URL") ||
        "https://api.anthropic.com/v1",
      apiKey:
        user.custom_ai_api_key ||
        Deno.env.get("DEFAULT_AI_API_KEY") ||
        "",
      model:
        user.custom_ai_model ||
        Deno.env.get("DEFAULT_AI_MODEL") ||
        DEFAULT_AI_MODEL,
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

    // Save assistant message to DB
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: response,
    });

    // Update last_activity on conversation
    await supabase
      .from("conversations")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", conversationId);

    // Update progress comment with AI response
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

async function handleItemCompleted(
  event: any,
  user: any,
  supabase: any
): Promise<void> {
  const taskId = event.event_data?.id;
  if (!taskId) {
    console.warn("Missing id in item:completed event");
    return;
  }

  // Delete conversation (cascade deletes messages)
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("user_id", user.id)
    .eq("task_id", taskId);

  if (error) {
    console.error("Failed to delete conversation", { taskId, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // POST only
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract todoist_user_id from URL path: /webhook/:userId
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Path: /webhook/:userId  ->  ["webhook", ":userId"]
  // With function prefix: /webhook/xxx  or  just match the last segment
  const userId = pathParts[pathParts.length - 1];

  if (!userId || userId === "webhook") {
    return new Response(JSON.stringify({ error: "Missing user ID in path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Read raw body for HMAC verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-todoist-hmac-sha256");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Look up user from users_config by todoist_user_id
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

  // Verify HMAC-SHA256 signature
  const valid = await verifyHmac(user.webhook_secret, rawBody, signature);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Respond 200 immediately
  const event = JSON.parse(rawBody);

  // Process event asynchronously (EdgeRuntime.waitUntil keeps the function alive)
  const processPromise = (async () => {
    try {
      const eventName = event.event_name;

      if (eventName === "note:added") {
        await handleNoteAdded(event, user, supabase);
      } else if (eventName === "item:completed") {
        await handleItemCompleted(event, user, supabase);
      }
    } catch (error) {
      console.error("Async webhook processing failed", {
        event_name: event.event_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  // Use EdgeRuntime.waitUntil if available, otherwise fall back to awaiting
  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(processPromise);
  } else {
    // Fallback: await the promise (still returns 200 immediately in practice
    // because Deno.serve handles the response before the promise resolves)
    processPromise.catch((e) =>
      console.error("Background processing error", e)
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
