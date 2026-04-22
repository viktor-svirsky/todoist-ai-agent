import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Regression: feature gates must NOT alter AI quota accounting.
// One successful AI run = +1 claim_ai_quota (counted=true) + 1 increment +
// 0 refunds, regardless of which gates fire or whether telemetry RPC fails.
// ---------------------------------------------------------------------------

const CLIENT_SECRET = "test-client-secret";
Deno.env.set("TODOIST_CLIENT_SECRET", CLIENT_SECRET);
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
Deno.env.set("DEFAULT_AI_BASE_URL", "https://api.anthropic.com/v1");
Deno.env.set("DEFAULT_AI_API_KEY", "default-key");
Deno.env.set("DEFAULT_AI_MODEL", "claude-default");
Deno.env.set("DEFAULT_BRAVE_API_KEY", "");
Deno.env.set("DEFAULT_AI_FALLBACK_MODEL", "");

const { webhookHandler: handler } = await import("../webhook/handler.ts");
const { encrypt } = await import("../_shared/crypto.ts");

const ENCRYPTED_MOCK_TOKEN = await encrypt("test-todoist-token");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

async function computeHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function signedRequest(body: string): Promise<Request> {
  const sig = await computeHmac(CLIENT_SECRET, body);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-todoist-hmac-sha256": sig,
    },
    body,
  });
}

function makePayload(): Record<string, unknown> {
  return {
    event_name: "note:added",
    user_id: "12345",
    event_data: {
      id: "comment-1",
      content: "@ai do it",
      item_id: "task-1",
    },
  };
}

function userConfig(overrides: Record<string, unknown>) {
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
    control_task_id: null,
    ...overrides,
  };
}

interface QuotaCounters {
  claim: number;
  increment: number;
  refund: number;
  gateLogAttempts: number;
}

function installMocks(
  user: Record<string, unknown>,
  opts: { logRpcThrows?: boolean } = {},
): { restore: () => void; counters: QuotaCounters } {
  const counters: QuotaCounters = { claim: 0, increment: 0, refund: 0, gateLogAttempts: 0 };
  const original = globalThis.fetch;

  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = String(input);
    const ri = init as RequestInit | undefined;

    if (url.includes("/rest/v1/users_config") && (!ri?.method || ri.method === "GET")) {
      return Promise.resolve(new Response(JSON.stringify(user), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return Promise.resolve(new Response("true", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return Promise.resolve(new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    if (url.includes("/rest/v1/rpc/claim_ai_quota")) {
      counters.claim++;
      return Promise.resolve(new Response(JSON.stringify({
        allowed: true, blocked: false, tier: "free",
        used: 0, limit: 5, next_slot_at: null, should_notify: false, event_id: 42,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      counters.increment++;
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/refund_ai_quota")) {
      counters.refund++;
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/log_feature_gate_event")) {
      counters.gateLogAttempts++;
      if (opts.logRpcThrows) {
        // Simulate transport failure mid-RPC. Helper must swallow.
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    if (host === "api.todoist.com") {
      if (url.includes("/comments") && ri?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: "progress-1" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/comments") && ri?.method === "PUT") {
        return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.includes("/comments")) {
        return Promise.resolve(new Response(JSON.stringify({ results: [] }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/tasks/")) {
        return Promise.resolve(new Response(JSON.stringify({ content: "Task", description: "" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
    }
    if (host === "api.anthropic.com") {
      return Promise.resolve(new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;

  return { restore: () => { globalThis.fetch = original; }, counters };
}

async function runAndWait(): Promise<void> {
  const req = await signedRequest(JSON.stringify(makePayload()));
  const res = await handler(req);
  assertEquals(res.status, 200);
  await new Promise((r) => setTimeout(r, 200));
}

t("Free + web_search gate filtered: quota counted exactly once, no refund", async () => {
  const { restore, counters } = installMocks(userConfig({}));
  try {
    await runAndWait();
    assertEquals(counters.claim, 1, "claim_ai_quota must run once");
    assertEquals(counters.increment, 1, "increment_ai_requests must run once on success");
    assertEquals(counters.refund, 0, "no refund on a successful reply");
  } finally { restore(); }
});

t("Free + custom_prompt + custom_ai_model gates: quota counted exactly once", async () => {
  const { restore, counters } = installMocks(
    userConfig({ custom_prompt: "secret", custom_ai_model: "gpt-4o" }),
  );
  try {
    await runAndWait();
    assertEquals(counters.claim, 1);
    assertEquals(counters.increment, 1);
    assertEquals(counters.refund, 0);
  } finally { restore(); }
});

t("log_feature_gate_event RPC failure does not break flow or quota accounting", async () => {
  const { restore, counters } = installMocks(userConfig({}), { logRpcThrows: true });
  try {
    await runAndWait();
    // Gate logging was attempted (and failed) — but reply still posted, quota still counted.
    assertEquals(counters.gateLogAttempts > 0, true, "telemetry attempted at least once");
    assertEquals(counters.claim, 1);
    assertEquals(counters.increment, 1, "AI reply posted → counter incremented");
    assertEquals(counters.refund, 0, "no refund: reply succeeded");
  } finally { restore(); }
});
