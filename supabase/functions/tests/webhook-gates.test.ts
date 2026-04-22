import { assert, assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
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

interface Capture {
  providerBodies: Array<Record<string, unknown>>;
  gateEvents: Array<{ feature: string; action: string; tier: string }>;
}

function installMocks(
  tier: "free" | "pro" | "byok",
  user: Record<string, unknown>,
  opts: { failLog?: boolean } = {},
): { restore: () => void; cap: Capture } {
  const cap: Capture = { providerBodies: [], gateEvents: [] };
  const original = globalThis.fetch;

  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = String(input);
    const ri = init as RequestInit | undefined;

    // users_config SELECT
    if (url.includes("/rest/v1/users_config") && (!ri?.method || ri.method === "GET")) {
      return Promise.resolve(new Response(JSON.stringify(user), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }

    // Claim + housekeeping RPCs
    if (url.includes("/rest/v1/rpc/try_claim_event")) {
      return Promise.resolve(new Response("true", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit")) {
      return Promise.resolve(new Response(JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    if (url.includes("/rest/v1/rpc/claim_ai_quota")) {
      return Promise.resolve(new Response(JSON.stringify({
        allowed: true, blocked: false, tier,
        used: 0, limit: tier === "free" ? 5 : 9999,
        next_slot_at: null, should_notify: false, event_id: 1,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/increment_ai_requests")) {
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/refund_ai_quota")) {
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/rest/v1/rpc/log_feature_gate_event")) {
      if (opts.failLog) {
        return Promise.resolve(new Response(
          JSON.stringify({ message: "boom" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ));
      }
      try {
        const body = JSON.parse(String(ri?.body ?? "{}"));
        cap.gateEvents.push({
          feature: body.p_feature, action: body.p_action, tier: body.p_tier,
        });
      } catch { /* ignore */ }
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // Todoist API
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

    // Provider (Anthropic)
    if (host === "api.anthropic.com") {
      try {
        const parsed = JSON.parse(String(ri?.body ?? "{}"));
        cap.providerBodies.push(parsed);
      } catch { /* ignore */ }
      return Promise.resolve(new Response(JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;

  return { restore: () => { globalThis.fetch = original; }, cap };
}

async function runAndWait(): Promise<void> {
  const req = await signedRequest(JSON.stringify(makePayload()));
  const res = await handler(req);
  assertEquals(res.status, 200);
  await new Promise((r) => setTimeout(r, 150));
}

function findProviderCall(cap: Capture): Record<string, unknown> {
  assert(cap.providerBodies.length > 0, "expected provider request");
  return cap.providerBodies[0];
}

function hasWebSearchTool(body: Record<string, unknown>): boolean {
  const tools = (body.tools as Array<Record<string, unknown>> | undefined) ?? [];
  return tools.some((tool) => {
    const fn = tool.function as { name?: string } | undefined;
    return tool.name === "web_search" || fn?.name === "web_search";
  });
}

function systemPromptText(body: Record<string, unknown>): string {
  // Anthropic top-level `system` string
  if (typeof body.system === "string") return body.system;
  const msgs = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (!msgs) return "";
  return msgs
    .filter((m) => m.role === "system")
    .map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content))
    .join("\n");
}

// ---------------------------------------------------------------------------
// G1 — web_search gated by tier
// ---------------------------------------------------------------------------

t("Free tier: web_search tool absent + gate event logged", async () => {
  const { restore, cap } = installMocks("free", userConfig({}));
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(hasWebSearchTool(body), false, "web_search should be filtered on Free");
    const evs = cap.gateEvents.filter((e) => e.feature === "web_search");
    assertEquals(evs.length, 1);
    assertEquals(evs[0], { feature: "web_search", action: "filtered", tier: "free" });
  } finally { restore(); }
});

t("Pro tier: web_search tool present + no gate event", async () => {
  const { restore, cap } = installMocks("pro", userConfig({}));
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(hasWebSearchTool(body), true);
    assertEquals(cap.gateEvents.filter((e) => e.feature === "web_search").length, 0);
  } finally { restore(); }
});

t("BYOK tier: web_search tool present + no gate event", async () => {
  const { restore, cap } = installMocks(
    "byok",
    userConfig({ custom_ai_api_key: await encrypt("sk-user") }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(hasWebSearchTool(body), true);
    assertEquals(cap.gateEvents.filter((e) => e.feature === "web_search").length, 0);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// G3 — custom_prompt gated
// ---------------------------------------------------------------------------

t("Free tier: custom_prompt dropped from system + logged silently_ignored", async () => {
  const SECRET_MARK = "ZZZ_CUSTOM_PROMPT_MARKER_ZZZ";
  const { restore, cap } = installMocks(
    "free", userConfig({ custom_prompt: SECRET_MARK }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    const sys = systemPromptText(body);
    assert(!sys.includes(SECRET_MARK), "custom prompt must not reach provider on Free");
    const evs = cap.gateEvents.filter((e) => e.feature === "custom_prompt");
    assertEquals(evs.length, 1);
    assertEquals(evs[0].action, "silently_ignored");
  } finally { restore(); }
});

t("Pro tier: custom_prompt included in system + no gate event", async () => {
  const SECRET_MARK = "ZZZ_CUSTOM_PROMPT_MARKER_ZZZ";
  const { restore, cap } = installMocks(
    "pro", userConfig({ custom_prompt: SECRET_MARK }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    const sys = systemPromptText(body);
    assert(sys.includes(SECRET_MARK), "custom prompt should be present on Pro");
    assertEquals(cap.gateEvents.filter((e) => e.feature === "custom_prompt").length, 0);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// G4 — model override gated to BYOK only
// ---------------------------------------------------------------------------

t("Free tier: custom_ai_model ignored, uses DEFAULT_AI_MODEL + logs silently_ignored", async () => {
  const { restore, cap } = installMocks(
    "free", userConfig({ custom_ai_model: "gpt-4o" }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(body.model, "claude-default");
    const evs = cap.gateEvents.filter((e) => e.feature === "model_override");
    assertEquals(evs.length, 1);
    assertEquals(evs[0].action, "silently_ignored");
  } finally { restore(); }
});

t("Pro tier: custom_ai_model still ignored (Pro alone does not enable override)", async () => {
  const { restore, cap } = installMocks(
    "pro", userConfig({ custom_ai_model: "gpt-4o" }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(body.model, "claude-default");
    const evs = cap.gateEvents.filter((e) => e.feature === "model_override");
    assertEquals(evs.length, 1);
    assertEquals(evs[0].action, "silently_ignored");
  } finally { restore(); }
});

t("BYOK tier: custom_ai_model applied + no gate event", async () => {
  const { restore, cap } = installMocks(
    "byok",
    userConfig({
      custom_ai_api_key: await encrypt("sk-user"),
      custom_ai_model: "gpt-4o",
    }),
  );
  try {
    await runAndWait();
    const body = findProviderCall(cap);
    assertEquals(body.model, "gpt-4o");
    assertEquals(cap.gateEvents.filter((e) => e.feature === "model_override").length, 0);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// G2 — todoist_tools filtered event (webhook currently runs non-agentic,
// so only telemetry path is observable here; tool-filter unit tests cover
// the actual dispatcher short-circuit).
// ---------------------------------------------------------------------------

t("Free tier: todoist_tools filtered event logged", async () => {
  const { restore, cap } = installMocks("free", userConfig({}));
  try {
    await runAndWait();
    const evs = cap.gateEvents.filter((e) => e.feature === "todoist_tools");
    assertEquals(evs.length, 1);
    assertEquals(evs[0], { feature: "todoist_tools", action: "filtered", tier: "free" });
  } finally { restore(); }
});

t("Pro tier: no todoist_tools gate event", async () => {
  const { restore, cap } = installMocks("pro", userConfig({}));
  try {
    await runAndWait();
    assertEquals(cap.gateEvents.filter((e) => e.feature === "todoist_tools").length, 0);
  } finally { restore(); }
});
