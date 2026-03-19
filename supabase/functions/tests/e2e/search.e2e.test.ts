/**
 * E2E integration tests for braveSearch — makes REAL HTTP calls to Brave Search API.
 * Run with: deno test supabase/functions/tests/e2e/search.e2e.test.ts --no-check --allow-env --allow-net --allow-read
 *
 * Requires: DEFAULT_BRAVE_API_KEY env var set to a valid Brave Search API key.
 * Skips gracefully if the key is not available.
 */

import { assertEquals } from "@std/assert";
import { braveSearch } from "../../_shared/search.ts";

const BRAVE_API_KEY = Deno.env.get("DEFAULT_BRAVE_API_KEY") || Deno.env.get("DEFAULT_BRAVE_KEY") || "";

function t(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    fn,
    sanitizeOps: false,
    sanitizeResources: false,
    ignore: !BRAVE_API_KEY,
  });
}

// ---------------------------------------------------------------------------
// braveSearch — real API calls
// ---------------------------------------------------------------------------

t("e2e braveSearch: returns results for a common query", async () => {
  const results = await braveSearch(BRAVE_API_KEY, "Deno JavaScript runtime", 3);
  assertEquals(results.length > 0, true, "Should return at least one result");
  for (const r of results) {
    assertEquals(typeof r.title, "string", "Result should have a title");
    assertEquals(typeof r.url, "string", "Result should have a URL");
    assertEquals(typeof r.description, "string", "Result should have a description");
    assertEquals(r.title.length > 0, true, "Title should not be empty");
    assertEquals(r.url.startsWith("http"), true, "URL should start with http");
  }
});

t("e2e braveSearch: respects count parameter", async () => {
  const results = await braveSearch(BRAVE_API_KEY, "TypeScript programming language", 2);
  assertEquals(results.length <= 2, true, "Should return at most 2 results");
  assertEquals(results.length > 0, true, "Should return at least 1 result");
});

t("e2e braveSearch: handles query with special characters", async () => {
  const results = await braveSearch(BRAVE_API_KEY, "what is 2+2?", 3);
  // Should not throw — special chars should be URL-encoded
  assertEquals(Array.isArray(results), true, "Should return an array");
});

t("e2e braveSearch: returns results relevant to query", async () => {
  const results = await braveSearch(BRAVE_API_KEY, "Supabase edge functions documentation", 5);
  assertEquals(results.length > 0, true, "Should return results");
  // At least one result should mention Supabase
  const hasRelevant = results.some(
    (r) =>
      r.title.toLowerCase().includes("supabase") ||
      r.description.toLowerCase().includes("supabase") ||
      r.url.includes("supabase"),
  );
  assertEquals(hasRelevant, true, "At least one result should be relevant to Supabase");
});
