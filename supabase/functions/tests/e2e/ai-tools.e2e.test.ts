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

function t(name: string, fn: () => Promise<void>, requiresBrave = false) {
  Deno.test({
    name,
    fn,
    sanitizeOps: false,
    sanitizeResources: false,
    ignore: requiresBrave && !BRAVE_API_KEY,
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
}, true);

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
}, true);

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
// Unknown tool
// ---------------------------------------------------------------------------

t("e2e tool unknown: returns unknown tool error", async () => {
  const result = await handleToolCall("nonexistent_tool", "{}");
  assertStringIncludes(result, "Unknown tool");
});
