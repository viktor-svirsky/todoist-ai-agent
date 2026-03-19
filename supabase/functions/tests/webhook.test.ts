import { assert, assertEquals } from "@std/assert";

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

// ============================================================================
// Image handling in webhook flow
// ============================================================================

const MOCK_PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function mockFullFlowWithImages(options: {
  commentsResponse?: unknown[];
  taskDescription?: string;
  onAiRequest?: (body: Record<string, unknown>) => void;
  failImageDownload?: boolean;
  useAnthropic?: boolean;
  fileDownloadResponse?: Response | (() => Response);
} = {}): () => void {
  const useAnthropic = options.useAnthropic ?? false;
  const aiHost = useAnthropic ? "api.anthropic.com" : "api.openai.com";
  const aiBaseUrl = useAnthropic
    ? "https://api.anthropic.com/v1"
    : "https://api.openai.com/v1";

  // Save original env vars so restore() can clean up
  const prevBaseUrl = Deno.env.get("DEFAULT_AI_BASE_URL");
  const prevApiKey = Deno.env.get("DEFAULT_AI_API_KEY");
  const prevModel = Deno.env.get("DEFAULT_AI_MODEL");

  Deno.env.set("DEFAULT_AI_BASE_URL", aiBaseUrl);
  Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
  Deno.env.set("DEFAULT_AI_MODEL", useAnthropic ? "claude-3-5-sonnet" : "gpt-4o-mini");

  const restoreFetch = mockFetch((url, init) => {
    // Supabase
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let host: string;
    try { host = new URL(url).hostname; } catch { host = ""; }

    // Todoist API
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ results: options.commentsResponse ?? [] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/tasks/")) {
        return new Response(JSON.stringify({
          content: "Test task",
          description: options.taskDescription ?? "",
        }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Todoist CDN (trusted file download domains)
    if (
      (host.endsWith(".todoist.com") && host !== "api.todoist.com") ||
      host.endsWith(".doist.com") ||
      host.endsWith(".todoist.net")
    ) {
      if (options.failImageDownload) {
        return new Response("Not Found", { status: 404 });
      }
      if (options.fileDownloadResponse) {
        return typeof options.fileDownloadResponse === "function"
          ? options.fileDownloadResponse()
          : options.fileDownloadResponse;
      }
      return new Response(MOCK_PNG_BYTES, {
        status: 200, headers: { "Content-Type": "image/png" },
      });
    }

    // AI API
    if (host === aiHost) {
      if (options.onAiRequest && init?.body) {
        options.onAiRequest(JSON.parse(String(init.body)));
      }
      if (useAnthropic) {
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "AI response" }],
        }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "AI response", role: "assistant" } }],
      }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // External URLs (description image downloads)
    if (options.failImageDownload) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(MOCK_PNG_BYTES, {
      status: 200, headers: { "Content-Type": "image/png" },
    });
  });

  return () => {
    restoreFetch();
    // Restore env vars to prevent leakage between tests
    if (prevBaseUrl !== undefined) Deno.env.set("DEFAULT_AI_BASE_URL", prevBaseUrl);
    else Deno.env.delete("DEFAULT_AI_BASE_URL");
    if (prevApiKey !== undefined) Deno.env.set("DEFAULT_AI_API_KEY", prevApiKey);
    else Deno.env.delete("DEFAULT_AI_API_KEY");
    if (prevModel !== undefined) Deno.env.set("DEFAULT_AI_MODEL", prevModel);
    else Deno.env.delete("DEFAULT_AI_MODEL");
  };
}

// -- A. Comment Image Attachments --

t("image: comment with text + image includes image in AI request", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "img-comment-1",
        content: "@ai What is this?",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "photo.png",
          file_url: "https://files.todoist.com/photo.png",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "img-comment-1", content: "@ai What is this?", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI API should have been called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assert(Array.isArray(lastUser.content), "Last user message should be multimodal array");
    const parts = lastUser.content as Record<string, unknown>[];
    const textPart = parts.find((p) => p.type === "text");
    const imageParts = parts.filter((p) => p.type === "image_url");
    assert(textPart, "Should have text part");
    assertEquals(imageParts.length, 1, "Should have exactly one image part");
    const imageUrl = (imageParts[0].image_url as { url: string }).url;
    assert(imageUrl.startsWith("data:image/png;base64,"), "Image should be base64 data URI");
  } finally {
    restore();
  }
});

