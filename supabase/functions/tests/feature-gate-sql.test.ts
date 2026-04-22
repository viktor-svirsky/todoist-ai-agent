// supabase/functions/tests/feature-gate-sql.test.ts
// Requires a running local Supabase (`npm run supabase:start`).
// Exercises get_user_tier across the 12 tier combinations, parity-checks against
// claim_ai_quota, and validates log_feature_gate_event insert + CHECK constraints.

import { assert, assertEquals } from "@std/assert";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RUN_SQL = Deno.env.get("RUN_SUPABASE_SQL_TESTS") === "1";
if (!RUN_SQL) {
  console.warn("feature-gate-sql.test.ts: skipping — set RUN_SUPABASE_SQL_TESTS=1 with live Supabase to enable");
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
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${text}`);
  return text.length ? JSON.parse(text) : null;
}

async function rpcRaw(fn: string, params: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(params),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

async function insertUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const row = {
    id,
    todoist_user_id: `t-${id.slice(0, 8)}`,
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

async function countGateEvents(userId: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/feature_gate_events?user_id=eq.${userId}&select=id`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  const rows = await r.json() as unknown[];
  return rows.length;
}

async function listGateEvents(userId: string): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/feature_gate_events?user_id=eq.${userId}&select=*`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  return await r.json() as Array<Record<string, unknown>>;
}

function t(name: string, fn: () => Promise<void>) {
  if (!RUN_SQL) return;
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

// ---------- get_user_tier matrix: 4 key × 3 pro_until = 12 combos ----------

const pastIso = () => new Date(Date.now() - 86_400_000).toISOString();
const futureIso = () => new Date(Date.now() + 86_400_000).toISOString();

type Combo = {
  label: string;
  key: string | null;
  pro: "null" | "past" | "future";
  expected: "free" | "pro" | "byok";
};

const combos: Combo[] = [
  // BYOK wins whenever key is real — regardless of pro_until.
  { label: "real-key + pro_null",   key: "sk-real", pro: "null",   expected: "byok" },
  { label: "real-key + pro_past",   key: "sk-real", pro: "past",   expected: "byok" },
  { label: "real-key + pro_future", key: "sk-real", pro: "future", expected: "byok" },
  // Empty key: treated as no key.
  { label: "empty-key + pro_null",   key: "",  pro: "null",   expected: "free" },
  { label: "empty-key + pro_past",   key: "",  pro: "past",   expected: "free" },
  { label: "empty-key + pro_future", key: "",  pro: "future", expected: "pro"  },
  // Whitespace key: treated as no key.
  { label: "ws-key + pro_null",   key: "   ", pro: "null",   expected: "free" },
  { label: "ws-key + pro_past",   key: "   ", pro: "past",   expected: "free" },
  { label: "ws-key + pro_future", key: "   ", pro: "future", expected: "pro"  },
  // Null key.
  { label: "null-key + pro_null",   key: null, pro: "null",   expected: "free" },
  { label: "null-key + pro_past",   key: null, pro: "past",   expected: "free" },
  { label: "null-key + pro_future", key: null, pro: "future", expected: "pro"  },
];

for (const c of combos) {
  t(`get_user_tier: ${c.label} → ${c.expected}`, async () => {
    const overrides: Record<string, unknown> = {};
    if (c.key !== null) overrides.custom_ai_api_key = c.key;
    if (c.pro === "past") overrides.pro_until = pastIso();
    if (c.pro === "future") overrides.pro_until = futureIso();
    const uid = await insertUser(overrides);
    try {
      const tier = await rpc("get_user_tier", { p_user_id: uid });
      assertEquals(tier, c.expected);

      // Parity: claim_ai_quota returns the same tier for non-disabled users.
      const q = await rpc("claim_ai_quota", { p_user_id: uid, p_task_id: "parity" });
      assertEquals(q.tier, c.expected, "claim_ai_quota tier must match get_user_tier");
    } finally { await cleanup(uid); }
  });
}

t("get_user_tier: unknown user returns NULL", async () => {
  const fakeId = crypto.randomUUID();
  const tier = await rpc("get_user_tier", { p_user_id: fakeId });
  assertEquals(tier, null);
});

// ---------- log_feature_gate_event ----------

t("log_feature_gate_event: inserts row with correct columns", async () => {
  const uid = await insertUser();
  try {
    const before = await countGateEvents(uid);
    await rpc("log_feature_gate_event", {
      p_user_id: uid, p_tier: "free",
      p_feature: "web_search", p_action: "filtered",
    });
    const rows = await listGateEvents(uid);
    assertEquals(rows.length, before + 1);
    const row = rows[0];
    assertEquals(row.user_id, uid);
    assertEquals(row.tier, "free");
    assertEquals(row.feature, "web_search");
    assertEquals(row.action, "filtered");
    assert(typeof row.id === "number");
    assert(typeof row.event_time === "string");
  } finally { await cleanup(uid); }
});

t("log_feature_gate_event: accepts every valid (feature, action) pair", async () => {
  const uid = await insertUser();
  const features = ["web_search", "todoist_tools", "custom_prompt", "model_override"];
  const actions = ["allowed", "filtered", "silently_ignored", "write_rejected"];
  try {
    for (const f of features) {
      for (const a of actions) {
        await rpc("log_feature_gate_event", {
          p_user_id: uid, p_tier: "pro", p_feature: f, p_action: a,
        });
      }
    }
    const n = await countGateEvents(uid);
    assertEquals(n, features.length * actions.length);
  } finally { await cleanup(uid); }
});

t("log_feature_gate_event: CHECK rejects bogus feature", async () => {
  const uid = await insertUser();
  try {
    const res = await rpcRaw("log_feature_gate_event", {
      p_user_id: uid, p_tier: "free",
      p_feature: "not_a_feature", p_action: "filtered",
    });
    assert(!res.ok, "bogus feature must be rejected");
    assert(
      res.text.includes("feature_gate_events") || res.text.includes("check"),
      `expected CHECK constraint failure, got: ${res.text}`,
    );
  } finally { await cleanup(uid); }
});

t("log_feature_gate_event: CHECK rejects bogus action", async () => {
  const uid = await insertUser();
  try {
    const res = await rpcRaw("log_feature_gate_event", {
      p_user_id: uid, p_tier: "free",
      p_feature: "web_search", p_action: "nuked",
    });
    assert(!res.ok, "bogus action must be rejected");
  } finally { await cleanup(uid); }
});

t("log_feature_gate_event: CHECK rejects bogus tier", async () => {
  const uid = await insertUser();
  try {
    const res = await rpcRaw("log_feature_gate_event", {
      p_user_id: uid, p_tier: "platinum",
      p_feature: "web_search", p_action: "filtered",
    });
    assert(!res.ok, "bogus tier must be rejected");
  } finally { await cleanup(uid); }
});

t("feature_gate_events: ON DELETE CASCADE removes rows when user deleted", async () => {
  const uid = await insertUser();
  await rpc("log_feature_gate_event", {
    p_user_id: uid, p_tier: "free",
    p_feature: "web_search", p_action: "filtered",
  });
  assertEquals(await countGateEvents(uid), 1);
  await cleanup(uid);
  assertEquals(await countGateEvents(uid), 0, "CASCADE must wipe gate events");
});
