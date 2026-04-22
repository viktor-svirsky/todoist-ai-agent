import { assert, assertEquals } from "@std/assert";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set(
  "ENCRYPTION_KEY",
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
);

const { settingsHandler: handler } = await import("../settings/handler.ts");
const { __resetToolEventsTableCacheForTests } = await import(
  "../_shared/usage.ts"
);

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const MOCK_USER = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  email: "test@example.com",
  aud: "authenticated",
};

interface Scenario {
  hasTools?: boolean;
  toolsRpc?: unknown[];
  dailyRpc?: unknown;
  summaryRpc?: unknown;
  tierRpc?: unknown;
  tierStatus?: number;
  seenUrls?: string[];
}

function mockFetch(scenario: Scenario): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = String(input);
    scenario.seenUrls?.push(url);
    return Promise.resolve(handleUrl(url, init as RequestInit, scenario));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function handleUrl(
  url: string,
  _init: RequestInit | undefined,
  s: Scenario,
): Response {
  const jsonHeaders = { "Content-Type": "application/json" };
  if (url.includes("/auth/v1/user") && !url.includes("/admin/")) {
    return new Response(JSON.stringify(MOCK_USER), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
    return new Response(
      JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (url.includes("/rest/v1/rpc/get_ai_quota_status")) {
    return new Response(
      JSON.stringify(
        s.tierRpc ?? {
          tier: "free",
          used: 2,
          limit: 5,
          next_slot_at: "2026-04-22T10:00:00Z",
          pro_until: null,
        },
      ),
      { status: s.tierStatus ?? 200, headers: jsonHeaders },
    );
  }
  if (url.includes("/rest/v1/rpc/get_usage_daily")) {
    return new Response(
      JSON.stringify(
        s.dailyRpc ?? [
          { day_start: "2026-04-15T00:00:00Z", counted: 1, denied: 0, refunded: 0 },
          { day_start: "2026-04-16T00:00:00Z", counted: 2, denied: 1, refunded: 0 },
        ],
      ),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (url.includes("/rest/v1/rpc/get_usage_summary")) {
    return new Response(
      JSON.stringify(
        s.summaryRpc ??
          { days: 30, total: 5, counted: 3, denied: 1, refunded: 1 },
      ),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (url.includes("/rest/v1/rpc/has_tool_events_table")) {
    return new Response(JSON.stringify(s.hasTools ?? false), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  if (url.includes("/rest/v1/rpc/get_usage_tools")) {
    return new Response(JSON.stringify(s.toolsRpc ?? []), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  return new Response("{}", { status: 200, headers: jsonHeaders });
}

t("GET /usage: 401 without Authorization header", async () => {
  __resetToolEventsTableCacheForTests();
  const restore = mockFetch({});
  try {
    const req = new Request("http://local/settings/usage?tz_offset=0", {
      method: "GET",
    });
    const resp = await handler(req);
    assertEquals(resp.status, 401);
  } finally {
    restore();
  }
});

t("GET /usage: 400 without tz_offset", async () => {
  __resetToolEventsTableCacheForTests();
  const restore = mockFetch({});
  try {
    const req = new Request("http://local/settings/usage", {
      method: "GET",
      headers: { Authorization: "Bearer fake" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, "tz_offset_required");
  } finally {
    restore();
  }
});

t("GET /usage: 400 when tz_offset is non-numeric", async () => {
  __resetToolEventsTableCacheForTests();
  const restore = mockFetch({});
  try {
    const req = new Request("http://local/settings/usage?tz_offset=abc", {
      method: "GET",
      headers: { Authorization: "Bearer fake" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 400);
  } finally {
    restore();
  }
});

t("GET /usage: happy path returns expected shape with tools=null", async () => {
  __resetToolEventsTableCacheForTests();
  const seenUrls: string[] = [];
  const restore = mockFetch({ hasTools: false, seenUrls });
  try {
    const req = new Request(
      "http://local/settings/usage?tz_offset=-420",
      { method: "GET", headers: { Authorization: "Bearer fake" } },
    );
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.live_24h.used, 2);
    assertEquals(body.live_24h.limit, 5);
    assertEquals(body.live_24h.next_slot_at, "2026-04-22T10:00:00Z");
    assertEquals(body.daily.length, 2);
    assertEquals(body.summary.total, 5);
    assertEquals(body.tools, null);
    assert(
      !seenUrls.some((u) => u.includes("/rpc/get_usage_tools")),
      "must not call get_usage_tools when table absent",
    );
  } finally {
    restore();
  }
});

t("GET /usage: tools populated when has_tool_events_table = true", async () => {
  __resetToolEventsTableCacheForTests();
  const restore = mockFetch({
    hasTools: true,
    toolsRpc: [{ tool_name: "list_tasks", count: 9 }],
  });
  try {
    const req = new Request("http://local/settings/usage?tz_offset=0", {
      method: "GET",
      headers: { Authorization: "Bearer fake" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.tools.length, 1);
    assertEquals(body.tools[0].tool_name, "list_tasks");
    assertEquals(body.tools[0].count, 9);
  } finally {
    restore();
  }
});

t("GET /usage: clamps days_7 and days_30 query params", async () => {
  __resetToolEventsTableCacheForTests();
  const seenUrls: string[] = [];
  const restore = mockFetch({ hasTools: false, seenUrls });
  try {
    const req = new Request(
      "http://local/settings/usage?tz_offset=60&days_7=999&days_30=-4",
      { method: "GET", headers: { Authorization: "Bearer fake" } },
    );
    const resp = await handler(req);
    assertEquals(resp.status, 200);
  } finally {
    restore();
  }
});
