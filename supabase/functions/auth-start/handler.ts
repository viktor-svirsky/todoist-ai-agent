import { signOAuthState } from "../_shared/crypto.ts";
import { TODOIST_OAUTH_URL } from "../_shared/constants.ts";

function getFrontendUrl(): string {
  const url = Deno.env.get("FRONTEND_URL");
  if (!url) {
    throw new Error("Missing required environment variable: FRONTEND_URL");
  }
  return url;
}

export async function authStartHandler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": getFrontendUrl(),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const clientId = Deno.env.get("TODOIST_CLIENT_ID");
  const clientSecret = Deno.env.get("TODOIST_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return new Response("Server misconfiguration", { status: 500 });
  }

  const state = await signOAuthState(clientSecret);

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "data:read_write",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${TODOIST_OAUTH_URL}?${params}` },
  });
}
