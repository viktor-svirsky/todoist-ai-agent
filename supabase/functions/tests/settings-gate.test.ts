import { assert, assertEquals } from "@std/assert";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set(
  "ENCRYPTION_KEY",
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
);
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_dummy");
Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test");
Deno.env.set("STRIPE_PRICE_ID_PRO_MONTHLY", "price_test");
Deno.env.set("APP_URL", "http://localhost");

const { settingsHandler } = await import("../settings/handler.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface State {
  tier: string | null;
  rpcCalls: RpcCall[];
  patchBodies: Record<string, unknown>[];
  configRow: Record<string, unknown>;
}

function freshState(over: Partial<State> = {}): State {
  return {
    tier: "free",
    rpcCalls: [],
    patchBodies: [],
    configRow: {
      pro_until: null,
      stripe_subscription_id: null,
      stripe_cancel_at_period_end: false,
    },
    ...over,
  };
}

function installFetchMock(state: State): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === "string"
      ? input
      : (input as Request | URL).toString();
    const req = init as RequestInit | undefined;
    const method = (req?.method ?? "GET").toUpperCase();

    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({ id: USER_ID, email: "t@e.com", aud: "authenticated" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return new Response(
        JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rest/v1/rpc/get_user_tier")) {
      const args = JSON.parse(String(req?.body ?? "{}"));
      state.rpcCalls.push({ fn: "get_user_tier", args });
      return new Response(JSON.stringify(state.tier), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/log_feature_gate_event")) {
      const args = JSON.parse(String(req?.body ?? "{}"));
      state.rpcCalls.push({ fn: "log_feature_gate_event", args });
      return new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/users_config")) {
      if (method === "PATCH") {
        const body = JSON.parse(String(req?.body ?? "{}"));
        state.patchBodies.push(body);
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "GET") {
        const accept = new Headers(req?.headers ?? {}).get("accept") ?? "";
        const single = accept.includes("vnd.pgrst.object+json");
        const body = state.configRow;
        return new Response(JSON.stringify(single ? body : [body]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function putReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/settings", {
    method: "PUT",
    headers: {
      Authorization: "Bearer valid-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

t("Free + custom_ai_model, no key → 409, no PATCH, write_rejected logged", async () => {
  const state = freshState({ tier: "free" });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(putReq({ custom_ai_model: "gpt-4o" }));
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.code, "model_requires_byok");
    assert(typeof body.message === "string" && body.message.length > 0);

    assertEquals(state.patchBodies.length, 0, "no DB write on rejection");

    const logged = state.rpcCalls.find((c) => c.fn === "log_feature_gate_event");
    assert(logged, "telemetry event logged");
    assertEquals(logged!.args.p_user_id, USER_ID);
    assertEquals(logged!.args.p_tier, "free");
    assertEquals(logged!.args.p_feature, "model_override");
    assertEquals(logged!.args.p_action, "write_rejected");
  } finally {
    restore();
  }
});

t("Null tier (missing row) + custom_ai_model → 409, event tier='free'", async () => {
  const state = freshState({ tier: null });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(putReq({ custom_ai_model: "gpt-4o" }));
    assertEquals(res.status, 409);
    assertEquals(state.patchBodies.length, 0);
    const logged = state.rpcCalls.find((c) => c.fn === "log_feature_gate_event");
    assert(logged);
    assertEquals(logged!.args.p_tier, "free");
  } finally {
    restore();
  }
});

t("BYOK (tier=byok) + custom_ai_model → 200, DB updated, no event", async () => {
  const state = freshState({ tier: "byok" });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(putReq({ custom_ai_model: "gpt-4o" }));
    assertEquals(res.status, 200);
    assertEquals(state.patchBodies.length, 1);
    assertEquals(state.patchBodies[0].custom_ai_model, "gpt-4o");
    const logged = state.rpcCalls.find((c) => c.fn === "log_feature_gate_event");
    assertEquals(logged, undefined);
  } finally {
    restore();
  }
});

t("Pro + custom_ai_model → 200, DB updated, no event", async () => {
  const state = freshState({
    tier: "pro",
    configRow: {
      pro_until: FAR_FUTURE,
      stripe_subscription_id: null,
      stripe_cancel_at_period_end: false,
    },
  });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(putReq({ custom_ai_model: "gpt-4o" }));
    assertEquals(res.status, 200);
    assertEquals(state.patchBodies.length, 1);
    assertEquals(state.patchBodies[0].custom_ai_model, "gpt-4o");
    const logged = state.rpcCalls.find((c) => c.fn === "log_feature_gate_event");
    assertEquals(logged, undefined);
  } finally {
    restore();
  }
});

t("Free + custom_ai_model + BYOK key in same request → 200, no gate lookup", async () => {
  const state = freshState({ tier: "free" });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_model: "gpt-4o", custom_ai_api_key: "sk-user" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.patchBodies.length, 1);
    const tierLookup = state.rpcCalls.find((c) => c.fn === "get_user_tier");
    assertEquals(tierLookup, undefined, "byok-in-request short-circuits gate");
  } finally {
    restore();
  }
});

t("Free clearing custom_ai_model (empty string) → 200, no gate", async () => {
  const state = freshState({ tier: "free" });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(putReq({ custom_ai_model: "" }));
    assertEquals(res.status, 200);
    assertEquals(state.patchBodies.length, 1);
    assertEquals(state.patchBodies[0].custom_ai_model, null);
    const tierLookup = state.rpcCalls.find((c) => c.fn === "get_user_tier");
    assertEquals(tierLookup, undefined);
  } finally {
    restore();
  }
});