t("image: image-only comment (trigger word only) appears as [image]", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "img-only-1",
        content: "@ai",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "photo.png",
          file_url: "https://files.todoist.com/photo.png",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "img-only-1", content: "@ai", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI API should have been called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assert(Array.isArray(lastUser.content), "Last user message should be multimodal");
    const parts = lastUser.content as Record<string, unknown>[];
    const textPart = parts.find((p) => p.type === "text") as { text: string } | undefined;
    assert(textPart, "Should have text part");
    assertEquals(textPart!.text, "[image]", "Text should be [image] for trigger-only comment");
    assert(parts.some((p) => p.type === "image_url"), "Should have image_url part");
  } finally {
    restore();
  }
});

t("image: multiple comments with images attaches all to last user message", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "c1",
        content: "@ai First question",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "first.png",
          file_url: "https://files.todoist.com/first.png",
        },
      },
      {
        id: "c2",
        content: "\u{1F916} **AI Agent**\n\nHere's my answer",
        posted_at: "2026-01-01T00:01:00Z",
      },
      {
        id: "c3",
        content: "@ai Follow up",
        posted_at: "2026-01-01T00:02:00Z",
        file_attachment: {
          file_type: "image/jpeg",
          file_name: "second.jpg",
          file_url: "https://files.todoist.com/second.jpg",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "c3", content: "@ai Follow up", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI API should have been called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assert(Array.isArray(lastUser.content), "Last user message should be multimodal");
    const imageParts = (lastUser.content as Record<string, unknown>[]).filter(
      (p) => p.type === "image_url",
    );
    assertEquals(imageParts.length, 2, "Both images should be attached to last user message");
  } finally {
    restore();
  }
});

t("image: download failure is handled gracefully, AI still processes", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "fail-img-1",
        content: "@ai Analyze this",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "broken.png",
          file_url: "https://files.todoist.com/broken.png",
        },
      },
    ],
    failImageDownload: true,
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "fail-img-1", content: "@ai Analyze this", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called despite image download failure");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(typeof lastUser.content, "string", "No images — content should be plain string");
  } finally {
    restore();
  }
});

t("document: PDF attachment is downloaded and sent as Anthropic document block", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "pdf-1",
        content: "@ai Check this document",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/pdf",
          file_name: "document.pdf",
          file_url: "https://files.todoist.com/document.pdf",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "pdf-1", content: "@ai Check this document", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    // PDF creates multimodal content with text + Anthropic document block
    assertEquals(Array.isArray(lastUser.content), true, "PDF should produce multimodal content");
    const parts = lastUser.content as Record<string, unknown>[];
    assertEquals(parts[0].type, "text");
    assertEquals(parts[0].text, "Check this document");
    assertEquals(parts[1].type, "document");
    const source = parts[1].source as Record<string, unknown>;
    assertEquals(source.type, "base64");
    assertEquals(source.media_type, "application/pdf");
    assert(typeof source.data === "string" && source.data.length > 0, "Should have base64 data");
  } finally {
    restore();
  }
});

t("document: PDF attachment with OpenAI becomes text placeholder", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "pdf-2",
        content: "@ai Check this document",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/pdf",
          file_name: "document.pdf",
          file_url: "https://files.todoist.com/document.pdf",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "pdf-2", content: "@ai Check this document", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    // OpenAI: document_attachment is sanitized to text placeholder
    assertEquals(Array.isArray(lastUser.content), true, "Should produce multimodal content");
    const parts = lastUser.content as Record<string, unknown>[];
    const textParts = parts.filter((p) => p.type === "text");
    const hasPlaceholder = textParts.some((p) =>
      (p.text as string).includes("document processing requires Anthropic provider")
    );
    assertEquals(hasPlaceholder, true, "OpenAI should get text placeholder for PDF");
  } finally {
    restore();
  }
});

