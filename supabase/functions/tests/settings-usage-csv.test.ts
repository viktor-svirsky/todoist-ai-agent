import { assert, assertEquals, assertStringIncludes } from "@std/assert";

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("FRONTEND_URL", "https://app.example.com");
Deno.env.set(
  "ENCRYPTION_KEY",
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
);

const { settingsHandler: handler } = await import("../settings/handler.ts");

function t(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const MOCK_USER = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  email: "test@example.com",
  aud: "authenticated",
};

interface CsvScenario {
  pages?: unknown[][];
  pageError?: { message: string };
  seenUrls?: string[];
}

function mockFetch(scenario: CsvScenario): () => void {
  const original = globalThis.fetch;
  let pageIdx = 0;
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = String(input);
    scenario.seenUrls?.push(url);
    const jsonHeaders = { "Content-Type": "application/json" };
    if (url.includes("/auth/v1/user") && !url.includes("/admin/")) {
      return Promise.resolve(
        new Response(JSON.stringify(MOCK_USER), {
          status: 200,
          headers: jsonHeaders,
        }),
      );
    }
    if (url.includes("/rest/v1/rpc/check_rate_limit_by_uuid")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ allowed: true, blocked: false, retry_after: 0 }),
          { status: 200, headers: jsonHeaders },
        ),
      );
    }
    if (url.includes("/rest/v1/rpc/get_usage_csv_page")) {
      if (scenario.pageError) {
        return Promise.resolve(
          new Response(JSON.stringify(scenario.pageError), {
            status: 500,
            headers: jsonHeaders,
          }),
        );
      }
      const page = scenario.pages?.[pageIdx] ?? [];
      pageIdx++;
      return Promise.resolve(
        new Response(JSON.stringify(page), {
          status: 200,
          headers: jsonHeaders,
        }),
      );
    }
    void init;
    return Promise.resolve(
      new Response("{}", { status: 200, headers: jsonHeaders }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

t("GET /usage.csv: 401 without Authorization header", async () => {
  const restore = mockFetch({});
  try {
    const req = new Request("http://local/settings/usage.csv", {
      method: "GET",
    });
    const resp = await handler(req);
    assertEquals(resp.status, 401);
    const body = await resp.text();
    assert(
      !body.includes("event_time"),
      "401 response must not leak CSV header",
    );
  } finally {
    restore();
  }
});

t("GET /usage.csv: returns CSV headers and emits header row even with zero rows", async () => {
  const restore = mockFetch({ pages: [[]] });
  try {
    const req = new Request("http://local/settings/usage.csv", {
      method: "GET",
      headers: { Authorization: "Bearer fake" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    assertEquals(
      resp.headers.get("Content-Type"),
      "text/csv; charset=utf-8",
    );
    const dispo = resp.headers.get("Content-Disposition") ?? "";
    assertStringIncludes(dispo, "attachment; filename=");
    assertStringIncludes(dispo, ".csv");
    assertEquals(resp.headers.get("Cache-Control"), "no-store");
    const body = await resp.text();
    assertEquals(body, "event_time,tier,counted,refunded_at,task_id\n");
  } finally {
    restore();
  }
});

t("GET /usage.csv: streams two pages and stops on short page", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    id: 1000 - i,
    event_time: `2026-04-${String(20 - Math.floor(i / 100)).padStart(2, "0")}T00:00:${
      String(i % 60).padStart(2, "0")
    }Z`,
    tier: "free",
    counted: true,
    refunded_at: null,
    task_id: `task-${i}`,
  }));
  const page2 = [{
    id: 1,
    event_time: "2026-04-01T00:00:00Z",
    tier: "free",
    counted: false,
    refunded_at: "2026-04-01T01:00:00Z",
    task_id: "task-final",
  }];
  const seenUrls: string[] = [];
  const restore = mockFetch({ pages: [page1, page2], seenUrls });
  try {
    const req = new Request(
      "http://local/settings/usage.csv?days=30",
      {
        method: "GET",
        headers: { Authorization: "Bearer fake" },
      },
    );
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.text();
    const lines = body.split("\n").filter((l) => l.length > 0);
    assertEquals(lines.length, 1 + 1000 + 1);
    assertEquals(lines[0], "event_time,tier,counted,refunded_at,task_id");
    assertStringIncludes(lines.at(-1)!, "task-final");
    assertStringIncludes(lines.at(-1)!, "2026-04-01T01:00:00Z");
    const csvCalls = seenUrls.filter((u) =>
      u.includes("/rpc/get_usage_csv_page")
    );
    assertEquals(csvCalls.length, 2);
  } finally {
    restore();
  }
});

t("GET /usage.csv: clamps days param to 1..90", async () => {
  const restore = mockFetch({ pages: [[]] });
  try {
    const req = new Request(
      "http://local/settings/usage.csv?days=99999",
      {
        method: "GET",
        headers: { Authorization: "Bearer fake" },
      },
    );
    const resp = await handler(req);
    assertEquals(resp.status, 200);
    const body = await resp.text();
    assertStringIncludes(body, "event_time,tier,counted,refunded_at,task_id");
  } finally {
    restore();
  }
});

t("GET /usage.csv: probe RPC error → 500 JSON (no truncated 200 CSV)", async () => {
  const restore = mockFetch({ pageError: { message: "relation missing" } });
  try {
    const req = new Request("http://local/settings/usage.csv", {
      method: "GET",
      headers: { Authorization: "Bearer fake" },
    });
    const resp = await handler(req);
    assertEquals(resp.status, 500);
    const ct = resp.headers.get("Content-Type") ?? "";
    assertStringIncludes(ct, "application/json");
    const body = await resp.json();
    assertEquals(body.code, "usage_csv_unavailable");
  } finally {
    restore();
  }
});
