import { stripeCheckoutHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv } from "../_shared/env.ts";

validateEnv([
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_PRO_MONTHLY",
  "APP_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

Deno.serve(withSentry(stripeCheckoutHandler));
