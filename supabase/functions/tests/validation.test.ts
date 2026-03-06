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

// -- custom_prompt --

Deno.test("validateSettings: valid custom_prompt", () => {
  assertEquals(validateSettings({ custom_prompt: "I live in Berlin" }), []);
  assertEquals(validateSettings({ custom_prompt: "a".repeat(2000) }), []);
  assertEquals(validateSettings({ custom_prompt: null }), []);
});

Deno.test("validateSettings: custom_prompt too long", () => {
  const errors = validateSettings({ custom_prompt: "a".repeat(2001) });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_prompt");
});

Deno.test("validateSettings: custom_prompt not a string", () => {
  const errors = validateSettings({ custom_prompt: 123 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "custom_prompt");
});

Deno.test("validateSettings: custom_prompt at exactly 2000 chars (boundary)", () => {
  assertEquals(validateSettings({ custom_prompt: "a".repeat(2000) }), []);
});

// -- digest_enabled --

Deno.test("validateSettings: digest_enabled must be boolean", () => {
  assertEquals(validateSettings({ digest_enabled: true }), []);
  assertEquals(validateSettings({ digest_enabled: false }), []);
  const errors = validateSettings({ digest_enabled: "yes" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "digest_enabled");
});

// -- digest_time --

Deno.test("validateSettings: digest_time must be valid HH:MM format", () => {
  assertEquals(validateSettings({ digest_time: "08:00" }), []);
  assertEquals(validateSettings({ digest_time: "23:59" }), []);
  assertEquals(validateSettings({ digest_time: "00:00" }), []);
});

Deno.test("validateSettings: digest_time rejects invalid format", () => {
  const errors1 = validateSettings({ digest_time: "8:00" });
  assertEquals(errors1.length, 1);
  assertEquals(errors1[0].field, "digest_time");

  const errors2 = validateSettings({ digest_time: "25:00" });
  assertEquals(errors2.length, 1);
  assertEquals(errors2[0].field, "digest_time");

  const errors3 = validateSettings({ digest_time: "08:60" });
  assertEquals(errors3.length, 1);
  assertEquals(errors3[0].field, "digest_time");
});

Deno.test("validateSettings: digest_time rejects non-string", () => {
  const errors = validateSettings({ digest_time: 800 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "digest_time");
});

// -- digest_timezone --

Deno.test("validateSettings: digest_timezone must be valid IANA timezone", () => {
  assertEquals(validateSettings({ digest_timezone: "America/New_York" }), []);
  assertEquals(validateSettings({ digest_timezone: "Europe/London" }), []);
  assertEquals(validateSettings({ digest_timezone: "UTC" }), []);
});

Deno.test("validateSettings: digest_timezone rejects invalid timezone", () => {
  const errors = validateSettings({ digest_timezone: "Mars/Olympus" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "digest_timezone");
});

Deno.test("validateSettings: digest_timezone rejects non-string", () => {
  const errors = validateSettings({ digest_timezone: 123 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "digest_timezone");
});

// -- digest_project_id --

Deno.test("validateSettings: digest_project_id must be string or null", () => {
  assertEquals(validateSettings({ digest_project_id: "12345" }), []);
  assertEquals(validateSettings({ digest_project_id: null }), []);
  const errors = validateSettings({ digest_project_id: 12345 });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "digest_project_id");
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
