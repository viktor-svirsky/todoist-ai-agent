/**
 * E2E integration tests for fetchUrl — makes REAL HTTP calls.
 * Run with: deno test supabase/functions/tests/e2e/fetch-url.e2e.test.ts --no-check --allow-env --allow-net --allow-read
 *
 * These tests catch issues that mocked tests miss:
 * - Real redirect chains, TLS, encoding
 * - Bot-blocking / User-Agent issues
 * - Content-type detection on real pages
 * - Deno runtime network behavior
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fetchUrl, htmlToText } from "../../_shared/fetch-url.ts";

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

// ---------------------------------------------------------------------------
// fetchUrl — real HTML pages
// ---------------------------------------------------------------------------

t("e2e fetchUrl: extracts text from httpbin.org HTML page", async () => {
  const result = await fetchUrl("https://httpbin.org/html");
  // httpbin.org/html returns a page with "Herman Melville - Moby Dick"
  assertStringIncludes(result, "Herman Melville");
  assertEquals(result.includes("Error"), false, `Unexpected error: ${result}`);
});

t("e2e fetchUrl: extracts text from example.com", async () => {
  const result = await fetchUrl("https://example.com");
  assertStringIncludes(result, "Example Domain");
  assertEquals(result.includes("Error"), false, `Unexpected error: ${result}`);
});

// ---------------------------------------------------------------------------
// fetchUrl — text/plain content
// ---------------------------------------------------------------------------

t("e2e fetchUrl: reads text/plain content from httpbin.org", async () => {
  const result = await fetchUrl("https://httpbin.org/robots.txt");
  // httpbin returns a robots.txt with User-agent or similar
  assertEquals(result.includes("Error"), false, `Unexpected error: ${result}`);
  assertEquals(result.length > 0, true, "Should return non-empty text");
});

// ---------------------------------------------------------------------------
// fetchUrl — redirect following
// ---------------------------------------------------------------------------

t("e2e fetchUrl: follows redirect chain", async () => {
  const result = await fetchUrl("https://httpbin.org/redirect/2");
  // After following 2 redirects, should reach a final page
  assertEquals(result.includes("Too many redirects"), false, "Should handle 2 redirects fine");
  // httpbin.org/redirect/2 eventually returns JSON, which may not be text/html
  // so it might return a content-type error — that's fine, the point is redirects work
});

t("e2e fetchUrl: follows single redirect (http->https)", async () => {
  // example.com sometimes redirects http -> https
  const result = await fetchUrl("http://example.com");
  // Should either get content or follow redirect successfully
  assertEquals(
    result.startsWith("Error: private") || result.startsWith("Error: only HTTP"),
    false,
    "Should not block example.com",
  );
});

// ---------------------------------------------------------------------------
// fetchUrl — error handling with real servers
// ---------------------------------------------------------------------------

t("e2e fetchUrl: returns error for 404 page", async () => {
  const result = await fetchUrl("https://httpbin.org/status/404");
  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "404");
});

t("e2e fetchUrl: returns error for 500 page", async () => {
  const result = await fetchUrl("https://httpbin.org/status/500");
  assertStringIncludes(result, "Error");
  assertStringIncludes(result, "500");
});

// ---------------------------------------------------------------------------
// fetchUrl — binary content rejection
// ---------------------------------------------------------------------------

t("e2e fetchUrl: rejects binary content (image)", async () => {
  const result = await fetchUrl("https://httpbin.org/image/png");
  assertStringIncludes(result, "Cannot extract text from content type");
});

t("e2e fetchUrl: rejects binary content (octet-stream)", async () => {
  const result = await fetchUrl("https://httpbin.org/bytes/100");
  assertStringIncludes(result, "Cannot extract text from content type");
});

// ---------------------------------------------------------------------------
// fetchUrl — SSRF protection (no real HTTP needed)
// ---------------------------------------------------------------------------

t("e2e fetchUrl: blocks private IP", async () => {
  const result = await fetchUrl("http://192.168.1.1/admin");
  assertStringIncludes(result, "private or internal");
});

t("e2e fetchUrl: blocks localhost", async () => {
  const result = await fetchUrl("http://localhost:8080/secret");
  assertStringIncludes(result, "private or internal");
});

t("e2e fetchUrl: blocks metadata endpoint", async () => {
  const result = await fetchUrl("http://169.254.169.254/latest/meta-data/");
  assertStringIncludes(result, "private or internal");
});

// ---------------------------------------------------------------------------
// fetchUrl — real-world pages (complex HTML)
// ---------------------------------------------------------------------------

t("e2e fetchUrl: handles Wikipedia page", async () => {
  const result = await fetchUrl("https://en.wikipedia.org/wiki/TypeScript");
  assertStringIncludes(result, "TypeScript");
  assertEquals(result.includes("<script"), false, "Should strip script tags");
  assertEquals(result.includes("<style"), false, "Should strip style tags");
  assertEquals(result.length > 100, true, "Should extract substantial text");
});

t("e2e fetchUrl: handles GitHub raw content", async () => {
  // GitHub raw files serve as text/plain
  const result = await fetchUrl(
    "https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md",
  );
  assertEquals(result.includes("Error"), false, `Unexpected error: ${result}`);
  assertEquals(result.length > 50, true, "Should have license text content");
});

// ---------------------------------------------------------------------------
// htmlToText — real-world HTML snippets
// ---------------------------------------------------------------------------

Deno.test("e2e htmlToText: handles deeply nested suppressed tags", () => {
  const html = `
    <nav>
      <script>var x = 1;</script>
      <style>.nav { color: red; }</style>
      <a href="/">Home</a>
    </nav>
    <main>
      <article>
        <h1>Title</h1>
        <p>Content with <strong>bold</strong> and <em>italic</em></p>
      </article>
    </main>
    <footer>
      <script>analytics();</script>
      Copyright 2024
    </footer>
  `;
  const text = htmlToText(html);
  assertStringIncludes(text, "Title");
  assertStringIncludes(text, "Content with bold and italic");
  assertEquals(text.includes("var x = 1"), false);
  assertEquals(text.includes("analytics"), false);
  assertEquals(text.includes(".nav"), false);
});
