import { assert, assertEquals } from "@std/assert";

Deno.env.set("STRIPE_SECRET_KEY", "sk_test_dummy");
Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test");
Deno.env.set("STRIPE_PRICE_ID_PRO_MONTHLY", "price_test");
Deno.env.set("APP_URL", "http://localhost");
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { stripePortalHandler } = await import("../stripe-portal/handler.ts");
const { __resetStripeForTests } = await import("../_shared/stripe.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface StripeCall {
  path: string;
  method: string;
  body: string;
}

interface State {
  authUser: { id: string; email: string | null } | null;
  existingCustomerId: string | null;
  stripeCalls: StripeCall[];
  portalSessionResponse: { id: string; url: string };
}

function freshState(over: Partial<State> = {}): State {
  return {
    authUser: { id: USER_ID, email: "test@example.com" },
    existingCustomerId: null,
    stripeCalls: [],
    portalSessionResponse: {
      id: "bps_test_1",
      url: "https://billing.stripe.com/p/session/bps_test_1",
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

    if (host === "localhost" && url.includes("/rest/v1/users_config")) {
      if (method === "GET") {
        const accept = new Headers(req?.headers ?? {}).get("accept") ?? "";
        const single = accept.includes("vnd.pgrst.object+json");
        const body = { stripe_customer_id: state.existingCustomerId };
        return new Response(JSON.stringify(single ? body : [body]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (host === "api.stripe.com") {
      const body = String(req?.body ?? "");
      const path = new URL(url).pathname;
      state.stripeCalls.push({ path, method, body });

      if (path === "/v1/billing_portal/sessions" && method === "POST") {
        return new Response(
          JSON.stringify({
            object: "billing_portal.session",
            ...state.portalSessionResponse,
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
  return new Request("http://localhost/stripe-portal", {
    method: opts.method ?? "POST",
    headers,
  });
}

t("rejects non-POST with 405", async () => {
  __resetStripeForTests();
  const res = await stripePortalHandler(req({ method: "GET", auth: null }));
  assertEquals(res.status, 405);
});

t("missing Authorization → 401", async () => {
  __resetStripeForTests();
  const res = await stripePortalHandler(req({ auth: null }));
  assertEquals(res.status, 401);
});

t("invalid token → 401, no Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState({ authUser: null });
  const restore = installFetchMock(state);
  try {
    const res = await stripePortalHandler(req());
    assertEquals(res.status, 401);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("no stripe_customer_id → 409, no Stripe calls", async () => {
  __resetStripeForTests();
  const state = freshState({ existingCustomerId: null });
  const restore = installFetchMock(state);
  try {
    const res = await stripePortalHandler(req());
    assertEquals(res.status, 409);
    assertEquals(state.stripeCalls.length, 0);
  } finally {
    restore();
  }
});

t("existing customer → creates portal session, returns URL", async () => {
  __resetStripeForTests();
  const state = freshState({ existingCustomerId: "cus_existing" });
  const restore = installFetchMock(state);
  try {
    const res = await stripePortalHandler(req());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.url, "https://billing.stripe.com/p/session/bps_test_1");

    const call = state.stripeCalls.find((c) =>
      c.path === "/v1/billing_portal/sessions"
    );
    assert(call, "portal session create must occur");
    assert(
      call!.body.includes("customer=cus_existing"),
      "body must include customer id",
    );
    assert(
      call!.body.includes("return_url=http%3A%2F%2Flocalhost%2Fsettings"),
      "body must include return_url pointing to /settings",
    );
  } finally {
    restore();
  }
});
