import { createServiceClient } from "../_shared/supabase.ts";
import { captureException } from "../_shared/sentry.ts";
import { hmacEqual } from "../_shared/crypto.ts";

const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TODOIST_CLIENT_SECRET",
  "ENCRYPTION_KEY",
];

export async function healthHandler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET" },
    });
  }

  // Authenticate with HEALTH_TOKEN if configured
  const healthToken = Deno.env.get("HEALTH_TOKEN");
  if (healthToken) {
    const provided = new URL(req.url).searchParams.get("token");
    if (!provided || !hmacEqual(provided, healthToken)) {
      return new Response(JSON.stringify({ status: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const checks: Record<string, { ok: boolean }> = {};

  // Check critical env vars (only log details server-side)
  const missingVars: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    const value = Deno.env.get(key);
    if (!value || value.trim() === "") {
      missingVars.push(key);
    }
  }
  checks.env = { ok: missingVars.length === 0 };
  if (missingVars.length > 0) {
    console.error(`Health check: missing env vars: ${missingVars.join(", ")}`);
  }

  // Check database connectivity
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("users_config").select("id").limit(1);
    checks.database = { ok: !error };
    if (error) {
      console.error(`Health check: database error: ${error.message}`);
      await captureException(new Error(`Health check DB: ${error.message}`));
    }
  } catch (err) {
    checks.database = { ok: false };
    console.error(`Health check: database error: ${err instanceof Error ? err.message : "Unknown"}`);
    await captureException(err);
  }

  const healthy = Object.values(checks).every((c) => c.ok);

  return new Response(
    JSON.stringify({ status: healthy ? "healthy" : "unhealthy" }),
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    },
  );
}