t("document: unsupported file type (XLSX) included as text placeholder", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "xlsx-1",
        content: "@ai Check this spreadsheet",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          file_name: "data.xlsx",
          file_url: "https://files.todoist.com/data.xlsx",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "xlsx-1", content: "@ai Check this spreadsheet", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(Array.isArray(lastUser.content), true, "Unsupported file should produce multimodal content");
    const parts = lastUser.content as Record<string, unknown>[];
    const textParts = parts.filter((p) => p.type === "text");
    const hasPlaceholder = textParts.some((p) =>
      (p.text as string).includes("only PDF and text-based files are supported")
    );
    assertEquals(hasPlaceholder, true, "Should have unsupported file placeholder text");
  } finally {
    restore();
  }
});

t("document: text file (.sh) is downloaded and injected as text content", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const scriptContent = '#!/bin/bash\necho "Hello World"';

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "sh-1",
        content: "@ai Review this script",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/x-sh",
          file_name: "install.sh",
          file_url: "https://files.todoist.com/install.sh",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    fileDownloadResponse: () => new Response(
      new TextEncoder().encode(scriptContent),
      { status: 200, headers: { "Content-Type": "application/x-sh" } },
    ),
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "sh-1", content: "@ai Review this script", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called for text file");
    const messages = (capturedBody!.messages ?? capturedBody!.choices) as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(Array.isArray(lastUser.content), true, "Text file should produce multimodal content");
    const parts = lastUser.content as Record<string, unknown>[];
    const textParts = parts.filter((p) => p.type === "text");
    const filePart = textParts.find((p) =>
      (p.text as string).includes("[File: install.sh]")
    );
    assert(filePart, "Should have text part with [File: install.sh]");
    assert((filePart!.text as string).includes(scriptContent), "Should contain the script content");
  } finally {
    restore();
  }
});

t("document: text file detected by extension when MIME is octet-stream", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const pyContent = "print('hello')";

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "py-1",
        content: "@ai Check this",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/octet-stream",
          file_name: "script.py",
          file_url: "https://files.todoist.com/script.py",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    fileDownloadResponse: () => new Response(
      new TextEncoder().encode(pyContent),
      { status: 200, headers: { "Content-Type": "application/octet-stream" } },
    ),
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "py-1", content: "@ai Check this", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = (capturedBody!.messages ?? capturedBody!.choices) as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    const parts = lastUser.content as Record<string, unknown>[];
    const textParts = parts.filter((p) => p.type === "text");
    const filePart = textParts.find((p) =>
      (p.text as string).includes("[File: script.py]")
    );
    assert(filePart, "Should detect .py by extension and inject text content");
    assert((filePart!.text as string).includes(pyContent), "Should contain the Python content");
  } finally {
    restore();
  }
});

t("document: text file works with OpenAI provider (no Anthropic needed)", async () => {
  let capturedBody: Record<string, unknown> | null = null;
  const csvContent = "name,age\nAlice,30\nBob,25";

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "csv-1",
        content: "@ai Analyze this data",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "text/csv",
          file_name: "data.csv",
          file_url: "https://files.todoist.com/data.csv",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: false,
    fileDownloadResponse: () => new Response(
      new TextEncoder().encode(csvContent),
      { status: 200, headers: { "Content-Type": "text/csv" } },
    ),
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "csv-1", content: "@ai Analyze this data", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    const parts = lastUser.content as Record<string, unknown>[];
    // Text files work with OpenAI — no "requires Anthropic" placeholder
    const textParts = parts.filter((p) => p.type === "text");
    const filePart = textParts.find((p) =>
      (p.text as string).includes("[File: data.csv]")
    );
    assert(filePart, "OpenAI should get text file content directly");
    assert((filePart!.text as string).includes(csvContent), "Should contain CSV content");
    // No Anthropic-only placeholder
    const hasAnthropicPlaceholder = textParts.some((p) =>
      (p.text as string).includes("requires Anthropic")
    );
    assertEquals(hasAnthropicPlaceholder, false, "Text files should not have Anthropic placeholder");
  } finally {
    restore();
  }
});

// -- B. Task Description Images --

