import { settingsHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv, validateEncryptionKey } from "../_shared/env.ts";

validateEnv(["FRONTEND_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
validateEncryptionKey();

Deno.serve(withSentry(settingsHandler));
