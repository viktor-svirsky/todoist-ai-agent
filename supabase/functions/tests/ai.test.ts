import { assert, assertEquals, assertStringIncludes, assertRejects } from "@std/assert";
import { buildMessages, executePrompt, isAnthropicUrl, formatLinksForTodoist } from "../_shared/ai.ts";

Deno.test("buildMessages: starts with system message containing task content", () => {
  const result = buildMessages("Buy milk", undefined, []);
  assertEquals(result[0].role, "system");
  assertStringIncludes(result[0].content, "Buy milk");
});

Deno.test("buildMessages: includes task description when provided", () => {
  const result = buildMessages("Fix bug", "The login button is broken", []);
  assertStringIncludes(result[0].content, "The login button is broken");
});

Deno.test("buildMessages: no task description — no undefined in system message", () => {
  const result = buildMessages("Fix bug", undefined, []);
  assertEquals(result[0].content.includes("undefined"), false);
});

Deno.test("buildMessages: conversation messages appended after system", () => {
  const messages = [
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi there" },
  ];
  const result = buildMessages("Task", undefined, messages);
  assertEquals(result.length, 3); // system + 2 messages
  assertEquals(result[1], { role: "user", content: "hello" });
  assertEquals(result[2], { role: "assistant", content: "hi there" });
});

Deno.test("buildMessages: empty messages produces only system message", () => {
  const result = buildMessages("Task", undefined, []);
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "system");
});

Deno.test("buildMessages: image attached to last user message as content array", () => {
  const messages = [{ role: "user" as const, content: "look at this" }];
  const images = [{ data: "base64data", mediaType: "image/png" }];
  const result = buildMessages("Task", undefined, messages, images);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content[0], { type: "text", text: "look at this" });
  assertEquals(lastUserMsg.content[1], {
    type: "image_url",
    image_url: { url: "data:image/png;base64,base64data" },
  });
});

Deno.test("buildMessages: no images — message content stays as string", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const result = buildMessages("Task", undefined, messages);
  assertEquals(typeof result[1].content, "string");
});

Deno.test("buildMessages: custom prompt injected into system message", () => {
  const result = buildMessages("Task", undefined, [], undefined, "I live in Berlin");
  assertStringIncludes(result[0].content, "User's custom instructions:");
  assertStringIncludes(result[0].content, "I live in Berlin");
});

Deno.test("buildMessages: custom prompt appears before task context", () => {
  const result = buildMessages("Buy milk", undefined, [], undefined, "Respond in German");
  const content = result[0].content;
  const promptIdx = content.indexOf("Respond in German");
  const taskIdx = content.indexOf("Buy milk");
  assertEquals(promptIdx < taskIdx, true);
});

Deno.test("buildMessages: null custom prompt not included in system message", () => {
  const result = buildMessages("Task", undefined, [], undefined, null);
  assertEquals(result[0].content.includes("custom instructions"), false);
});

Deno.test("buildMessages: empty string custom prompt not included", () => {
  const result = buildMessages("Task", undefined, [], undefined, "");
  assertEquals(result[0].content.includes("custom instructions"), false);
});

Deno.test("buildMessages: undefined custom prompt not included", () => {
  const result = buildMessages("Task", undefined, []);
  assertEquals(result[0].content.includes("custom instructions"), false);
});

Deno.test("buildMessages: custom prompt + task description both present", () => {
  const result = buildMessages("Buy groceries", "Get milk and eggs", [], undefined, "I'm vegan");
  const content = result[0].content;
  assertStringIncludes(content, "I'm vegan");
  assertStringIncludes(content, "Buy groceries");
  assertStringIncludes(content, "Get milk and eggs");
  // Order: base prompt, custom instructions, task context
  const customIdx = content.indexOf("I'm vegan");
  const taskIdx = content.indexOf("Buy groceries");
  assertEquals(customIdx < taskIdx, true);
});

Deno.test("buildMessages: multiple images all attached to last user message", () => {
  const messages = [{ role: "user" as const, content: "compare these" }];
  const images = [
    { data: "img1data", mediaType: "image/png" },
    { data: "img2data", mediaType: "image/jpeg" },
  ];
  const result = buildMessages("Task", undefined, messages, images);
  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content.length, 3); // text + 2 images
  assertEquals(lastUserMsg.content[1].image_url.url, "data:image/png;base64,img1data");
  assertEquals(lastUserMsg.content[2].image_url.url, "data:image/jpeg;base64,img2data");
});

Deno.test("buildMessages: images with custom prompt — both present", () => {
  const messages = [{ role: "user" as const, content: "what is this?" }];
  const images = [{ data: "imgdata", mediaType: "image/png" }];
  const result = buildMessages("Task", undefined, messages, images, "I'm a designer");
  assertStringIncludes(result[0].content, "I'm a designer");
  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
});

Deno.test("buildMessages: images with no user messages — no crash", () => {
  const images = [{ data: "imgdata", mediaType: "image/png" }];
  const result = buildMessages("Task", undefined, [], images);
  // No user message to attach images to — system message only
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "system");
});

