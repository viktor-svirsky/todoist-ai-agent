import { assertEquals } from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
Deno.env.set("DEFAULT_AI_API_KEY", "test-key");

const { digestHandler } = await import("../digest/handler.ts");

// Disable sanitizers — Supabase client starts token refresh intervals
function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

function mockFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(String(input), init as RequestInit))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// ============================================================================
// Method validation
// ============================================================================

t("digestHandler: GET returns 405", async () => {
  const req = new Request("http://localhost/digest", { method: "GET" });
  const res = await digestHandler(req);
  assertEquals(res.status, 405);
});

// ============================================================================
// Auth validation
// ============================================================================

t("digestHandler: returns 401 when cron secret is set but not provided", async () => {
  Deno.env.set("CRON_SECRET", "my-secret");
  try {
    const req = new Request("http://localhost/digest", { method: "POST" });
    const res = await digestHandler(req);
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});

t("digestHandler: returns 401 when cron secret is wrong", async () => {
  Deno.env.set("CRON_SECRET", "my-secret");
  try {
    const req = new Request("http://localhost/digest", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await digestHandler(req);
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});

t("digestHandler: accepts correct cron secret", async () => {
  Deno.env.set("CRON_SECRET", "my-secret");

  const restore = mockFetch((url) => {
    // Supabase query for digest users — return empty
    if (url.includes("/rest/v1/users_config")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const req = new Request("http://localhost/digest", {
      method: "POST",
      headers: { Authorization: "Bearer my-secret" },
    });
    const res = await digestHandler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
  } finally {
    restore();
    Deno.env.delete("CRON_SECRET");
  }
});

// ============================================================================
// Batch processing
// ============================================================================

t("digestHandler: processes batch with no users", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const req = new Request("http://localhost/digest", { method: "POST" });
    const res = await digestHandler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.processed, 0);
    assertEquals(body.skipped, 0);
    assertEquals(body.errors, 0);
  } finally {
    restore();
  }
});
