import { authCallbackHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";

Deno.serve(withSentry(authCallbackHandler));
