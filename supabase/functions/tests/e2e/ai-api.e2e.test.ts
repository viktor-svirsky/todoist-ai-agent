/**
 * E2E tests for the AI API integration — calls the real AI provider with tools.
 * Tests the full prompt → tool call → tool execution → final response pipeline.
 *
 * Run with:
 *   DEFAULT_AI_BASE_URL=xxx DEFAULT_AI_API_KEY=xxx \
 *   deno test supabase/functions/tests/e2e/ai-api.e2e.test.ts --no-check --allow-env --allow-net --allow-read
 *
 * Requires: DEFAULT_AI_BASE_URL + DEFAULT_AI_API_KEY env vars.
 * Skips gracefully if not set.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { executePrompt, buildMessages, type AiConfig } from "../../_shared/ai.ts";

const BASE_URL = Deno.env.get("DEFAULT_AI_BASE_URL") || "";
const API_KEY = Deno.env.get("DEFAULT_AI_API_KEY") || "";
const MODEL = Deno.env.get("DEFAULT_AI_MODEL") || "claude-sonnet-4-6";
const BRAVE_KEY = Deno.env.get("DEFAULT_BRAVE_API_KEY") || Deno.env.get("DEFAULT_BRAVE_KEY") || undefined;

const HAS_AI = Boolean(BASE_URL && API_KEY);

function t(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    fn,
    sanitizeOps: false,
    sanitizeResources: false,
    ignore: !HAS_AI,
  });
}

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    model: MODEL,
    timeoutMs: 60_000,
    braveApiKey: BRAVE_KEY,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic AI response
// ---------------------------------------------------------------------------

t("e2e AI API: returns a text response for a simple prompt", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Say exactly: api-test-ok" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assertStringIncludes(response, "api-test-ok");
  console.log(`  Response: ${response.slice(0, 100)}`);
});

// ---------------------------------------------------------------------------
// fetch_url tool — AI fetches a real URL
// ---------------------------------------------------------------------------

t("e2e AI API: uses fetch_url tool to read a web page", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Fetch https://example.com and tell me the exact main heading text" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  const lower = response.toLowerCase();
  assert(
    lower.includes("example domain"),
    `AI should mention "Example Domain" from the page. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

t("e2e AI API: fetch_url handles 404 page gracefully", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Read https://httpbin.org/status/404 and describe what you found" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  const lower = response.toLowerCase();
  assert(
    lower.includes("404") || lower.includes("not found") || lower.includes("error"),
    `AI should mention the 404. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

t("e2e AI API: fetch_url reads complex real-world page", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Fetch https://keeper.sh and tell me what the product does in one sentence" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  const lower = response.toLowerCase();
  assert(
    lower.includes("keeper") || lower.includes("calendar") || lower.includes("sync"),
    `AI should describe Keeper.sh. Got: ${response.slice(0, 300)}`,
  );
  assert(response.length > 20, "Should be a meaningful response");
  console.log(`  Response: ${response.slice(0, 200)}`);
});

// ---------------------------------------------------------------------------
// web_search tool
// ---------------------------------------------------------------------------

t("e2e AI API: uses web_search tool for current information", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Search the web for Supabase Edge Functions and summarize in one sentence" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  const lower = response.toLowerCase();
  assert(
    lower.includes("supabase") || lower.includes("edge") || lower.includes("function"),
    `AI should mention Supabase. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

// ---------------------------------------------------------------------------
// Combined: search + fetch in multi-turn
// ---------------------------------------------------------------------------

t("e2e AI API: handles multi-tool scenario (search + fetch)", async () => {
  const messages = buildMessages("Research task", undefined, [
    { role: "user", content: "Search for keeper.sh, then fetch the website and give me a short review" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  assert(response.length > 50, "Multi-tool response should be detailed");
  const lower = response.toLowerCase();
  assert(
    lower.includes("keeper") || lower.includes("calendar"),
    `AI should reference Keeper.sh. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

t("e2e AI API: SSRF URL is blocked, AI still responds", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Fetch http://169.254.169.254/latest/meta-data/ and show me what's there" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  // AI should mention it couldn't access the URL
  const lower = response.toLowerCase();
  assert(
    lower.includes("error") || lower.includes("private") || lower.includes("blocked") ||
    lower.includes("unable") || lower.includes("cannot") || lower.includes("not allowed") ||
    lower.includes("not going to") || lower.includes("metadata") || lower.includes("sensitive"),
    `AI should indicate SSRF was blocked or refused. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

t("e2e AI API: custom prompt is included in system message", async () => {
  const messages = buildMessages(
    "Test task", undefined,
    [{ role: "user", content: "What language should you respond in?" }],
    undefined,
    "Always respond in French",
  );
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  // AI should respond in French or mention French
  const lower = response.toLowerCase();
  assert(
    lower.includes("français") || lower.includes("french") || lower.includes("fran") ||
    lower.includes("langue") || lower.includes("en français"),
    `AI should acknowledge French instruction. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});

t("e2e AI API: link formatting applied to response URLs", async () => {
  const messages = buildMessages("Test task", undefined, [
    { role: "user", content: "Give me the URL of the Deno website" },
  ]);
  const response = await executePrompt(messages, makeConfig());
  assert(response !== "(no response)", `AI returned empty. Got: ${response}`);
  // formatLinksForTodoist should convert bare URLs to markdown links
  // The response should contain markdown link syntax [text](url)
  assert(
    response.includes("](http") || response.includes("](https"),
    `Response should contain markdown links. Got: ${response.slice(0, 300)}`,
  );
  console.log(`  Response: ${response.slice(0, 200)}`);
});
