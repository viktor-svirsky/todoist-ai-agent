/**
 * E2E integration tests for AI tool call handlers — makes REAL HTTP calls.
 * Tests the handleToolCall flow with real fetch_url and web_search.
 * Run with: deno test supabase/functions/tests/e2e/ai-tools.e2e.test.ts --no-check --allow-env --allow-net --allow-read
 *
 * These tests verify the full tool call pipeline works end-to-end,
 * catching issues where individual modules pass but integration fails.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleToolCall } from "../../_shared/ai.ts";

const BRAVE_API_KEY = Deno.env.get("DEFAULT_BRAVE_API_KEY") || Deno.env.get("DEFAULT_BRAVE_KEY") || "";

function t(name: string, fn: () => Promise<void>, shouldIgnore = false) {
  Deno.test({
    name,
    fn,
    sanitizeOps: false,
    sanitizeResources: false,
    ignore: shouldIgnore,
  });
}

// ---------------------------------------------------------------------------
// fetch_url tool — real HTTP
// ---------------------------------------------------------------------------

t("e2e tool fetch_url: fetches real HTML page and returns text", async () => {
  const result = await handleToolCall(
    "fetch_url",
    JSON.stringify({ url: "https://httpbin.org/html" }),
  );
  assertStringIncludes(result, "Herman Melville");
  assertEquals(result.startsWith("Error"), false, `Unexpected error: ${result}`);
});

t("e2e tool fetch_url: fetches example.com successfully", async () => {
  const result = await handleToolCall(
    "fetch_url",
    JSON.stringify({ url: "https://example.com" }),
  );
  assertStringIncludes(result, "Example Domain");
});

t("e2e tool fetch_url: handles 404 gracefully", async () => {
  const result = await handleToolCall(
    "fetch_url",
    JSON.stringify({ url: "https://httpbin.org/status/404" }),
  );
  assertStringIncludes(result, "Error");
});

t("e2e tool fetch_url: blocks SSRF", async () => {
  const result = await handleToolCall(
    "fetch_url",
    JSON.stringify({ url: "http://192.168.1.1/admin" }),
  );
  assertStringIncludes(result, "private or internal");
});

t("e2e tool fetch_url: rejects binary content", async () => {
  const result = await handleToolCall(
    "fetch_url",
    JSON.stringify({ url: "https://httpbin.org/image/png" }),
  );
  assertStringIncludes(result, "Cannot extract text");
});

t("e2e tool fetch_url: empty URL returns error", async () => {
  const result = await handleToolCall("fetch_url", JSON.stringify({ url: "" }));
  assertStringIncludes(result, "Error");
});

t("e2e tool fetch_url: invalid JSON returns error", async () => {
  const result = await handleToolCall("fetch_url", "not-json");
  assertStringIncludes(result, "Tool error");
});

// ---------------------------------------------------------------------------
// web_search tool — real Brave API
// ---------------------------------------------------------------------------

t("e2e tool web_search: returns formatted search results", async () => {
  const result = await handleToolCall(
    "web_search",
    JSON.stringify({ query: "Deno runtime", count: 3 }),
    BRAVE_API_KEY,
  );
  assertEquals(result.startsWith("Error"), false, `Unexpected error: ${result}`);
  assertEquals(result.startsWith("No results"), false, "Should find results for 'Deno runtime'");
  // Results should be markdown-formatted
  assertStringIncludes(result, "](http");
}, !BRAVE_API_KEY);

t("e2e tool web_search: returns error without API key", async () => {
  const result = await handleToolCall(
    "web_search",
    JSON.stringify({ query: "test" }),
    undefined,
  );
  assertStringIncludes(result, "not configured");
});

t("e2e tool web_search: empty query returns error", async () => {
  const result = await handleToolCall(
    "web_search",
    JSON.stringify({ query: "" }),
    BRAVE_API_KEY,
  );
  assertStringIncludes(result, "Error");
}, !BRAVE_API_KEY);

// ---------------------------------------------------------------------------
// Proxy-prefixed tool names (some proxies rename tools)
// ---------------------------------------------------------------------------

t("e2e tool proxy_fetch_url: handles proxy-prefixed tool name", async () => {
  const result = await handleToolCall(
    "proxy_fetch_url",
    JSON.stringify({ url: "https://example.com" }),
  );
  assertStringIncludes(result, "Example Domain");
});

t("e2e tool proxy_web_search: handles proxy-prefixed search", async () => {
  const result = await handleToolCall(
    "proxy_web_search",
    JSON.stringify({ query: "test" }),
    undefined,
  );
  assertStringIncludes(result, "not configured");
});

// ---------------------------------------------------------------------------
// Proxy tool name compatibility — verify AI provider returns names we handle
// ---------------------------------------------------------------------------

const AI_PROXY_URL = Deno.env.get("DEFAULT_AI_BASE_URL") || "";
const AI_PROXY_KEY = Deno.env.get("DEFAULT_AI_API_KEY") || "";
const KNOWN_TOOL_NAMES = ["web_search", "fetch_url"];

/**
 * Calls the real AI proxy with tools and a prompt that forces a tool call.
 * Verifies the returned tool name (after normalization) matches one we handle.
 * This catches proxy renaming issues (e.g. proxy_fetch_url) before they hit production.
 */
t("e2e tool names: AI proxy returns tool names compatible with handleToolCall", async () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "fetch_url",
        description: "Fetch a URL",
        parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
  ];

  const res = await fetch(`${AI_PROXY_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_PROXY_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("DEFAULT_AI_MODEL") || "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You must use tools to answer. Always use fetch_url for URLs." },
        { role: "user", content: "Fetch https://example.com" },
      ],
      max_tokens: 200,
      tools,
    }),
  });

  assertEquals(res.ok, true, `AI proxy should return 200, got ${res.status}`);
  const data = await res.json();
  const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
  assertEquals(toolCalls.length > 0, true, "AI should return at least one tool call");

  for (const tc of toolCalls) {
    const rawName = tc.function?.name || tc.name || "";
    const normalized = rawName.replace(/^proxy_/, "");
    const isKnown = KNOWN_TOOL_NAMES.includes(normalized);
    assertEquals(
      isKnown,
      true,
      `Proxy returned tool name "${rawName}" (normalized: "${normalized}") which is not in ${JSON.stringify(KNOWN_TOOL_NAMES)}. ` +
      `Either add it to handleToolCall or fix the proxy config.`,
    );
    // Also verify handleToolCall doesn't return "Unknown tool" for the raw name
    const result = await handleToolCall(rawName, tc.function?.arguments || "{}", undefined);
    assertEquals(
      result.startsWith("Unknown tool"),
      false,
      `handleToolCall should recognize "${rawName}" but returned: ${result.slice(0, 100)}`,
    );
  }

  console.log(`  Proxy tool names: ${toolCalls.map((tc: Record<string, Record<string, string>>) => tc.function?.name).join(", ")}`);
}, !AI_PROXY_URL || !AI_PROXY_KEY);

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------

t("e2e tool unknown: returns unknown tool error", async () => {
  const result = await handleToolCall("nonexistent_tool", "{}");
  assertStringIncludes(result, "Unknown tool");
});
