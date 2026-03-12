import { authCallbackHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv, validateEncryptionKey } from "../_shared/env.ts";

validateEnv([
  "TODOIST_CLIENT_ID",
  "TODOIST_CLIENT_SECRET",
  "FRONTEND_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);
validateEncryptionKey();

Deno.serve(withSentry(authCallbackHandler));