Deno.test("buildMessages: empty images array treated same as no images", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const result = buildMessages("Task", undefined, messages, []);
  assertEquals(typeof result[1].content, "string");
});

Deno.test("buildMessages: images attached to last user message, not first", () => {
  const messages = [
    { role: "user" as const, content: "first question" },
    { role: "assistant" as const, content: "first answer" },
    { role: "user" as const, content: "second question" },
  ];
  const images = [{ data: "imgdata", mediaType: "image/png" }];
  const result = buildMessages("Task", undefined, messages, images);
  // First user message stays as string
  assertEquals(typeof result[1].content, "string");
  assertEquals(result[1].content, "first question");
  // Last user message becomes array with image
  assertEquals(Array.isArray(result[3].content), true);
  assertEquals(result[3].content[0].text, "second question");
});

// ---------------------------------------------------------------------------
// Document attachment handling in buildMessages
// ---------------------------------------------------------------------------

Deno.test("buildMessages: PDF document attached to last user message as document_attachment", () => {
  const messages = [{ role: "user" as const, content: "analyze this" }];
  const docs = [{ data: "pdfbase64data", mediaType: "application/pdf", fileName: "report.pdf" }];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content[0], { type: "text", text: "analyze this" });
  assertEquals(lastUserMsg.content[1], {
    type: "document_attachment",
    file_name: "report.pdf",
    media_type: "application/pdf",
    data: "pdfbase64data",
  });
});

Deno.test("buildMessages: unsupported document (empty data) becomes text placeholder", () => {
  const messages = [{ role: "user" as const, content: "check this" }];
  const docs = [{ data: "", mediaType: "application/vnd.ms-excel", fileName: "data.xls" }];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content[1], {
    type: "text",
    text: "[Attached file: data.xls — only PDF and text-based files are supported for AI processing]",
  });
});

Deno.test("buildMessages: text file with textContent becomes text block with [File: name] prefix", () => {
  const messages = [{ role: "user" as const, content: "review this" }];
  const docs = [{ data: "", mediaType: "text/plain", fileName: "notes.txt", textContent: "Hello world" }];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content[1], {
    type: "text",
    text: "[File: notes.txt]\nHello world",
  });
});

Deno.test("buildMessages: text file truncated at 50k chars", () => {
  const messages = [{ role: "user" as const, content: "analyze" }];
  const longContent = "x".repeat(60_000);
  const docs = [{ data: "", mediaType: "text/plain", fileName: "big.log", textContent: longContent }];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  const textPart = lastUserMsg.content[1];
  assertEquals(textPart.type, "text");
  assertEquals(textPart.text.includes("[Content truncated]"), true);
  // 50k chars + prefix + truncation suffix
  assertEquals(textPart.text.length < 60_000, true);
});

Deno.test("buildMessages: text file + PDF combined on last user message", () => {
  const messages = [{ role: "user" as const, content: "compare" }];
  const docs = [
    { data: "", mediaType: "text/plain", fileName: "notes.txt", textContent: "some text" },
    { data: "pdfdata", mediaType: "application/pdf", fileName: "report.pdf" },
  ];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content.length, 3); // text + text_file + pdf_doc
  assertEquals(lastUserMsg.content[1].type, "text"); // text file
  assertEquals(lastUserMsg.content[1].text, "[File: notes.txt]\nsome text");
  assertEquals(lastUserMsg.content[2].type, "document_attachment"); // PDF
});

Deno.test("buildMessages: empty textContent string is treated as text file (not unsupported)", () => {
  const messages = [{ role: "user" as const, content: "check" }];
  const docs = [{ data: "", mediaType: "text/plain", fileName: "empty.txt", textContent: "" }];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(lastUserMsg.content[1], {
    type: "text",
    text: "[File: empty.txt]\n",
  });
});

Deno.test("buildMessages: images and documents combined on last user message", () => {
  const messages = [{ role: "user" as const, content: "review these" }];
  const images = [{ data: "imgdata", mediaType: "image/png" }];
  const docs = [{ data: "pdfdata", mediaType: "application/pdf", fileName: "doc.pdf" }];
  const result = buildMessages("Task", undefined, messages, images, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content.length, 3); // text + image + document
  assertEquals(lastUserMsg.content[0].type, "text");
  assertEquals(lastUserMsg.content[1].type, "image_url");
  assertEquals(lastUserMsg.content[2].type, "document_attachment");
});

Deno.test("buildMessages: documents with no user messages — no crash", () => {
  const docs = [{ data: "pdfdata", mediaType: "application/pdf", fileName: "doc.pdf" }];
  const result = buildMessages("Task", undefined, [], undefined, null, docs);
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "system");
});

Deno.test("buildMessages: empty documents array treated same as no documents", () => {
  const messages = [{ role: "user" as const, content: "hello" }];
  const result = buildMessages("Task", undefined, messages, undefined, null, []);
  assertEquals(typeof result[1].content, "string");
});

