import { assertEquals } from "@std/assert";
import { commentsToMessages, normalizeBaseUrl, normalizeModel } from "../_shared/messages.ts";
import { AI_INDICATOR, ERROR_PREFIX, PROGRESS_INDICATOR } from "../_shared/constants.ts";

// ---------------------------------------------------------------------------
// commentsToMessages
// ---------------------------------------------------------------------------

Deno.test("user comment: strips trigger word and returns user role", () => {
  const comments = [{ id: "1", content: "@ai help me with this task" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, [{ role: "user", content: "help me with this task" }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("user comment: trigger word stripped case-insensitively", () => {
  const comments = [{ id: "1", content: "@AI What is 2+2?" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, [{ role: "user", content: "What is 2+2?" }]);
});

Deno.test("AI comment: strips AI_INDICATOR prefix and returns assistant role", () => {
  const comments = [{ id: "1", content: `${AI_INDICATOR}\n\nThe answer is 42.` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, [{ role: "assistant", content: "The answer is 42." }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("progress indicator comment: skipped", () => {
  const comments = [{ id: "1", content: PROGRESS_INDICATOR }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
  assertEquals(result.commentIds, []);
});

Deno.test("progress comment ID: skipped regardless of content", () => {
  const comments = [{ id: "progress-id", content: "@ai hello" }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
});

Deno.test("error prefix comment: skipped", () => {
  const comments = [{ id: "1", content: `${ERROR_PREFIX} something went wrong` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
  assertEquals(result.commentIds, []);
});

Deno.test("empty content: skipped", () => {
  const comments = [{ id: "1", content: "   " }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
});

Deno.test("null content: skipped", () => {
  const comments = [{ id: "1", content: null }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
});

Deno.test("multi-turn conversation: preserves order with correct roles", () => {
  const comments = [
    { id: "1", content: "@ai what is TypeScript?" },
    { id: "2", content: `${AI_INDICATOR}\n\nTypeScript is a typed superset of JavaScript.` },
    { id: "3", content: "@ai can I use it in Deno?" },
  ];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [
    { role: "user", content: "what is TypeScript?" },
    { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
    { role: "user", content: "can I use it in Deno?" },
  ]);
  assertEquals(result.commentIds, ["1", "2", "3"]);
});

Deno.test("user comment with no text after trigger: excluded (empty after strip)", () => {
  const comments = [{ id: "1", content: "@ai" }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, []);
});

Deno.test("AI comment with only whitespace after stripping prefix: excluded", () => {
  const comments = [{ id: "1", content: `${AI_INDICATOR}\n\n   ` }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, []);
});

Deno.test("error comment stored via updateComment: appears as assistant with error content", () => {
  // updateComment wraps errors with AI_INDICATOR, so they land as assistant messages
  const errorContent = `${AI_INDICATOR}\n\n${ERROR_PREFIX} timeout. Retry by adding a comment.`;
  const comments = [{ id: "1", content: errorContent }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{
    role: "assistant",
    content: `${ERROR_PREFIX} timeout. Retry by adding a comment.`,
  }]);
});

Deno.test("standalone ERROR_PREFIX comment (not wrapped in AI_INDICATOR): skipped", () => {
  const comments = [{ id: "1", content: `${ERROR_PREFIX} something went wrong` }];
  const result = commentsToMessages(comments, "@ai", "progress-id");
  assertEquals(result.messages, []);
});

Deno.test("multi-turn with error in history: error preserved as assistant turn", () => {
  const errorContent = `${AI_INDICATOR}\n\n${ERROR_PREFIX} network error. Retry by adding a comment.`;
  const comments = [
    { id: "1", content: "@ai help" },
    { id: "2", content: errorContent },
    { id: "3", content: "@ai try again" },
  ];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [
    { role: "user", content: "help" },
    { role: "assistant", content: `${ERROR_PREFIX} network error. Retry by adding a comment.` },
    { role: "user", content: "try again" },
  ]);
  assertEquals(result.commentIds, ["1", "2", "3"]);
});

Deno.test("trigger word with regex special chars (e.g. $ai): stripped correctly", () => {
  const comments = [{ id: "1", content: "$ai help me" }];
  const result = commentsToMessages(comments, "$ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "help me" }]);
});

Deno.test("trigger word with dot (e.g. .ai): stripped correctly", () => {
  const comments = [{ id: "1", content: ".ai what is this?" }];
  const result = commentsToMessages(comments, ".ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "what is this?" }]);
});

Deno.test("multiple trigger words in one comment: all stripped", () => {
  const comments = [{ id: "1", content: "@ai tell @ai me" }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "tell me" }]);
});

Deno.test("comment with undefined content: skipped", () => {
  const comments = [{ id: "1", content: undefined }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, []);
});

Deno.test("empty comments array: returns empty", () => {
  const result = commentsToMessages([], "@ai", "none");
  assertEquals(result.messages, []);
  assertEquals(result.commentIds, []);
});

// ---------------------------------------------------------------------------
// Image attachment handling
// ---------------------------------------------------------------------------

Deno.test("image-only comment (no text): included as [image] placeholder", () => {
  const comments = [{
    id: "1",
    content: "",
    file_attachment: { file_type: "image/png", file_name: "img.png", file_url: "https://files.todoist.com/img.png" },
  }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "[image]" }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("comment with text and attachment: text content used, ID tracked", () => {
  const comments = [{
    id: "1",
    content: "@ai what is this?",
    file_attachment: { file_type: "image/png", file_name: "img.png", file_url: "https://files.todoist.com/img.png" },
  }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "what is this?" }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("image-only comment with null content: included as [image]", () => {
  const comments = [{
    id: "1",
    content: null,
    file_attachment: { file_type: "image/png", file_name: "img.png", file_url: "https://files.todoist.com/img.png" },
  }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "[image]" }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("comment with only trigger word + attachment: included as [image]", () => {
  const comments = [{
    id: "1",
    content: "@ai",
    file_attachment: { file_type: "image/png", file_name: "img.png", file_url: "https://files.todoist.com/img.png" },
  }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [{ role: "user", content: "[image]" }]);
  assertEquals(result.commentIds, ["1"]);
});

Deno.test("empty comment without attachment: still skipped", () => {
  const comments = [{ id: "1", content: "" }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, []);
  assertEquals(result.commentIds, []);
});

Deno.test("non-image attachment (PDF) without text: skipped", () => {
  const comments = [{
    id: "1",
    content: "",
    file_attachment: { file_type: "application/pdf", file_name: "doc.pdf", file_url: "https://files.todoist.com/doc.pdf" },
  }];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, []);
  assertEquals(result.commentIds, []);
});

Deno.test("multi-turn with image-only comment in middle: preserved in order", () => {
  const comments = [
    { id: "1", content: "@ai help" },
    { id: "2", content: `${AI_INDICATOR}\n\nSure, send me the image.` },
    {
      id: "3",
      content: "",
      file_attachment: { file_type: "image/png", file_name: "img.png", file_url: "https://files.todoist.com/img.png" },
    },
  ];
  const result = commentsToMessages(comments, "@ai", "none");
  assertEquals(result.messages, [
    { role: "user", content: "help" },
    { role: "assistant", content: "Sure, send me the image." },
    { role: "user", content: "[image]" },
  ]);
  assertEquals(result.commentIds, ["1", "2", "3"]);
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
