import { assertEquals } from "@std/assert";

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------

Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set("TODOIST_CLIENT_ID", "test-client-id");
Deno.env.set("TODOIST_CLIENT_SECRET", "test-client-secret");

const { authStartHandler: handler } = await import("../auth-start/handler.ts");

// ---------------------------------------------------------------------------

Deno.test("authStartHandler: OPTIONS returns CORS headers", async () => {
  const req = new Request("http://localhost/auth-start", { method: "OPTIONS" });
  const res = await handler(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
});

Deno.test("authStartHandler: POST returns 405", async () => {
  const req = new Request("http://localhost/auth-start", { method: "POST" });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test("authStartHandler: GET redirects to Todoist OAuth with signed state", async () => {
  const req = new Request("http://localhost/auth-start", { method: "GET" });
  const res = await handler(req);
  assertEquals(res.status, 302);

  const location = res.headers.get("Location")!;
  assertEquals(location.startsWith("https://todoist.com/oauth/authorize?"), true);

  const url = new URL(location);
  assertEquals(url.searchParams.get("client_id"), "test-client-id");
  assertEquals(url.searchParams.get("scope"), "data:read_write");

  // State should be in nonce.timestamp.signature format
  const state = url.searchParams.get("state")!;
  const parts = state.split(".");
  assertEquals(parts.length, 3);
});

Deno.test("authStartHandler: state is verifiable with the same secret", async () => {
  const { verifyOAuthState } = await import("../_shared/crypto.ts");

  const req = new Request("http://localhost/auth-start", { method: "GET" });
  const res = await handler(req);
  const location = res.headers.get("Location")!;
  const url = new URL(location);
  const state = url.searchParams.get("state")!;

  assertEquals(await verifyOAuthState("test-client-secret", state), true);
  assertEquals(await verifyOAuthState("wrong-secret", state), false);
});
