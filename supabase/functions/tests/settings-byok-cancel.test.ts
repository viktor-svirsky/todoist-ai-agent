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
const { __resetStripeForTests } = await import("../_shared/stripe.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

interface StripeCall {
  path: string;
  method: string;
  body: string;
  idempotencyKey: string | null;
}

interface ConfigRow {
  pro_until: string | null;
  stripe_subscription_id: string | null;
  stripe_cancel_at_period_end: boolean;
}

interface State {
  configRow: ConfigRow;
  stripeCalls: StripeCall[];
  stripeUpdateStatus: number;
  patchBodies: Record<string, unknown>[];
}

function freshState(over: Partial<State> = {}): State {
  return {
    configRow: {
      pro_until: FAR_FUTURE,
      stripe_subscription_id: "sub_test_1",
      stripe_cancel_at_period_end: false,
    },
    stripeCalls: [],
    stripeUpdateStatus: 200,
    patchBodies: [],
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
    const host = new URL(url).hostname;

    if (host === "localhost" && url.includes("/auth/v1/user")) {
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
    if (host === "localhost" && url.includes("/rest/v1/users_config")) {
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

    if (host === "api.stripe.com") {
      const headers = new Headers(req?.headers ?? {});
      state.stripeCalls.push({
        path: new URL(url).pathname,
        method,
        body: String(req?.body ?? ""),
        idempotencyKey: headers.get("idempotency-key"),
      });
      if (state.stripeUpdateStatus >= 400) {
        return new Response(
          JSON.stringify({ error: { message: "stripe down" } }),
          {
            status: state.stripeUpdateStatus,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          object: "subscription",
          id: "sub_test_1",
          cancel_at_period_end: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
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

t("BYOK key + Pro active + sub present → Stripe cancel_at_period_end and DB flip", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "sk-user-byok" }),
    );
    assertEquals(res.status, 200);

    const subCall = state.stripeCalls.find((c) =>
      c.path === "/v1/subscriptions/sub_test_1" && c.method === "POST"
    );
    assert(subCall, "subscriptions.update must be called");
    assert(
      subCall!.body.includes("cancel_at_period_end=true"),
      "body must set cancel_at_period_end=true",
    );
    assertEquals(subCall!.idempotencyKey, `byok-cancel:${USER_ID}`);

    const flip = state.patchBodies.find((b) =>
      b.stripe_cancel_at_period_end === true
    );
    assert(flip, "DB column must be flipped to true");
  } finally {
    restore();
  }
});

t("Stripe API error → PUT still 200, no DB flip", async () => {
  __resetStripeForTests();
  const state = freshState({ stripeUpdateStatus: 500 });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "sk-user-byok" }),
    );
    assertEquals(res.status, 200);

    assert(
      state.stripeCalls.some((c) => c.path === "/v1/subscriptions/sub_test_1"),
      "subscriptions.update was attempted",
    );
    const flip = state.patchBodies.find((b) =>
      b.stripe_cancel_at_period_end === true
    );
    assertEquals(flip, undefined, "DB must not flip on Stripe failure");
  } finally {
    restore();
  }
});

t("whitespace-only key → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "   " }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("empty key → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("no BYOK field in PUT → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ trigger_word: "@bot" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("Pro expired → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState({
    configRow: {
      pro_until: PAST,
      stripe_subscription_id: "sub_test_1",
      stripe_cancel_at_period_end: false,
    },
  });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "sk-user-byok" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("no subscription id → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState({
    configRow: {
      pro_until: FAR_FUTURE,
      stripe_subscription_id: null,
      stripe_cancel_at_period_end: false,
    },
  });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "sk-user-byok" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("already scheduled to cancel → zero Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState({
    configRow: {
      pro_until: FAR_FUTURE,
      stripe_subscription_id: "sub_test_1",
      stripe_cancel_at_period_end: true,
    },
  });
  const restore = installFetchMock(state);
  try {
    const res = await settingsHandler(
      putReq({ custom_ai_api_key: "sk-user-byok" }),
    );
    assertEquals(res.status, 200);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});
