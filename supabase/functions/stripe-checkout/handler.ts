import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import { APP_URL, STRIPE_PRICE_ID_PRO_MONTHLY } from "../_shared/env.ts";
import { captureException } from "../_shared/sentry.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stripeCheckoutHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userClient = createUserClient(auth);
  const { data: authed, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authed?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = authed.user.id;
  const email = authed.user.email ?? undefined;

  const admin = createServiceClient();
  const { data: row, error } = await admin
    .from("users_config")
    .select("id, stripe_customer_id, stripe_subscription_id, stripe_status")
    .eq("id", userId)
    .single();
  if (error || !row) {
    return new Response("No user config", { status: 404 });
  }

  // The DB models only one active Stripe subscription per user. Starting
  // a second checkout would create a second subscription that later
  // webhook events would clobber, and double-bill the customer.
  const existingSubId = (row.stripe_subscription_id as string | null) ?? null;
  const existingStatus = (row.stripe_status as string | null) ?? null;
  if (existingSubId && (existingStatus === "active" || existingStatus === "trialing")) {
    return json(
      {
        code: "already_subscribed",
        message: "An active subscription already exists. Manage it via the Billing Portal.",
      },
      409,
    );
  }

  const stripe = getStripe();
  let customerId = (row.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    });
    customerId = customer.id;
    const { error: updateErr } = await admin
      .from("users_config")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);
    if (updateErr) {
      // Orphaned Stripe customer if we proceed — the next call would
      // create another one, violating the one-user-one-customer invariant
      // the webhook relies on. Fail hard so retry picks up the saved id.
      await captureException(updateErr);
      return json({ error: "Failed to persist Stripe customer" }, 500);
    }
  }

  const minuteBucket = Math.floor(Date.now() / 60_000);
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: STRIPE_PRICE_ID_PRO_MONTHLY(), quantity: 1 }],
        success_url: `${APP_URL()}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL()}/settings?billing=cancelled`,
        client_reference_id: userId,
        metadata: { user_id: userId },
        subscription_data: { metadata: { user_id: userId } },
        allow_promotion_codes: false,
        automatic_tax: { enabled: true },
      },
      { idempotencyKey: `checkout:${userId}:${minuteBucket}` },
    );
    return json({ url: session.url });
  } catch (err) {
    await captureException(err);
    return json({ error: "Failed to create checkout session" }, 500);
  }
}
