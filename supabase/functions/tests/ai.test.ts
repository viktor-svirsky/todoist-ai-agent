import { assertEquals, assertStringIncludes, assertRejects } from "jsr:@std/assert";
import { buildMessages, executePrompt } from "../_shared/ai.ts";

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
