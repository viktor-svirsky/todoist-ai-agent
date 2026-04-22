import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import { APP_URL } from "../_shared/env.ts";
import { captureException } from "../_shared/sentry.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function stripePortalHandler(req: Request): Promise<Response> {
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

  const admin = createServiceClient();
  const { data: row, error } = await admin
    .from("users_config")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();
  if (error || !row) {
    return new Response("No user config", { status: 404 });
  }

  const customer = (row.stripe_customer_id as string | null) ?? null;
  if (!customer) {
    return new Response("No Stripe customer", { status: 409 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${APP_URL()}/settings`,
    });
    return json({ url: session.url });
  } catch (err) {
    await captureException(err);
    return json({ error: "Failed to create portal session" }, 500);
  }
}
