import { createServiceClient } from "../_shared/supabase.ts";
import { TODOIST_TOKEN_URL, TODOIST_SYNC_URL, TODOIST_USER_URL } from "../_shared/constants.ts";

const FRONTEND_URL = Deno.env.get("FRONTEND_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": FRONTEND_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function errorRedirect(message = "auth_failed"): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: `${FRONTEND_URL}/?error=${encodeURIComponent(message)}`,
    },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return errorRedirect("missing_code");
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

    if (existingUser) {
      // 4. Existing user — update their token
      userId = existingUser.id;

      const { error: updateError } = await supabase
        .from("users_config")
        .update({ todoist_token: access_token })
        .eq("id", userId);

      if (updateError) {
        console.error("Failed to update token:", updateError);
        return errorRedirect("update_failed");
      }
    } else {
      // 5. New user — create Supabase Auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { todoist_user_id: todoistUserId },
      });

      if (authError || !authData.user) {
        console.error("Failed to create auth user:", authError);
        return errorRedirect("user_creation_failed");
      }

      userId = authData.user.id;

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

      // 7. Generate webhook secret and insert users_config row
      const webhookSecret = crypto.randomUUID();

      const { error: insertError } = await supabase.from("users_config").insert({
        id: userId,
        todoist_token: access_token,
        todoist_user_id: todoistUserId,
        webhook_secret: webhookSecret,
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
        Location: `${FRONTEND_URL}/auth/callback#${params.toString()}`,
      },
    });
  } catch (error) {
    console.error("Auth callback error:", error);
    return errorRedirect("auth_failed");
  }
});
