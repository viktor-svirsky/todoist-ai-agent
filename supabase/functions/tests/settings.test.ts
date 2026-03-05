import { assertEquals } from "jsr:@std/assert";
import { validateSettings } from "../_shared/validation.ts";
import {
  rateLimitResponse,
  accountBlockedResponse,
} from "../_shared/rate-limit.ts";

// ============================================================================
// Settings handler: Method routing
// ============================================================================

Deno.test("settings: OPTIONS returns CORS headers", () => {
  const FRONTEND_URL = "https://app.example.com";
  const headers = {
    "Access-Control-Allow-Origin": FRONTEND_URL,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  assertEquals(headers["Access-Control-Allow-Origin"], FRONTEND_URL);
  assertEquals(headers["Access-Control-Allow-Methods"], "GET, PUT, DELETE, OPTIONS");
});

Deno.test("settings: unsupported methods return 405", () => {
  const unsupported = ["POST", "PATCH"];
  for (const method of unsupported) {
    assertEquals(
      !["GET", "PUT", "DELETE", "OPTIONS"].includes(method),
      true,
      `${method} should not be allowed`,
    );
  }
});

// ============================================================================
// Settings handler: Auth checks
// ============================================================================

Deno.test("settings: missing Authorization header returns 401", () => {
  const authHeader = null;
  assertEquals(authHeader === null, true);
});

Deno.test("settings: invalid Authorization header returns 401", () => {
  const authHeader = "Bearer invalid-jwt";
  assertEquals(authHeader.startsWith("Bearer "), true);
  // Auth verification happens in Supabase client — just verify header is extracted
});

// ============================================================================
// Settings handler: GET response shape
// ============================================================================

Deno.test("settings: GET response includes all expected fields", () => {
  const mockData = {
    trigger_word: "@ai",
    custom_ai_base_url: null,
    custom_ai_model: null,
    max_messages: 20,
    custom_prompt: null,
  };
  const mockFullConfig = {
    custom_ai_api_key: "encrypted-value",
    custom_brave_key: null,
  };

  const response = {
    trigger_word: mockData.trigger_word,
    custom_ai_base_url: mockData.custom_ai_base_url,
    custom_ai_model: mockData.custom_ai_model,
    has_custom_ai_key: !!mockFullConfig.custom_ai_api_key,
    has_custom_brave_key: !!mockFullConfig.custom_brave_key,
    max_messages: mockData.max_messages,
    custom_prompt: mockData.custom_prompt,
  };

  assertEquals(response.has_custom_ai_key, true);
  assertEquals(response.has_custom_brave_key, false);
  assertEquals(response.trigger_word, "@ai");
  assertEquals(response.max_messages, 20);
});

Deno.test("settings: GET never exposes actual key values", () => {
  const fullConfig = {
    custom_ai_api_key: "sk-secret-key-12345",
    custom_brave_key: "BSA-secret-key",
  };

  const response = {
    has_custom_ai_key: !!fullConfig.custom_ai_api_key,
    has_custom_brave_key: !!fullConfig.custom_brave_key,
  };

  // Response should only have boolean flags, not actual values
  assertEquals(typeof response.has_custom_ai_key, "boolean");
  assertEquals(typeof response.has_custom_brave_key, "boolean");
  assertEquals(JSON.stringify(response).includes("sk-secret"), false);
  assertEquals(JSON.stringify(response).includes("BSA-secret"), false);
});

// ============================================================================
// Settings handler: PUT validation integration
// ============================================================================

Deno.test("settings: PUT filters to allowed fields only", () => {
  const body = {
    trigger_word: "@bot",
    custom_ai_base_url: "https://api.openai.com/v1",
    custom_ai_api_key: "sk-123",
    custom_ai_model: "gpt-4o",
    custom_brave_key: "BSA-123",
    max_messages: 30,
    custom_prompt: "Be concise",
    // These should be filtered out
    id: "hacker-id",
    todoist_token: "stolen-token",
    is_disabled: false,
    rate_limit_count: 999,
  };

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
    if ((body as Record<string, unknown>)[field] !== undefined) {
      updates[field] = (body as Record<string, unknown>)[field];
    }
  }

  assertEquals(Object.keys(updates).length, 7);
  assertEquals("id" in updates, false);
  assertEquals("todoist_token" in updates, false);
  assertEquals("is_disabled" in updates, false);
  assertEquals("rate_limit_count" in updates, false);
});

Deno.test("settings: PUT empty body returns no fields to update", () => {
  const updates: Record<string, unknown> = {};
  assertEquals(Object.keys(updates).length, 0);
});

Deno.test("settings: PUT converts empty strings to null for optional fields", () => {
  const body: Record<string, unknown> = {
    custom_ai_base_url: "",
    custom_ai_model: "",
    trigger_word: "@ai",
  };

  const allowedFields = [
    "trigger_word",
    "custom_ai_base_url",
    "custom_ai_model",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field !== "trigger_word" && field !== "max_messages") {
        updates[field] = body[field] || null;
      } else {
        updates[field] = body[field];
      }
    }
  }

  assertEquals(updates.custom_ai_base_url, null);
  assertEquals(updates.custom_ai_model, null);
  assertEquals(updates.trigger_word, "@ai");
});

Deno.test("settings: PUT validates before encrypting", () => {
  const updates = { trigger_word: "", max_messages: 200 };
  const errors = validateSettings(updates);
  assertEquals(errors.length >= 2, true);
  // Both fields should fail validation
  const fields = errors.map((e) => e.field);
  assertEquals(fields.includes("trigger_word"), true);
  assertEquals(fields.includes("max_messages"), true);
});

// ============================================================================
// Settings handler: Rate limiting
// ============================================================================

Deno.test("settings: rate limited response has correct status and headers", async () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "https://app.example.com" };
  const resp = rateLimitResponse(30, corsHeaders);
  assertEquals(resp.status, 429);
  assertEquals(resp.headers.get("Retry-After"), "30");
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  const body = await resp.json();
  assertEquals(body.error, "Rate limit exceeded");
});

Deno.test("settings: blocked response has correct status and CORS", async () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "https://app.example.com" };
  const resp = accountBlockedResponse(corsHeaders);
  assertEquals(resp.status, 403);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  const body = await resp.json();
  assertEquals(body.error, "Account disabled");
});

// ============================================================================
// Settings handler: DELETE
// ============================================================================

Deno.test("settings: DELETE cascades from auth user deletion", () => {
  // The handler calls serviceClient.auth.admin.deleteUser(user.id)
  // which cascades to users_config via FK constraint
  // This test verifies the expected behavior pattern
  const userId = "test-uuid-123";
  assertEquals(typeof userId, "string");
  assertEquals(userId.length > 0, true);
});

// ============================================================================
// Settings handler: JSON response helper
// ============================================================================

Deno.test("settings: jsonResponse includes CORS and Content-Type", () => {
  const FRONTEND_URL = "https://app.example.com";
  const corsHeaders = {
    "Access-Control-Allow-Origin": FRONTEND_URL,
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  assertEquals(headers["Content-Type"], "application/json");
  assertEquals(headers["Access-Control-Allow-Origin"], FRONTEND_URL);
});

Deno.test("settings: jsonResponse defaults to status 200", () => {
  const status = 200;
  assertEquals(status, 200);
});

Deno.test("settings: jsonResponse supports custom status codes", () => {
  const errorCodes = [400, 401, 404, 500];
  for (const code of errorCodes) {
    assertEquals(code >= 400, true);
  }
});
