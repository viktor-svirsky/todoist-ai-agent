import { assert, assertEquals } from "@std/assert";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set(
  "ENCRYPTION_KEY",
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
);

const { settingsHandler: handler } = await import("../settings/handler.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const MOCK_USER = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  email: "test@example.com",
  aud: "authenticated",
};

function mockFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(String(input), init as RequestInit))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

t("GET /tier: returns flat shape and does not insert an event", async () => {
  let getStatusCalled = 0;
  let claimCalled = 0;

  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user") && !url.includes("/admin/")) {
      return new Response(JSON.stringify(MOCK_USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(
        JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/rpc/get_ai_quota_status")) {
      getStatusCalled++;
      return new Response(
        JSON.stringify({
          tier: "free",
          used: 3,
          limit: 5,
          next_slot_at: "2026-04-22T14:02:00Z",
          pro_until: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/rpc/claim_ai_quota")) {
      claimCalled++;
      return new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const req = new Request("http://local/settings/tier", {
      method: "GET",
      headers: { Authorization: "Bearer fake-jwt" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.tier, "free");
    assertEquals(body.used, 3);
    assertEquals(body.limit, 5);
    assert(body.next_slot_at === null || typeof body.next_slot_at === "string");
    assertEquals(body.pro_until, null);
    assertEquals(getStatusCalled, 1);
    assertEquals(claimCalled, 0, "GET /tier must never call claim_ai_quota");
  } finally {
    restore();
  }
});

t("GET /tier: returns 401 without auth header", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user")) {
      return new Response("unauthorized", { status: 401 });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const req = new Request("http://local/settings/tier", { method: "GET" });
    const resp = await handler(req);
    assertEquals(resp.status, 401);
  } finally {
    restore();
  }
});

t("GET /tier: returns 401 when auth header is invalid", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user")) {
      return new Response("unauthorized", { status: 401 });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const req = new Request("http://local/settings/tier", {
      method: "GET",
      headers: { Authorization: "Bearer invalid" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 401);
  } finally {
    restore();
  }
});

t("GET /tier: falls back to safe defaults when RPC errors", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user") && !url.includes("/admin/")) {
      return new Response(JSON.stringify(MOCK_USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(
        JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/rpc/get_ai_quota_status")) {
      return new Response(JSON.stringify({ message: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    const req = new Request("http://local/settings/tier", {
      method: "GET",
      headers: { Authorization: "Bearer fake-jwt" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.tier, null);
    assertEquals(body.used, 0);
    assertEquals(body.limit, 0);
    assertEquals(body.next_slot_at, null);
    assertEquals(body.pro_until, null);
  } finally {
    restore();
  }
});
