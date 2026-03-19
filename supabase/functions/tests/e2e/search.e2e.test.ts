/**
 * E2E integration tests for braveSearch — makes REAL HTTP calls to Brave Search API.
 * Run with: deno test supabase/functions/tests/e2e/search.e2e.test.ts --no-check --allow-env --allow-net --allow-read
 *
 * Requires: DEFAULT_BRAVE_API_KEY env var set to a valid Brave Search API key.
 * Skips gracefully if the key is not available.
 *
 * Note: Brave free tier has strict rate limits (~1 req/s).
 * All assertions are consolidated into a single test to avoid 429 errors.
 */

import { assertEquals } from "@std/assert";
import { braveSearch } from "../../_shared/search.ts";

const BRAVE_API_KEY = Deno.env.get("DEFAULT_BRAVE_API_KEY") || Deno.env.get("DEFAULT_BRAVE_KEY") || "";

Deno.test({
  name: "e2e braveSearch: returns valid, relevant results from real API",
  fn: async () => {
    const results = await braveSearch(BRAVE_API_KEY, "Supabase edge functions", 3);

    // Returns results
    assertEquals(results.length > 0, true, "Should return at least one result");
    assertEquals(results.length <= 3, true, "Should respect count parameter");

    // Results have correct shape
    for (const r of results) {
      assertEquals(typeof r.title, "string", "Result should have a title");
      assertEquals(typeof r.url, "string", "Result should have a URL");
      assertEquals(typeof r.description, "string", "Result should have a description");
      assertEquals(r.title.length > 0, true, "Title should not be empty");
      assertEquals(r.url.startsWith("http"), true, "URL should start with http");
    }

    // Results are relevant
    const hasRelevant = results.some(
      (r) =>
        r.title.toLowerCase().includes("supabase") ||
        r.description.toLowerCase().includes("supabase") ||
        r.url.includes("supabase"),
    );
    assertEquals(hasRelevant, true, "At least one result should be relevant to Supabase");
  },
  sanitizeOps: false,
  sanitizeResources: false,
  ignore: !BRAVE_API_KEY,
});