Deno.test("buildMessages: multiple documents all attached to last user message", () => {
  const messages = [{ role: "user" as const, content: "compare" }];
  const docs = [
    { data: "pdf1", mediaType: "application/pdf", fileName: "a.pdf" },
    { data: "pdf2", mediaType: "application/pdf", fileName: "b.pdf" },
  ];
  const result = buildMessages("Task", undefined, messages, undefined, null, docs);

  const lastUserMsg = result[result.length - 1];
  assertEquals(Array.isArray(lastUserMsg.content), true);
  assertEquals(lastUserMsg.content.length, 3); // text + 2 documents
  assertEquals(lastUserMsg.content[1].file_name, "a.pdf");
  assertEquals(lastUserMsg.content[2].file_name, "b.pdf");
});

Deno.test("buildMessages: system prompt includes file support mention", () => {
  const result = buildMessages("Task", undefined, []);
  assertStringIncludes(result[0].content, "attach files");
});

// Model identity in system prompt

Deno.test("buildMessages: model name included in system prompt when provided", () => {
  const result = buildMessages("Task", undefined, [], undefined, null, undefined, "claude-opus-4-6");
  assertStringIncludes(result[0].content as string, "You are powered by claude-opus-4-6.");
});

Deno.test("buildMessages: model name not included when omitted", () => {
  const result = buildMessages("Task", undefined, []);
  const content = result[0].content as string;
  assertEquals(content.includes("You are powered by"), false);
});

Deno.test("buildMessages: model name appears before custom prompt and task context", () => {
  const result = buildMessages("Buy milk", undefined, [], undefined, "Be helpful", undefined, "claude-sonnet-4-6");
  const content = result[0].content as string;
  const modelIdx = content.indexOf("You are powered by claude-sonnet-4-6.");
  const customIdx = content.indexOf("User's custom instructions:");
  const taskIdx = content.indexOf('Current task:');
  assert(modelIdx < customIdx, "model identity should appear before custom prompt");
  assert(modelIdx < taskIdx, "model identity should appear before task context");
});

// ---------------------------------------------------------------------------
// executePrompt — requires fetch mocking
// ---------------------------------------------------------------------------

