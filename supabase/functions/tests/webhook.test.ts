import { assertEquals } from "jsr:@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
// ---------------------------------------------------------------------------

const CLIENT_SECRET = "test-client-secret";
Deno.env.set("TODOIST_CLIENT_SECRET", CLIENT_SECRET);
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

const { webhookHandler: handler } = await import("../webhook/handler.ts");
const { encrypt } = await import("../_shared/crypto.ts");

// Pre-encrypt mock token so decrypt() succeeds in the handler
const ENCRYPTED_MOCK_TOKEN = await encrypt("test-todoist-token");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Disable sanitizers — Supabase client starts token refresh intervals
function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

async function computeHmac(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: "note:added",
    user_id: "12345",
    event_data: {
      content: "@ai What is 2+2?",
      item_id: "task-1",
    },
    ...overrides,
  };
}

async function signedRequest(
  body: string,
  method = "POST",
): Promise<Request> {
  const sig = await computeHmac(CLIENT_SECRET, body);
  return new Request("http://localhost/webhook/12345", {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-todoist-hmac-sha256": sig,
    },
    body,
  });
}

function mockFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(String(input), init as RequestInit))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function mockUserConfig() {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    todoist_token: ENCRYPTED_MOCK_TOKEN,
    todoist_user_id: "12345",
    trigger_word: "@ai",
    custom_ai_base_url: null,
    custom_ai_api_key: null,
    custom_ai_model: null,
    custom_brave_key: null,
    max_messages: 20,
    custom_prompt: null,
  };
}

// ============================================================================
// Method validation
// ============================================================================

t("webhookHandler: rejects GET with 405", async () => {
  const req = new Request("http://localhost/webhook", { method: "GET" });
  const res = await handler(req);
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, "Method not allowed");
});

t("webhookHandler: rejects PUT with 405", async () => {
  const req = new Request("http://localhost/webhook", { method: "PUT" });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

// ============================================================================
// Signature validation
// ============================================================================

t("webhookHandler: rejects POST without signature", async () => {
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    body: "{}",
  });
  const res = await handler(req);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "Missing signature");
});

t("webhookHandler: rejects POST with invalid HMAC", async () => {
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "x-todoist-hmac-sha256": "invalid-signature" },
    body: "{}",
  });
  const res = await handler(req);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "Invalid signature");
});

t("webhookHandler: rejects with 500 when TODOIST_CLIENT_SECRET missing", async () => {
  const original = Deno.env.get("TODOIST_CLIENT_SECRET");
  Deno.env.delete("TODOIST_CLIENT_SECRET");
  try {
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "x-todoist-hmac-sha256": "some-sig" },
      body: "{}",
    });
    const res = await handler(req);
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "Server misconfiguration");
  } finally {
    if (original) Deno.env.set("TODOIST_CLIENT_SECRET", original);
  }
});

// ============================================================================
// JSON parsing
// ============================================================================

t("webhookHandler: rejects invalid JSON with 400", async () => {
  const invalidJson = "not-json{{{";
  const req = await signedRequest(invalidJson);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid JSON");
});

// ============================================================================
// user_id validation
// ============================================================================

t("webhookHandler: rejects missing user_id with 400", async () => {
  const payload = JSON.stringify({ event_name: "note:added", event_data: {} });
  const req = await signedRequest(payload);
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Missing user_id in payload");
});

// ============================================================================
// User lookup (requires Supabase mock)
// ============================================================================

t("webhookHandler: returns 404 when user not found", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url) => {
    if (url.includes("/rest/v1/users_config")) {
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "User not found");
  } finally {
    restore();
  }
});

// ============================================================================
// Rate limiting (requires Supabase mock)
// ============================================================================

t("webhookHandler: returns 429 when rate limited", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: false, blocked: false, retry_after: 45 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 429);
    assertEquals(res.headers.get("Retry-After"), "45");
  } finally {
    restore();
  }
});

t("webhookHandler: returns 403 when account blocked", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: false, blocked: true, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "Account disabled");
  } finally {
    restore();
  }
});

// ============================================================================
// Successful request (returns 200 immediately, processes async)
// ============================================================================

t("webhookHandler: accepts valid request and returns 200", async () => {
  // Use item:updated event to avoid triggering handleNoteAdded
  const payload = JSON.stringify(makePayload({ event_name: "item:updated" }));
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
  } finally {
    restore();
  }
});
