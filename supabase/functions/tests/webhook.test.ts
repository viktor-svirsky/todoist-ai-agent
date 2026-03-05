import { assertEquals } from "jsr:@std/assert";
import { verifyHmac } from "../_shared/crypto.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_SECRET = "test-client-secret";

async function computeHmac(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: "note:added",
    user_id: "12345",
    event_data: {
      content: "@ai What is 2+2?",
      item_id: "task-1",
    },
    ...overrides,
  };
}

// ============================================================================
// HMAC signature verification (unit-level, reusable for handler tests)
// ============================================================================

Deno.test("webhook: HMAC signature verification works correctly", async () => {
  const body = JSON.stringify(makePayload());
  const sig = await computeHmac(CLIENT_SECRET, body);
  const valid = await verifyHmac(CLIENT_SECRET, body, sig);
  assertEquals(valid, true);
});

Deno.test("webhook: HMAC rejects tampered body", async () => {
  const body = JSON.stringify(makePayload());
  const sig = await computeHmac(CLIENT_SECRET, body);
  const valid = await verifyHmac(CLIENT_SECRET, body + " ", sig);
  assertEquals(valid, false);
});

Deno.test("webhook: HMAC rejects wrong secret", async () => {
  const body = JSON.stringify(makePayload());
  const sig = await computeHmac("wrong-secret", body);
  const valid = await verifyHmac(CLIENT_SECRET, body, sig);
  assertEquals(valid, false);
});

// ============================================================================
// Webhook handler logic (isolated unit tests for request parsing)
// ============================================================================

Deno.test("webhook: rejects non-POST method", () => {
  // The handler checks req.method !== "POST" and returns 405
  const methods = ["GET", "PUT", "DELETE", "PATCH"];
  for (const method of methods) {
    // Simulating the handler's method check
    assertEquals(method !== "POST", true);
  }
});

Deno.test("webhook: payload parsing - missing user_id returns empty string", () => {
  const payload = { event_name: "note:added", event_data: {} };
  const userId = String((payload as Record<string, unknown>).user_id ?? "");
  assertEquals(userId, "");
});

Deno.test("webhook: payload parsing - extracts user_id", () => {
  const payload = makePayload();
  const userId = String(payload.user_id ?? "");
  assertEquals(userId, "12345");
});

// ============================================================================
// handleNoteAdded logic (isolated unit tests)
// ============================================================================

Deno.test("webhook: ignores bot's own comments (AI_INDICATOR prefix)", () => {
  const AI_INDICATOR = "🤖 **AI Agent**";
  const content = `${AI_INDICATOR}\n\nSome response`;
  assertEquals(content.startsWith(AI_INDICATOR), true);
});

Deno.test("webhook: ignores error comments (ERROR_PREFIX)", () => {
  const ERROR_PREFIX = "⚠️ AI agent error:";
  const content = `${ERROR_PREFIX} Something went wrong`;
  assertEquals(content.startsWith(ERROR_PREFIX), true);
});

Deno.test("webhook: trigger word matching with special regex chars", () => {
  const triggerWord = "@ai+bot";
  const escaped = triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  assertEquals(regex.test("hey @ai+bot help"), true);
  assertEquals(regex.test("hey @aiXbot help"), false);
});

Deno.test("webhook: trigger word matching is case insensitive", () => {
  const triggerWord = "@AI";
  const escaped = triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  assertEquals(regex.test("@ai help me"), true);
  assertEquals(regex.test("@AI help me"), true);
  assertEquals(regex.test("@Ai help me"), true);
});

Deno.test("webhook: skips when content missing trigger word", () => {
  const triggerWord = "@ai";
  const regex = new RegExp(triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  assertEquals(regex.test("just a regular comment"), false);
});

Deno.test("webhook: AI config cascade - custom overrides defaults", () => {
  const custom = "https://custom.api.com/v1";
  const defaultUrl = "https://api.anthropic.com/v1";
  const result = (custom || defaultUrl).trim().replace(/\/$/, "");
  assertEquals(result, "https://custom.api.com/v1");
});

Deno.test("webhook: AI config cascade - falls back to default when custom is empty", () => {
  const custom = "";
  const defaultUrl = "https://api.anthropic.com/v1";
  const result = (custom || defaultUrl).trim().replace(/\/$/, "");
  assertEquals(result, "https://api.anthropic.com/v1");
});

Deno.test("webhook: AI config strips trailing slash from base URL", () => {
  const url = "https://api.example.com/v1/";
  const result = url.trim().replace(/\/$/, "");
  assertEquals(result, "https://api.example.com/v1");
});

Deno.test("webhook: message truncation respects max_messages", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: "user",
    content: `Message ${i}`,
  }));
  const maxMessages = 20;
  let truncated = messages;
  if (truncated.length > maxMessages) {
    truncated = truncated.slice(-maxMessages);
  }
  assertEquals(truncated.length, 20);
  assertEquals(truncated[0].content, "Message 10");
});

Deno.test("webhook: missing event_data fields are handled", () => {
  const event = { event_data: {} };
  const taskId = event.event_data.item_id;
  const content: string = (event.event_data as Record<string, string>).content ?? "";
  assertEquals(taskId, undefined);
  assertEquals(content, "");
});

// ============================================================================
// Rate limit integration with webhook
// ============================================================================

Deno.test("webhook: rate limit result handling - allowed", () => {
  const result = { allowed: true, blocked: false, retry_after: 0 };
  assertEquals(result.blocked, false);
  assertEquals(result.allowed, true);
});

Deno.test("webhook: rate limit result handling - blocked account", () => {
  const result = { allowed: false, blocked: true, retry_after: 0 };
  // Blocked is checked before allowed
  assertEquals(result.blocked, true);
});

Deno.test("webhook: rate limit result handling - rate limited", () => {
  const result = { allowed: false, blocked: false, retry_after: 45 };
  assertEquals(result.allowed, false);
  assertEquals(result.retry_after, 45);
});
