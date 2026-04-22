import { assert, assertEquals } from "@std/assert";

Deno.env.set("STRIPE_SECRET_KEY", "sk_test_dummy");
Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test");
Deno.env.set("STRIPE_PRICE_ID_PRO_MONTHLY", "price_test");
Deno.env.set("APP_URL", "http://localhost");
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { stripeCheckoutHandler } = await import("../stripe-checkout/handler.ts");
const { __resetStripeForTests } = await import("../_shared/stripe.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface StripeCall {
  path: string;
  method: string;
  body: string;
  idempotencyKey: string | null;
}

interface State {
  authUser: { id: string; email: string | null } | null;
  existingCustomerId: string | null;
  existingSubscriptionId?: string | null;
  existingStatus?: string | null;
  userConfigUpdates: Array<Record<string, unknown>>;
  stripeCalls: StripeCall[];
  customerCreateResponse: { id: string };
  checkoutSessionResponse: { id: string; url: string };
  failUserConfigPatch?: boolean;
}

function freshState(over: Partial<State> = {}): State {
  return {
    authUser: { id: USER_ID, email: "test@example.com" },
    existingCustomerId: null,
    userConfigUpdates: [],
    stripeCalls: [],
    customerCreateResponse: { id: "cus_new_1" },
    checkoutSessionResponse: {
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
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
    const host = new URL(url).hostname;

    // Supabase auth getUser
    if (host === "localhost" && url.includes("/auth/v1/user")) {
      if (!state.authUser) {
        return new Response(
          JSON.stringify({ msg: "invalid" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          id: state.authUser.id,
          email: state.authUser.email,
          aud: "authenticated",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Supabase REST: users_config
    if (host === "localhost" && url.includes("/rest/v1/users_config")) {
      if (method === "GET") {
        const accept = new Headers(req?.headers ?? {}).get("accept") ?? "";
        const single = accept.includes("vnd.pgrst.object+json");
        const body = {
          id: USER_ID,
          stripe_customer_id: state.existingCustomerId,
          stripe_subscription_id: state.existingSubscriptionId ?? null,
          stripe_status: state.existingStatus ?? null,
        };
        return new Response(JSON.stringify(single ? body : [body]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "PATCH") {
        if (state.failUserConfigPatch) {
          return new Response(
            JSON.stringify({ code: "XX000", message: "boom" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        const patch = JSON.parse(String(req?.body ?? "{}"));
        state.userConfigUpdates.push(patch);
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Stripe API
    if (host === "api.stripe.com") {
      const headers = new Headers(req?.headers ?? {});
      const idempotencyKey = headers.get("idempotency-key");
      const body = String(req?.body ?? "");
      const path = new URL(url).pathname;
      state.stripeCalls.push({ path, method, body, idempotencyKey });

      if (path === "/v1/customers" && method === "POST") {
        return new Response(
          JSON.stringify({
            object: "customer",
            ...state.customerCreateResponse,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/v1/checkout/sessions" && method === "POST") {
        return new Response(
          JSON.stringify({
            object: "checkout.session",
            ...state.checkoutSessionResponse,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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

function req(
  opts: { method?: string; auth?: string | null } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== null) {
    headers.Authorization = opts.auth ?? `Bearer test-jwt`;
  }
  return new Request("http://localhost/stripe-checkout", {
    method: opts.method ?? "POST",
    headers,
  });
}

t("rejects non-POST with 405", async () => {
  __resetStripeForTests();
  const res = await stripeCheckoutHandler(req({ method: "GET", auth: null }));
  assertEquals(res.status, 405);
});

t("missing Authorization → 401", async () => {
  __resetStripeForTests();
  const res = await stripeCheckoutHandler(req({ auth: null }));
  assertEquals(res.status, 401);
});

t("invalid token (supabase returns no user) → 401", async () => {
  __resetStripeForTests();
  const state = freshState({ authUser: null });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 401);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("first call creates customer, then creates checkout session", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.url, "https://checkout.stripe.com/c/pay/cs_test_1");

    const customerCall = state.stripeCalls.find((c) =>
      c.path === "/v1/customers"
    );
    assert(customerCall, "customer create call must occur");
    assert(
      customerCall!.body.includes(`metadata[user_id]=${USER_ID}`),
      "customer create must pass user_id metadata",
    );

    const sessionCall = state.stripeCalls.find((c) =>
      c.path === "/v1/checkout/sessions"
    );
    assert(sessionCall, "checkout session create call must occur");
    assert(
      sessionCall!.idempotencyKey?.startsWith(`checkout:${USER_ID}:`),
      `idempotency-key should be bucketed per user+minute, got ${sessionCall!.idempotencyKey}`,
    );
    assert(
      sessionCall!.body.includes(`client_reference_id=${USER_ID}`),
      "session body must include client_reference_id",
    );
    assert(
      sessionCall!.body.includes(`customer=cus_new_1`),
      "session must reference the newly-created customer",
    );

    // users_config updated with the new stripe_customer_id
    assertEquals(state.userConfigUpdates.length, 1);
    assertEquals(
      state.userConfigUpdates[0].stripe_customer_id,
      "cus_new_1",
    );
  } finally {
    restore();
  }
});

t("existing customer: skips customers.create, reuses stored id", async () => {
  __resetStripeForTests();
  const state = freshState({ existingCustomerId: "cus_existing" });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 200);
    assertEquals(
      state.stripeCalls.filter((c) => c.path === "/v1/customers").length,
      0,
    );
    const sessionCall = state.stripeCalls.find((c) =>
      c.path === "/v1/checkout/sessions"
    );
    assert(sessionCall, "session create must occur");
    assert(
      sessionCall!.body.includes("customer=cus_existing"),
      "session must reuse existing stripe_customer_id",
    );
    assertEquals(state.userConfigUpdates.length, 0);
  } finally {
    restore();
  }
});

t("two calls in the same minute reuse the same idempotency key", async () => {
  __resetStripeForTests();
  const state = freshState({ existingCustomerId: "cus_existing" });
  const restore = installFetchMock(state);
  try {
    const r1 = await stripeCheckoutHandler(req());
    const r2 = await stripeCheckoutHandler(req());
    assertEquals(r1.status, 200);
    assertEquals(r2.status, 200);
    const sessionCalls = state.stripeCalls.filter((c) =>
      c.path === "/v1/checkout/sessions"
    );
    assertEquals(sessionCalls.length, 2);
    assertEquals(
      sessionCalls[0].idempotencyKey,
      sessionCalls[1].idempotencyKey,
      "same-minute calls must share idempotency key",
    );
  } finally {
    restore();
  }
});

t("active subscription already exists → 409 (no new checkout session)", async () => {
  __resetStripeForTests();
  const state = freshState({
    existingCustomerId: "cus_existing",
    existingSubscriptionId: "sub_active",
    existingStatus: "active",
  });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.code, "already_subscribed");
    const sessionCalls = state.stripeCalls.filter((c) =>
      c.path === "/v1/checkout/sessions"
    );
    assertEquals(sessionCalls.length, 0);
  } finally {
    restore();
  }
});

t("trialing subscription already exists → 409", async () => {
  __resetStripeForTests();
  const state = freshState({
    existingCustomerId: "cus_existing",
    existingSubscriptionId: "sub_trial",
    existingStatus: "trialing",
  });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 409);
  } finally {
    restore();
  }
});

t("canceled subscription id lingering → new checkout allowed (200)", async () => {
  __resetStripeForTests();
  const state = freshState({
    existingCustomerId: "cus_existing",
    existingSubscriptionId: "sub_old",
    existingStatus: "canceled",
  });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 200);
  } finally {
    restore();
  }
});

t("customer created but users_config update fails → 500 (no orphan checkout)", async () => {
  __resetStripeForTests();
  const state = freshState({ failUserConfigPatch: true });
  const restore = installFetchMock(state);
  try {
    const res = await stripeCheckoutHandler(req());
    assertEquals(res.status, 500);
    // Customer was created, but checkout session must NOT be reached.
    const custCalls = state.stripeCalls.filter((c) => c.path === "/v1/customers");
    const sessCalls = state.stripeCalls.filter((c) =>
      c.path === "/v1/checkout/sessions"
    );
    assertEquals(custCalls.length, 1);
    assertEquals(sessCalls.length, 0);
  } finally {
    restore();
  }
});
