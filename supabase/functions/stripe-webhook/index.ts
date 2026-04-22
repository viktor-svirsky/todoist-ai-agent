import { stripeWebhookHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv } from "../_shared/env.ts";

validateEnv([
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

Deno.serve(withSentry(stripeWebhookHandler));
