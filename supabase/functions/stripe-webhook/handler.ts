import type Stripe from "stripe";
import { createServiceClient } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import {
  type ProUntilWrite,
  writeFromRefund,
  writeFromSubscription,
} from "../_shared/billing.ts";
import { STRIPE_WEBHOOK_SECRET } from "../_shared/env.ts";
import { captureException } from "../_shared/sentry.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;

export async function stripeWebhookHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  if (!sig) return new Response("Missing signature", { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      sig,
      STRIPE_WEBHOOK_SECRET(),
    );
  } catch (err) {
    console.warn("stripe_webhook_signature_failure", {
      sig_prefix: sig.slice(0, 16),
      err: (err as Error).message,
    });
    // Surface signature failures to Sentry — a burst may indicate a
    // rotated secret outage or a probing attacker.
    await captureException(err);
    return new Response("Invalid signature", { status: 400 });
  }

  // Defense in depth: reject test-mode events in production. Prevents a
  // leaked dev webhook secret (e.g. via Stripe CLI forwarding) from
  // mutating live billing state.
  if (Deno.env.get("STRIPE_REQUIRE_LIVEMODE") === "true" && !event.livemode) {
    console.warn("stripe_webhook_testmode_rejected", {
      id: event.id,
      type: event.type,
    });
    await captureException(
      new Error(`stripe_webhook_testmode_rejected: ${event.type}`),
    );
    return new Response("Test-mode event rejected", { status: 400 });
  }

  const sb = createServiceClient();
  const digest = await sha256Hex(raw);

  const { data: inserted, error: insertError } = await sb
    .from("stripe_events")
    .insert({
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      payload_digest: digest,
    })
    .select("id")
    .maybeSingle();

  if (insertError && !isUniqueViolation(insertError)) {
    console.error("stripe_event_insert_failed", {
      id: event.id,
      err: insertError.message,
    });
    return new Response("error", { status: 500 });
  }

  if (!inserted) {
    // Unique-violation: a prior delivery already inserted this row.
    // Only skip if it was fully processed; otherwise retry dispatch so a
    // transient failure on the first delivery does not permanently drop
    // the event (Stripe keeps retrying for ~3 days).
    //
    // Concurrent-delivery note: two in-flight attempts can both see
    // `processed_at IS NULL` and re-dispatch. This is safe because every
    // `users_config` write the dispatcher produces is a pure function of
    // the Stripe event (`writeFromSubscription` / `writeFromRefund`) — the
    // second update sets identical columns to the first. Stripe guarantees
    // event immutability for a given event id, and its retry scheduler is
    // serialized, so the only path that produces true concurrency is an
    // operator replay via the Stripe CLI — accepted and idempotent.
    const { data: existing } = await sb
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    if (existing?.processed_at) {
      console.info("stripe_event_replay_ignored", {
        id: event.id,
        type: event.type,
      });
      return new Response("ok", { status: 200 });
    }
    console.info("stripe_event_reprocessing", {
      id: event.id,
      type: event.type,
    });
  }

  try {
    const { userId, write } = await dispatch(event, sb, stripe);
    if (userId && write && Object.keys(write).length > 0) {
      const { error } = await sb
        .from("users_config")
        .update(write)
        .eq("id", userId);
      if (error) throw error;
    }
    await sb
      .from("stripe_events")
      .update({
        processed_at: new Date().toISOString(),
        user_id: userId ?? null,
      })
      .eq("id", event.id);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("stripe_webhook_dispatch_failed", {
      id: event.id,
      type: event.type,
      err: err instanceof Error ? err.message : String(err),
    });
    await captureException(err);
    return new Response("error", { status: 500 });
  }
}

