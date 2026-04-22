import { stripePortalHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv } from "../_shared/env.ts";

validateEnv([
  "STRIPE_SECRET_KEY",
  "APP_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

Deno.serve(withSentry(stripePortalHandler));
