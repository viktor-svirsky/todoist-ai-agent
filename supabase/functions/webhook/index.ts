import { webhookHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry(webhookHandler));
