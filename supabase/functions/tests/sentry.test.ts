import { assertEquals } from "jsr:@std/assert";
import { withSentry, captureException } from "../_shared/sentry.ts";

Deno.test("withSentry: passes response through when handler succeeds", async () => {
  const handler = async (_req: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "POST" }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("withSentry: returns 500 JSON when handler throws", async () => {
  const handler = async (_req: Request): Promise<Response> => {
    throw new Error("boom");
  };
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "POST" }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "Internal server error");
});

Deno.test("withSentry: OPTIONS request passes through", async () => {
  const handler = async (req: Request) =>
    req.method === "OPTIONS"
      ? new Response(null, { status: 200 })
      : new Response("ok", { status: 200 });
  const wrapped = withSentry(handler);
  const res = await wrapped(new Request("http://localhost/test", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("captureException: no-ops when SENTRY_DSN not set", async () => {
  // Should not throw even without Sentry initialized
  await captureException(new Error("test error"));
});
