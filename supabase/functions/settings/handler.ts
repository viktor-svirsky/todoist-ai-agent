import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { validateSettings, isPrivateHostname } from "../_shared/validation.ts";
import { encryptIfPresent } from "../_shared/crypto.ts";
import { isAnthropicUrl } from "../_shared/ai.ts";
import { captureException } from "../_shared/sentry.ts";
import { getStripe } from "../_shared/stripe.ts";
import { logFeatureGateEvent } from "../_shared/feature-gates.ts";
import {
  getUsageDaily,
  getUsageSummary,
  hasToolEventsTable,
} from "../_shared/usage.ts";
import { csvLine } from "../_shared/csv.ts";
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

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = raw === null ? NaN : parseInt(raw, 10);
  const v = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(v, min), max);
}

async function maybeAutoCancelForByok(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<void> {
  const { data: row, error } = await admin
    .from("users_config")
    .select("pro_until, stripe_subscription_id, stripe_cancel_at_period_end")
    .eq("id", userId)
    .single();
  if (error || !row) return;

  const proActive =
    typeof row.pro_until === "string" &&
    row.pro_until > new Date().toISOString();
  if (!proActive) return;
  if (!row.stripe_subscription_id) return;
  if (row.stripe_cancel_at_period_end) return;

  try {
    await getStripe().subscriptions.update(
      row.stripe_subscription_id as string,
      { cancel_at_period_end: true },
      { idempotencyKey: `byok-cancel:${userId}` },
    );
    await admin
      .from("users_config")
      .update({ stripe_cancel_at_period_end: true })
      .eq("id", userId);
    console.info("byok_auto_cancel_scheduled", { user_id: userId });
  } catch (err) {
    console.error("byok_auto_cancel_failed", { user_id: userId, err });
    await captureException(err);
  }
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

  // ── GET /tier: Return flat quota status (no event row inserted) ──
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/tier")) {
    const { data, error } = await serviceClient.rpc("get_ai_quota_status", {
      p_user_id: user.id,
    });
    if (error || !data) {
      console.error("get_ai_quota_status failed", { userId: user.id, error });
      await captureException(error ?? new Error("get_ai_quota_status no data"));
      return jsonResponse(
        { tier: null, used: 0, limit: 0, next_slot_at: null, pro_until: null },
        200,
        CORS_HEADERS,
      );
    }
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return jsonResponse(parsed as Record<string, unknown>, 200, CORS_HEADERS);
  }

  // ── GET /usage: Return usage dashboard payload ─────────────────────
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/usage")) {
    const url = new URL(req.url);
    const tzRaw = url.searchParams.get("tz_offset");
    if (tzRaw === null || !/^-?\d+$/.test(tzRaw)) {
      return jsonResponse({ error: "tz_offset_required" }, 400, CORS_HEADERS);
    }
    const tzOffset = parseInt(tzRaw, 10);
    const days7 = clampInt(url.searchParams.get("days_7"), 7, 1, 31);
    const days30 = clampInt(url.searchParams.get("days_30"), 30, 1, 90);

    const [tierResult, daily, summary, hasTools] = await Promise.all([
      serviceClient.rpc("get_ai_quota_status", { p_user_id: user.id }),
      getUsageDaily(supabase, tzOffset, days7),
      getUsageSummary(supabase, days30),
      hasToolEventsTable(supabase),
    ]);

    const tierData = (() => {
      if (tierResult.error || !tierResult.data) return null;
      return typeof tierResult.data === "string"
        ? JSON.parse(tierResult.data)
        : tierResult.data as Record<string, unknown>;
    })();

    let tools: unknown = null;
    if (hasTools) {
      const { data, error } = await supabase.rpc("get_usage_tools", {
        p_days: days30,
      });
      if (error) {
        console.error("get_usage_tools RPC failed", { error });
        await captureException(error);
        tools = [];
      } else {
        tools = data ?? [];
      }
    }

    return jsonResponse({
      live_24h: {
        used: (tierData?.used as number | null) ?? null,
        limit: (tierData?.limit as number | null) ?? 0,
        next_slot_at: (tierData?.next_slot_at as string | null) ?? null,
      },
      daily,
      summary,
      tools,
    }, 200, CORS_HEADERS);
  }

  // ── GET /usage.csv: Stream usage events as CSV ─────────────────────
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/usage.csv")) {
    const url = new URL(req.url);
    const days = clampInt(url.searchParams.get("days"), 30, 1, 90);
    const enc = new TextEncoder();
    const filename = `todoist-ai-usage-${
      new Date().toISOString().slice(0, 10)
    }.csv`;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            enc.encode("event_time,tier,counted,refunded_at,task_id\n"),
          );
          let cursor: string | null = null;
          let cursorId: number | null = null;
          const PAGE = 1000;
          const MAX_ROWS = 50_000;
          let total = 0;
          while (true) {
            const { data, error } = await supabase.rpc("get_usage_csv_page", {
              p_before: cursor,
              p_before_id: cursorId,
              p_limit: PAGE,
              p_days: days,
            });
            if (error) {
              console.error("get_usage_csv_page failed", { error });
              await captureException(error);
              controller.error(error);
              return;
            }
            const rows = (data ?? []) as Array<{
              id: number;
              event_time: string;
              tier: string | null;
              counted: boolean;
              refunded_at: string | null;
              task_id: string | null;
            }>;
            if (rows.length === 0) break;
            for (const r of rows) {
              controller.enqueue(
                enc.encode(csvLine([
                  r.event_time,
                  r.tier,
                  String(r.counted),
                  r.refunded_at ?? "",
                  r.task_id,
                ])),
              );
              total += 1;
              if (total >= MAX_ROWS) break;
            }
            if (total >= MAX_ROWS) {
              controller.enqueue(
                enc.encode(`# truncated at ${MAX_ROWS} rows\n`),
              );
              break;
            }
            const last = rows[rows.length - 1];
            cursor = last.event_time;
            cursorId = last.id;
            if (rows.length < PAGE) break;
          }
          controller.close();
        } catch (err) {
          await captureException(err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
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
      await captureException(err);
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
        // Set empty / whitespace-only strings to null for optional text fields.
        // Whitespace-only custom_ai_api_key would otherwise encrypt to a non-empty
        // ciphertext and wrongly derive the BYOK tier server-side.
        if (field !== "trigger_word" && field !== "max_messages") {
          const raw = body[field];
          if (typeof raw === "string" && raw.trim().length === 0) {
            updates[field] = null;
          } else {
            updates[field] = raw || null;
          }
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

    const byokKeyBeingSet =
      typeof updates.custom_ai_api_key === "string" &&
      (updates.custom_ai_api_key as string).trim().length > 0;

    // G4: custom_ai_model requires BYOK or Pro. Reject Free users whose
    // request doesn't include a BYOK key and who don't already have one.
    const settingCustomModel =
      typeof updates.custom_ai_model === "string" &&
      (updates.custom_ai_model as string).trim().length > 0;

    if (settingCustomModel && !byokKeyBeingSet) {
      const { data: tierData } = await serviceClient.rpc("get_user_tier", {
        p_user_id: user.id,
      });
      const tier = (tierData as string | null) ?? null;
      if (tier === "free" || tier === null) {
        await logFeatureGateEvent(
          serviceClient,
          user.id,
          tier ?? "free",
          "model_override",
          "write_rejected",
        );
        return jsonResponse(
          {
            code: "model_requires_byok",
            message: "Custom model requires a custom AI key or Pro plan.",
          },
          409,
          CORS_HEADERS,
        );
      }
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
      await captureException(error);
      return jsonResponse({ error: "Failed to update settings" }, 500, CORS_HEADERS);
    }

    if (byokKeyBeingSet) {
      await maybeAutoCancelForByok(serviceClient, user.id);
    }

    return jsonResponse({ ok: true }, 200, CORS_HEADERS);
  }

  // ── DELETE: Delete account ─────────────────────────────────────────
  if (req.method === "DELETE") {
    // Delete the Supabase Auth user (cascades to users_config)
    const { error } = await serviceClient.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("Failed to delete user:", error);
      await captureException(error);
      return jsonResponse({ error: "Failed to delete account" }, 500, CORS_HEADERS);
    }

    return jsonResponse({ ok: true }, 200, CORS_HEADERS);
  }

  return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
}