t("image: description markdown image is included in AI request", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "desc-img-1",
        content: "@ai Analyze the task",
        posted_at: "2026-01-01T00:00:00Z",
      },
    ],
    taskDescription: "Task details: ![screenshot](https://cdn.example.com/screenshot.png)",
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "desc-img-1", content: "@ai Analyze the task", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assert(Array.isArray(lastUser.content), "Should have multimodal content with description image");
    const imageParts = (lastUser.content as Record<string, unknown>[]).filter(
      (p) => p.type === "image_url",
    );
    assertEquals(imageParts.length, 1, "Should have one image from description");
    const imageUrl = (imageParts[0].image_url as { url: string }).url;
    assert(imageUrl.startsWith("data:image/png;base64,"), "Image should be base64 data URI");
  } finally {
    restore();
  }
});

t("image: description image from private IP is rejected (SSRF)", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "ssrf-1",
        content: "@ai Look at this",
        posted_at: "2026-01-01T00:00:00Z",
      },
    ],
    taskDescription: "Reference: ![img](https://192.168.1.1/secret.png)",
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "ssrf-1", content: "@ai Look at this", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should process despite SSRF-blocked image");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(typeof lastUser.content, "string", "Private IP image should be rejected — no images");
  } finally {
    restore();
  }
});

t("image: description image with HTTP protocol is rejected", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "http-1",
        content: "@ai Check this",
        posted_at: "2026-01-01T00:00:00Z",
      },
    ],
    taskDescription: "See: ![img](http://example.com/image.png)",
    onAiRequest: (body) => { capturedBody = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "http-1", content: "@ai Check this", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should process despite rejected HTTP image");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(typeof lastUser.content, "string", "HTTP image should be rejected — no images");
  } finally {
    restore();
  }
});

// -- C. Anthropic Provider --

t("image: Anthropic provider converts to base64 source format", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "anth-img-1",
        content: "@ai What is this?",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "photo.png",
          file_url: "https://files.todoist.com/photo.png",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "anth-img-1", content: "@ai What is this?", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI API should have been called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assert(Array.isArray(lastUser.content), "Last user message should be multimodal");
    const parts = lastUser.content as Record<string, unknown>[];
    const imagePart = parts.find((p) => p.type === "image");
    assert(imagePart, "Should have Anthropic-format image part");
    const source = imagePart.source as { type: string; media_type: string; data: string };
    assertEquals(source.type, "base64");
    assertEquals(source.media_type, "image/png");
    assert(source.data.length > 0, "Image data should not be empty");
  } finally {
    restore();
  }
});

// ============================================================================
// Document handling — additional e2e tests
// ============================================================================

t("document: PDF-only comment (no text) creates [file:] message + document block", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "pdf-only-1",
        content: "",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/pdf",
          file_name: "report.pdf",
          file_url: "https://files.todoist.com/report.pdf",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "pdf-only-1", content: "@ai", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called for PDF-only comment");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    // The [file: report.pdf] message should be in the conversation
    const userMessages = messages.filter((m) => m.role === "user");
    assert(userMessages.length > 0, "Should have user messages");
    // Last user message should have the document block
    const lastUser = userMessages[userMessages.length - 1];
    assertEquals(Array.isArray(lastUser.content), true, "Should be multimodal");
    const parts = lastUser.content as Record<string, unknown>[];
    const docPart = parts.find((p) => p.type === "document");
    assert(docPart, "Should have Anthropic document block");
  } finally {
    restore();
  }
});

t("document: failed PDF download still calls AI without document", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "pdf-fail-1",
        content: "@ai Analyze this document",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "application/pdf",
          file_name: "missing.pdf",
          file_url: "https://files.todoist.com/missing.pdf",
        },
      },
    ],
    failImageDownload: true,
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "pdf-fail-1", content: "@ai Analyze this document", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called despite failed document download");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    // No document block — download failed
    if (Array.isArray(lastUser.content)) {
      const parts = lastUser.content as Record<string, unknown>[];
      const docPart = parts.find((p) => p.type === "document");
      assertEquals(docPart, undefined, "Failed download should not produce document block");
    }
  } finally {
    restore();
  }
});

