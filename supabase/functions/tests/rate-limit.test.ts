import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

// Env vars must be set before importing the module
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

// Dynamic import helper so env vars are read fresh
async function importModule() {
  const timestamp = Date.now() + Math.random();
  return await import(`../_shared/rate-limit.ts?t=${timestamp}`);
}

// ============================================================================
// getRateLimitConfig
// ============================================================================

Deno.test("getRateLimitConfig: returns defaults when no env vars set", async () => {
  clearEnv("RATE_LIMIT_MAX_REQUESTS");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 5);
    assertEquals(config.windowSeconds, 60);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: reads env var overrides", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "20");
  setEnv("RATE_LIMIT_WINDOW_SECONDS", "120");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 20);
    assertEquals(config.windowSeconds, 120);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on non-numeric env var", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "abc");
  setEnv("RATE_LIMIT_WINDOW_SECONDS", "xyz");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 5);
    assertEquals(config.windowSeconds, 60);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on zero", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "0");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 5);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on negative", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "-5");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 5);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: partial override (only max_requests)", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "10");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 10);
    assertEquals(config.windowSeconds, 60);
  } finally {
    restoreEnv();
  }
});

Deno.test("getRateLimitConfig: falls back on float", async () => {
  setEnv("RATE_LIMIT_MAX_REQUESTS", "5.5");
  try {
    const { getRateLimitConfig } = await importModule();
    const config = getRateLimitConfig();
    assertEquals(config.maxRequests, 5);
  } finally {
    restoreEnv();
  }
});

// ============================================================================
// getSettingsRateLimitConfig
// ============================================================================

Deno.test("getSettingsRateLimitConfig: returns defaults", async () => {
  clearEnv("SETTINGS_RATE_LIMIT_MAX_REQUESTS");
  clearEnv("RATE_LIMIT_WINDOW_SECONDS");
  try {
    const { getSettingsRateLimitConfig } = await importModule();
    const config = getSettingsRateLimitConfig();
    assertEquals(config.maxRequests, 30);
    assertEquals(config.windowSeconds, 60);
  } finally {
    restoreEnv();
  }
});

Deno.test("getSettingsRateLimitConfig: reads env var override", async () => {
  setEnv("SETTINGS_RATE_LIMIT_MAX_REQUESTS", "50");
  try {
    const { getSettingsRateLimitConfig } = await importModule();
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
  const { rateLimitResponse } = await importModule();
  const resp = rateLimitResponse(30);
  assertEquals(resp.status, 429);
  assertEquals(resp.headers.get("Retry-After"), "30");
  assertEquals(resp.headers.get("Content-Type"), "application/json");
  const body = await resp.json();
  assertEquals(body.error, "Rate limit exceeded");
});

Deno.test("rateLimitResponse: clamps Retry-After to minimum 1", async () => {
  const { rateLimitResponse } = await importModule();
  const resp = rateLimitResponse(0);
  assertEquals(resp.headers.get("Retry-After"), "1");
});

Deno.test("rateLimitResponse: clamps negative to 1", async () => {
  const { rateLimitResponse } = await importModule();
  const resp = rateLimitResponse(-10);
  assertEquals(resp.headers.get("Retry-After"), "1");
});

Deno.test("rateLimitResponse: ceils fractional Retry-After", async () => {
  const { rateLimitResponse } = await importModule();
  const resp = rateLimitResponse(2.3);
  assertEquals(resp.headers.get("Retry-After"), "3");
});

Deno.test("rateLimitResponse: merges extra headers", async () => {
  const { rateLimitResponse } = await importModule();
  const resp = rateLimitResponse(10, {
    "Access-Control-Allow-Origin": "https://example.com",
  });
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://example.com");
  assertEquals(resp.headers.get("Retry-After"), "10");
});

// ============================================================================
// checkRateLimitByTodoistId
// ============================================================================

Deno.test("checkRateLimitByTodoistId: allowed when RPC returns allowed=true", async () => {
  const { checkRateLimitByTodoistId } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, true);
  assertEquals(result.retry_after, 0);
});

Deno.test("checkRateLimitByTodoistId: blocked with retry_after", async () => {
  const { checkRateLimitByTodoistId } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: false, retry_after: 45 }, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.retry_after, 45);
});

Deno.test("checkRateLimitByTodoistId: RPC error returns blocked", async () => {
  const { checkRateLimitByTodoistId } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: null, error: { message: "db down" } }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByTodoistId: null data returns blocked", async () => {
  const { checkRateLimitByTodoistId } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: null, error: null }),
  };
  const result = await checkRateLimitByTodoistId(
    mockSupabase,
    "123",
    { maxRequests: 5, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByTodoistId: parses string JSON data", async () => {
  const { checkRateLimitByTodoistId } = await importModule();
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
  const { checkRateLimitByTodoistId } = await importModule();
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

// ============================================================================
// checkRateLimitByUuid
// ============================================================================

Deno.test("checkRateLimitByUuid: allowed when RPC returns allowed=true", async () => {
  const { checkRateLimitByUuid } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.allowed, true);
});

Deno.test("checkRateLimitByUuid: RPC error returns blocked", async () => {
  const { checkRateLimitByUuid } = await importModule();
  const mockSupabase = {
    rpc: async () => ({ data: null, error: { message: "fail" } }),
  };
  const result = await checkRateLimitByUuid(
    mockSupabase,
    "uuid-abc",
    { maxRequests: 30, windowSeconds: 60 },
  );
  assertEquals(result.allowed, false);
  assertEquals(result.retry_after, 60);
});

Deno.test("checkRateLimitByUuid: passes correct params to RPC", async () => {
  const { checkRateLimitByUuid } = await importModule();
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
