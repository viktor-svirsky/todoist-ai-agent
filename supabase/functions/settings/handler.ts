import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { validateSettings } from "../_shared/validation.ts";
import { encryptIfPresent } from "../_shared/crypto.ts";
import {
  getSettingsRateLimitConfig,
  checkRateLimitByUuid,
  rateLimitResponse,
  accountBlockedResponse,
} from "../_shared/rate-limit.ts";

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
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  corsHeaders?: Record<string, string>,
): Response {
  const headers = corsHeaders ?? getCorsHeaders();
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function settingsHandler(req: Request): Promise<Response> {
  const CORS_HEADERS = getCorsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createUserClient(authHeader);

  // Verify session
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  // Rate limit check — before any route handling
  const serviceClient = createServiceClient();
  const rlConfig = getSettingsRateLimitConfig();
  const rlResult = await checkRateLimitByUuid(serviceClient, user.id, rlConfig);
  if (rlResult.blocked) {
    return accountBlockedResponse(CORS_HEADERS);
  }
  if (!rlResult.allowed) {
    return rateLimitResponse(rlResult.retry_after, CORS_HEADERS);
  }

  // ── GET: Return user settings ──────────────────────────────────────
  if (req.method === "GET") {
    // Fetch non-sensitive fields via user client (respects RLS)
    const { data, error } = await supabase
      .from("users_config")
      .select("trigger_word, custom_ai_base_url, custom_ai_model, max_messages, custom_prompt")
      .eq("id", user.id)
      .single();

    if (error) {
      return jsonResponse({ error: "Config not found" }, 404, CORS_HEADERS);
    }

    // Check key presence via service client (bypasses RLS, can see encrypted cols)
    const { data: fullConfig } = await serviceClient
      .from("users_config")
      .select("custom_ai_api_key, custom_brave_key")
      .eq("id", user.id)
      .single();

    return jsonResponse({
      trigger_word: data.trigger_word,
      custom_ai_base_url: data.custom_ai_base_url,
      custom_ai_model: data.custom_ai_model,
      has_custom_ai_key: !!fullConfig?.custom_ai_api_key,
      has_custom_brave_key: !!fullConfig?.custom_brave_key,
      max_messages: data.max_messages,
      custom_prompt: data.custom_prompt,
    }, 200, CORS_HEADERS);
  }

  // ── PUT: Update user settings ──────────────────────────────────────
  if (req.method === "PUT") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, CORS_HEADERS);
    }

    const allowedFields = [
      "trigger_word",
      "custom_ai_base_url",
      "custom_ai_api_key",
      "custom_ai_model",
      "custom_brave_key",
      "max_messages",
      "custom_prompt",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // Set empty strings to null for optional text fields
        if (field !== "trigger_word" && field !== "max_messages") {
          updates[field] = body[field] || null;
        } else {
          updates[field] = body[field];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "No fields to update" }, 400, CORS_HEADERS);
    }

    // Validate inputs
    const validationErrors = validateSettings(updates);
    if (validationErrors.length > 0) {
      return jsonResponse({ error: "Validation failed", details: validationErrors }, 400, CORS_HEADERS);
    }

    // Encrypt sensitive fields before writing
    if ("custom_ai_api_key" in updates) {
      updates.custom_ai_api_key = await encryptIfPresent(updates.custom_ai_api_key as string | null);
    }
    if ("custom_brave_key" in updates) {
      updates.custom_brave_key = await encryptIfPresent(updates.custom_brave_key as string | null);
    }

    // Use service client to update (handles encrypted fields)
    const { error } = await serviceClient
      .from("users_config")
      .update(updates)
      .eq("id", user.id);

    if (error) {
      console.error("Failed to update settings:", error);
      return jsonResponse({ error: "Failed to update settings" }, 500, CORS_HEADERS);
    }

    return jsonResponse({ ok: true }, 200, CORS_HEADERS);
  }

  // ── DELETE: Delete account ─────────────────────────────────────────
  if (req.method === "DELETE") {
    // Delete the Supabase Auth user (cascades to users_config, conversations, messages)
    const { error } = await serviceClient.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("Failed to delete user:", error);
      return jsonResponse({ error: "Failed to delete account" }, 500, CORS_HEADERS);
    }

    // Sign out the current session
    await supabase.auth.signOut();

    return jsonResponse({ ok: true }, 200, CORS_HEADERS);
  }

  return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
}