function mockFetch(responses: Array<{ status: number; body: unknown }>): () => void {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

const BASE_CONFIG = {
  baseUrl: "http://test-ai.local",
  apiKey: "test-key",
  model: "test-model",
  timeoutMs: 5000,
};

Deno.test("executePrompt: throws when AI response exceeds size limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    // Return a response body larger than MAX_AI_RESPONSE_BYTES (10 MB)
    const oversized = "x".repeat(10 * 1024 * 1024 + 1);
    return Promise.resolve(new Response(oversized, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], BASE_CONFIG),
      Error,
      "AI response too large"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: returns content from simple response", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [{ message: { content: "Hello world" } }] },
  }]);
  try {
    const messages = [{ role: "system", content: "You are helpful" }];
    const result = await executePrompt(messages, BASE_CONFIG);
    assertEquals(result, "Hello world");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: returns '(no response)' when no choices", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [] },
  }]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], BASE_CONFIG);
    assertEquals(result, "(no response)");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: returns '(no response)' for empty content", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [{ message: { content: "" } }] },
  }]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], BASE_CONFIG);
    assertEquals(result, "(no response)");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: throws on API error", async () => {
  const restore = mockFetch([{
    status: 500,
    body: { error: "Internal Server Error" },
  }]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], BASE_CONFIG),
      Error,
      "AI API error 500"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: trims whitespace from response", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [{ message: { content: "  trimmed  " } }] },
  }]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], BASE_CONFIG);
    assertEquals(result, "trimmed");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: handles tool call and returns final response", async () => {
  const restore = mockFetch([
    // First call — model requests a tool call
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "web_search", arguments: '{"query":"test query"}' },
            }],
          },
        }],
      },
    },
    // Second call — model returns final answer after tool result
    {
      status: 200,
      body: { choices: [{ message: { content: "Here's what I found" } }] },
    },
  ]);
  try {
    // braveApiKey enables tool use
    const config = { ...BASE_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Here's what I found");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: handles multiple tool calls and returns combined result", async () => {
  const searchQueries: string[] = [];
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    // 1st fetch: AI call — model requests two tool calls
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"first"}' } },
              { id: "call_2", type: "function", function: { name: "web_search", arguments: '{"query":"second"}' } },
            ],
          },
        }],
      },
    },
    // 2nd fetch: Brave Search result for one of the calls
    { status: 200, body: { web: { results: [{ title: "R1", url: "https://r1.com", description: "d1" }] } } },
    // 3rd fetch: Brave Search result for the other call
    { status: 200, body: { web: { results: [{ title: "R2", url: "https://r2.com", description: "d2" }] } } },
    // 4th fetch: AI returns final answer
    {
      status: 200,
      body: { choices: [{ message: { content: "Combined answer" } }] },
    },
  ];
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    const host = new URL(url).hostname;
    if (host === "api.search.brave.com") {
      const q = new URL(url).searchParams.get("q") || "";
      searchQueries.push(q);
    }
    if (callIndex >= responses.length) {
      throw new Error(`Unexpected fetch call #${callIndex + 1}: ${url}`);
    }
    const response = responses[callIndex++];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const config = { ...BASE_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Combined answer");
    // Both search calls were made with correct queries
    assertEquals(searchQueries.length, 2);
    assertEquals(searchQueries.sort(), ["first", "second"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: no tool calls returns directly even with braveApiKey", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [{ message: { content: "Direct answer", tool_calls: [] } }] },
  }]);
  try {
    const config = { ...BASE_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Direct answer");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// isAnthropicUrl
// ---------------------------------------------------------------------------

Deno.test("isAnthropicUrl: detects api.anthropic.com", () => {
  assertEquals(isAnthropicUrl("https://api.anthropic.com/v1"), true);
});

Deno.test("isAnthropicUrl: detects subdomain of anthropic.com", () => {
  assertEquals(isAnthropicUrl("https://custom.anthropic.com"), true);
});

Deno.test("isAnthropicUrl: rejects OpenAI URL", () => {
  assertEquals(isAnthropicUrl("https://api.openai.com/v1"), false);
});

Deno.test("isAnthropicUrl: rejects other providers", () => {
  assertEquals(isAnthropicUrl("https://openrouter.ai/api/v1"), false);
});

Deno.test("isAnthropicUrl: rejects invalid URL", () => {
  assertEquals(isAnthropicUrl("not-a-url"), false);
});

Deno.test("isAnthropicUrl: rejects URL containing anthropic in path but not hostname", () => {
  assertEquals(isAnthropicUrl("https://proxy.example.com/anthropic.com/v1"), false);
});

// ---------------------------------------------------------------------------
// executePrompt — Anthropic provider
// ---------------------------------------------------------------------------

const ANTHROPIC_CONFIG = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-test-key",
  model: "claude-sonnet-4-6",
  timeoutMs: 5000,
};

Deno.test("executePrompt (Anthropic): returns content from text response", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { content: [{ type: "text", text: "Hello from Claude" }] },
  }]);
  try {
    const messages = [{ role: "system", content: "You are helpful" }];
    const result = await executePrompt(messages, ANTHROPIC_CONFIG);
    assertEquals(result, "Hello from Claude");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): returns '(no response)' for empty content", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { content: [] },
  }]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], ANTHROPIC_CONFIG);
    assertEquals(result, "(no response)");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): throws on API error", async () => {
  const restore = mockFetch([{
    status: 400,
    body: { error: { message: "Bad request" } },
  }]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], ANTHROPIC_CONFIG),
      Error,
      "AI API error 400"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): handles tool use and returns final response", async () => {
  const restore = mockFetch([
    // First call — model requests tool_use
    {
      status: 200,
      body: {
        content: [
          { type: "text", text: "Let me search for that." },
          { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "test query" } },
        ],
      },
    },
    // Second call — model returns final answer
    {
      status: 200,
      body: { content: [{ type: "text", text: "Here are the results" }] },
    },
  ]);
  try {
    const config = { ...ANTHROPIC_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Here are the results");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): no tool use returns directly even with braveApiKey", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { content: [{ type: "text", text: "Direct answer" }] },
  }]);
  try {
    const config = { ...ANTHROPIC_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Direct answer");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): trims whitespace from response", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { content: [{ type: "text", text: "  trimmed  " }] },
  }]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], ANTHROPIC_CONFIG);
    assertEquals(result, "trimmed");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): sends x-api-key header, not Bearer", async () => {
  let capturedHeaders: Record<string, string> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    await executePrompt([{ role: "system", content: "test" }], ANTHROPIC_CONFIG);
    assertEquals(capturedHeaders["x-api-key"], "sk-ant-test-key");
    assertEquals(capturedHeaders["Authorization"], undefined);
    assertEquals(capturedHeaders["anthropic-version"], "2023-06-01");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): sends system as top-level param, not in messages", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ];
    await executePrompt(messages, ANTHROPIC_CONFIG);
    assertStringIncludes(capturedBody.system as string, "You are helpful");
    const hasSystemMsg = (capturedBody.messages as Record<string, unknown>[]).some((m) => m.role === "system");
    assertEquals(hasSystemMsg, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): batches multiple tool results into single user message", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    // 1st fetch: AI call — model requests two tool_use blocks
    {
      status: 200,
      body: {
        content: [
          { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "query one" } },
          { type: "tool_use", id: "toolu_2", name: "web_search", input: { query: "query two" } },
        ],
      },
    },
    // 2nd fetch: Brave Search for first tool call
    { status: 200, body: { web: { results: [{ title: "R1", url: "https://r1.com", description: "d1" }] } } },
    // 3rd fetch: Brave Search for second tool call
    { status: 200, body: { web: { results: [{ title: "R2", url: "https://r2.com", description: "d2" }] } } },
    // 4th fetch: AI call — model returns final answer
    {
      status: 200,
      body: { content: [{ type: "text", text: "Combined results" }] },
    },
  ];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBodies.push(JSON.parse((init?.body as string) || "{}"));
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const config = { ...ANTHROPIC_CONFIG, braveApiKey: "brave-test-key" };
    const result = await executePrompt([{ role: "user", content: "test" }], config);
    assertEquals(result, "Combined results");
    // Fourth request (2nd AI call) should have tool results batched in a single user message
    const secondBody = capturedBodies[3];
    const toolResultMsgs = (secondBody.messages as Record<string, unknown>[]).filter(
      (m) => m.role === "user" && Array.isArray(m.content) && (m.content as Record<string, unknown>[]).some((c) => c.type === "tool_result")
    );
    // Should be exactly 1 user message containing both tool results
    assertEquals(toolResultMsgs.length, 1);
    assertEquals(toolResultMsgs[0].content.length, 2);
    assertEquals(toolResultMsgs[0].content[0].tool_use_id, "toolu_1");
    assertEquals(toolResultMsgs[0].content[1].tool_use_id, "toolu_2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): sends to /v1/messages endpoint", async () => {
  let capturedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    capturedUrl = String(input);
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    await executePrompt([{ role: "user", content: "test" }], ANTHROPIC_CONFIG);
    assertEquals(capturedUrl, "https://api.anthropic.com/v1/messages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// executePrompt — Fallback on overload
// ---------------------------------------------------------------------------

const FALLBACK_CONFIG = {
  ...BASE_CONFIG,
  fallbackModel: "fallback-model",
};

const ANTHROPIC_FALLBACK_CONFIG = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-test-key",
  model: "claude-opus-4-6",
  timeoutMs: 5000,
  fallbackModel: "claude-sonnet-4-6",
};

function mockFetchWithCapture(responses: Array<{ status: number; body: unknown }>): { restore: () => void; bodies: Record<string, unknown>[] } {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string));
    else bodies.push({});
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; }, bodies };
}

