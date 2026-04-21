import { assertEquals } from "@std/assert";
import { claimAiQuota, getAiQuotaStatus, refundAiQuota } from "../_shared/ai-quota.ts";

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

function makeClient(
  rpcImpl: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>,
) {
  return { rpc: rpcImpl };
}

t("claimAiQuota: returns RPC body when successful", async () => {
  const client = makeClient((_fn, _params) =>
    Promise.resolve({
      data: {
        allowed: true,
        blocked: false,
        tier: "free",
        used: 0,
        limit: 5,
        next_slot_at: null,
        should_notify: false,
        event_id: 42,
      },
      error: null,
    })
  );
  const r = await claimAiQuota(client, "uuid", "task-1");
  assertEquals(r.allowed, true);
  assertEquals(r.event_id, 42);
});

t("claimAiQuota: fail-closed on RPC error", async () => {
  const client = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "db down" } })
  );
  const r = await claimAiQuota(client, "uuid", "task-1");
  assertEquals(r.allowed, false);
  assertEquals(r.blocked, false);
  assertEquals(r.should_notify, false);
  assertEquals(r.event_id, null);
  assertEquals(r.error, "rpc_failed");
});

t("claimAiQuota: parses JSON string payload", async () => {
  const client = makeClient(() =>
    Promise.resolve({
      data: JSON.stringify({
        allowed: false,
        blocked: false,
        tier: "free",
        used: 5,
        limit: 5,
        next_slot_at: "2026-04-22T14:02:00Z",
        should_notify: true,
        event_id: 99,
      }),
      error: null,
    })
  );
  const r = await claimAiQuota(client, "uuid", "task-1");
  assertEquals(r.allowed, false);
  assertEquals(r.should_notify, true);
});

t("refundAiQuota: calls RPC and swallows errors", async () => {
  let called = false;
  const client = makeClient((fn, params) => {
    called = true;
    assertEquals(fn, "refund_ai_quota");
    assertEquals((params as { p_event_id: number }).p_event_id, 42);
    return Promise.resolve({ data: null, error: null });
  });
  await refundAiQuota(client, 42);
  assertEquals(called, true);

  const failing = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "down" } })
  );
  await refundAiQuota(failing, 42);
});

t("getAiQuotaStatus: returns RPC body", async () => {
  const client = makeClient(() =>
    Promise.resolve({
      data: {
        tier: "byok",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: null,
      },
      error: null,
    })
  );
  const r = await getAiQuotaStatus(client, "uuid");
  assertEquals(r.tier, "byok");
  assertEquals(r.limit, -1);
});

t("getAiQuotaStatus: fail-closed returns null tier on error", async () => {
  const client = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "x" } })
  );
  const r = await getAiQuotaStatus(client, "uuid");
  assertEquals(r.tier, null);
  assertEquals(r.limit, 0);
});
