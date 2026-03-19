import { assertEquals, assertStringIncludes } from "@std/assert";
import { htmlToText, fetchUrl } from "../_shared/fetch-url.ts";

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

Deno.test("htmlToText: strips script tags and their content", () => {
  const html = "<p>Hello</p><script>alert('xss')</script><p>World</p>";
  assertEquals(htmlToText(html), "Hello\nWorld");
});

Deno.test("htmlToText: strips style tags and their content", () => {
  const html = "<style>body { color: red; }</style><p>Content</p>";
  assertEquals(htmlToText(html), "Content");
});

Deno.test("htmlToText: strips noscript tags", () => {
  const html = "<p>Visible</p><noscript>Enable JavaScript</noscript>";
  assertEquals(htmlToText(html), "Visible");
});

Deno.test("htmlToText: strips nav, header, footer", () => {
  const html = "<nav>Menu</nav><p>Main content</p><footer>Copyright</footer>";
  assertEquals(htmlToText(html), "Main content");
});

Deno.test("htmlToText: converts block tags to newlines", () => {
  const html = "<p>First</p><p>Second</p><div>Third</div>";
  const result = htmlToText(html);
  assertStringIncludes(result, "First\nSecond\nThird");
});

Deno.test("htmlToText: converts br to newline", () => {
  const html = "Line 1<br/>Line 2<br>Line 3";
  assertEquals(htmlToText(html), "Line 1\nLine 2\nLine 3");
});

Deno.test("htmlToText: decodes HTML entities", () => {
  const html = "<p>Tom &amp; Jerry &lt;3&gt; &quot;friends&quot; &#39;forever&#39;</p>";
  const result = htmlToText(html);
  assertStringIncludes(result, 'Tom & Jerry <3> "friends" \'forever\'');
});

Deno.test("htmlToText: decodes numeric and hex entities", () => {
  const html = "<p>&#65; &#x42;</p>";
  assertStringIncludes(htmlToText(html), "A B");
});

Deno.test("htmlToText: decodes nbsp", () => {
  const html = "<p>Hello&nbsp;World</p>";
  assertStringIncludes(htmlToText(html), "Hello World");
});

Deno.test("htmlToText: collapses excessive whitespace", () => {
  const html = "<p>  lots   of   spaces  </p>";
  assertEquals(htmlToText(html), "lots of spaces");
});

Deno.test("htmlToText: collapses excessive newlines", () => {
  const html = "<p>First</p>\n\n\n\n<p>Second</p>";
  const result = htmlToText(html);
  assertEquals(result, "First\n\nSecond");
});

Deno.test("htmlToText: strips remaining HTML tags", () => {
  const html = "<p>Text with <strong>bold</strong> and <a href='#'>link</a></p>";
  assertEquals(htmlToText(html), "Text with bold and link");
});

Deno.test("htmlToText: handles heading tags", () => {
  const html = "<h1>Title</h1><p>Body</p>";
  const result = htmlToText(html);
  assertStringIncludes(result, "Title\nBody");
});

Deno.test("htmlToText: handles empty input", () => {
  assertEquals(htmlToText(""), "");
});

Deno.test("htmlToText: handles plain text (no HTML)", () => {
  assertEquals(htmlToText("Just plain text"), "Just plain text");
});

// ---------------------------------------------------------------------------
// fetchUrl — requires fetch mocking
// ---------------------------------------------------------------------------