Deno.test("executePrompt: fallback triggers on 529 overload", async () => {
  const { restore, bodies } = mockFetchWithCapture([
    { status: 529, body: { error: { message: "Overloaded" } } },
    { status: 200, body: { choices: [{ message: { content: "Fallback response" } }] } },
  ]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG);
    assertEquals(result, "Fallback response");
    assertEquals(bodies[0].model, "test-model");
    assertEquals(bodies[1].model, "fallback-model");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: fallback triggers on 503 service unavailable", async () => {
  const { restore, bodies } = mockFetchWithCapture([
    { status: 503, body: { error: { message: "Service Unavailable" } } },
    { status: 200, body: { choices: [{ message: { content: "Fallback response" } }] } },
  ]);
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG);
    assertEquals(result, "Fallback response");
    assertEquals(bodies[0].model, "test-model");
    assertEquals(bodies[1].model, "fallback-model");
  } finally {
    restore();
  }
});

Deno.test("executePrompt: no fallback on 400 error", async () => {
  const restore = mockFetch([
    { status: 400, body: { error: { message: "Bad request" } } },
  ]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG),
      Error,
      "AI API error 400"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: no fallback on 401 error", async () => {
  const restore = mockFetch([
    { status: 401, body: { error: { message: "Unauthorized" } } },
  ]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG),
      Error,
      "AI API error 401"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: no fallback on 500 error", async () => {
  const restore = mockFetch([
    { status: 500, body: { error: { message: "Internal Server Error" } } },
  ]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG),
      Error,
      "AI API error 500"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: no fallback when fallbackModel not configured", async () => {
  const restore = mockFetch([
    { status: 529, body: { error: { message: "Overloaded" } } },
  ]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], BASE_CONFIG),
      Error,
      "AI API error 529"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: fallback also fails — throws fallback error", async () => {
  const restore = mockFetch([
    { status: 529, body: { error: { message: "Overloaded" } } },
    { status: 500, body: { error: { message: "Fallback also failed" } } },
  ]);
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], FALLBACK_CONFIG),
      Error,
      "AI API error 500"
    );
  } finally {
    restore();
  }
});

