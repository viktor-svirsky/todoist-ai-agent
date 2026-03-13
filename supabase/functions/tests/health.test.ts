import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("TODOIST_CLIENT_SECRET", "test-secret");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

const { healthHandler: handler } = await import("../health/handler.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

t("healthHandler: POST returns 405", async () => {
  const req = new Request("http://localhost/health", { method: "POST" });
  const res = await handler(req);
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("Allow"), "GET");
});

t("healthHandler: PUT returns 405", async () => {
  const req = new Request("http://localhost/health", { method: "PUT" });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

// ============================================================================
// Healthy response
// ============================================================================

t("healthHandler: returns 200 when all checks pass", async () => {
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
    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "healthy");
    // Per-check details are no longer exposed externally
    assertEquals(body.checks, undefined);
  } finally {
    restore();
  }
});

// ============================================================================
// Unhealthy: missing env
// ============================================================================

t("healthHandler: returns 503 when env var missing", async () => {
  const original = Deno.env.get("TODOIST_CLIENT_SECRET");
  Deno.env.delete("TODOIST_CLIENT_SECRET");
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
    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.status, "unhealthy");
    // Per-check details are no longer exposed externally
    assertEquals(body.checks, undefined);
  } finally {
    restore();
    Deno.env.set("TODOIST_CLIENT_SECRET", original!);
  }
});

// ============================================================================
// Unhealthy: database error
// ============================================================================

t("healthHandler: returns 503 when database check fails", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(JSON.stringify({ message: "connection refused", code: "500" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.status, "unhealthy");
    assertEquals(body.checks, undefined);
  } finally {
    restore();
  }
});

// ============================================================================
// HEALTH_TOKEN authentication
// ============================================================================

t("healthHandler: returns 401 when HEALTH_TOKEN is set but not provided", async () => {
  Deno.env.set("HEALTH_TOKEN", "my-secret-token");
  const restore = mockFetch(() => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    const req = new Request("http://localhost/health", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 401);
  } finally {
    restore();
    Deno.env.delete("HEALTH_TOKEN");
  }
});

t("healthHandler: returns 401 when HEALTH_TOKEN is wrong", async () => {
  Deno.env.set("HEALTH_TOKEN", "my-secret-token");
  const restore = mockFetch(() => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    const req = new Request("http://localhost/health?token=wrong", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 401);
  } finally {
    restore();
    Deno.env.delete("HEALTH_TOKEN");
  }
});

t("healthHandler: returns 200 when correct HEALTH_TOKEN provided", async () => {
  Deno.env.set("HEALTH_TOKEN", "my-secret-token");
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request("http://localhost/health?token=my-secret-token", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "healthy");
  } finally {
    restore();
    Deno.env.delete("HEALTH_TOKEN");
  }
});
