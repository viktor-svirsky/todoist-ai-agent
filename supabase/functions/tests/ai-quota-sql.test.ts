// supabase/functions/tests/ai-quota-sql.test.ts
// Requires a running local Supabase (`npm run supabase:start`).
// Uses service-role client; inserts and cleans up its own fixture users.

import { assert, assertEquals } from "@std/assert";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RUN_SQL = Deno.env.get("RUN_SUPABASE_SQL_TESTS") === "1";
if (!RUN_SQL) {
  console.warn("ai-quota-sql.test.ts: skipping — set RUN_SUPABASE_SQL_TESTS=1 with live Supabase to enable");
}

async function rpc(fn: string, params: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function insertUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const todoistId = `t-${id.slice(0, 8)}`;
  const row = {
    id,
    todoist_user_id: todoistId,
    todoist_token: "fake",
    ...overrides,
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users_config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertUser failed: ${await r.text()}`);
  return id;
}

async function cleanup(userId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/users_config?id=eq.${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
}

function t(name: string, fn: () => Promise<void>) {
  if (!RUN_SQL) return;
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

t("claim_ai_quota: free user first attempt is allowed and counted", async () => {
  const uid = await insertUser();
  try {
    const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t1" });
    assertEquals(r.allowed, true);
    assertEquals(r.tier, "free");
    assertEquals(r.limit, 5);
    assertEquals(r.used, 0);              // pre-claim count
    assert(typeof r.event_id === "number");
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: free user's 6th call in 24h is denied", async () => {
  const uid = await insertUser();
  try {
    for (let i = 0; i < 5; i++) {
      const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `t${i}` });
      assertEquals(r.allowed, true, `call ${i + 1} should be allowed`);
    }
    const denied = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t6" });
    assertEquals(denied.allowed, false);
    assertEquals(denied.should_notify, true);

    const deniedAgain = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t7" });
    assertEquals(deniedAgain.allowed, false);
    assertEquals(deniedAgain.should_notify, false,
      "second denial within window must not re-notify");
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: Pro user is unlimited; event row counted", async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const uid = await insertUser({ pro_until: future });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `t${i}` });
      assertEquals(r.allowed, true);
      assertEquals(r.tier, "pro");
      assertEquals(r.limit, -1);
      assertEquals(r.used, null);
    }
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: BYOK (non-empty key) unlimited", async () => {
  const uid = await insertUser({ custom_ai_api_key: "sk-real-key" });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `t${i}` });
      assertEquals(r.allowed, true);
      assertEquals(r.tier, "byok");
    }
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: empty-string key is NOT BYOK", async () => {
  const uid = await insertUser({ custom_ai_api_key: "" });
  try {
    const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t1" });
    assertEquals(r.tier, "free", "empty key must resolve to free, not byok");
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: whitespace key is NOT BYOK", async () => {
  const uid = await insertUser({ custom_ai_api_key: "   " });
  try {
    const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t1" });
    assertEquals(r.tier, "free", "whitespace-only key must resolve to free");
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: disabled user is blocked", async () => {
  const uid = await insertUser({ is_disabled: true });
  try {
    const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t1" });
    assertEquals(r.allowed, false);
    assertEquals(r.blocked, true);
    assertEquals(r.event_id, null, "blocked must not insert an event row");
  } finally { await cleanup(uid); }
});

t("claim_ai_quota: concurrent denials produce exactly one should_notify", async () => {
  const uid = await insertUser();
  try {
    for (let i = 0; i < 5; i++) {
      await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `t${i}` });
    }
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `parallel${i}` })
      )
    );
    const notifies = results.filter((r: { should_notify: boolean }) => r.should_notify);
    assertEquals(notifies.length, 1, "exactly one concurrent denial should notify");
  } finally { await cleanup(uid); }
});

t("refund_ai_quota: flips counted to false and frees a slot", async () => {
  const uid = await insertUser();
  try {
    const claims = [];
    for (let i = 0; i < 5; i++) {
      const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: `t${i}` });
      claims.push(r.event_id);
    }
    // Refund the first
    await rpc("refund_ai_quota", { p_event_id: claims[0] });
    // 6th call should now be allowed (only 4 counted)
    const sixth = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t6" });
    assertEquals(sixth.allowed, true, "after refund, next call must succeed");
  } finally { await cleanup(uid); }
});

t("refund_ai_quota: idempotent on already-refunded event", async () => {
  const uid = await insertUser();
  try {
    const r = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "t1" });
    await rpc("refund_ai_quota", { p_event_id: r.event_id });
    // Second refund is a no-op; no exception
    await rpc("refund_ai_quota", { p_event_id: r.event_id });
  } finally { await cleanup(uid); }
});

t("get_ai_quota_status: does NOT insert an event row", async () => {
  const uid = await insertUser();
  try {
    const before = await countEvents(uid);
    await rpc("get_ai_quota_status", { p_user_id: uid });
    await rpc("get_ai_quota_status", { p_user_id: uid });
    await rpc("get_ai_quota_status", { p_user_id: uid });
    const after = await countEvents(uid);
    assertEquals(after, before, "status reads must not write events");
  } finally { await cleanup(uid); }
});

t("get_ai_quota_status: scrubs pro_until when derived tier is byok", async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const uid = await insertUser({
    pro_until: future,
    custom_ai_api_key: "sk-real-key",
  });
  try {
    const r = await rpc("get_ai_quota_status", { p_user_id: uid });
    assertEquals(r.tier, "byok");
    assertEquals(r.pro_until, null, "byok wins; pro_until must be null");
  } finally { await cleanup(uid); }
});

async function countEvents(userId: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_request_events?user_id=eq.${userId}&select=id`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
  );
  const rows = await r.json() as unknown[];
  return rows.length;
}
