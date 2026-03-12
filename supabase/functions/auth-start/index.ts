import { authStartHandler } from "./handler.ts";
import { withSentry } from "../_shared/sentry.ts";
import { validateEnv } from "../_shared/env.ts";

validateEnv(["TODOIST_CLIENT_ID", "TODOIST_CLIENT_SECRET", "FRONTEND_URL"]);

Deno.serve(withSentry(authStartHandler));
