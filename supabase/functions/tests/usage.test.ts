import { assertEquals } from "@std/assert";
import {
  __resetToolEventsTableCacheForTests,
  getUsageDaily,
  getUsageSummary,
  hasToolEventsTable,
} from "../_shared/usage.ts";

function t(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

function makeClient(
  rpcImpl: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }>,
) {
  return { rpc: rpcImpl };
}

t("getUsageDaily: forwards params and returns rows", async () => {
  let seenFn = ""; let seenParams: unknown = null;
  const client = makeClient((fn, params) => {
    seenFn = fn; seenParams = params;
    return Promise.resolve({
      data: [{ day_start: "2026-04-20T00:00:00Z", counted: 3, denied: 1, refunded: 0 }],
      error: null,
    });
  });
  const rows = await getUsageDaily(client, -420, 7);
  assertEquals(seenFn, "get_usage_daily");
  assertEquals(seenParams, { p_tz_offset_minutes: -420, p_days: 7 });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].counted, 3);
});

t("getUsageDaily: returns [] on RPC error", async () => {
  const client = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "boom" } })
  );
  assertEquals(await getUsageDaily(client, 0, 7), []);
});

t("getUsageDaily: returns [] when rpc throws", async () => {
  const client = makeClient(() => Promise.reject(new Error("net")));
  assertEquals(await getUsageDaily(client, 0, 7), []);
});

t("getUsageSummary: returns parsed payload", async () => {
  const client = makeClient(() =>
    Promise.resolve({
      data: { days: 30, total: 10, counted: 7, denied: 2, refunded: 1 },
      error: null,
    })
  );
  const s = await getUsageSummary(client, 30);
  assertEquals(s.total, 10);
  assertEquals(s.counted, 7);
});

t("getUsageSummary: parses JSON string payload", async () => {
  const client = makeClient(() =>
    Promise.resolve({
      data: JSON.stringify({ days: 30, total: 0, counted: 0, denied: 0, refunded: 0 }),
      error: null,
    })
  );
  const s = await getUsageSummary(client, 30);
  assertEquals(s.days, 30);
});

t("getUsageSummary: empty fallback on error", async () => {
  const client = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "x" } })
  );
  const s = await getUsageSummary(client, 30);
  assertEquals(s, { days: 30, total: 0, counted: 0, denied: 0, refunded: 0 });
});

t("hasToolEventsTable: true when RPC returns true", async () => {
  __resetToolEventsTableCacheForTests();
  const client = makeClient(() => Promise.resolve({ data: true, error: null }));
  assertEquals(await hasToolEventsTable(client), true);
});

t("hasToolEventsTable: false on error", async () => {
  __resetToolEventsTableCacheForTests();
  const client = makeClient(() =>
    Promise.resolve({ data: null, error: { message: "x" } })
  );
  assertEquals(await hasToolEventsTable(client), false);
});

t("hasToolEventsTable: caches within module", async () => {
  __resetToolEventsTableCacheForTests();
  let calls = 0;
  const client = makeClient(() => {
    calls++;
    return Promise.resolve({ data: true, error: null });
  });
  await hasToolEventsTable(client);
  await hasToolEventsTable(client);
  await hasToolEventsTable(client);
  assertEquals(calls, 1);
});
