import { webhookHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv, validateEncryptionKey } from "../_shared/env.ts";

validateEnv(["TODOIST_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
validateEncryptionKey();

Deno.serve(withSentry(webhookHandler));
