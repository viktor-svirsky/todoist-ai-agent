import { assertEquals } from "jsr:@std/assert";
import { validateSettings } from "../_shared/validation.ts";

// -- max_messages --

Deno.test("validateSettings: valid max_messages", () => {
  assertEquals(validateSettings({ max_messages: 1 }), []);
  assertEquals(validateSettings({ max_messages: 50 }), []);
  assertEquals(validateSettings({ max_messages: 100 }), []);
});

Deno.test("validateSettings: max_messages below minimum", () => {
  const errors = validateSettings({ max_messages: 0 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "max_messages");
});

Deno.test("validateSettings: max_messages above maximum", () => {
  const errors = validateSettings({ max_messages: 101 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "max_messages");
});

Deno.test("validateSettings: max_messages non-integer", () => {
  const errors = validateSettings({ max_messages: 5.5 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "max_messages");
});

Deno.test("validateSettings: max_messages not a number", () => {
  const errors = validateSettings({ max_messages: "ten" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "max_messages");
});

// -- trigger_word --

Deno.test("validateSettings: valid trigger_word", () => {
  assertEquals(validateSettings({ trigger_word: "@ai" }), []);
  assertEquals(validateSettings({ trigger_word: "a" }), []);
  assertEquals(validateSettings({ trigger_word: "a".repeat(50) }), []);
});

Deno.test("validateSettings: trigger_word empty string", () => {
  const errors = validateSettings({ trigger_word: "" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "trigger_word");
});

Deno.test("validateSettings: trigger_word too long", () => {
  const errors = validateSettings({ trigger_word: "a".repeat(51) });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "trigger_word");
});

// -- custom_ai_base_url --

Deno.test("validateSettings: valid URLs", () => {
  assertEquals(validateSettings({ custom_ai_base_url: "https://api.openai.com/v1" }), []);
  assertEquals(validateSettings({ custom_ai_base_url: "http://localhost:8080" }), []);
});

Deno.test("validateSettings: null URL allowed", () => {
  assertEquals(validateSettings({ custom_ai_base_url: null }), []);
});

Deno.test("validateSettings: invalid URL", () => {
  const errors = validateSettings({ custom_ai_base_url: "not-a-url" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_ai_base_url");
});

Deno.test("validateSettings: non-http protocol rejected", () => {
  const errors = validateSettings({ custom_ai_base_url: "ftp://example.com" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_ai_base_url");
});

// -- custom_ai_model --

Deno.test("validateSettings: valid model", () => {
  assertEquals(validateSettings({ custom_ai_model: "gpt-4" }), []);
  assertEquals(validateSettings({ custom_ai_model: null }), []);
});

Deno.test("validateSettings: model too long", () => {
  const errors = validateSettings({ custom_ai_model: "a".repeat(101) });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_ai_model");
});

// -- custom_ai_api_key --

Deno.test("validateSettings: valid api key", () => {
  assertEquals(validateSettings({ custom_ai_api_key: "sk-abc123" }), []);
  assertEquals(validateSettings({ custom_ai_api_key: null }), []);
});

Deno.test("validateSettings: api key too long", () => {
  const errors = validateSettings({ custom_ai_api_key: "a".repeat(501) });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_ai_api_key");
});

// -- custom_brave_key --

Deno.test("validateSettings: valid brave key", () => {
  assertEquals(validateSettings({ custom_brave_key: "BSA12345" }), []);
  assertEquals(validateSettings({ custom_brave_key: null }), []);
});

Deno.test("validateSettings: brave key too long", () => {
  const errors = validateSettings({ custom_brave_key: "a".repeat(501) });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_brave_key");
});

// -- multiple fields --

Deno.test("validateSettings: multiple valid fields", () => {
  const errors = validateSettings({
    max_messages: 50,
    trigger_word: "@bot",
    custom_ai_base_url: "https://api.openai.com/v1",
  });
  assertEquals(errors, []);
});

Deno.test("validateSettings: multiple invalid fields return all errors", () => {
  const errors = validateSettings({
    max_messages: -1,
    trigger_word: "",
    custom_ai_base_url: "not-valid",
  });
  assertEquals(errors.length, 3);
});

Deno.test("validateSettings: empty updates return no errors", () => {
  assertEquals(validateSettings({}), []);
});
