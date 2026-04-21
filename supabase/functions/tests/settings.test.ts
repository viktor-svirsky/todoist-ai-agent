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
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, PUT, DELETE, OPTIONS");
});

t("settingsHandler: PATCH returns 405", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "PATCH",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 405);
  } finally {
    restore();
  }
});

// ============================================================================
// POST: Validate API key
// ============================================================================

t("settingsHandler: POST rejects missing fields", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "base_url, api_key, and model are required strings");
  } finally {
    restore();
  }
});

t("settingsHandler: POST rejects empty fields", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "base_url, api_key, and model must not be empty");
  } finally {
    restore();
  }
});

t("settingsHandler: POST rejects non-HTTPS URL", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "http://api.openai.com/v1", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Base URL must use HTTPS");
  } finally {
    restore();
  }
});

t("settingsHandler: POST rejects private URLs", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://192.168.1.1/v1", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Private or internal URLs are not allowed");
  } finally {
    restore();
  }
});

t("settingsHandler: POST returns valid=true on successful API response", async () => {
  const restore = mockFetch(authedMock((url) => {
    // Intercept the test call to OpenAI
    if (new URL(url).hostname === "api.openai.com") {
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, true);
  } finally {
    restore();
  }
});

t("settingsHandler: POST returns valid=false on 401 (invalid key)", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (new URL(url).hostname === "api.openai.com") {
      return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "sk-invalid", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, false);
    assertEquals(body.error, "Invalid API key");
  } finally {
    restore();
  }
});

t("settingsHandler: POST returns valid=false on 404 (bad model)", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (new URL(url).hostname === "api.openai.com") {
      return new Response(JSON.stringify({ error: { message: "Not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "nonexistent" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, false);
    assertEquals(body.error, "Model not found or invalid base URL");
  } finally {
    restore();
  }
});

t("settingsHandler: POST validates Anthropic keys correctly", async () => {
  const restore = mockFetch(authedMock((url, init) => {
    if (new URL(url).hostname === "api.anthropic.com") {
      // Verify Anthropic-specific headers
      const headers = init?.headers as Record<string, string>;
      if (headers?.["x-api-key"] === "valid-key") {
        return new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.anthropic.com/v1", api_key: "valid-key", model: "claude-sonnet-4-20250514" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, true);
  } finally {
    restore();
  }
});

t("settingsHandler: POST returns valid=false on network error", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (new URL(url).hostname === "api.openai.com") {
      throw new Error("DNS resolution failed");
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, false);
    assertEquals(body.error, "Could not reach the API — check base URL");
  } finally {
    restore();
  }
});

t("settingsHandler: POST returns valid=false on timeout", async () => {
  const restore = mockFetch(authedMock((url) => {
    if (new URL(url).hostname === "api.openai.com") {
      const err = new DOMException("The operation was aborted", "AbortError");
      throw err;
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, false);
    assertEquals(body.error, "Request timed out — check base URL and try again");
  } finally {
    restore();
  }
});

t("settingsHandler: POST rejects oversized api_key", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1", api_key: "x".repeat(501), model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "api_key must be at most 500 characters");
  } finally {
    restore();
  }
});

t("settingsHandler: POST strips trailing slash from base URL", async () => {
  const restore = mockFetch(authedMock((url) => {
    // Verify no double slash in the URL
    if (new URL(url).hostname === "api.openai.com" && !url.includes("//chat")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.openai.com/v1/", api_key: "sk-test", model: "gpt-4o" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.valid, true);
  } finally {
    restore();
  }
});

t("settingsHandler: POST rejects invalid JSON body", async () => {
  const restore = mockFetch(authedMock());
  try {
    const req = new Request("http://localhost/settings", {
      method: "POST",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await handler(req);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "Invalid JSON body");
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

t("settingsHandler: PUT coerces whitespace-only custom_ai_api_key to null (prevent bogus BYOK)", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const restore = mockFetch(authedMock((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method === "PATCH") {
      capturedBody = JSON.parse(init?.body as string ?? "{}");
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ custom_ai_api_key: "   " }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(capturedBody?.custom_ai_api_key, null,
      "whitespace-only API key must be stored as NULL so BYOK tier is not granted");
  } finally {
    restore();
  }
});

t("settingsHandler: PUT normalizes trailing slashes on base URL", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const restore = mockFetch(authedMock((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method === "PATCH") {
      capturedBody = JSON.parse(init?.body as string ?? "{}");
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ custom_ai_base_url: "https://api.openai.com/v1///" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(capturedBody?.custom_ai_base_url, "https://api.openai.com/v1");
  } finally {
    restore();
  }
});

// ============================================================================
// DELETE
// ============================================================================

t("settingsHandler: PUT returns 500 on database update failure", async () => {
  const restore = mockFetch(authedMock((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method === "PATCH") {
      return new Response(
        JSON.stringify({ message: "connection refused", code: "PGRST301" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "PUT",
      headers: { Authorization: "Bearer valid-jwt", "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_word: "@bot" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Failed to update settings");
  } finally {
    restore();
  }
});

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

t("settingsHandler: DELETE returns 500 on deletion failure", async () => {
  const restore = mockFetch(authedMock((url, init) => {
    if (url.includes("/auth/v1/admin/users/") && init?.method === "DELETE") {
      return new Response(
        JSON.stringify({ msg: "user not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }));
  try {
    const req = new Request("http://localhost/settings", {
      method: "DELETE",
      headers: { Authorization: "Bearer valid-jwt" },
    });
    const res = await handler(req);
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Failed to delete account");
  } finally {
    restore();
  }
});
