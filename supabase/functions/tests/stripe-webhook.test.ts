import { assert, assertEquals } from "@std/assert";
import { signStripePayload } from "./helpers/stripe-sig.ts";

// ---------------------------------------------------------------------------
// Env setup (must happen before dynamic imports)
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "whsec_test_secret";
Deno.env.set("STRIPE_SECRET_KEY", "sk_test_dummy");
Deno.env.set("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
Deno.env.set("STRIPE_PRICE_ID_PRO_MONTHLY", "price_test");
Deno.env.set("APP_URL", "http://localhost");
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

const { stripeWebhookHandler } = await import("../stripe-webhook/handler.ts");
const { __resetStripeForTests } = await import("../_shared/stripe.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

interface State {
  stripeEventIds: Set<string>;
  processedEventIds: Set<string>;
  usersConfigUpdates: Array<Record<string, unknown>>;
  stripeEventsUpdates: Array<Record<string, unknown>>;
  userPriorProUntil: string | null;
  subscriptionFetches: number;
  subscriptionResponse: Record<string, unknown>;
  failNextUserConfigPatch?: boolean;
}

function freshState(over: Partial<State> = {}): State {
  return {
    stripeEventIds: new Set(),
    processedEventIds: new Set(),
    usersConfigUpdates: [],
    stripeEventsUpdates: [],
    userPriorProUntil: null,
    subscriptionFetches: 0,
    subscriptionResponse: {
      id: "sub_test",
      object: "subscription",
      status: "active",
      cancel_at_period_end: false,
      items: {
        object: "list",
        data: [{
          id: "si_1",
          price: { id: "price_test", object: "price" },
          current_period_end: 1_800_000_000,
        }],
      },
      metadata: { user_id: USER_ID },
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

    // --- Supabase REST ------------------------------------------------------
    if (host === "localhost" && url.includes("/rest/v1/stripe_events")) {
      if (method === "POST") {
        const body = JSON.parse(String(req?.body ?? "[]"));
        const rows = Array.isArray(body) ? body : [body];
        const row = rows[0];
        if (state.stripeEventIds.has(row.id)) {
          return new Response(
            JSON.stringify({
              code: "23505",
              message: "duplicate key value violates unique constraint",
              details: null,
              hint: null,
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        state.stripeEventIds.add(row.id);
        return new Response(JSON.stringify([{ id: row.id }]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "GET" && url.includes("select=processed_at")) {
        const m = url.match(/id=eq\.([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : "";
        const processed = state.processedEventIds.has(id);
        const body = {
          processed_at: processed ? "2026-04-21T00:00:00Z" : null,
        };
        const accept = new Headers(req?.headers ?? {}).get("accept") ?? "";
        const single = accept.includes("vnd.pgrst.object+json");
        return new Response(JSON.stringify(single ? body : [body]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "PATCH") {
        const patch = JSON.parse(String(req?.body ?? "{}"));
        state.stripeEventsUpdates.push(patch);
        const m = url.match(/id=eq\.([^&]+)/);
        if (m && patch.processed_at) {
          state.processedEventIds.add(decodeURIComponent(m[1]));
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (host === "localhost" && url.includes("/rest/v1/users_config")) {
      if (method === "GET") {
        const accept = new Headers(req?.headers ?? {}).get("accept") ?? "";
        const single = accept.includes("vnd.pgrst.object+json");
        if (url.includes("select=pro_until")) {
          const body = { pro_until: state.userPriorProUntil };
          return new Response(
            JSON.stringify(single ? body : [body]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("select=id")) {
          const body = { id: USER_ID };
          return new Response(JSON.stringify(single ? body : [body]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      if (method === "PATCH") {
        const patch = JSON.parse(String(req?.body ?? "{}"));
        if (state.failNextUserConfigPatch) {
          state.failNextUserConfigPatch = false;
          return new Response(
            JSON.stringify({ code: "XX000", message: "boom" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        state.usersConfigUpdates.push(patch);
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // --- Stripe API ---------------------------------------------------------
    if (host === "api.stripe.com") {
      if (url.includes("/v1/subscriptions/")) {
        state.subscriptionFetches += 1;
        return new Response(JSON.stringify(state.subscriptionResponse), {
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

async function signedPost(
  body: Record<string, unknown>,
  opts: { sigOverride?: string } = {},
): Promise<Request> {
  const raw = JSON.stringify(body);
  const sig = opts.sigOverride ??
    (await signStripePayload(raw, WEBHOOK_SECRET));
  return new Request("http://localhost/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body: raw,
  });
}

function subUpdatedEvent(id: string, subOver: Record<string, unknown> = {}) {
  return {
    id,
    object: "event",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: "sub_test",
        object: "subscription",
        customer: "cus_test",
        status: "active",
        cancel_at_period_end: false,
        items: {
          object: "list",
          data: [{
            id: "si_1",
            price: { id: "price_test", object: "price" },
            current_period_end: 1_800_000_000,
          }],
        },
        metadata: { user_id: USER_ID },
        ...subOver,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

t("rejects non-POST with 405", async () => {
  __resetStripeForTests();
  const req = new Request("http://localhost/stripe-webhook", { method: "GET" });
  const res = await stripeWebhookHandler(req);
  assertEquals(res.status, 405);
});

t("missing signature → 400", async () => {
  __resetStripeForTests();
  const req = new Request("http://localhost/stripe-webhook", {
    method: "POST",
    body: "{}",
  });
  const res = await stripeWebhookHandler(req);
  assertEquals(res.status, 400);
});

t("bad signature → 400", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const req = await signedPost({ id: "evt_bad", type: "invoice.paid" }, {
      sigOverride: "t=1,v1=deadbeef",
    });
    const res = await stripeWebhookHandler(req);
    assertEquals(res.status, 400);
    assertEquals(state.usersConfigUpdates.length, 0);
  } finally {
    restore();
  }
});

t("customer.subscription.updated active → writes pro_until", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const req = await signedPost(subUpdatedEvent("evt_upd_1"));
    const res = await stripeWebhookHandler(req);
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assertEquals(w.stripe_subscription_id, "sub_test");
    assertEquals(w.stripe_status, "active");
    assertEquals(w.stripe_price_id, "price_test");
    assert(typeof w.pro_until === "string");
    assertEquals(state.stripeEventsUpdates.length, 1);
    assertEquals(state.stripeEventsUpdates[0].user_id, USER_ID);
  } finally {
    restore();
  }
});

t("retry after failed dispatch re-processes (processed_at still NULL)", async () => {
  __resetStripeForTests();
  const state = freshState({ failNextUserConfigPatch: true });
  const restore = installFetchMock(state);
  try {
    const evt = subUpdatedEvent("evt_retry_1");
    const r1 = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(r1.status, 500);
    assertEquals(state.usersConfigUpdates.length, 0);
    const r2 = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(r2.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
  } finally {
    restore();
  }
});

t("invoice.paid with Basil parent.subscription_details.subscription", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_invoice_paid_basil",
      object: "event",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_basil",
          object: "invoice",
          customer: "cus_test",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_test" },
          },
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.subscriptionFetches, 1);
    assertEquals(state.usersConfigUpdates.length, 1);
  } finally {
    restore();
  }
});

t("replay of same event id → second call 200 with no extra write", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = subUpdatedEvent("evt_replay");
    const r1 = await stripeWebhookHandler(await signedPost(evt));
    const r2 = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(r1.status, 200);
    assertEquals(r2.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
  } finally {
    restore();
  }
});

t("customer.subscription.deleted → clears subscription id, clamps pro_until", async () => {
  __resetStripeForTests();
  const state = freshState({ userPriorProUntil: "2099-01-01T00:00:00Z" });
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_del_1",
      object: "event",
      type: "customer.subscription.deleted",
      livemode: false,
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          customer: "cus_test",
          status: "canceled",
          current_period_end: 1_800_000_000,
          cancel_at_period_end: false,
          items: {
            object: "list",
            data: [{ id: "si_1", price: { id: "price_test" } }],
          },
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assertEquals(w.stripe_subscription_id, null);
    assertEquals(w.stripe_status, "canceled");
    assert(typeof w.pro_until === "string");
    assert((w.pro_until as string) < "2099-01-01T00:00:00Z");
  } finally {
    restore();
  }
});

t("charge.refunded → clamps pro_until, no other stripe columns written", async () => {
  __resetStripeForTests();
  const state = freshState({ userPriorProUntil: "2099-01-01T00:00:00Z" });
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_refund_1",
      object: "event",
      type: "charge.refunded",
      livemode: false,
      data: {
        object: {
          id: "ch_test",
          object: "charge",
          customer: "cus_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assert(typeof w.pro_until === "string");
    assert((w.pro_until as string) < "2099-01-01T00:00:00Z");
    assertEquals(w.stripe_status, undefined);
    assertEquals(w.stripe_subscription_id, undefined);
  } finally {
    restore();
  }
});

t("invoice.payment_failed → no column writes, still dedupes", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_failed_1",
      object: "event",
      type: "invoice.payment_failed",
      livemode: false,
      data: {
        object: {
          id: "in_test",
          object: "invoice",
          customer: "cus_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 0);
    assertEquals(state.stripeEventsUpdates.length, 1);
  } finally {
    restore();
  }
});

t("checkout.session.completed → retrieves subscription and writes", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_checkout_1",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test",
          object: "checkout.session",
          customer: "cus_test",
          subscription: "sub_test",
          client_reference_id: USER_ID,
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.subscriptionFetches, 1);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assertEquals(w.stripe_customer_id, "cus_test");
    assertEquals(w.stripe_subscription_id, "sub_test");
    assert(typeof w.pro_until === "string");
  } finally {
    restore();
  }
});

t("invoice.paid with subscription id → retrieves sub and writes pro_until", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_invoice_paid_1",
      object: "event",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_test",
          object: "invoice",
          customer: "cus_test",
          subscription: "sub_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.subscriptionFetches, 1);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assertEquals(w.stripe_subscription_id, "sub_test");
    assertEquals(w.stripe_status, "active");
    assert(typeof w.pro_until === "string");
  } finally {
    restore();
  }
});

t("invoice.paid without subscription → no column writes", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_invoice_paid_nosub",
      object: "event",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_test2",
          object: "invoice",
          customer: "cus_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.subscriptionFetches, 0);
    assertEquals(state.usersConfigUpdates.length, 0);
    assertEquals(state.stripeEventsUpdates.length, 1);
  } finally {
    restore();
  }
});

t("charge.dispute.created → clamps pro_until", async () => {
  __resetStripeForTests();
  const state = freshState({ userPriorProUntil: "2099-01-01T00:00:00Z" });
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_dispute_1",
      object: "event",
      type: "charge.dispute.created",
      livemode: false,
      data: {
        object: {
          id: "dp_test",
          object: "dispute",
          customer: "cus_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
    const w = state.usersConfigUpdates[0];
    assert(typeof w.pro_until === "string");
    assert((w.pro_until as string) < "2099-01-01T00:00:00Z");
    assertEquals(w.stripe_status, undefined);
  } finally {
    restore();
  }
});

t("unresolved userId (no metadata, unknown customer) → 200, no write", async () => {
  __resetStripeForTests();
  const state = freshState();
  // Override users_config GET to return no row for customer lookup.
  const origFetch = globalThis.fetch;
  const restore = installFetchMock(state);
  const wrapped = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === "string"
      ? input
      : (input as Request | URL).toString();
    const req = init as RequestInit | undefined;
    const method = (req?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/users_config") && method === "GET" &&
        url.includes("select=id")) {
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return wrapped(input as Parameters<typeof fetch>[0], init as RequestInit);
  }) as typeof fetch;
  try {
    const evt = {
      id: "evt_unresolved_1",
      object: "event",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          customer: "cus_unknown",
          status: "active",
          current_period_end: 1_800_000_000,
          cancel_at_period_end: false,
          items: {
            object: "list",
            data: [{ id: "si_1", price: { id: "price_test" } }],
          },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 0);
  } finally {
    globalThis.fetch = origFetch;
    restore();
  }
});

t("resolves userId via stripe_customer_id when metadata is absent", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_nometa_1",
      object: "event",
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          customer: "cus_test",
          status: "active",
          current_period_end: 1_800_000_000,
          cancel_at_period_end: false,
          items: {
            object: "list",
            data: [{ id: "si_1", price: { id: "price_test" } }],
          },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
    assertEquals(state.stripeEventsUpdates[0].user_id, USER_ID);
  } finally {
    restore();
  }
});

t("subscription.updated: spoofed metadata.user_id ignored; resolves via customer", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = subUpdatedEvent("evt_spoof_sub", {
      metadata: { user_id: "00000000-dead-beef-cafe-000000000000" },
    });
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    // Must resolve via `customer=cus_test` → mocked USER_ID, NOT the spoof.
    assertEquals(state.stripeEventsUpdates[0].user_id, USER_ID);
  } finally {
    restore();
  }
});

t("invoice.paid: spoofed metadata.user_id ignored; resolves via customer", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_spoof_invoice",
      object: "event",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_spoof",
          object: "invoice",
          customer: "cus_test",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_test" },
          },
          metadata: { user_id: "00000000-dead-beef-cafe-000000000000" },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.stripeEventsUpdates[0].user_id, USER_ID);
  } finally {
    restore();
  }
});

t("subscription.updated: payload ignored; fresh subscription fetched from Stripe", async () => {
  __resetStripeForTests();
  const state = freshState();
  // Simulate Stripe returning CANCELED state for the same sub id, even
  // though the event payload says active — i.e. a stale replayed update
  // arriving after a cancellation. Handler must honor Stripe's truth.
  state.subscriptionResponse = {
    id: "sub_test",
    object: "subscription",
    status: "canceled",
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [{
        id: "si_1",
        price: { id: "price_test", object: "price" },
        current_period_end: 1_800_000_000,
      }],
    },
  };
  const restore = installFetchMock(state);
  try {
    // Existing active Pro until far future — a stale update must not extend.
    state.userPriorProUntil = "2099-01-01T00:00:00Z";
    const evt = subUpdatedEvent("evt_stale_update");
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.subscriptionFetches, 1);
    const patch = state.usersConfigUpdates[0] as Record<string, unknown>;
    assertEquals(patch.stripe_status, "canceled");
    assertEquals(patch.stripe_subscription_id, null);
  } finally {
    restore();
  }
});

t("STRIPE_REQUIRE_LIVEMODE=true + livemode:false payload → 400, no dispatch", async () => {
  __resetStripeForTests();
  Deno.env.set("STRIPE_REQUIRE_LIVEMODE", "true");
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = subUpdatedEvent("evt_testmode_rejected");
    evt.livemode = false;
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 400);
    // Must NOT have inserted or dispatched.
    assertEquals(state.stripeEventIds.has("evt_testmode_rejected"), false);
    assertEquals(state.usersConfigUpdates.length, 0);
  } finally {
    Deno.env.delete("STRIPE_REQUIRE_LIVEMODE");
    restore();
  }
});

t("STRIPE_REQUIRE_LIVEMODE unset + livemode:false → processed normally", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = subUpdatedEvent("evt_testmode_ok");
    evt.livemode = false;
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.usersConfigUpdates.length, 1);
  } finally {
    restore();
  }
});

t("checkout.session.completed: metadata.user_id trusted when present", async () => {
  __resetStripeForTests();
  const state = freshState();
  const restore = installFetchMock(state);
  try {
    const evt = {
      id: "evt_checkout_meta_trusted",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: "cs_test",
          object: "checkout.session",
          customer: "cus_test",
          subscription: "sub_test",
          metadata: { user_id: USER_ID },
        },
      },
    };
    const res = await stripeWebhookHandler(await signedPost(evt));
    assertEquals(res.status, 200);
    assertEquals(state.stripeEventsUpdates[0].user_id, USER_ID);
  } finally {
    restore();
  }
});
