import { assertEquals, assertRejects } from "jsr:@std/assert";
import { braveSearch } from "../_shared/search.ts";

function mockFetch(response: { status: number; body: unknown }): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function capturingFetch(response: { status: number; body: unknown }): {
  restore: () => void;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    calls.push({ url: String(input), init: init as RequestInit });
    return Promise.resolve(new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; }, calls };
}

Deno.test("braveSearch: returns mapped results", async () => {
  const restore = mockFetch({
    status: 200,
    body: {
      web: {
        results: [
          { title: "Result 1", url: "https://example.com/1", description: "First result" },
          { title: "Result 2", url: "https://example.com/2", description: "Second result" },
        ],
      },
    },
  });
  try {
    const results = await braveSearch("test-key", "test query", 2);
    assertEquals(results.length, 2);
    assertEquals(results[0], { title: "Result 1", url: "https://example.com/1", description: "First result" });
    assertEquals(results[1], { title: "Result 2", url: "https://example.com/2", description: "Second result" });
  } finally {
    restore();
  }
});

Deno.test("braveSearch: returns empty array when no web results", async () => {
  const restore = mockFetch({
    status: 200,
    body: { web: { results: [] } },
  });
  try {
    const results = await braveSearch("test-key", "obscure query");
    assertEquals(results, []);
  } finally {
    restore();
  }
});

Deno.test("braveSearch: returns empty array when web field is missing", async () => {
  const restore = mockFetch({
    status: 200,
    body: {},
  });
  try {
    const results = await braveSearch("test-key", "query");
    assertEquals(results, []);
  } finally {
    restore();
  }
});

Deno.test("braveSearch: throws on non-OK response", async () => {
  const restore = mockFetch({ status: 429, body: { error: "rate limited" } });
  try {
    await assertRejects(
      () => braveSearch("test-key", "query"),
      Error,
      "Brave search failed: 429"
    );
  } finally {
    restore();
  }
});

Deno.test("braveSearch: sends correct headers and query params", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { web: { results: [] } },
  });
  try {
    await braveSearch("my-api-key", "deno testing", 3);
    assertEquals(calls.length, 1);
    const url = new URL(calls[0].url);
    assertEquals(url.searchParams.get("q"), "deno testing");
    assertEquals(url.searchParams.get("count"), "3");
    const headers = calls[0].init.headers as Record<string, string>;
    assertEquals(headers["X-Subscription-Token"], "my-api-key");
  } finally {
    restore();
  }
});

Deno.test("braveSearch: defaults count to 5", async () => {
  const { restore, calls } = capturingFetch({
    status: 200,
    body: { web: { results: [] } },
  });
  try {
    await braveSearch("key", "query");
    const url = new URL(calls[0].url);
    assertEquals(url.searchParams.get("count"), "5");
  } finally {
    restore();
  }
});
