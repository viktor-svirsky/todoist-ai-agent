import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
// ---------------------------------------------------------------------------

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

const { settingsHandler: handler } = await import("../settings/handler.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Valid UUID required by Supabase auth admin methods
const MOCK_USER = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  email: "test@example.com",
  aud: "authenticated",
};

/** Mock that passes auth + rate limit, with optional extra handler. */
function authedMock(
  extra?: (url: string, init?: RequestInit) => Response | null,
): (url: string, init?: RequestInit) => Response {
  return (url, init) => {
    if (url.includes("/auth/v1/user") && !url.includes("/admin/")) {
      return new Response(JSON.stringify(MOCK_USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (extra) {
      const res = extra(url, init);
      if (res) return res;
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

// ============================================================================
// CORS / Method validation
// ============================================================================

t("settingsHandler: OPTIONS returns CORS headers", async () => {
  const req = new Request("http://localhost/settings", { method: "OPTIONS" });
  const res = await handler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, PUT, DELETE, OPTIONS");
});

t("settingsHandler: POST returns 405", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 405);
  } finally {
    restore();
  }
});

// ============================================================================
// Auth validation
// ============================================================================

t("settingsHandler: missing Authorization returns 401", async () => {
  const req = new Request("http://localhost/settings", { method: "GET" });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

t("settingsHandler: invalid auth returns 401", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ message: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request("http://localhost/settings", {
      method: "GET",
      headers: { Authorization: "Bearer invalid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 401);
  } finally {
    restore();
  }
});

// ============================================================================
// Rate limiting
// ============================================================================

t("settingsHandler: returns 429 when rate limited", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(MOCK_USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(JSON.stringify({ allowed: false, blocked: false, retry_after: 30 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request("http://localhost/settings", {
      method: "GET",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 429);
    assertEquals(res.headers.get("Retry-After"), "30");
  } finally {
    restore();
  }
});

t("settingsHandler: returns 403 when account blocked", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(MOCK_USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(JSON.stringify({ allowed: false, blocked: true, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request("http://localhost/settings", {
      method: "GET",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "Account disabled");
  } finally {
    restore();
  }
});

// ============================================================================
// GET settings
// ============================================================================

t("settingsHandler: GET returns settings with key presence flags", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (url.includes("/rest/v1/users_config")) {
      if (url.includes("custom_ai_api_key")) {
        return new Response(JSON.stringify({
          custom_ai_api_key: "encrypted-key",
          custom_brave_key: null,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        trigger_word: "@ai",
        custom_ai_base_url: null,
        custom_ai_model: null,
        max_messages: 20,
        custom_prompt: null,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "GET",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.trigger_word, "@ai");
    assertEquals(body.max_messages, 20);
    assertEquals(body.has_custom_ai_key, true);
    assertEquals(body.has_custom_brave_key, false);
  } finally {
    restore();
  }
});

t("settingsHandler: GET returns 404 when config not found", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(
        JSON.stringify({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" }),
        { status: 406, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "GET",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "Config not found");
  } finally {
    restore();
  }
});

// ============================================================================
// PUT settings
// ============================================================================

t("settingsHandler: PUT rejects invalid JSON", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid JSON body");
  } finally {
    restore();
  }
});

t("settingsHandler: PUT filters disallowed fields", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "hacker-id", todoist_token: "stolen" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "No fields to update");
  } finally {
    restore();
  }
});

t("settingsHandler: PUT validates fields", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_word: "", max_messages: 200 }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Validation failed");
    assertEquals(body.details.length >= 2, true);
  } finally {
    restore();
  }
});

t("settingsHandler: PUT updates settings successfully", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_word: "@bot", max_messages: 30 }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
  } finally {
    restore();
  }
});

// ============================================================================
// DELETE
// ============================================================================

t("settingsHandler: DELETE removes account and returns ok", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "DELETE",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
  } finally {
    restore();
  }
});