function mockFetchForUrl(
  responses: Map<string, { status: number; body: string; headers?: Record<string, string> }>
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    const resp = responses.get(url);
    if (!resp) {
      return Promise.reject(new TypeError(`Unexpected fetch: ${url}`));
    }
    const responseHeaders = new Headers({
      "content-type": "text/html",
      ...resp.headers,
    });
    return Promise.resolve(new Response(resp.body, {
      status: resp.status,
      headers: responseHeaders,
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

Deno.test("fetchUrl: returns extracted text from HTML page", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/page", {
      status: 200,
      body: "<html><body><p>Hello World</p></body></html>",
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/page");
    assertStringIncludes(result, "Hello World");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: returns plain text for text/plain content", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/text", {
      status: 200,
      body: "Plain text content",
      headers: { "content-type": "text/plain" },
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/text");
    assertEquals(result, "Plain text content");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: returns error for invalid URL", async () => {
  const result = await fetchUrl("not-a-url");
  assertStringIncludes(result, "Error: invalid URL");
});

Deno.test("fetchUrl: returns error for non-HTTP protocol", async () => {
  const result = await fetchUrl("ftp://example.com/file");
  assertStringIncludes(result, "only HTTP and HTTPS");
});

Deno.test("fetchUrl: blocks private/internal hostnames", async () => {
  const result = await fetchUrl("http://localhost:3000/secret");
  assertStringIncludes(result, "private or internal");
});

Deno.test("fetchUrl: blocks 127.0.0.1", async () => {
  const result = await fetchUrl("http://127.0.0.1/api");
  assertStringIncludes(result, "private or internal");
});

Deno.test("fetchUrl: blocks 10.x private range", async () => {
  const result = await fetchUrl("http://10.0.0.1/internal");
  assertStringIncludes(result, "private or internal");
});

Deno.test("fetchUrl: blocks 192.168.x private range", async () => {
  const result = await fetchUrl("http://192.168.1.1/router");
  assertStringIncludes(result, "private or internal");
});

Deno.test("fetchUrl: blocks 169.254.169.254 metadata endpoint", async () => {
  const result = await fetchUrl("http://169.254.169.254/latest/meta-data/");
  assertStringIncludes(result, "private or internal");
});

Deno.test("fetchUrl: returns error for HTTP error status", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/404", { status: 404, body: "Not found" }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/404");
    assertStringIncludes(result, "Error: HTTP 404");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: rejects non-text content types", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/image.png", {
      status: 200,
      body: "binary data",
      headers: { "content-type": "image/png" },
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/image.png");
    assertStringIncludes(result, "Cannot extract text from content type");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: returns error for empty content", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/empty", {
      status: 200,
      body: "",
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/empty");
    assertStringIncludes(result, "Error: page returned empty content");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: truncates content exceeding MAX_FETCH_CONTENT_CHARS", async () => {
  const longContent = "<p>" + "a".repeat(60_000) + "</p>";
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/long", {
      status: 200,
      body: longContent,
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/long");
    assertStringIncludes(result, "[Content truncated]");
    // Result should be roughly MAX_FETCH_CONTENT_CHARS + truncation notice
    assertEquals(result.length <= 50_100, true);
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: rejects page exceeding MAX_FETCH_BYTES via content-length", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/huge", {
      status: 200,
      body: "small body",
      headers: { "content-length": String(3 * 1024 * 1024) },
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/huge");
    assertStringIncludes(result, "Error: page too large");
  } finally {
    restore();
  }
});

Deno.test("fetchUrl: follows redirects and returns content", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    callCount++;
    if (url === "https://example.com/redirect") {
      return Promise.resolve(new Response("", {
        status: 301,
        headers: { "Location": "https://example.com/final" },
      }));
    }
    if (url === "https://example.com/final") {
      return Promise.resolve(new Response("<p>Final page</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  try {
    const result = await fetchUrl("https://example.com/redirect");
    assertStringIncludes(result, "Final page");
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchUrl: blocks redirect to private host", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    if (url === "https://example.com/ssrf") {
      return Promise.resolve(new Response("", {
        status: 302,
        headers: { "Location": "http://169.254.169.254/latest/meta-data/" },
      }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  try {
    const result = await fetchUrl("https://example.com/ssrf");
    assertStringIncludes(result, "private/internal host blocked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchUrl: blocks redirect loop", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = String(input);
    if (url === "https://example.com/loop-a") {
      return Promise.resolve(new Response("", {
        status: 302,
        headers: { "Location": "https://example.com/loop-b" },
      }));
    }
    if (url === "https://example.com/loop-b") {
      return Promise.resolve(new Response("", {
        status: 302,
        headers: { "Location": "https://example.com/loop-a" },
      }));
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as typeof fetch;
  try {
    const result = await fetchUrl("https://example.com/loop-a");
    assertStringIncludes(result, "Redirect loop detected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchUrl: limits maximum redirects", async () => {
  const originalFetch = globalThis.fetch;
  let counter = 0;
  globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
    counter++;
    return Promise.resolve(new Response("", {
      status: 302,
      headers: { "Location": `https://example.com/hop-${counter}` },
    }));
  }) as typeof fetch;
  try {
    const result = await fetchUrl("https://example.com/start");
    assertStringIncludes(result, "Too many redirects");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchUrl: strips script tags from fetched HTML", async () => {
  const restore = mockFetchForUrl(new Map([
    ["https://example.com/scripts", {
      status: 200,
      body: "<html><body><script>malicious()</script><p>Safe content</p></body></html>",
    }],
  ]));
  try {
    const result = await fetchUrl("https://example.com/scripts");
    assertStringIncludes(result, "Safe content");
    assertEquals(result.includes("malicious"), false);
  } finally {
    restore();
  }
});
