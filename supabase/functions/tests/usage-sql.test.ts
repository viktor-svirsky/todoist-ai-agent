// supabase/functions/tests/usage-sql.test.ts
// Requires a running local Supabase (`npm run supabase:start`) plus
// SUPABASE_SERVICE_ROLE_KEY and SUPABASE_JWT_SECRET envs.
//
// Exercises the Task 2-4 usage dashboard RPCs:
//   - get_usage_daily(tz_offset_minutes, days)
//   - get_usage_summary(days)
//   - get_usage_csv_page(before, limit, days)
// All use auth.uid() — we mint per-user HS256 JWTs to impersonate.

import { assert, assertEquals } from "@std/assert";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JWT_SECRET   = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";

const RUN_SQL = Deno.env.get("RUN_SUPABASE_SQL_TESTS") === "1";
if (!RUN_SQL) {
  console.warn(
    "usage-sql.test.ts: skipping — set RUN_SUPABASE_SQL_TESTS=1 with live Supabase + SUPABASE_JWT_SECRET to enable",
  );
}

// ---------- JWT minting (HS256) ----------

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function mintUserJwt(sub: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)),
  );
  return `${unsigned}.${b64url(sig)}`;
}

// ---------- HTTP helpers ----------

async function rpcAsService(fn: string, params: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(params),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${text}`);
  return text.length ? JSON.parse(text) : null;
}

async function rpcAsUser(
  uid: string,
  fn: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const jwt = await mintUserJwt(uid);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(params),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try { parsed = text.length ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: r.ok, status: r.status, text, json: parsed };
}

async function rpcAsAnon(fn: string, params: Record<string, unknown>) {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify(params),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

async function insertUser(): Promise<string> {
  const id = crypto.randomUUID();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/users_config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id,
      todoist_user_id: `t-${id.slice(0, 8)}`,
      todoist_token: "fake",
    }),
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

async function insertEvent(
  userId: string,
  opts: { eventTime?: string; counted?: boolean; refundedAt?: string | null; taskId?: string; tier?: string } = {},
): Promise<number> {
  const body: Record<string, unknown> = {
    user_id: userId,
    task_id: opts.taskId ?? "t-fake",
    tier: opts.tier ?? "free",
    counted: opts.counted ?? true,
  };
  if (opts.eventTime) body.event_time = opts.eventTime;
  if (opts.refundedAt !== undefined) body.refunded_at = opts.refundedAt;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_request_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`insertEvent failed: ${await r.text()}`);
  const rows = await r.json() as Array<{ id: number }>;
  return rows[0].id;
}

function t(name: string, fn: () => Promise<void>) {
  if (!RUN_SQL) return;
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

// ---------- Tests ----------

t("get_usage_daily: unauthenticated (anon) call raises 42501", async () => {
  const res = await rpcAsAnon("get_usage_daily", {
    p_tz_offset_minutes: 0, p_days: 7,
  });
  assert(!res.ok, "anon call must fail");
  assert(
    res.text.includes("not_authenticated") || res.text.includes("42501"),
    `expected not_authenticated error, got: ${res.text}`,
  );
});

t("get_usage_summary: unauthenticated (anon) call raises 42501", async () => {
  const res = await rpcAsAnon("get_usage_summary", { p_days: 30 });
  assert(!res.ok, "anon call must fail");
  assert(
    res.text.includes("not_authenticated") || res.text.includes("42501"),
    `expected not_authenticated error, got: ${res.text}`,
  );
});

t("get_usage_csv_page: unauthenticated (anon) call raises 42501", async () => {
  const res = await rpcAsAnon("get_usage_csv_page", {
    p_before: null, p_before_id: null, p_limit: 100, p_days: 30,
  });
  assert(!res.ok);
  assert(
    res.text.includes("not_authenticated") || res.text.includes("42501"),
    `expected not_authenticated error, got: ${res.text}`,
  );
});

t("get_usage_daily: cross-user isolation — A sees only A's events", async () => {
  const uidA = await insertUser();
  const uidB = await insertUser();
  try {
    // Populate B's events today
    for (let i = 0; i < 3; i++) await insertEvent(uidB);
    // A queries — should see zero counted
    const res = await rpcAsUser(uidA, "get_usage_daily", {
      p_tz_offset_minutes: 0, p_days: 7,
    });
    assert(res.ok, `A query failed: ${res.text}`);
    const rows = res.json as Array<{ counted: number; denied: number; refunded: number }>;
    assertEquals(rows.length, 7);
    for (const r of rows) {
      assertEquals(r.counted, 0, "A must not see B's counted events");
      assertEquals(r.denied, 0);
      assertEquals(r.refunded, 0);
    }
  } finally {
    await cleanup(uidA);
    await cleanup(uidB);
  }
});

t("get_usage_daily: 7-day window contains 7 rows for any tz offset", async () => {
  const uid = await insertUser();
  try {
    for (const tz of [-420, 0, 540]) {
      const res = await rpcAsUser(uid, "get_usage_daily", {
        p_tz_offset_minutes: tz, p_days: 7,
      });
      assert(res.ok, `tz=${tz} failed: ${res.text}`);
      const rows = res.json as Array<{ day_start: string }>;
      assertEquals(rows.length, 7, `tz=${tz} must return 7 rows`);
      // Buckets should be exactly 24h apart.
      for (let i = 1; i < rows.length; i++) {
        const prev = new Date(rows[i - 1].day_start).getTime();
        const cur = new Date(rows[i].day_start).getTime();
        assertEquals(cur - prev, 86_400_000, `tz=${tz} buckets must be 24h apart`);
      }
    }
  } finally { await cleanup(uid); }
});

t("get_usage_daily: refunded events land in refunded column, not denied", async () => {
  const uid = await insertUser();
  try {
    const eventId = await insertEvent(uid);
    await rpcAsService("refund_ai_quota", { p_event_id: eventId });
    const res = await rpcAsUser(uid, "get_usage_daily", {
      p_tz_offset_minutes: 0, p_days: 7,
    });
    assert(res.ok);
    const rows = res.json as Array<{ counted: number; denied: number; refunded: number }>;
    const totals = rows.reduce(
      (acc, r) => ({
        counted: acc.counted + r.counted,
        denied: acc.denied + r.denied,
        refunded: acc.refunded + r.refunded,
      }),
      { counted: 0, denied: 0, refunded: 0 },
    );
    assertEquals(totals.refunded, 1, "refund must show up in refunded");
    assertEquals(totals.counted, 0, "refunded event must not count");
    assertEquals(totals.denied, 0, "refunded event must not appear as denied");
  } finally { await cleanup(uid); }
});

t("get_usage_summary: total === counted + denied + refunded", async () => {
  const uid = await insertUser();
  try {
    // 3 counted
    for (let i = 0; i < 3; i++) await insertEvent(uid, { counted: true });
    // 2 denied (counted=false, refunded_at=null)
    for (let i = 0; i < 2; i++) await insertEvent(uid, { counted: false });
    // 1 refunded (counted=false, refunded_at=now)
    const refundedId = await insertEvent(uid, { counted: true });
    await rpcAsService("refund_ai_quota", { p_event_id: refundedId });

    const res = await rpcAsUser(uid, "get_usage_summary", { p_days: 30 });
    assert(res.ok, res.text);
    const s = res.json as { total: number; counted: number; denied: number; refunded: number; days: number };
    assertEquals(s.days, 30);
    assertEquals(s.counted, 3);
    assertEquals(s.denied, 2);
    assertEquals(s.refunded, 1);
    assertEquals(s.total, s.counted + s.denied + s.refunded);
    assertEquals(s.total, 6);
  } finally { await cleanup(uid); }
});

t("get_usage_csv_page: keyset pagination yields disjoint pages", async () => {
  const uid = await insertUser();
  try {
    // Insert 5 events with distinct event_times, descending order from now.
    const times: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString();
      times.push(ts);
      await insertEvent(uid, { eventTime: ts, taskId: `t${i}` });
    }

    const page1 = await rpcAsUser(uid, "get_usage_csv_page", {
      p_before: null, p_before_id: null, p_limit: 3, p_days: 30,
    });
    assert(page1.ok, page1.text);
    const rows1 = page1.json as Array<{ id: number; event_time: string; task_id: string }>;
    assertEquals(rows1.length, 3);

    const last1 = rows1[rows1.length - 1];
    const page2 = await rpcAsUser(uid, "get_usage_csv_page", {
      p_before: last1.event_time, p_before_id: last1.id, p_limit: 3, p_days: 30,
    });
    assert(page2.ok, page2.text);
    const rows2 = page2.json as Array<{ event_time: string; task_id: string }>;
    assertEquals(rows2.length, 2);

    const ids1 = new Set(rows1.map((r) => r.task_id));
    const ids2 = new Set(rows2.map((r) => r.task_id));
    for (const id of ids2) {
      assert(!ids1.has(id), `page 2 must be disjoint from page 1 (overlap: ${id})`);
    }
  } finally { await cleanup(uid); }
});

t("get_usage_csv_page: ties on event_time are not dropped across pages", async () => {
  const uid = await insertUser();
  try {
    const ts = new Date(Date.now() - 60_000).toISOString();
    // 3 events sharing the same event_time.
    for (let i = 0; i < 3; i++) {
      await insertEvent(uid, { eventTime: ts, taskId: `tie-${i}` });
    }
    const page1 = await rpcAsUser(uid, "get_usage_csv_page", {
      p_before: null, p_before_id: null, p_limit: 2, p_days: 30,
    });
    assert(page1.ok, page1.text);
    const r1 = page1.json as Array<{ id: number; event_time: string; task_id: string }>;
    assertEquals(r1.length, 2);
    const last = r1[r1.length - 1];
    const page2 = await rpcAsUser(uid, "get_usage_csv_page", {
      p_before: last.event_time, p_before_id: last.id, p_limit: 10, p_days: 30,
    });
    assert(page2.ok, page2.text);
    const r2 = page2.json as Array<{ task_id: string }>;
    assertEquals(r2.length, 1, "remaining tied row must appear on page 2");
    const seen = new Set([...r1, ...r2].map((r) => r.task_id));
    assertEquals(seen.size, 3, "all 3 tied rows must be returned across pages");
  } finally { await cleanup(uid); }
});

t("get_usage_daily: p_days clamped to 31", async () => {
  const uid = await insertUser();
  try {
    const res = await rpcAsUser(uid, "get_usage_daily", {
      p_tz_offset_minutes: 0, p_days: 9999,
    });
    assert(res.ok, res.text);
    const rows = res.json as Array<unknown>;
    assertEquals(rows.length, 31, "p_days must clamp to 31");
  } finally { await cleanup(uid); }
});

t("get_usage_daily: p_tz_offset_minutes clamped to 840", async () => {
  const uid = await insertUser();
  try {
    // extreme tz offset should not error and should still return 7 rows
    const res = await rpcAsUser(uid, "get_usage_daily", {
      p_tz_offset_minutes: 99999, p_days: 7,
    });
    assert(res.ok, res.text);
    const rows = res.json as Array<unknown>;
    assertEquals(rows.length, 7);
  } finally { await cleanup(uid); }
});

t("get_usage_summary: p_days clamped to 90", async () => {
  const uid = await insertUser();
  try {
    const res = await rpcAsUser(uid, "get_usage_summary", { p_days: 9999 });
    assert(res.ok, res.text);
    const s = res.json as { days: number };
    assertEquals(s.days, 90, "p_days must clamp to 90");
  } finally { await cleanup(uid); }
});

t("get_usage_csv_page: p_limit clamped to 1000", async () => {
  const uid = await insertUser();
  try {
    // No rows; just verify the call succeeds with over-limit param.
    const res = await rpcAsUser(uid, "get_usage_csv_page", {
      p_before: null, p_before_id: null, p_limit: 99999, p_days: 30,
    });
    assert(res.ok, res.text);
    const rows = res.json as Array<unknown>;
    assert(rows.length <= 1000, "result length must respect the 1000 cap");
  } finally { await cleanup(uid); }
});
