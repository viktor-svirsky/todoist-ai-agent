import { assertEquals } from "@std/assert";
import { validateSettings, isPrivateHostname } from "../_shared/validation.ts";

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

// -- isPrivateHostname --

Deno.test("isPrivateHostname: detects localhost", () => {
  assertEquals(isPrivateHostname("localhost"), true);
  assertEquals(isPrivateHostname("::1"), true);
});

Deno.test("isPrivateHostname: detects private IPv4 ranges", () => {
  assertEquals(isPrivateHostname("10.0.0.1"), true);
  assertEquals(isPrivateHostname("10.255.255.255"), true);
  assertEquals(isPrivateHostname("172.16.0.1"), true);
  assertEquals(isPrivateHostname("172.31.255.255"), true);
  assertEquals(isPrivateHostname("192.168.0.1"), true);
  assertEquals(isPrivateHostname("192.168.255.255"), true);
  assertEquals(isPrivateHostname("127.0.0.1"), true);
  assertEquals(isPrivateHostname("127.0.0.2"), true);
  assertEquals(isPrivateHostname("0.0.0.0"), true);
});

Deno.test("isPrivateHostname: detects link-local / AWS metadata", () => {
  assertEquals(isPrivateHostname("169.254.169.254"), true);
  assertEquals(isPrivateHostname("169.254.0.1"), true);
});

Deno.test("isPrivateHostname: detects cloud metadata hostnames", () => {
  assertEquals(isPrivateHostname("metadata.google.internal"), true);
  assertEquals(isPrivateHostname("metadata.goog"), true);
});

Deno.test("isPrivateHostname: allows public hostnames", () => {
  assertEquals(isPrivateHostname("api.openai.com"), false);
  assertEquals(isPrivateHostname("api.anthropic.com"), false);
  assertEquals(isPrivateHostname("8.8.8.8"), false);
  assertEquals(isPrivateHostname("172.15.0.1"), false); // just outside 172.16/12
  assertEquals(isPrivateHostname("172.32.0.1"), false); // just outside 172.16/12
});

// -- custom_ai_base_url --

Deno.test("validateSettings: valid HTTPS URLs", () => {
  assertEquals(validateSettings({ custom_ai_base_url: "https://api.openai.com/v1" }), []);
  assertEquals(validateSettings({ custom_ai_base_url: "https://api.anthropic.com/v1" }), []);
});

Deno.test("validateSettings: HTTP URLs rejected", () => {
  const errors = validateSettings({ custom_ai_base_url: "http://api.openai.com/v1" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Must use HTTPS protocol");
});

Deno.test("validateSettings: localhost URLs rejected", () => {
  const errors = validateSettings({ custom_ai_base_url: "https://localhost:8080" });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Private or internal URLs are not allowed");
});

Deno.test("validateSettings: private IP URLs rejected", () => {
  assertEquals(validateSettings({ custom_ai_base_url: "https://10.0.0.1/v1" }).length, 1);
  assertEquals(validateSettings({ custom_ai_base_url: "https://192.168.1.1/v1" }).length, 1);
  assertEquals(validateSettings({ custom_ai_base_url: "https://169.254.169.254" }).length, 1);
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
