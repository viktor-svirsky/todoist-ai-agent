import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { statsHandler: handler } = await import("../stats/handler.ts");

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

t("stats: returns 405 for non-GET requests", async () => {
  const req = new Request("http://localhost/stats", { method: "POST" });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

t("stats: returns user count on success", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": "0-54/55",
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.users, 55);
  } finally {
    restore();
  }
});

t("stats: returns cache headers", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": "0-9/10",
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await handler(req);
    const cc = res.headers.get("Cache-Control") ?? "";
    assertEquals(cc.includes("max-age=300"), true);
  } finally {
    restore();
  }
});

t("stats: returns CORS header", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": "0-9/10",
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await handler(req);
    assertEquals(
      res.headers.get("Access-Control-Allow-Origin"),
      "https://todoist-ai-agent.pages.dev",
    );
  } finally {
    restore();
  }
});

t("stats: returns 500 on database error", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(
        JSON.stringify({ message: "relation does not exist", code: "42P01" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await handler(req);
    assertEquals(res.status, 500);
  } finally {
    restore();
  }
});
