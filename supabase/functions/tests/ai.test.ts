import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildMessages } from "../_shared/ai.ts";

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
