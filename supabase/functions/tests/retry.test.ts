import { assertEquals, assertRejects } from "@std/assert";
import { fetchWithRetry } from "../_shared/retry.ts";

const FAST_RETRY = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, timeoutMs: 5000 };

function mockFetchSequence(responses: Array<{ status: number; body?: unknown } | "network-error">): {
  restore: () => void;
  callCount: () => number;
} {
  const originalFetch = globalThis.fetch;
  let index = 0;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    const response = responses[index++] || responses[responses.length - 1];
    if (response === "network-error") {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve(new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as typeof fetch;
  return {
    restore: () => { globalThis.fetch = originalFetch; },
    callCount: () => index,
  };
}

// ---------------------------------------------------------------------------
// Success on first attempt
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: returns response on first success", async () => {
  const { restore, callCount } = mockFetchSequence([{ status: 200, body: { ok: true } }]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Retries on 5xx (GET — safe method)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: retries GET on 500 and succeeds", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 500 },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 2);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: retries GET on 502 and succeeds on third attempt", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 502 },
    { status: 503 },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 3);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: returns last 5xx response after exhausting retries", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 500 },
    { status: 502 },
    { status: 503 },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 503);
    assertEquals(callCount(), 3);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Retries on 429 (rate limit) — GET
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: retries GET on 429 and succeeds", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 429 },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// No retry on 4xx (except 429)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: does not retry on 400", async () => {
  const { restore, callCount } = mockFetchSequence([{ status: 400 }]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 400);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: does not retry on 403", async () => {
  const { restore, callCount } = mockFetchSequence([{ status: 403 }]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 403);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: does not retry on 404", async () => {
  const { restore, callCount } = mockFetchSequence([{ status: 404 }]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 404);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Retries on network errors (all methods)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: retries on network error and succeeds", async () => {
  const { restore, callCount } = mockFetchSequence([
    "network-error",
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 2);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: throws after exhausting retries on network errors", async () => {
  const { restore, callCount } = mockFetchSequence([
    "network-error",
    "network-error",
    "network-error",
  ]);
  try {
    await assertRejects(
      () => fetchWithRetry("https://example.com/api", undefined, FAST_RETRY),
      TypeError,
      "Failed to fetch",
    );
    assertEquals(callCount(), 3);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Non-retryable errors are thrown immediately
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: non-retryable error thrown immediately", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.reject(new Error("Unexpected error"));
  }) as typeof fetch;
  try {
    await assertRejects(
      () => fetchWithRetry("https://example.com/api", undefined, FAST_RETRY),
      Error,
      "Unexpected error",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// maxRetries = 0 means no retries
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: maxRetries 0 means no retries", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 500 },
    { status: 200 },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, {
      ...FAST_RETRY,
      maxRetries: 0,
    });
    assertEquals(res.status, 500);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Mixed: network error then 5xx then success (GET)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: recovers from network error then 5xx then success", async () => {
  const { restore, callCount } = mockFetchSequence([
    "network-error",
    { status: 503 },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", undefined, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 3);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Passes request init through
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: passes method and headers through", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedInit = init;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await fetchWithRetry("https://example.com/api", {
      method: "POST",
      headers: { "X-Custom": "value" },
      body: '{"key":"val"}',
    }, FAST_RETRY);
    assertEquals(capturedInit?.method, "POST");
    assertEquals((capturedInit?.headers as Record<string, string>)["X-Custom"], "value");
    assertEquals(capturedInit?.body, '{"key":"val"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// POST: does NOT retry on 5xx status (non-idempotent)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: POST does not retry on 500 status", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 500 },
    { status: 200 },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", {
      method: "POST",
      body: '{}',
    }, FAST_RETRY);
    assertEquals(res.status, 500);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: POST does not retry on 429 status", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 429 },
    { status: 200 },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", {
      method: "POST",
      body: '{}',
    }, FAST_RETRY);
    assertEquals(res.status, 429);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// POST: DOES retry on network errors (request never reached server)
// ---------------------------------------------------------------------------

Deno.test("fetchWithRetry: POST retries on network error", async () => {
  const { restore, callCount } = mockFetchSequence([
    "network-error",
    { status: 200, body: { ok: true } },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", {
      method: "POST",
      body: '{}',
    }, FAST_RETRY);
    assertEquals(res.status, 200);
    assertEquals(callCount(), 2);
  } finally {
    restore();
  }
});

Deno.test("fetchWithRetry: POST does not retry on 4xx", async () => {
  const { restore, callCount } = mockFetchSequence([
    { status: 403 },
    { status: 200 },
  ]);
  try {
    const res = await fetchWithRetry("https://example.com/api", {
      method: "POST",
      body: '{}',
    }, FAST_RETRY);
    assertEquals(res.status, 403);
    assertEquals(callCount(), 1);
  } finally {
    restore();
  }
});
