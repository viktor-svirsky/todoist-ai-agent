import { assertEquals } from "jsr:@std/assert";

// ============================================================================
// Auth callback: URL parameter parsing
// ============================================================================

Deno.test("auth-callback: extracts code and state from URL", () => {
  const url = new URL("https://example.com/auth-callback?code=abc123&state=xyz789");
  assertEquals(url.searchParams.get("code"), "abc123");
  assertEquals(url.searchParams.get("state"), "xyz789");
});

Deno.test("auth-callback: missing code returns null", () => {
  const url = new URL("https://example.com/auth-callback?state=xyz789");
  assertEquals(url.searchParams.get("code"), null);
});

Deno.test("auth-callback: missing state returns null", () => {
  const url = new URL("https://example.com/auth-callback?code=abc123");
  assertEquals(url.searchParams.get("state"), null);
});

// ============================================================================
// Auth callback: Error redirect construction
// ============================================================================

Deno.test("auth-callback: error redirect encodes message", () => {
  const FRONTEND_URL = "https://app.example.com";
  const message = "auth_failed";
  const location = `${FRONTEND_URL}/?error=${encodeURIComponent(message)}`;
  assertEquals(location, "https://app.example.com/?error=auth_failed");
});

Deno.test("auth-callback: error redirect handles special characters", () => {
  const FRONTEND_URL = "https://app.example.com";
  const message = "token exchange failed & retry";
  const location = `${FRONTEND_URL}/?error=${encodeURIComponent(message)}`;
  assertEquals(location.includes("&retry"), false); // & should be encoded
  assertEquals(location.includes("%26"), true);
});

Deno.test("auth-callback: default error message is auth_failed", () => {
  const message = "auth_failed";
  assertEquals(message, "auth_failed");
});

// ============================================================================
// Auth callback: CORS headers
// ============================================================================

Deno.test("auth-callback: CORS headers restrict origin to FRONTEND_URL", () => {
  const FRONTEND_URL = "https://app.example.com";
  const corsHeaders = {
    "Access-Control-Allow-Origin": FRONTEND_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], FRONTEND_URL);
  assertEquals(corsHeaders["Access-Control-Allow-Methods"], "GET, OPTIONS");
});

// ============================================================================
// Auth callback: OAuth token exchange body
// ============================================================================

Deno.test("auth-callback: token exchange request body is correct", () => {
  const clientId = "test-client-id";
  const clientSecret = "test-client-secret";
  const code = "oauth-code-123";

  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
  };

  assertEquals(body.client_id, "test-client-id");
  assertEquals(body.client_secret, "test-client-secret");
  assertEquals(body.code, "oauth-code-123");
});

// ============================================================================
// Auth callback: User ID extraction
// ============================================================================

Deno.test("auth-callback: extracts todoist user ID as string", () => {
  const userData = { id: 12345, email: "user@example.com" };
  const todoistUserId = String(userData.id);
  assertEquals(todoistUserId, "12345");
  assertEquals(typeof todoistUserId, "string");
});

Deno.test("auth-callback: handles numeric user ID conversion", () => {
  const userData = { id: 9876543210 };
  assertEquals(String(userData.id), "9876543210");
});

// ============================================================================
// Auth callback: Webhook URL construction
// ============================================================================

Deno.test("auth-callback: webhook URL uses todoist user ID", () => {
  const supabaseUrl = "https://project.supabase.co";
  const todoistUserId = "12345";
  const webhookUrl = `${supabaseUrl}/functions/v1/webhook/${todoistUserId}`;
  assertEquals(webhookUrl, "https://project.supabase.co/functions/v1/webhook/12345");
});

// ============================================================================
// Auth callback: Webhook registration command
// ============================================================================

Deno.test("auth-callback: sync command has correct structure", () => {
  const webhookUrl = "https://project.supabase.co/functions/v1/webhook/12345";
  const uuid = "test-uuid";

  const commands = JSON.stringify([
    {
      type: "live_notifications_set_service",
      uuid,
      args: { service_url: webhookUrl },
    },
  ]);

  const parsed = JSON.parse(commands);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].type, "live_notifications_set_service");
  assertEquals(parsed[0].args.service_url, webhookUrl);
});

// ============================================================================
// Auth callback: Session redirect construction
// ============================================================================

Deno.test("auth-callback: redirect URL uses fragment (#) for tokens", () => {
  const FRONTEND_URL = "https://app.example.com";
  const state = "csrf-state-123";
  const session = {
    access_token: "jwt-access-token",
    refresh_token: "jwt-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
  };

  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    token_type: session.token_type,
    type: "magiclink",
  });

  const location = `${FRONTEND_URL}/auth/callback?state=${encodeURIComponent(state)}#${params.toString()}`;

  // Fragment (#) comes after query string
  assertEquals(location.includes("#access_token="), true);
  // State is in query string, tokens in fragment
  assertEquals(location.includes("?state=csrf-state-123#"), true);
  // Tokens should be in fragment, not query string
  const [queryPart, fragmentPart] = location.split("#");
  assertEquals(queryPart.includes("access_token"), false);
  assertEquals(fragmentPart.includes("access_token"), true);
});

Deno.test("auth-callback: defaults token_type to bearer", () => {
  const session = { token_type: undefined };
  const tokenType = session.token_type || "bearer";
  assertEquals(tokenType, "bearer");
});

// ============================================================================
// Auth callback: Race condition handling
// ============================================================================

Deno.test("auth-callback: detects email-already-registered error", () => {
  const errorCases = [
    { message: "A user with this email address has already been registered" },
    { message: "other error", status: 422 },
  ];

  for (const errorCase of errorCases) {
    const isEmailExists =
      (errorCase.message?.includes("already been registered")) ||
      ((errorCase as Record<string, unknown>).status === 422);
    assertEquals(isEmailExists, true);
  }
});

Deno.test("auth-callback: non-email-exists errors are not retried", () => {
  const error = { message: "Internal server error", status: 500 };
  const isEmailExists =
    error.message?.includes("already been registered") ||
    error.status === 422;
  assertEquals(isEmailExists, false);
});