async function dispatch(
  event: Stripe.Event,
  sb: ServiceClient,
  stripe: Stripe,
): Promise<{ userId: string | null; write: ProUntilWrite | null }> {
  const obj = event.data.object as Record<string, unknown>;
  const userId = await resolveUserId(event, sb);
  if (!userId) return { userId: null, write: null };

  const { data: row, error: rowErr } = await sb
    .from("users_config")
    .select("pro_until")
    .eq("id", userId)
    .single();
  if (rowErr) {
    // Billing write is next — never fall back to "no prior Pro" silently or
    // a refund after this point would miscalculate clamping. Let the outer
    // dispatch catch turn this into a 500 so Stripe retries.
    throw rowErr;
  }
  const existingProUntil = (row?.pro_until as string | null) ?? null;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = obj as unknown as Stripe.Checkout.Session;
      if (!session.subscription) return { userId, write: {} };
      const sub = await stripe.subscriptions.retrieve(
        session.subscription as string,
      );
      const write = writeFromSubscription(sub, existingProUntil);
      if (session.customer) {
        write.stripe_customer_id = session.customer as string;
      }
      return { userId, write };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Stripe does NOT guarantee ordering across event ids — a stale
      // `subscription.updated` with `status=active` can arrive after a
      // later `subscription.deleted`. Trusting the event payload would
      // re-extend `pro_until` and wrongly re-enable paid access. Always
      // fetch the current subscription from Stripe so the write reflects
      // authoritative state at dispatch time.
      const payloadSub = obj as unknown as Stripe.Subscription;
      let freshSub: Stripe.Subscription;
      try {
        freshSub = await stripe.subscriptions.retrieve(payloadSub.id);
      } catch (err) {
        // Stripe returns 404 once the subscription object is fully purged
        // (rare, after `customer.subscription.deleted`). Treat as canceled.
        const code = (err as { code?: string; statusCode?: number })?.statusCode;
        if (code === 404) {
          freshSub = { ...payloadSub, status: "canceled" as const };
        } else {
          throw err;
        }
      }
      const forced = event.type === "customer.subscription.deleted"
        ? { ...freshSub, status: "canceled" as const }
        : freshSub;
      return { userId, write: writeFromSubscription(forced, existingProUntil) };
    }
    case "invoice.paid": {
      const invoice = obj as unknown as Stripe.Invoice;
      // Basil (2025-03-31) moved invoice.subscription to
      // invoice.parent.subscription_details.subscription. Accept either.
      const parentSub = (invoice.parent as {
        subscription_details?: { subscription?: string | Stripe.Subscription };
      } | null | undefined)?.subscription_details?.subscription;
      const legacySub = (invoice as unknown as {
        subscription?: string | Stripe.Subscription;
      }).subscription;
      const raw = parentSub ?? legacySub;
      const subId = typeof raw === "string" ? raw : raw?.id;
      if (!subId) return { userId, write: {} };
      const sub = await stripe.subscriptions.retrieve(subId);
      return { userId, write: writeFromSubscription(sub, existingProUntil) };
    }
    case "charge.refunded":
    case "charge.dispute.created":
      return { userId, write: writeFromRefund(existingProUntil) };
    case "invoice.payment_failed":
    default:
      return { userId, write: {} };
  }
}

async function resolveUserId(
  event: Stripe.Event,
  sb: ServiceClient,
): Promise<string | null> {
  const obj = event.data.object as Record<string, unknown>;

  // Only trust `metadata.user_id` + `client_reference_id` on checkout
  // sessions — those are set server-side during stripe-checkout and are
  // not reachable by end users. For every other event type (customer/
  // subscription/invoice/charge), resolve authoritatively via our owned
  // `stripe_customer_id` column. This blocks a Pro user from flipping
  // another user's `pro_until` by writing to customer/subscription
  // metadata through the Stripe API.
  if (event.type === "checkout.session.completed") {
    const metaUser = (obj.metadata as Record<string, string> | undefined)
      ?.user_id;
    if (metaUser) return metaUser;
    const clientRef = (obj as { client_reference_id?: string })
      .client_reference_id;
    if (clientRef) return clientRef;
  }

  const customer = obj.customer as string | undefined;
  if (!customer) return null;
  const { data } = await sb
    .from("users_config")
    .select("id")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  if (err?.code === "23505") return true;
  const msg = err?.message ?? "";
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
