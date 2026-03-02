import { assertEquals } from "jsr:@std/assert";
import { commentsToMessages, normalizeBaseUrl, normalizeModel } from "../_shared/messages.ts";
import { AI_INDICATOR, ERROR_PREFIX, PROGRESS_INDICATOR } from "../_shared/constants.ts";

// ---------------------------------------------------------------------------
// commentsToMessages
// ---------------------------------------------------------------------------

Deno.test("user comment: strips trigger word and returns user role", () => {
  const comments = [{ id: "1", content: "@ai help me with this task" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, [{ role: "user", content: "help me with this task" }]);
});

Deno.test("user comment: trigger word stripped case-insensitively", () => {
  const comments = [{ id: "1", content: "@AI What is 2+2?" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, [{ role: "user", content: "What is 2+2?" }]);
});

Deno.test("AI comment: strips AI_INDICATOR prefix and returns assistant role", () => {
  const comments = [{ id: "1", content: `${AI_INDICATOR}\n\nThe answer is 42.` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, [{ role: "assistant", content: "The answer is 42." }]);
});

Deno.test("progress indicator comment: skipped", () => {
  const comments = [{ id: "1", content: PROGRESS_INDICATOR }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("progress comment ID: skipped regardless of content", () => {
  const comments = [{ id: "progress-id", content: "@ai hello" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("error prefix comment: skipped", () => {
  const comments = [{ id: "1", content: `${ERROR_PREFIX} something went wrong` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("empty content: skipped", () => {
  const comments = [{ id: "1", content: "   " }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("null content: skipped", () => {
  const comments = [{ id: "1", content: null }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("multi-turn conversation: preserves order with correct roles", () => {
  const comments = [
    { id: "1", content: "@ai what is TypeScript?" },
    { id: "2", content: `${AI_INDICATOR}\n\nTypeScript is a typed superset of JavaScript.` },
    { id: "3", content: "@ai can I use it in Deno?" },
  ];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result, [
    { role: "user", content: "what is TypeScript?" },
    { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
    { role: "user", content: "can I use it in Deno?" },
  ]);
});

Deno.test("user comment with no text after trigger: excluded (empty after strip)", () => {
  const comments = [{ id: "1", content: "@ai" }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result, []);
});

Deno.test("AI comment with only whitespace after stripping prefix: excluded", () => {
  const comments = [{ id: "1", content: `${AI_INDICATOR}\n\n   ` }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result, []);
});

Deno.test("error comment stored via updateComment: appears as assistant with error content", () => {
  // updateComment wraps errors with AI_INDICATOR, so they land as assistant messages
  const errorContent = `${AI_INDICATOR}\n\n${ERROR_PREFIX} timeout. Retry by adding a comment.`;
  const comments = [{ id: "1", content: errorContent }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result, [{
    role: "assistant",
    content: `${ERROR_PREFIX} timeout. Retry by adding a comment.`,
  }]);
});

Deno.test("standalone ERROR_PREFIX comment (not wrapped in AI_INDICATOR): skipped", () => {
  const comments = [{ id: "1", content: `${ERROR_PREFIX} something went wrong` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result, []);
});

Deno.test("multi-turn with error in history: error preserved as assistant turn", () => {
  const errorContent = `${AI_INDICATOR}\n\n${ERROR_PREFIX} network error. Retry by adding a comment.`;
  const comments = [
    { id: "1", content: "@ai help" },
    { id: "2", content: errorContent },
    { id: "3", content: "@ai try again" },
  ];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result, [
    { role: "user", content: "help" },
    { role: "assistant", content: `${ERROR_PREFIX} network error. Retry by adding a comment.` },
    { role: "user", content: "try again" },
  ]);
});

// ---------------------------------------------------------------------------
// normalizeBaseUrl — covers the trailing-space production bug
// ---------------------------------------------------------------------------

Deno.test("normalizeBaseUrl: strips trailing space", () => {
  assertEquals(
    normalizeBaseUrl("https://ai-proxy.example.com/v1 "),
    "https://ai-proxy.example.com/v1"
  );
});

Deno.test("normalizeBaseUrl: strips trailing slash", () => {
  assertEquals(
    normalizeBaseUrl("https://api.anthropic.com/v1/"),
    "https://api.anthropic.com/v1"
  );
});

Deno.test("normalizeBaseUrl: strips leading and trailing whitespace", () => {
  assertEquals(
    normalizeBaseUrl("  https://ai-proxy.example.com/v1  "),
    "https://ai-proxy.example.com/v1"
  );
});

Deno.test("normalizeBaseUrl: strips trailing newline", () => {
  assertEquals(
    normalizeBaseUrl("https://ai-proxy.example.com/v1\n"),
    "https://ai-proxy.example.com/v1"
  );
});

Deno.test("normalizeBaseUrl: clean URL unchanged", () => {
  assertEquals(
    normalizeBaseUrl("https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1"
  );
});

// ---------------------------------------------------------------------------
// normalizeModel — covers the leading/trailing-space production bug
// ---------------------------------------------------------------------------

Deno.test("normalizeModel: strips leading space", () => {
  assertEquals(normalizeModel(" claude-opus-4-6"), "claude-opus-4-6");
});

Deno.test("normalizeModel: strips trailing space", () => {
  assertEquals(normalizeModel("claude-opus-4-6 "), "claude-opus-4-6");
});

Deno.test("normalizeModel: strips surrounding whitespace", () => {
  assertEquals(normalizeModel(" claude-opus-4-6 "), "claude-opus-4-6");
});

Deno.test("normalizeModel: strips surrounding newlines", () => {
  assertEquals(normalizeModel("\nclaude-sonnet-4-6\n"), "claude-sonnet-4-6");
});

Deno.test("normalizeModel: clean model unchanged", () => {
  assertEquals(normalizeModel("claude-sonnet-4-6"), "claude-sonnet-4-6");
});

Deno.test("normalizeModel: production bug — Supabase secret with surrounding spaces", () => {
  // DEFAULT_AI_MODEL secret was stored as " claude-opus-4-6 ", causing model_not_found
  assertEquals(normalizeModel(" claude-opus-4-6 "), "claude-opus-4-6");
});
