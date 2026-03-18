import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { validateSettings, isPrivateHostname } from "../_shared/validation.ts";
import { encryptIfPresent } from "../_shared/crypto.ts";
import { isAnthropicUrl } from "../_shared/ai.ts";
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
    }, 200, {
      ...CORS_HEADERS,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    });
  }

  // ── POST: Validate API key ────────────────────────────────────────
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, CORS_HEADERS);
    }

    const baseUrl = body.base_url;
    const apiKey = body.api_key;
    const model = body.model;

    if (typeof baseUrl !== "string" || typeof apiKey !== "string" || typeof model !== "string") {
      return jsonResponse({ error: "base_url, api_key, and model are required strings" }, 400, CORS_HEADERS);
    }
    if (!baseUrl || !apiKey || !model) {
      return jsonResponse({ error: "base_url, api_key, and model must not be empty" }, 400, CORS_HEADERS);
    }
    if (apiKey.length > 500) {
      return jsonResponse({ error: "api_key must be at most 500 characters" }, 400, CORS_HEADERS);
    }
    if (model.length > 100) {
      return jsonResponse({ error: "model must be at most 100 characters" }, 400, CORS_HEADERS);
    }
    if (baseUrl.length > 2000) {
      return jsonResponse({ error: "base_url must be at most 2000 characters" }, 400, CORS_HEADERS);
    }

    // Validate URL safety
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "https:") {
        return jsonResponse({ error: "Base URL must use HTTPS" }, 400, CORS_HEADERS);
      }
      if (isPrivateHostname(url.hostname)) {
        return jsonResponse({ error: "Private or internal URLs are not allowed" }, 400, CORS_HEADERS);
      }
    } catch {
      return jsonResponse({ error: "Invalid base URL" }, 400, CORS_HEADERS);
    }

    // Make a lightweight test request to validate the key
    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    const anthropic = isAnthropicUrl(normalizedUrl);
    const endpoint = anthropic
      ? `${normalizedUrl}/messages`
      : `${normalizedUrl}/chat/completions`;

    const headers: Record<string, string> = anthropic
      ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

    const requestBody = { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        redirect: "error",
      });

      if (res.ok) {
        return jsonResponse({ valid: true }, 200, CORS_HEADERS);
      }

      await res.text(); // drain response body
      let detail = `API returned status ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        detail = "Invalid API key";
      } else if (res.status === 404) {
        detail = "Model not found or invalid base URL";
      } else if (res.status === 429) {
        detail = "Rate limited by the AI provider — try again later";
      }
      console.error("API key validation failed:", { status: res.status });
      return jsonResponse({ valid: false, error: detail }, 200, CORS_HEADERS);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return jsonResponse({ valid: false, error: "Request timed out — check base URL and try again" }, 200, CORS_HEADERS);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("API key validation fetch error:", message);
      return jsonResponse({ valid: false, error: "Could not reach the API — check base URL" }, 200, CORS_HEADERS);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── PUT: Update user settings ──────────────────────────────────────
  if (req.method === "PUT") {
    let body: Record<string, unknown>;
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

    // Normalize trailing slashes on base URL to prevent double-slash in API calls
    if (typeof updates.custom_ai_base_url === "string") {
      updates.custom_ai_base_url = updates.custom_ai_base_url.replace(/\/+$/, "");
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
    // Delete the Supabase Auth user (cascades to users_config)
    const { error } = await serviceClient.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("Failed to delete user:", error);
      return jsonResponse({ error: "Failed to delete account" }, 500, CORS_HEADERS);
    }

    return jsonResponse({ ok: true }, 200, CORS_HEADERS);
  }

  return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
}
