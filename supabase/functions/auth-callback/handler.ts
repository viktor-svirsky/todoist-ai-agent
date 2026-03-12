import { createServiceClient } from "../_shared/supabase.ts";
import { TODOIST_TOKEN_URL, TODOIST_SYNC_URL, TODOIST_USER_URL } from "../_shared/constants.ts";
import { captureException } from "../_shared/sentry.ts";
import { encrypt, verifyOAuthState } from "../_shared/crypto.ts";

function getFrontendUrl(): string {
  const url = Deno.env.get("FRONTEND_URL");
  if (!url) {
    throw new Error("Missing required environment variable: FRONTEND_URL");
  }
  return url;
}

function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getFrontendUrl(),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function errorRedirect(message = "auth_failed"): Response {
  const FRONTEND_URL = getFrontendUrl();
  return new Response(null, {
    status: 302,
    headers: {
      ...getCorsHeaders(),
      Location: `${FRONTEND_URL}/?error=${encodeURIComponent(message)}`,
    },
  });
}

export async function authCallbackHandler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      return errorRedirect("missing_code");
    }

    if (!state) {
      return errorRedirect("missing_state");
    }

    // Verify HMAC-signed state to prevent CSRF
    const clientSecret = Deno.env.get("TODOIST_CLIENT_SECRET");
    if (!clientSecret || !(await verifyOAuthState(clientSecret, state))) {
      return errorRedirect("invalid_state");
    }

    // 1. Exchange code for access token
    const tokenRes = await fetch(TODOIST_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: Deno.env.get("TODOIST_CLIENT_ID"),
        client_secret: Deno.env.get("TODOIST_CLIENT_SECRET"),
        code,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenRes.status, await tokenRes.text());
      return errorRedirect("token_exchange_failed");
    }

    const { access_token } = await tokenRes.json();

    // 2. Fetch Todoist user profile via REST API
    const userRes = await fetch(TODOIST_USER_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) {
      console.error("User API failed:", userRes.status, await userRes.text());
      return errorRedirect("profile_fetch_failed");
    }

    const userData = await userRes.json();
    const todoistUserId = String(userData.id);
    const email = userData.email;

    // 3. Check if user already exists
    const supabase = createServiceClient();

    const { data: existingUser } = await supabase
      .from("users_config")
      .select("id")
      .eq("todoist_user_id", todoistUserId)
      .maybeSingle();

    let userId: string;
    const FRONTEND_URL = getFrontendUrl();

    if (existingUser) {
      // 4. Existing user — update their token
      userId = existingUser.id;

      const { error: updateError } = await supabase
        .from("users_config")
        .update({ todoist_token: await encrypt(access_token) })
        .eq("id", userId);

      if (updateError) {
        console.error("Failed to update token:", updateError);
        return errorRedirect("update_failed");
      }
    } else {
      // 5. New user — find or create Supabase Auth user
      let authUserId: string;

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { todoist_user_id: todoistUserId },
      });

      if (authError) {
        // Race condition: another OAuth flow already created this user
        const isEmailExists =
          authError.message?.includes("already been registered") ||
          (authError as unknown as { status?: number }).status === 422;

        if (!isEmailExists) {
          console.error("Failed to create auth user:", authError);
          return errorRedirect("user_creation_failed");
        }

        // Re-check users_config — the concurrent request may have already inserted it
        const { data: racedUser } = await supabase
          .from("users_config")
          .select("id")
          .eq("todoist_user_id", todoistUserId)
          .maybeSingle();

        if (racedUser) {
          userId = racedUser.id;
          const { error: raceUpdateError } = await supabase
            .from("users_config")
            .update({ todoist_token: await encrypt(access_token) })
            .eq("id", userId);
          if (raceUpdateError) {
            console.error("Failed to update token (race path):", raceUpdateError);
            return errorRedirect("update_failed");
          }
          // Skip webhook + insert — jump straight to magic link
          const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: "magiclink",
            email,
          });
          if (linkError || !linkData) {
            console.error("Failed to generate magic link (race path):", linkError);
            return errorRedirect("session_failed");
          }
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
          const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: anonKey },
            body: JSON.stringify({ token_hash: linkData.properties.hashed_token, type: "magiclink" }),
          });
          if (!verifyRes.ok) {
            return errorRedirect("session_failed");
          }
          const session = await verifyRes.json();
          const params = new URLSearchParams({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: String(session.expires_in),
            token_type: session.token_type || "bearer",
            type: "magiclink",
          });
          return new Response(null, {
            status: 302,
            headers: { ...corsHeaders, Location: `${FRONTEND_URL}/auth/callback?state=${encodeURIComponent(state)}#${params.toString()}` },
          });
        }

        // Auth user exists but users_config doesn't — find auth user by email
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({
          filter: email,
        });
        if (listError || !users?.length) {
          console.error("Could not find existing auth user after email_exists error");
          return errorRedirect("user_creation_failed");
        }
        const found = users.find((u) => u.email === email);
        if (!found) {
          return errorRedirect("user_creation_failed");
        }
        authUserId = found.id;
      } else {
        if (!authData.user) {
          return errorRedirect("user_creation_failed");
        }
        authUserId = authData.user.id;
      }

      userId = authUserId;

      // 6. Register Todoist webhook
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookUrl = `${supabaseUrl}/functions/v1/webhook/${todoistUserId}`;

      const webhookRes = await fetch(TODOIST_SYNC_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          commands: JSON.stringify([
            {
              type: "live_notifications_set_service",
              uuid: crypto.randomUUID(),
              args: {
                service_url: webhookUrl,
              },
            },
          ]),
        }),
      });

      if (!webhookRes.ok) {
        console.error("Webhook registration failed:", webhookRes.status, await webhookRes.text());
        // Continue anyway — webhook can be re-registered later
      }

      // 7. Insert users_config row
      const { error: insertError } = await supabase.from("users_config").insert({
        id: userId,
        todoist_token: await encrypt(access_token),
        todoist_user_id: todoistUserId,
      });

      if (insertError) {
        console.error("Failed to insert user config:", insertError);
        return errorRedirect("config_creation_failed");
      }
    }

    // 8. Generate a magic link and verify it server-side to get real session tokens
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkError || !linkData) {
      console.error("Failed to generate magic link:", linkError);
      return errorRedirect("session_failed");
    }

    const tokenHash = linkData.properties.hashed_token;

    // 9. Verify the OTP server-side to get real session tokens
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({ token_hash: tokenHash, type: "magiclink" }),
    });

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      console.error("OTP verification failed:", verifyRes.status, errText);
      return errorRedirect("session_failed");
    }

    const session = await verifyRes.json();

    // 10. Redirect to frontend with real session tokens in URL fragment
    const params = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in),
      token_type: session.token_type || "bearer",
      type: "magiclink",
    });

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: `${FRONTEND_URL}/auth/callback?state=${encodeURIComponent(state)}#${params.toString()}`,
      },
    });
  } catch (error) {
    console.error("Auth callback error:", error);
    await captureException(error);
    return errorRedirect("auth_failed");
  }
}