t("document: image + PDF in same conversation both included", async () => {
  let capturedBody: Record<string, unknown> | null = null;

  const restore = mockFullFlowWithImages({
    commentsResponse: [
      {
        id: "img-1",
        content: "@ai look at this image",
        posted_at: "2026-01-01T00:00:00Z",
        file_attachment: {
          file_type: "image/png",
          file_name: "photo.png",
          file_url: "https://files.todoist.com/photo.png",
        },
      },
      {
        id: "pdf-1",
        content: "@ai and this PDF",
        posted_at: "2026-01-01T00:01:00Z",
        file_attachment: {
          file_type: "application/pdf",
          file_name: "doc.pdf",
          file_url: "https://files.todoist.com/doc.pdf",
        },
      },
    ],
    onAiRequest: (body) => { capturedBody = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "pdf-1", content: "@ai and this PDF", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBody !== null, "AI should be called");
    const messages = capturedBody!.messages as Record<string, unknown>[];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    assert(lastUser, "Should have a user message");
    assertEquals(Array.isArray(lastUser.content), true, "Should be multimodal");
    const parts = lastUser.content as Record<string, unknown>[];
    const imagePart = parts.find((p) => p.type === "image");
    const docPart = parts.find((p) => p.type === "document");
    assert(imagePart, "Should have image block from comment attachment");
    assert(docPart, "Should have document block from PDF attachment");
  } finally {
    restore();
  }
});

// ============================================================================
// URL / fetch_url tool call e2e tests
// ============================================================================

/**
 * Helper that mocks a full webhook flow with AI tool call support.
 * The AI mock responds with a sequence: first a tool call, then a final response.
 */
function mockFullFlowWithToolCalls(options: {
  commentsResponse?: unknown[];
  taskDescription?: string;
  aiToolCallResponse: Record<string, unknown>;
  aiFinalResponse: Record<string, unknown>;
  fetchUrlResponse?: { status: number; body: string; contentType?: string };
  braveSearchResponse?: { status: number; body: unknown };
  onAiRequest?: (body: Record<string, unknown>, callIndex: number) => void;
  useAnthropic?: boolean;
  withBraveKey?: boolean;
}): () => void {
  const useAnthropic = options.useAnthropic ?? false;
  const aiHost = useAnthropic ? "api.anthropic.com" : "api.openai.com";
  const aiBaseUrl = useAnthropic
    ? "https://api.anthropic.com/v1"
    : "https://api.openai.com/v1";

  const prevBaseUrl = Deno.env.get("DEFAULT_AI_BASE_URL");
  const prevApiKey = Deno.env.get("DEFAULT_AI_API_KEY");
  const prevModel = Deno.env.get("DEFAULT_AI_MODEL");
  const prevBraveKey = Deno.env.get("DEFAULT_BRAVE_API_KEY");

  Deno.env.set("DEFAULT_AI_BASE_URL", aiBaseUrl);
  Deno.env.set("DEFAULT_AI_API_KEY", "test-key");
  Deno.env.set("DEFAULT_AI_MODEL", useAnthropic ? "claude-3-5-sonnet" : "gpt-4o-mini");
  if (options.withBraveKey) Deno.env.set("DEFAULT_BRAVE_API_KEY", "test-brave-key");
  else Deno.env.delete("DEFAULT_BRAVE_API_KEY");

  let aiCallIndex = 0;
  const restoreFetch = mockFetch((url, init) => {
    // Supabase
    if (url.includes("/rest/v1/users_config") && init?.method !== "POST" && !url.includes("rpc")) {
      return new Response(JSON.stringify(mockUserConfig()), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let host: string;
    try { host = new URL(url).hostname; } catch { host = ""; }

    // Todoist API
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/comments")) {
        return new Response(JSON.stringify({ results: options.commentsResponse ?? [] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/tasks/")) {
        return new Response(JSON.stringify({
          content: "Test task",
          description: options.taskDescription ?? "",
        }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Brave Search API
    if (host === "api.search.brave.com" && options.braveSearchResponse) {
      return new Response(JSON.stringify(options.braveSearchResponse.body), {
        status: options.braveSearchResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // AI API
    if (host === aiHost) {
      const currentIndex = aiCallIndex++;
      if (options.onAiRequest && init?.body) {
        options.onAiRequest(JSON.parse(String(init.body)), currentIndex);
      }
      const responseBody = currentIndex === 0
        ? options.aiToolCallResponse
        : options.aiFinalResponse;
      return new Response(JSON.stringify(responseBody), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // External URL fetch (for fetch_url tool)
    if (options.fetchUrlResponse) {
      return new Response(options.fetchUrlResponse.body, {
        status: options.fetchUrlResponse.status,
        headers: { "Content-Type": options.fetchUrlResponse.contentType ?? "text/html" },
      });
    }

    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  return () => {
    restoreFetch();
    if (prevBaseUrl !== undefined) Deno.env.set("DEFAULT_AI_BASE_URL", prevBaseUrl);
    else Deno.env.delete("DEFAULT_AI_BASE_URL");
    if (prevApiKey !== undefined) Deno.env.set("DEFAULT_AI_API_KEY", prevApiKey);
    else Deno.env.delete("DEFAULT_AI_API_KEY");
    if (prevModel !== undefined) Deno.env.set("DEFAULT_AI_MODEL", prevModel);
    else Deno.env.delete("DEFAULT_AI_MODEL");
    if (prevBraveKey !== undefined) Deno.env.set("DEFAULT_BRAVE_API_KEY", prevBraveKey);
    else Deno.env.delete("DEFAULT_BRAVE_API_KEY");
  };
}

// -- OpenAI provider --

t("fetch_url: AI calls fetch_url tool, gets page content, returns final answer", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "url-1", content: "@ai summarize https://example.com/article", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "fetch_url", arguments: '{"url":"https://example.com/article"}' },
          }],
        },
      }],
    },
    aiFinalResponse: {
      choices: [{ message: { content: "Here is a summary of the article." } }],
    },
    fetchUrlResponse: {
      status: 200,
      body: "<html><body><h1>Article Title</h1><p>Article content here.</p></body></html>",
      contentType: "text/html",
    },
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "url-1", content: "@ai summarize https://example.com/article", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    // First AI call should have messages
    assert(capturedBodies[0], "First AI call should happen");
    // Second AI call should include tool result
    assert(capturedBodies[1], "Second AI call (with tool result) should happen");
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) => m.role === "tool");
    assert(toolResultMsg, "Should have a tool result message");
    const toolContent = toolResultMsg.content as string;
    assert(toolContent.includes("Article Title"), "Tool result should contain page text");
    assert(toolContent.includes("Article content here"), "Tool result should contain page content");
  } finally {
    restore();
  }
});

t("fetch_url: page returns 404 — AI receives error message", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "url-404-1", content: "@ai check https://example.com/missing", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "fetch_url", arguments: '{"url":"https://example.com/missing"}' },
          }],
        },
      }],
    },
    aiFinalResponse: {
      choices: [{ message: { content: "The page could not be found." } }],
    },
    fetchUrlResponse: {
      status: 404,
      body: "Not Found",
      contentType: "text/html",
    },
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "url-404-1", content: "@ai check https://example.com/missing", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBodies[1], "Second AI call should happen with tool error");
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) => m.role === "tool");
    assert(toolResultMsg, "Should have a tool result message");
    const toolContent = toolResultMsg.content as string;
    assert(
      toolContent.includes("Error") || toolContent.includes("error"),
      "Tool result should indicate error for 404 page"
    );
  } finally {
    restore();
  }
});

