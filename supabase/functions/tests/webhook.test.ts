import { assertEquals } from "@std/assert";

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
      id: "comment-1",
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

function makeItemPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: "item:added",
    user_id: "12345",
    event_data: {
      id: "task-1",
      content: "@ai What is 2+2?",
      description: "",
      labels: [],
    },
    ...overrides,
  };
}

function mockFullFlow(options: {
  onRpc?: () => void;
  commentsResponse?: unknown[];
} = {}): () => void {
  Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
  Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
  Deno.env.set("DEFAULT_AI_MODEL", "gpt-4o-mini");

  return mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      options.onRpc?.();
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const host = new URL(url).hostname;
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ results: options.commentsResponse ?? [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/tasks/")) {
        return new Response(JSON.stringify({ content: "Test task", description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    if (host === "api.openai.com") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "AI response", role: "assistant" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
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
// Body size limit
// ============================================================================

t("webhookHandler: rejects oversized payload with 413", async () => {
  // Create a body larger than 1 MB
  const largeBody = "x".repeat(1024 * 1024 + 1);
  const req = await signedRequest(largeBody);
  const res = await handler(req);
  assertEquals(res.status, 413);
  const body = await res.json();
  assertEquals(body.error, "Payload too large");
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

t("webhookHandler: returns 200 with rate_limited flag when rate limited", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
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
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.rate_limited, true);
  } finally {
    restore();
  }
});

t("webhookHandler: returns 200 with rate_limited flag when account blocked", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
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
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.rate_limited, true);
  } finally {
    restore();
  }
});

// ============================================================================
// Successful request (returns 200 immediately, processes async)
// ============================================================================

t("webhookHandler: accepts valid request and returns 200", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST") {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
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
    assertEquals(typeof body.request_id, "string");
    assertEquals(body.request_id.length, 36); // UUID format
  } finally {
    restore();
  }
});

// ============================================================================
// AI request tracking
// ============================================================================

t("webhookHandler: calls increment_ai_requests RPC for note:added with trigger word", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  let rpcCalled = false;

  Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
  Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
  Deno.env.set("DEFAULT_AI_MODEL", "gpt-4o-mini");

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      rpcCalled = true;
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Mock Todoist API calls (postProgressComment, getTask, getComments)
    const host = new URL(url).hostname;
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/tasks/")) {
        return new Response(JSON.stringify({ content: "Test task", description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    // Mock AI API call
    if (host === "api.openai.com") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "AI response", role: "assistant" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    // Wait for background processing
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, true, "increment_ai_requests RPC should be called");
  } finally {
    restore();
  }
});

t("webhookHandler: posts error comment to Todoist when AI API fails", async () => {
  const payload = JSON.stringify(makePayload());
  const req = await signedRequest(payload);

  let errorCommentPosted = false;

  Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.openai.com/v1");
  Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
  Deno.env.set("DEFAULT_AI_MODEL", "gpt-4o-mini");

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const host = new URL(url).hostname;
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && init?.method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.content && body.content.includes("AI agent error:")) {
          errorCommentPosted = true;
        }
        return new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/tasks/")) {
        return new Response(JSON.stringify({ content: "Test task", description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    // AI API returns 400 error
    if (host === "api.openai.com") {
      return new Response(JSON.stringify({ error: { message: "invalid request", type: "invalid_request_error" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(errorCommentPosted, true, "Error comment should be posted to Todoist when AI API fails");
  } finally {
    restore();
  }
});

t("webhookHandler: does NOT call increment_ai_requests for non-trigger comments", async () => {
  const payload = JSON.stringify(makePayload({
    event_data: { id: "comment-2", content: "just a regular comment", item_id: "task-1" },
  }));
  const req = await signedRequest(payload);

  let rpcCalled = false;

  const restore = mockFetch((url, init) => {
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      rpcCalled = true;
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, false, "increment_ai_requests RPC should NOT be called for non-trigger comments");
  } finally {
    restore();
  }
});

// ============================================================================
// note:updated event handling
// ============================================================================

t("webhookHandler: note:updated triggers AI processing", async () => {
  const payload = JSON.stringify(makePayload({ event_name: "note:updated" }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({ onRpc: () => { rpcCalled = true; } });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, true, "note:updated with trigger word should invoke AI");
  } finally {
    restore();
  }
});

t("webhookHandler: note:updated ignores bot comments", async () => {
  const payload = JSON.stringify(makePayload({
    event_name: "note:updated",
    event_data: { id: "comment-3", content: "\u{1F916} **AI Agent**\n\nSome response", item_id: "task-1" },
  }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({ onRpc: () => { rpcCalled = true; } });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, false, "note:updated should ignore bot's own comments");
  } finally {
    restore();
  }
});

// ============================================================================
// item:added event handling
// ============================================================================

t("webhookHandler: item:added with trigger in content triggers AI", async () => {
  const payload = JSON.stringify(makeItemPayload());
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({ onRpc: () => { rpcCalled = true; } });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, true, "item:added with @ai in content should invoke AI");
  } finally {
    restore();
  }
});

t("webhookHandler: item:added with trigger in label triggers AI", async () => {
  const payload = JSON.stringify(makeItemPayload({
    event_data: { id: "task-1", content: "Buy groceries", description: "", labels: ["ai"] },
  }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({ onRpc: () => { rpcCalled = true; } });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, true, "item:added with 'ai' label should invoke AI");
  } finally {
    restore();
  }
});

t("webhookHandler: item:added without trigger word is ignored", async () => {
  const payload = JSON.stringify(makeItemPayload({
    event_data: { id: "task-1", content: "Buy groceries", description: "", labels: [] },
  }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({ onRpc: () => { rpcCalled = true; } });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, false, "item:added without trigger should not invoke AI");
  } finally {
    restore();
  }
});

// ============================================================================
// item:updated event handling (with deduplication)
// ============================================================================

t("webhookHandler: item:updated with trigger and no prior AI comment triggers AI", async () => {
  const payload = JSON.stringify(makeItemPayload({ event_name: "item:updated" }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({
    onRpc: () => { rpcCalled = true; },
    commentsResponse: [],
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, true, "item:updated with trigger and no AI comment should invoke AI");
  } finally {
    restore();
  }
});

t("webhookHandler: item:updated skips when AI already responded", async () => {
  const payload = JSON.stringify(makeItemPayload({ event_name: "item:updated" }));
  const req = await signedRequest(payload);

  let rpcCalled = false;
  const restore = mockFullFlow({
    onRpc: () => { rpcCalled = true; },
    commentsResponse: [
      { id: "c1", content: "\u{1F916} **AI Agent**\n\nPrevious response", posted_at: "2026-01-01T00:00:00Z" },
    ],
  });

  try {
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assertEquals(rpcCalled, false, "item:updated should skip when AI already commented");
  } finally {
    restore();
  }
});