Deno.test("executePrompt: no double fallback — second overload throws", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    // Round 0: primary overloaded → triggers fallback
    { status: 529, body: { error: { message: "Overloaded" } } },
    // Fallback succeeds on round 0 with tool call
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }],
          },
        }],
      },
    },
    // Brave search result
    { status: 200, body: { web: { results: [{ title: "R1", url: "https://r1.com", description: "d1" }] } } },
    // Round 1: fallback also overloaded — should throw (already fallen back)
    { status: 529, body: { error: { message: "Overloaded again" } } },
  ];
  globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    await assertRejects(
      () => executePrompt([{ role: "system", content: "test" }], { ...FALLBACK_CONFIG, braveApiKey: "brave-key" }),
      Error,
      "AI API error 529"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: mid-tool-loop fallback — primary succeeds round 1, fails round 2", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const bodies: Record<string, unknown>[] = [];
  const responses = [
    // Round 0: primary model returns tool call
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"test"}' } }],
          },
        }],
      },
    },
    // Brave search result
    { status: 200, body: { web: { results: [{ title: "R1", url: "https://r1.com", description: "d1" }] } } },
    // Round 1: primary model overloaded
    { status: 529, body: { error: { message: "Overloaded" } } },
    // Fallback model succeeds
    { status: 200, body: { choices: [{ message: { content: "Fallback answer" } }] } },
  ];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string));
    else bodies.push({});
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const config = { ...FALLBACK_CONFIG, braveApiKey: "brave-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Fallback answer");
    // First AI call used primary model
    assertEquals(bodies[0].model, "test-model");
    // Second AI call (round 1) used primary model (before fallback)
    assertEquals(bodies[2].model, "test-model");
    // Third AI call (fallback retry) used fallback model
    assertEquals(bodies[3].model, "fallback-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: fallback does not mutate original config", async () => {
  const { restore } = mockFetchWithCapture([
    { status: 529, body: { error: { message: "Overloaded" } } },
    { status: 200, body: { choices: [{ message: { content: "ok" } }] } },
  ]);
  try {
    const config = { ...FALLBACK_CONFIG };
    const originalModel = config.model;
    await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(config.model, originalModel);
  } finally {
    restore();
  }
});

Deno.test("executePrompt: final response fallback on 529", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const bodies: Record<string, unknown>[] = [];
  const responses = [
    // Rounds 0,1,2: tool calls exhaust MAX_TOOL_ROUNDS
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"q1"}' } }],
          },
        }],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_2", type: "function", function: { name: "web_search", arguments: '{"query":"q2"}' } }],
          },
        }],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: "call_3", type: "function", function: { name: "web_search", arguments: '{"query":"q3"}' } }],
          },
        }],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    // Final response: primary overloaded
    { status: 529, body: { error: { message: "Overloaded" } } },
    // Fallback final response
    { status: 200, body: { choices: [{ message: { content: "Fallback final" } }] } },
  ];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string));
    else bodies.push({});
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const config = { ...FALLBACK_CONFIG, braveApiKey: "brave-key" };
    const result = await executePrompt([{ role: "system", content: "test" }], config);
    assertEquals(result, "Fallback final");
    // Final request uses primary model, then fallback
    assertEquals(bodies[6].model, "test-model");
    assertEquals(bodies[7].model, "fallback-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): fallback triggers on 529", async () => {
  const { restore, bodies } = mockFetchWithCapture([
    { status: 529, body: { error: { message: "Overloaded" } } },
    { status: 200, body: { content: [{ type: "text", text: "Anthropic fallback" }] } },
  ]);
  try {
    const result = await executePrompt([{ role: "user", content: "test" }], ANTHROPIC_FALLBACK_CONFIG);
    assertEquals(result, "Anthropic fallback");
    assertEquals(bodies[0].model, "claude-opus-4-6");
    assertEquals(bodies[1].model, "claude-sonnet-4-6");
  } finally {
    restore();
  }
});