t("fetch_url: private IP URL blocked by SSRF protection", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "ssrf-url-1", content: "@ai read http://192.168.1.1/admin", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "fetch_url", arguments: '{"url":"http://192.168.1.1/admin"}' },
          }],
        },
      }],
    },
    aiFinalResponse: {
      choices: [{ message: { content: "I cannot access that URL." } }],
    },
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "ssrf-url-1", content: "@ai read http://192.168.1.1/admin", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBodies[1], "Second AI call should happen with SSRF error");
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) => m.role === "tool");
    assert(toolResultMsg, "Should have a tool result message");
    const toolContent = toolResultMsg.content as string;
    assert(
      toolContent.includes("Error") || toolContent.includes("private") || toolContent.includes("blocked"),
      "Tool result should indicate SSRF block"
    );
  } finally {
    restore();
  }
});

// -- Anthropic provider --

t("fetch_url (Anthropic): AI calls fetch_url, gets content, responds", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "anth-url-1", content: "@ai summarize https://example.com/page", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      content: [
        { type: "text", text: "Let me fetch that page." },
        { type: "tool_use", id: "toolu_1", name: "fetch_url", input: { url: "https://example.com/page" } },
      ],
    },
    aiFinalResponse: {
      content: [{ type: "text", text: "Based on the page content, here is a summary." }],
    },
    fetchUrlResponse: {
      status: 200,
      body: "<html><body><p>Important page content.</p></body></html>",
      contentType: "text/html",
    },
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
    useAnthropic: true,
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "anth-url-1", content: "@ai summarize https://example.com/page", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBodies[0], "First AI call should happen");
    assert(capturedBodies[1], "Second AI call with tool result should happen");
    // Anthropic batches tool results in a user message
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) =>
      m.role === "user" && Array.isArray(m.content) &&
      (m.content as Record<string, unknown>[]).some((c) => c.type === "tool_result")
    );
    assert(toolResultMsg, "Should have tool_result in a user message (Anthropic format)");
    const toolParts = (toolResultMsg!.content as Record<string, unknown>[]).filter(
      (c) => c.type === "tool_result"
    );
    assertEquals(toolParts.length, 1, "Should have exactly one tool result");
    const content = toolParts[0].content as string;
    assert(content.includes("Important page content"), "Tool result should contain fetched text");
  } finally {
    restore();
  }
});

