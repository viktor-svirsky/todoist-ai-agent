import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env + dynamic import setup
// ---------------------------------------------------------------------------

const FRONTEND_URL = "https://app.example.com";
const CLIENT_SECRET = "test-client-secret";
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", FRONTEND_URL);
Deno.env.set("TODOIST_CLIENT_ID", "test-client-id");
Deno.env.set("TODOIST_CLIENT_SECRET", CLIENT_SECRET);
Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));

const { authCallbackHandler: handler } = await import("../auth-callback/handler.ts");
const { signOAuthState } = await import("../_shared/crypto.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Disable sanitizers — Supabase client starts token refresh intervals
function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

function mockFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    Promise.resolve(fn(String(input), init as RequestInit))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

async function callbackUrl(params: Record<string, string> = {}): Promise<string> {
  const validState = await signOAuthState(CLIENT_SECRET);
  const merged = { code: "oauth-code", state: validState, ...params };
  return `http://localhost/auth-callback?${new URLSearchParams(merged).toString()}`;
}

const SESSION_TOKENS = {
  access_token: "session-access-token",
  refresh_token: "session-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
};

/** Mock Todoist token exchange + user profile, then delegate to extra handler. */
function todoistAndSupabaseMock(
  todoistUser: { id: number; email: string },
  extra: (url: string, init?: RequestInit) => Response | null,
): (url: string, init?: RequestInit) => Response {
  return (url, init) => {
    if (url.includes("todoist.com/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "test-access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.todoist.com") && url.includes("/user")) {
      return new Response(JSON.stringify(todoistUser), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const res = extra(url, init);
    if (res) return res;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

// ============================================================================
// CORS
// ============================================================================

t("authCallbackHandler: OPTIONS returns CORS headers", async () => {
  const req = new Request("http://localhost/auth-callback", { method: "OPTIONS" });
  const res = await handler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), FRONTEND_URL);
});

// ============================================================================
// Parameter validation
// ============================================================================

t("authCallbackHandler: missing code redirects with error", async () => {
  const req = new Request("http://localhost/auth-callback?state=csrf");
  const res = await handler(req);
  assertEquals(res.status, 302);
  const location = res.headers.get("Location")!;
  assertEquals(location.includes("error=missing_code"), true);
});

t("authCallbackHandler: missing state redirects with error", async () => {
  const req = new Request("http://localhost/auth-callback?code=abc");
  const res = await handler(req);
  assertEquals(res.status, 302);
  const location = res.headers.get("Location")!;
  assertEquals(location.includes("error=missing_state"), true);
});

// ============================================================================
// State validation (CSRF protection)
// ============================================================================

t("authCallbackHandler: invalid state (forged) redirects with error", async () => {
  const req = new Request("http://localhost/auth-callback?code=abc&state=forged-state");
  const res = await handler(req);
  assertEquals(res.status, 302);
  const location = res.headers.get("Location")!;
  assertEquals(location.includes("error=invalid_state"), true);
});

t("authCallbackHandler: state signed with wrong secret redirects with error", async () => {
  const wrongState = await signOAuthState("wrong-secret");
  const req = new Request(`http://localhost/auth-callback?code=abc&state=${encodeURIComponent(wrongState)}`);
  const res = await handler(req);
  assertEquals(res.status, 302);
  const location = res.headers.get("Location")!;
  assertEquals(location.includes("error=invalid_state"), true);
});

// ============================================================================
// External API failures
// ============================================================================

t("authCallbackHandler: token exchange failure redirects with error", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("todoist.com/oauth/access_token")) {
      return new Response("Bad Request", { status: 400 });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request(await callbackUrl());
    const res = await handler(req);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location")!.includes("error=token_exchange_failed"), true);
  } finally {
    restore();
  }
});

t("authCallbackHandler: profile fetch failure redirects with error", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("todoist.com/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.todoist.com") && url.includes("/user")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const req = new Request(await callbackUrl());
    const res = await handler(req);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location")!.includes("error=profile_fetch_failed"), true);
  } finally {
    restore();
  }
});

// ============================================================================
// Existing user flow
// ============================================================================

t("authCallbackHandler: existing user updates token and redirects with session", async () => {
  const restore = mockFetch(todoistAndSupabaseMock(
    { id: 12345, email: "user@example.com" },
    (url, init) => {
      // users_config select (existing user found)
      if (url.includes("/rest/v1/users_config") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // admin generateLink
      if (url.includes("/auth/v1/admin/generate_link")) {
        return new Response(JSON.stringify({
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          email: "user@example.com",
          properties: { hashed_token: "test-token-hash" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // verify OTP
      if (url.includes("/auth/v1/verify")) {
        return new Response(JSON.stringify(SESSION_TOKENS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    },
  ));
  try {
    const req = new Request(await callbackUrl());
    const res = await handler(req);
    assertEquals(res.status, 302);
    const location = res.headers.get("Location")!;
    assertEquals(location.includes(`${FRONTEND_URL}/auth/callback`), true);
    assertEquals(location.includes("#access_token=session-access-token"), true);
    // OAuth state should NOT be in redirect URL (#158 — prevents CSRF token leakage)
    assertEquals(location.includes("state="), false);
  } finally {
    restore();
  }
});

// ============================================================================
// New user flow
// ============================================================================

t("authCallbackHandler: new user creates account and redirects with session", async () => {
  const restore = mockFetch(todoistAndSupabaseMock(
    { id: 99999, email: "new@example.com" },
    (url, init) => {
      // users_config select (user not found)
      if (url.includes("/rest/v1/users_config") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // admin createUser
      if (url.includes("/auth/v1/admin/users") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
          email: "new@example.com",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Todoist sync (webhook registration)
      if (url.includes("api.todoist.com") && url.includes("/sync")) {
        return new Response(JSON.stringify({ sync_status: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // users_config insert
      if (url.includes("/rest/v1/users_config") && init?.method === "POST") {
        return new Response("{}", {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      // admin generateLink
      if (url.includes("/auth/v1/admin/generate_link")) {
        return new Response(JSON.stringify({
          id: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
          email: "new@example.com",
          properties: { hashed_token: "new-hash" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // verify OTP
      if (url.includes("/auth/v1/verify")) {
        return new Response(JSON.stringify(SESSION_TOKENS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    },
  ));
  try {
    const req = new Request(await callbackUrl());
    const res = await handler(req);
    assertEquals(res.status, 302);
    const location = res.headers.get("Location")!;
    assertEquals(location.includes(`${FRONTEND_URL}/auth/callback`), true);
    assertEquals(location.includes("#access_token=session-access-token"), true);
  } finally {
    restore();
  }
});

// ============================================================================
// Error handling
// ============================================================================

t("authCallbackHandler: catches internal errors and redirects", async () => {
  const restore = mockFetch(() => {
    throw new Error("Network failure");
  });
  try {
    const req = new Request(await callbackUrl());
    const res = await handler(req);
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location")!.includes("error=auth_failed"), true);
  } finally {
    restore();
  }
});