Deno.test("executePrompt (Anthropic): final response fallback after exhausted tool rounds", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const bodies: Record<string, unknown>[] = [];
  const responses = [
    // Rounds 0,1,2: tool calls exhaust MAX_TOOL_ROUNDS (Anthropic format)
    {
      status: 200,
      body: {
        content: [
          { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "q1" } },
        ],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    {
      status: 200,
      body: {
        content: [
          { type: "tool_use", id: "toolu_2", name: "web_search", input: { query: "q2" } },
        ],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    {
      status: 200,
      body: {
        content: [
          { type: "tool_use", id: "toolu_3", name: "web_search", input: { query: "q3" } },
        ],
      },
    },
    { status: 200, body: { web: { results: [] } } },
    // Final response: primary overloaded
    { status: 529, body: { error: { message: "Overloaded" } } },
    // Fallback final response (Anthropic format)
    { status: 200, body: { content: [{ type: "text", text: "Anthropic fallback final" }] } },
  ];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    if (init?.body) bodies.push(JSON.parse(init.body as string));
    else bodies.push({});
    const response = responses[callIndex++] || responses[responses.length - 1];
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  try {
    const config = { ...ANTHROPIC_FALLBACK_CONFIG, braveApiKey: "brave-key" };
    const result = await executePrompt([{ role: "user", content: "test" }], config);
    assertEquals(result, "Anthropic fallback final");
    // Final request uses primary model, then fallback
    assertEquals(bodies[6].model, "claude-opus-4-6");
    assertEquals(bodies[7].model, "claude-sonnet-4-6");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// executePrompt — fetch_url tool
// ---------------------------------------------------------------------------

Deno.test("executePrompt: fetch_url tool always included even without braveApiKey", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    await executePrompt([{ role: "system", content: "test" }], BASE_CONFIG);
    const tools = capturedBody.tools as Record<string, unknown>[];
    assertEquals(Array.isArray(tools), true);
    const toolNames = tools.map((t) => (t.function as Record<string, unknown>).name);
    assertEquals(toolNames.includes("fetch_url"), true);
    assertEquals(toolNames.includes("web_search"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: both fetch_url and web_search included with braveApiKey", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    await executePrompt([{ role: "system", content: "test" }], { ...BASE_CONFIG, braveApiKey: "key" });
    const tools = capturedBody.tools as Record<string, unknown>[];
    assertEquals(Array.isArray(tools), true);
    const toolNames = tools.map((t) => (t.function as Record<string, unknown>).name);
    assertEquals(toolNames.includes("fetch_url"), true);
    assertEquals(toolNames.includes("web_search"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): fetch_url and built-in web_search always included", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    await executePrompt([{ role: "user", content: "test" }], ANTHROPIC_CONFIG);
    const tools = capturedBody.tools as Record<string, unknown>[];
    assertEquals(Array.isArray(tools), true);
    const toolNames = tools.map((t) => t.name);
    assertEquals(toolNames.includes("fetch_url"), true);
    // Built-in Anthropic web search included when no braveApiKey
    assertEquals(toolNames.includes("web_search"), true);
    const webSearchTool = tools.find((t) => t.name === "web_search");
    assertEquals(webSearchTool!.type, "web_search_20250305");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt: handles fetch_url tool call", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    // 1st fetch: AI call — model requests fetch_url
    {
      status: 200,
      body: {
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "fetch_url", arguments: '{"url":"https://example.com"}' },
            }],
          },
        }],
      },
    },
    // 2nd fetch: fetchUrl fetches the page
    {
      status: 200,
      body: "<html><body><p>Page content here</p></body></html>",
      contentType: "text/html",
    },
    // 3rd fetch: AI returns final answer
    {
      status: 200,
      body: { choices: [{ message: { content: "Based on the page content" } }] },
    },
  ];
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    const response = responses[callIndex++];
    if (!response) throw new Error(`Unexpected fetch #${callIndex}: ${url}`);
    const isHtml = typeof response.body === "string";
    return Promise.resolve(new Response(
      isHtml ? response.body : JSON.stringify(response.body),
      {
        status: response.status,
        headers: {
          "Content-Type": isHtml ? "text/html" : "application/json",
        },
      }
    ));
  }) as typeof fetch;
  try {
    const result = await executePrompt([{ role: "system", content: "test" }], BASE_CONFIG);
    assertEquals(result, "Based on the page content");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("executePrompt (Anthropic): handles fetch_url tool call", async () => {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;
  const responses = [
    // 1st fetch: AI call — Anthropic model requests fetch_url
    {
      status: 200,
      body: {
        content: [
          { type: "text", text: "Let me read that page." },
          { type: "tool_use", id: "toolu_1", name: "fetch_url", input: { url: "https://example.com" } },
        ],
      },
    },
    // 2nd fetch: fetchUrl fetches the page
    {
      status: 200,
      body: "<html><body><p>Anthropic page content</p></body></html>",
      contentType: "text/html",
    },
    // 3rd fetch: AI returns final answer
    {
      status: 200,
      body: { content: [{ type: "text", text: "Based on the Anthropic page content" }] },
    },
  ];
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    const response = responses[callIndex++];
    if (!response) throw new Error(`Unexpected fetch #${callIndex}: ${url}`);
    const isHtml = typeof response.body === "string";
    return Promise.resolve(new Response(
      isHtml ? response.body : JSON.stringify(response.body),
      {
        status: response.status,
        headers: {
          "Content-Type": isHtml ? "text/html" : "application/json",
        },
      }
    ));
  }) as typeof fetch;
  try {
    const result = await executePrompt([{ role: "user", content: "test" }], ANTHROPIC_CONFIG);
    assertEquals(result, "Based on the Anthropic page content");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// executePrompt — Document attachment conversion per provider
// ---------------------------------------------------------------------------

Deno.test("executePrompt (Anthropic): document_attachment converted to Anthropic document block", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "I read the PDF" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const messages = buildMessages(
      "Review doc", undefined,
      [{ role: "user" as const, content: "check this PDF" }],
      undefined, null,
      [{ data: "cGRmZGF0YQ==", mediaType: "application/pdf", fileName: "report.pdf" }],
    );
    await executePrompt(messages, ANTHROPIC_CONFIG);

    const apiMessages = capturedBody.messages as Record<string, unknown>[];
    const userMsg = apiMessages.find((m) => m.role === "user");
    const content = userMsg!.content as Record<string, unknown>[];
    const docPart = content.find((p) => p.type === "document");
    assertEquals(docPart!.type, "document");
    const source = docPart!.source as Record<string, unknown>;
    assertEquals(source.type, "base64");
    assertEquals(source.media_type, "application/pdf");
    assertEquals(source.data, "cGRmZGF0YQ==");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// formatLinksForTodoist
// ---------------------------------------------------------------------------

Deno.test("formatLinksForTodoist: converts bare HTTPS URL to markdown link", () => {
  const result = formatLinksForTodoist("Check https://www.keeper.sh/ for details");
  assertEquals(result, "Check [keeper.sh](https://www.keeper.sh/) for details");
});

Deno.test("formatLinksForTodoist: converts bare HTTP URL to markdown link", () => {
  const result = formatLinksForTodoist("Visit http://example.com for info");
  assertEquals(result, "Visit [example.com](http://example.com) for info");
});

Deno.test("formatLinksForTodoist: preserves existing markdown links", () => {
  const input = "Check [Keeper](https://www.keeper.sh/) for details";
  assertEquals(formatLinksForTodoist(input), input);
});

Deno.test("formatLinksForTodoist: handles URL with trailing period", () => {
  const result = formatLinksForTodoist("Visit https://example.com.");
  assertEquals(result, "Visit [example.com](https://example.com).");
});

Deno.test("formatLinksForTodoist: handles URL with trailing comma", () => {
  const result = formatLinksForTodoist("See https://example.com, and more");
  assertEquals(result, "See [example.com](https://example.com), and more");
});

Deno.test("formatLinksForTodoist: handles multiple bare URLs", () => {
  const result = formatLinksForTodoist("Check https://a.com and https://b.com");
  assertEquals(result, "Check [a.com](https://a.com) and [b.com](https://b.com)");
});

Deno.test("formatLinksForTodoist: mixed markdown and bare URLs", () => {
  const result = formatLinksForTodoist("See [Link](https://a.com) and https://b.com");
  assertEquals(result, "See [Link](https://a.com) and [b.com](https://b.com)");
});

Deno.test("formatLinksForTodoist: no URLs — returns unchanged", () => {
  const input = "No links here, just plain text.";
  assertEquals(formatLinksForTodoist(input), input);
});

Deno.test("formatLinksForTodoist: URL with path preserved", () => {
  const result = formatLinksForTodoist("See https://example.com/path/to/page for details");
  assertEquals(result, "See [example.com](https://example.com/path/to/page) for details");
});

Deno.test("formatLinksForTodoist: URL with query string preserved", () => {
  const result = formatLinksForTodoist("See https://example.com/search?q=test for results");
  assertEquals(result, "See [example.com](https://example.com/search?q=test) for results");
});

Deno.test("formatLinksForTodoist: strips www from display text", () => {
  const result = formatLinksForTodoist("Visit https://www.example.com");
  assertEquals(result, "Visit [example.com](https://www.example.com)");
});

Deno.test("formatLinksForTodoist: URL at start of text", () => {
  const result = formatLinksForTodoist("https://example.com is a great site");
  assertEquals(result, "[example.com](https://example.com) is a great site");
});

Deno.test("formatLinksForTodoist: URL at end of text", () => {
  const result = formatLinksForTodoist("Visit https://example.com");
  assertEquals(result, "Visit [example.com](https://example.com)");
});

Deno.test("formatLinksForTodoist: Wikipedia URL with balanced parentheses preserved", () => {
  const result = formatLinksForTodoist("See https://en.wikipedia.org/wiki/Foo_(bar) for info");
  assertEquals(result, "See [en.wikipedia.org](https://en.wikipedia.org/wiki/Foo_(bar)) for info");
});

Deno.test("formatLinksForTodoist: URL with unbalanced trailing paren stripped", () => {
  const result = formatLinksForTodoist("(see https://example.com)");
  assertEquals(result, "(see [example.com](https://example.com))");
});

Deno.test("formatLinksForTodoist: executePrompt applies formatting to response", async () => {
  const restore = mockFetch([{
    status: 200,
    body: { choices: [{ message: { content: "Visit https://www.keeper.sh/ for password management" } }] },
  }]);
  try {
    const messages = [{ role: "system", content: "You are helpful" }];
    const result = await executePrompt(messages, BASE_CONFIG);
    assertEquals(result, "Visit [keeper.sh](https://www.keeper.sh/) for password management");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// executePrompt — Document attachment conversion per provider
// ---------------------------------------------------------------------------

Deno.test("executePrompt (OpenAI): document_attachment converted to text placeholder", async () => {
  let capturedBody: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const messages = buildMessages(
      "Review doc", undefined,
      [{ role: "user" as const, content: "check this PDF" }],
      undefined, null,
      [{ data: "cGRmZGF0YQ==", mediaType: "application/pdf", fileName: "report.pdf" }],
    );
    await executePrompt(messages, BASE_CONFIG);

    const apiMessages = capturedBody.messages as Record<string, unknown>[];
    const userMsg = apiMessages.find((m) => m.role === "user");
    const content = userMsg!.content as Record<string, unknown>[];
    // document_attachment should be converted to text placeholder
    const docPart = content.find((p) => (p as Record<string, unknown>).type === "document_attachment");
    assertEquals(docPart, undefined); // no document_attachment in OpenAI
    const textParts = content.filter((p) => p.type === "text");
    const hasPlaceholder = textParts.some((p) =>
      (p.text as string).includes("document processing requires Anthropic provider")
    );
    assertEquals(hasPlaceholder, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