t("fetch_url: binary content type is rejected", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "bin-url-1", content: "@ai download https://example.com/file.zip", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "fetch_url", arguments: '{"url":"https://example.com/file.zip"}' },
          }],
        },
      }],
    },
    aiFinalResponse: {
      choices: [{ message: { content: "That URL contains binary content." } }],
    },
    fetchUrlResponse: {
      status: 200,
      body: "binary-content",
      contentType: "application/zip",
    },
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "bin-url-1", content: "@ai download https://example.com/file.zip", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBodies[1], "Second AI call should happen");
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) => m.role === "tool");
    assert(toolResultMsg, "Should have a tool result message");
    const toolContent = toolResultMsg.content as string;
    assert(
      toolContent.includes("Error") || toolContent.includes("not supported") || toolContent.includes("text"),
      "Tool result should reject binary content"
    );
  } finally {
    restore();
  }
});

t("web_search: AI calls web_search tool and gets results", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  const restore = mockFullFlowWithToolCalls({
    commentsResponse: [
      { id: "search-1", content: "@ai what is the weather today", posted_at: "2026-01-01T00:00:00Z" },
    ],
    aiToolCallResponse: {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "web_search", arguments: '{"query":"weather today"}' },
          }],
        },
      }],
    },
    aiFinalResponse: {
      choices: [{ message: { content: "The weather is sunny today." } }],
    },
    braveSearchResponse: {
      status: 200,
      body: {
        web: {
          results: [
            { title: "Weather Report", url: "https://weather.com", description: "Sunny, 25°C" },
          ],
        },
      },
    },
    withBraveKey: true,
    onAiRequest: (body, idx) => { capturedBodies[idx] = body; },
  });

  try {
    const payload = JSON.stringify(makePayload({
      event_data: { id: "search-1", content: "@ai what is the weather today", item_id: "task-1" },
    }));
    const req = await signedRequest(payload);
    const res = await handler(req);
    assertEquals(res.status, 200);
    await new Promise((r) => setTimeout(r, 300));

    assert(capturedBodies[1], "Second AI call should happen with search results");
    const secondMessages = capturedBodies[1].messages as Record<string, unknown>[];
    const toolResultMsg = secondMessages.find((m) => m.role === "tool");
    assert(toolResultMsg, "Should have a tool result message");
    const toolContent = toolResultMsg.content as string;
    assert(toolContent.includes("Weather Report"), "Tool result should contain search results");
    assert(toolContent.includes("Sunny"), "Tool result should contain search description");
  } finally {
    restore();
  }
});
