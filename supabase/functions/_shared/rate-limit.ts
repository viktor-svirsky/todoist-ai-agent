import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
} from "./constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  blocked: boolean;
  reason?: string;
  retry_after: number;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function getRateLimitConfig(): RateLimitConfig {
  return {
    maxRequests: parsePositiveInt(
      Deno.env.get("RATE_LIMIT_MAX_REQUESTS"),
      RATE_LIMIT_MAX_REQUESTS,
    ),
    windowSeconds: parsePositiveInt(
      Deno.env.get("RATE_LIMIT_WINDOW_SECONDS"),
      RATE_LIMIT_WINDOW_SECONDS,
    ),
  };
}

const SETTINGS_DEFAULT_MAX_REQUESTS = 30;

export function getSettingsRateLimitConfig(): RateLimitConfig {
  return {
    maxRequests: parsePositiveInt(
      Deno.env.get("SETTINGS_RATE_LIMIT_MAX_REQUESTS"),
      SETTINGS_DEFAULT_MAX_REQUESTS,
    ),
    windowSeconds: parsePositiveInt(
      Deno.env.get("RATE_LIMIT_WINDOW_SECONDS"),
      RATE_LIMIT_WINDOW_SECONDS,
    ),
  };
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

export function rateLimitResponse(
  retryAfter: number,
  extraHeaders?: Record<string, string>,
): Response {
  const clampedRetry = Math.max(1, Math.ceil(retryAfter));
  return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(clampedRetry),
      ...extraHeaders,
    },
  });
}

export function accountBlockedResponse(
  reason?: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: "Account disabled", reason: reason ?? "Account disabled" }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

export async function checkRateLimitByTodoistId(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  userId: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_user_todoist_id: userId,
    p_max_requests: config.maxRequests,
    p_window_seconds: config.windowSeconds,
  });

  if (error || !data) {
    return { allowed: false, blocked: false, retry_after: config.windowSeconds };
  }

  const result = typeof data === "string" ? JSON.parse(data) : data;
  return {
    allowed: result.allowed,
    blocked: result.blocked ?? false,
    reason: result.reason,
    retry_after: result.retry_after ?? config.windowSeconds,
  };
}

export async function checkRateLimitByUuid(
  supabase: { rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  userId: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("check_rate_limit_by_uuid", {
    p_user_id: userId,
    p_max_requests: config.maxRequests,
    p_window_seconds: config.windowSeconds,
  });

  if (error || !data) {
    return { allowed: false, blocked: false, retry_after: config.windowSeconds };
  }

  const result = typeof data === "string" ? JSON.parse(data) : data;
  return {
    allowed: result.allowed,
    blocked: result.blocked ?? false,
    reason: result.reason,
    retry_after: result.retry_after ?? config.windowSeconds,
  };
}
