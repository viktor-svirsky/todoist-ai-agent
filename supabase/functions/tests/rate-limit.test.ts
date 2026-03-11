import { assertEquals } from "@std/assert";
import {
  getRateLimitConfig,
  getSettingsRateLimitConfig,
  rateLimitResponse,
  accountBlockedResponse,
  checkRateLimitByTodoistId,
  checkRateLimitByUuid,
} from "../_shared/rate-limit.ts";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  envBackup[key] = Deno.env.get(key);
  Deno.env.set(key, value);
}

function clearEnv(key: string) {
  envBackup[key] = Deno.env.get(key);
  Deno.env.delete(key);
}

function restoreEnv() {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  for (const key of Object.keys(envBackup)) {
    delete envBackup[key];
  }
}

// ============================================================================
// getRateLimitConfig
// ============================================================================

Deno.test("getRateLimitConfig: returns defaults when no env vars set", () => {
  clearEnv("RATE_LIMIT_MAX_REQUESTS");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: reads env var overrides", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "20");
  setEnv("RATE_LIMIT_WINDOW_SECONDS", "120");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 20);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on non-numeric env var", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "abc");
  setEnv("RATE_LIMIT_WINDOW_SECONDS", "xyz");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on zero", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "0");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on negative", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "-5");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: partial override (only max_requests)", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "10");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on float", () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "5.5");
  try {
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// getSettingsRateLimitConfig
// ============================================================================

Deno.test("getSettingsRateLimitConfig: returns defaults", () => {
  clearEnv("SETTINGS_RATE_LIMIT_MAX_REQUESTS");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const config = getSettingsRateLimitConfig();
    assertEquals(config.maxRequests, 30);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getSettingsRateLimitConfig: reads env var override", () => {
  setEnv("SETTINGS_RATE_LIMIT_MAX_REQUESTS", "50");
  try {
    const config = getSettingsRateLimitConfig();
    assertEquals(config.maxRequests, 50);
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// rateLimitResponse
// ============================================================================

Deno.test("rateLimitResponse: returns 429 with Retry-After header", async () => {
  const resp = rateLimitResponse(30);
  assertEquals(resp.status, 429);
  assertEquals(resp.headers.get("Retry-After"), "30");
  assertEquals(resp.headers.get("Content-Type"), "application/json");
  const body = await resp.json();
  assertEquals(body.error, "Rate limit exceeded");
});

Deno.test("rateLimitResponse: clamps Retry-After to minimum 1", () => {
  const resp = rateLimitResponse(0);
  assertEquals(resp.headers.get("Retry-After"), "1");
});

Deno.test("rateLimitResponse: clamps negative to 1", () => {
  const resp = rateLimitResponse(-10);
  assertEquals(resp.headers.get("Retry-After"), "1");
});

Deno.test("rateLimitResponse: ceils fractional Retry-After", () => {
  const resp = rateLimitResponse(2.3);
  assertEquals(resp.headers.get("Retry-After"), "3");
});

Deno.test("rateLimitResponse: merges extra headers", () => {
  const resp = rateLimitResponse(10, {
    "Access-Control-Allow-Origin": "https://example.com",
  });
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://example.com");
  assertEquals(resp.headers.get("Retry-After"), "10");
});

// ============================================================================
// accountBlockedResponse
// ============================================================================

Deno.test("accountBlockedResponse: returns 403 with generic message", async () => {
  const resp = accountBlockedResponse();
  assertEquals(resp.status, 403);
  assertEquals(resp.headers.get("Content-Type"), "application/json");
  const body = await resp.json();
  assertEquals(body.error, "Account disabled");
  assertEquals(body.reason, undefined);
});

Deno.test("accountBlockedResponse: merges extra headers", () => {
  const resp = accountBlockedResponse({
    "Access-Control-Allow-Origin": "https://example.com",
  });
  assertEquals(resp.status, 403);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://example.com");
});

// ============================================================================
// checkRateLimitByTodoistId
// ============================================================================

Deno.test("checkRateLimitByTodoistId: allowed when RPC returns allowed=true", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, blocked: false, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, true);
  assertEquals(result.blocked, false);
  assertEquals(result.retry_after, 0);
});

Deno.test("checkRateLimitByTodoistId: rate limited with retry_after", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: false, blocked: false, retry_after: 45 }, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, false);
  assertEquals(result.retry_after, 45);
});

Deno.test("checkRateLimitByTodoistId: RPC error returns not allowed", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: null, error: { message: "db down" } }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByTodoistId: null data returns not allowed", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: null, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByTodoistId: parses string JSON data", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: JSON.stringify({ allowed: true, retry_after: 0 }), error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, true);
});

Deno.test("checkRateLimitByTodoistId: passes correct params to RPC", async () => {
  let capturedParams: Record<string, unknown> = {};
  const mockSupabase = {
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      capturedParams = params;
      return { data: { allowed: true, retry_after: 0 }, error: null };
    },
  };
  await checkRateLimitByTodoistId(
    mockSupabase,
    "user-42",
    { maxRequests: 10, windowSeconds: 120 },
  );
  assertEquals(capturedParams.p_user_todoist_id, "user-42");
  assertEquals(capturedParams.p_max_requests, 10);
  assertEquals(capturedParams.p_window_seconds, 120);
});

Deno.test("checkRateLimitByTodoistId: blocked account returns blocked=true", async () => {
  const mockSupabase = {
    rpc: async () => ({
      data: { allowed: false, blocked: true, retry_after: 0 },
      error: null,
    }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, true);
  assertEquals(result.retry_after, 0);
});

Deno.test("checkRateLimitByTodoistId: defaults blocked to false when field missing", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.blocked, false);
});

// ============================================================================
// checkRateLimitByUuid
// ============================================================================

Deno.test("checkRateLimitByUuid: allowed when RPC returns allowed=true", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, blocked: false, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.allowed, true);
  assertEquals(result.blocked, false);
});

Deno.test("checkRateLimitByUuid: RPC error returns not allowed", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: null, error: { message: "fail" } }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByUuid: passes correct params to RPC", async () => {
  let capturedFn = "";
  let capturedParams: Record<string, unknown> = {};
  const mockSupabase = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      capturedFn = fn;
      capturedParams = params;
      return { data: { allowed: true, retry_after: 0 }, error: null };
    },
  };
  await checkRateLimitByUuid(
    mockSupabase,
    "uuid-123",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(capturedFn, "check_rate_limit_by_uuid");
  assertEquals(capturedParams.p_user_id, "uuid-123");
  assertEquals(capturedParams.p_max_requests, 30);
  assertEquals(capturedParams.p_window_seconds, 60);
});

Deno.test("checkRateLimitByUuid: blocked account returns blocked=true", async () => {
  const mockSupabase = {
    rpc: async () => ({
      data: { allowed: false, blocked: true, retry_after: 0 },
      error: null,
    }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.blocked, true);
  assertEquals(result.retry_after, 0);
});

Deno.test("checkRateLimitByUuid: defaults blocked to false when field missing", async () => {
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.blocked, false);
});
