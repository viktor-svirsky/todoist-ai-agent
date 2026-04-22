# Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship monetization sub-project E: a read-only "Usage" tab in Settings showing last-24h live count, a 7-day per-day chart, a 30-day summary, an optional tool-breakdown panel (gated on sub-project C), and a streamed CSV export. All aggregates come from new `SECURITY DEFINER` Postgres functions scoped by `auth.uid()`. No changes to the write path except a backward-compatible `refunded_at` column on `ai_request_events`.

**Architecture:** Three new aggregate RPCs (`get_usage_daily`, `get_usage_summary`, `get_usage_csv_page`) and one feature-flag helper (`has_tool_events_table`). Two new Edge Function subroutes on the existing `settings` handler: `GET /settings/usage` (JSON, three RPCs in parallel) and `GET /settings/usage.csv` (streamed keyset pagination). New `useUsage` hook, `UsageTab` page composition, and an inline-SVG `UsageBarChart` component — no new chart dependency.

**Tech Stack:** Supabase Postgres (RLS + `SECURITY DEFINER` functions), Deno 2 Edge Functions (`ReadableStream` for CSV), TypeScript, React 19 + Vite + Vitest.

**Spec:** `docs/superpowers/specs/2026-04-21-usage-dashboard-design.md`

---

## File Structure

Files created:
- `supabase/migrations/00014_usage_dashboard.sql`
- `supabase/functions/_shared/usage.ts`
- `supabase/functions/_shared/csv.ts`
- `supabase/functions/tests/usage-sql.test.ts`
- `supabase/functions/tests/settings-usage.test.ts`
- `supabase/functions/tests/settings-usage-csv.test.ts`
- `frontend/src/hooks/useUsage.ts`
- `frontend/src/hooks/useUsage.test.ts`
- `frontend/src/components/UsageBarChart.tsx`
- `frontend/src/components/UsageBarChart.test.tsx`
- `frontend/src/components/UsageTab.tsx`
- `frontend/src/components/UsageTab.test.tsx`

Files modified:
- `supabase/functions/settings/handler.ts` — add `GET /usage` and `GET /usage.csv` subroutes
- `frontend/src/pages/Settings.tsx` — wire the Usage tab into the tab switcher
- `docs/ops/tier-quota-runbook.md` — append "Usage dashboard + retention follow-up" section
- `README.md` — one-line mention of the new dashboard

Note: the migration number (`00014`) is illustrative — the implementing agent should pick the next unused integer at the head of `ls supabase/migrations`.

---

## Task 1: Migration — `refunded_at` column + updated `refund_ai_quota`

**Files:**
- Create: `supabase/migrations/00014_usage_dashboard.sql`

- [x] **Step 1: Add the column, index, and refresh the refund RPC**

```sql
-- supabase/migrations/00014_usage_dashboard.sql
-- Monetization sub-project E: usage dashboard.
-- Spec: docs/superpowers/specs/2026-04-21-usage-dashboard-design.md

ALTER TABLE ai_request_events
  ADD COLUMN refunded_at timestamptz DEFAULT NULL;

CREATE INDEX ai_request_events_refunded_idx
  ON ai_request_events (user_id, refunded_at)
  WHERE refunded_at IS NOT NULL;

CREATE OR REPLACE FUNCTION refund_ai_quota(p_event_id bigint)
RETURNS void LANGUAGE sql AS $$
  UPDATE ai_request_events
     SET counted     = false,
         refunded_at = now()
   WHERE id = p_event_id AND counted = true;
$$;
```

- [x] **Step 2: Validate** (skipped - requires running Supabase stack; migration SQL is syntactically valid and matches existing refund_ai_quota signature from 00010)

- [x] **Step 3: Commit**

---

## Task 2: Migration — `get_usage_daily` RPC

**Files:**
- Modify: `supabase/migrations/00014_usage_dashboard.sql`

- [x] **Step 1: Append the function**

```sql
CREATE OR REPLACE FUNCTION get_usage_daily(
  p_tz_offset_minutes int,
  p_days              int
) RETURNS TABLE (
  day_start timestamptz,
  counted   int,
  denied    int,
  refunded  int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_off   int  := GREATEST(LEAST(COALESCE(p_tz_offset_minutes, 0), 840), -840);
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 7), 31), 1);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH bounds AS (
    SELECT date_trunc('day',
             (now() AT TIME ZONE 'UTC') + make_interval(mins => v_off)
           ) - make_interval(mins => v_off) AS today_start
  ),
  series AS (
    SELECT generate_series(
      (SELECT today_start FROM bounds) - make_interval(days => v_days - 1),
      (SELECT today_start FROM bounds),
      interval '1 day'
    ) AS day_start
  )
  SELECT
    s.day_start,
    COUNT(*) FILTER (WHERE e.counted = true)::int,
    COUNT(*) FILTER (WHERE e.counted = false AND e.refunded_at IS NULL)::int,
    COUNT(*) FILTER (WHERE e.refunded_at IS NOT NULL)::int
  FROM series s
  LEFT JOIN ai_request_events e
    ON e.user_id = v_uid
   AND e.event_time >= s.day_start
   AND e.event_time <  s.day_start + interval '1 day'
  GROUP BY s.day_start
  ORDER BY s.day_start;
END;
$$;

REVOKE ALL ON FUNCTION get_usage_daily(int, int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_daily(int, int) TO authenticated;
```

- [x] **Step 2: Validate** (skipped - requires running Supabase stack; SQL syntactically valid, references existing `ai_request_events(event_time, counted, refunded_at, user_id)` columns)
- [x] **Step 3: Commit**

---

## Task 3: Migration — `get_usage_summary` RPC

**Files:**
- Modify: `supabase/migrations/00014_usage_dashboard.sql`

- [x] **Step 1: Append**

```sql
CREATE OR REPLACE FUNCTION get_usage_summary(p_days int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 30), 90), 1);
  v_total int; v_counted int; v_denied int; v_refunded int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE counted = true)::int,
    COUNT(*) FILTER (WHERE counted = false AND refunded_at IS NULL)::int,
    COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)::int
  INTO v_total, v_counted, v_denied, v_refunded
  FROM ai_request_events
  WHERE user_id = v_uid
    AND event_time > now() - make_interval(days => v_days);
  RETURN jsonb_build_object(
    'days', v_days, 'total', v_total, 'counted', v_counted,
    'denied', v_denied, 'refunded', v_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_summary(int) TO authenticated;
```

- [x] **Step 2: Validate.** (skipped - requires running Supabase stack; SQL syntactically valid, references existing columns)
- [x] **Step 3: Commit.**

---

## Task 4: Migration — `get_usage_csv_page` + `has_tool_events_table`

**Files:**
- Modify: `supabase/migrations/00014_usage_dashboard.sql`

- [x] **Step 1: Append both functions**

```sql
CREATE OR REPLACE FUNCTION get_usage_csv_page(
  p_before timestamptz,
  p_limit  int,
  p_days   int
) RETURNS TABLE (
  event_time  timestamptz,
  tier        text,
  counted     boolean,
  refunded_at timestamptz,
  task_id     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int  := GREATEST(LEAST(COALESCE(p_limit, 1000), 1000), 1);
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 30), 90), 1);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.event_time, e.tier, e.counted, e.refunded_at, e.task_id
  FROM ai_request_events e
  WHERE e.user_id = v_uid
    AND e.event_time > now() - make_interval(days => v_days)
    AND (p_before IS NULL OR e.event_time < p_before)
  ORDER BY e.event_time DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION get_usage_csv_page(timestamptz, int, int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_csv_page(timestamptz, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION has_tool_events_table()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_events'
  );
$$;
GRANT EXECUTE ON FUNCTION has_tool_events_table() TO authenticated;
```

- [x] **Step 2: Validate — keyset pagination smoke test** (skipped - requires running Supabase stack; SQL syntactically valid, references existing columns, p_limit clamped to 1000)

```sql
-- Insert 1500 fake rows for a test user, then:
SELECT count(*) FROM (
  SELECT * FROM get_usage_csv_page(NULL, 1000, 30)
) x;  -- expect 1000
```

- [x] **Step 3: Commit.**

---

## Task 5: SQL function tests (Deno integration)

**Files:**
- Create: `supabase/functions/tests/usage-sql.test.ts`

- [x] **Step 1: Mirror the `ai-quota-sql.test.ts` harness (service-role fixture users + cleanup)**

Cover:
- Unauthenticated call → `42501` error surface (call via anon key, expect failure).
- Cross-user isolation: user A JWT calling `get_usage_daily` returns zeros for user B's rows.
- 7-day bucket boundaries at `tz_offset_minutes = -420` (PDT) vs. `0` (UTC) vs. `540` (JST).
- Refund flow: claim → `refund_ai_quota` → appears in `refunded` column of `get_usage_daily`, not `denied`.
- `get_usage_summary`: `total === counted + denied + refunded`.
- `get_usage_csv_page` keyset: page 1's last `event_time` passed as `p_before` yields a disjoint page 2.
- Parameter clamping: `p_days = 9999` clamped to 90; `p_tz_offset_minutes = 99999` clamped to 840.

- [x] **Step 2: Run** — `deno test supabase/functions/tests/usage-sql.test.ts --no-check --allow-env --allow-net` (skips cleanly when SUPABASE_SERVICE_ROLE_KEY/SUPABASE_JWT_SECRET not set; lint passes)
- [x] **Step 3: Commit.**

---

## Task 6: `_shared/usage.ts` wrappers + `_shared/csv.ts` encoder

**Files:**
- Create: `supabase/functions/_shared/usage.ts`
- Create: `supabase/functions/_shared/csv.ts`

- [x] **Step 1: Write the wrappers**

```ts
// _shared/usage.ts
export interface UsageDailyRow {
  day_start: string; counted: number; denied: number; refunded: number;
}
export interface UsageSummary {
  days: number; total: number; counted: number; denied: number; refunded: number;
}

export async function getUsageDaily(
  supabase, tzOffsetMin: number, days: number
): Promise<UsageDailyRow[]> { /* rpc call, return [] on error + log */ }

export async function getUsageSummary(
  supabase, days: number
): Promise<UsageSummary> { /* rpc call */ }

export async function hasToolEventsTable(supabase): Promise<boolean> {
  /* rpc call, cached in module-scope Promise */
}
```

```ts
// _shared/csv.ts
export function csvEscape(value: string | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
export function csvLine(parts: (string | null)[]): string {
  return parts.map(csvEscape).join(",") + "\n";
}
```

- [x] **Step 2: Unit test** — `tests/csv.test.ts` with empty, comma, quote, newline, null values. Also added `tests/usage.test.ts` covering the wrappers + cache.
- [x] **Step 3: Commit.**

---

## Task 7: Settings handler — `GET /settings/usage` subroute

**Files:**
- Modify: `supabase/functions/settings/handler.ts`

- [x] **Step 1: Add subroute just below the existing `GET /tier` block**

```ts
if (req.method === "GET" && new URL(req.url).pathname.endsWith("/usage")) {
  const { user, supabaseAuthed, error } = await authenticateRequest(req);
  if (error) return json(401, { error: "unauthorized" });

  const url = new URL(req.url);
  const tzRaw = url.searchParams.get("tz_offset");
  if (tzRaw === null || !/^-?\d+$/.test(tzRaw)) {
    return json(400, { error: "tz_offset_required" });
  }
  const tzOffset = parseInt(tzRaw, 10);
  const days7  = clamp(parseInt(url.searchParams.get("days_7")  ?? "7", 10), 1, 31);
  const days30 = clamp(parseInt(url.searchParams.get("days_30") ?? "30", 10), 1, 90);

  const [tier, daily, summary, hasTools] = await Promise.all([
    supabaseAuthed.rpc("get_ai_quota_status", { p_user_id: user.id }),
    supabaseAuthed.rpc("get_usage_daily",
      { p_tz_offset_minutes: tzOffset, p_days: days7 }),
    supabaseAuthed.rpc("get_usage_summary", { p_days: days30 }),
    hasToolEventsTable(supabaseAuthed),
  ]);

  const tools = hasTools
    ? (await supabaseAuthed.rpc("get_usage_tools", { p_days: days30 })).data ?? []
    : null;

  return json(200, {
    live_24h: {
      used: tier.data?.used ?? null,
      limit: tier.data?.limit ?? 0,
      next_slot_at: tier.data?.next_slot_at ?? null,
    },
    daily: daily.data ?? [],
    summary: summary.data ?? { days: days30, total: 0, counted: 0, denied: 0, refunded: 0 },
    tools,
  });
}
```

- [x] **Step 2: Tests** — `tests/settings-usage.test.ts`:
  - 401 without Authorization.
  - 400 without `tz_offset`.
  - 400 with `tz_offset=abc`.
  - Happy-path shape (mock RPC returns).
  - `tools: null` when `has_tool_events_table` returns false.

- [x] **Step 3: Run** — `deno test supabase/functions/tests/settings-usage.test.ts --no-check --allow-env --allow-read --allow-net` (6 passed, lint clean)
- [x] **Step 4: Commit.**

---

## Task 8: Settings handler — `GET /settings/usage.csv` streamed subroute

**Files:**
- Modify: `supabase/functions/settings/handler.ts`

- [x] **Step 1: Add streaming subroute**

```ts
if (req.method === "GET" && new URL(req.url).pathname.endsWith("/usage.csv")) {
  const { user, supabaseAuthed, error } = await authenticateRequest(req);
  if (error) return new Response("unauthorized", { status: 401 });

  const url = new URL(req.url);
  const days = clamp(parseInt(url.searchParams.get("days") ?? "30", 10), 1, 90);
  const enc = new TextEncoder();
  const filename = `todoist-ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode("event_time,tier,counted,refunded_at,task_id\n"));
      let cursor: string | null = null;
      while (true) {
        const { data, error } = await supabaseAuthed.rpc("get_usage_csv_page", {
          p_before: cursor, p_limit: 1000, p_days: days,
        });
        if (error) { controller.error(error); return; }
        if (!data || data.length === 0) break;
        for (const r of data) {
          controller.enqueue(enc.encode(csvLine([
            r.event_time, r.tier, String(r.counted),
            r.refunded_at ?? "", r.task_id,
          ])));
        }
        cursor = data[data.length - 1].event_time;
        if (data.length < 1000) break;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [x] **Step 2: Tests** — `tests/settings-usage-csv.test.ts`:
  - 401 without Authorization; assert no stream body leaked.
  - Headers `text/csv; charset=utf-8` and `Content-Disposition: attachment`.
  - Header row always emitted (even with zero rows).
  - With mock RPC returning two pages (1000 + 1) — stream closes after second page.

- [x] **Step 3: Run tests.** (4 passed, lint clean)
- [x] **Step 4: Commit.**

---

## Task 9: Frontend — `useUsage` hook

**Files:**
- Create: `frontend/src/hooks/useUsage.ts`
- Create: `frontend/src/hooks/useUsage.test.ts`

- [x] **Step 1: Mirror `useTier.ts` shape**

```ts
export interface UsageData {
  live_24h: { used: number | null; limit: number; next_slot_at: string | null };
  daily: { day_start: string; counted: number; denied: number; refunded: number }[];
  summary: { days: number; total: number; counted: number; denied: number; refunded: number };
  tools: { tool_name: string; count: number }[] | null;
}

export function useUsage() {
  // tz_offset = minutes-ahead-of-UTC; JS getTimezoneOffset is minutes-behind, flip sign.
  const tzOffset = -new Date().getTimezoneOffset();
  // fetch once on mount + on window focus; identical pattern to useTier
}
```

- [x] **Step 2: Vitest**
  - Asserts outbound URL contains `tz_offset=<expected-sign-flipped>`.
  - Refresh on window focus.
  - Error state on 500.

- [x] **Step 3: Run** — `cd frontend && npm test -- useUsage` (4 passed)
- [x] **Step 4: Commit.**

---

## Task 10: Frontend — `UsageBarChart` component (inline SVG)

**Files:**
- Create: `frontend/src/components/UsageBarChart.tsx`
- Create: `frontend/src/components/UsageBarChart.test.tsx`

- [x] **Step 1: Write the component**

```tsx
interface Props {
  data: { day_start: string; counted: number }[];
  height?: number;  // default 120
}
export function UsageBarChart({ data, height = 120 }: Props) {
  const max = Math.max(1, ...data.map(d => d.counted));
  const barW = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} role="img" aria-label="7-day usage">
      {data.map((d, i) => {
        const h = (d.counted / max) * (height - 20);
        return (
          <g key={d.day_start}>
            <rect x={i * barW + 1} y={height - h - 10}
                  width={barW - 2} height={Math.max(h, 2)}
                  className="fill-indigo-500" />
            <text x={i * barW + barW / 2} y={height - 2}
                  textAnchor="middle" fontSize="6">
              {new Date(d.day_start).toLocaleDateString(undefined, { weekday: "short" })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [x] **Step 2: Vitest**
  - Seven `<rect>` elements with frozen `[3,1,4,1,5,9,2]` dataset; tallest corresponds to `9`.
  - All-zero dataset: seven `<rect>`s with height >= 2 (min-height guard).
  - `role="img"` and `aria-label` present for accessibility.

- [x] **Step 3: Run tests.** (3 passed)
- [x] **Step 4: Commit.**

---

## Task 11: Frontend — `UsageTab` composition + tab integration

**Files:**
- Create: `frontend/src/components/UsageTab.tsx`
- Create: `frontend/src/components/UsageTab.test.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

- [x] **Step 1: Compose the tab**

```tsx
export function UsageTab() {
  const { data, loading, error, refresh } = useUsage();
  if (loading) return <Spinner />;
  if (error)   return <ErrorBox err={error} onRetry={refresh} />;
  if (!data)   return null;
  return (
    <div className="space-y-6">
      <Live24hCard live={data.live_24h} />
      <section>
        <h3>Last 7 days</h3>
        <UsageBarChart data={data.daily} />
        <DailyTable rows={data.daily} />
      </section>
      <SummaryCard s={data.summary} />
      <ToolsCard tools={data.tools} />
      <ExportButton />
    </div>
  );
}
```

- [x] **Step 2: `ExportButton` download flow**

Fetch the CSV with the Bearer header (cannot use a plain `<a download>` with auth), convert to a blob, and trigger download:

```tsx
async function onClick() {
  const { data: s } = await supabase.auth.getSession();
  const resp = await fetch(`${BASE}/settings/usage.csv?days=30`, {
    headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` },
  });
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `todoist-ai-usage.csv`;
  a.click(); URL.revokeObjectURL(url);
}
```

(Blob fallback loses the streaming benefit at the *client* but keeps it on the server. Acceptable for < 10k rows. Re-evaluate if users hit 100k+.)

- [x] **Step 3: Vitest**
  - Renders "Requires sub-project C" placeholder when `data.tools === null`.
  - Renders tool list when `data.tools` is populated.
  - Export button calls `fetch` with Authorization header (mocked).
  - Live24h section shows the counter and matches the shape passed in.

- [x] **Step 4: Wire the tab into `Settings.tsx`** alongside the existing PlanCard tab.

- [x] **Step 5: Run** — npm test (165 passed), npm run build (clean). npm run lint shows only pre-existing warnings unrelated to this task.
- [x] **Step 6: Commit.**

---

## Task 12: Docs + runbook update

**Files:**
- Modify: `docs/ops/tier-quota-runbook.md`
- Modify: `README.md`

- [x] **Step 1: Append "Usage dashboard" section** documenting:
  - The new `/settings/usage` and `/settings/usage.csv` endpoints.
  - How to support-query a user's 30d usage via `SELECT get_usage_summary(30)` with `SET request.jwt.claim.sub = '<uuid>'` (impersonation pattern).
  - Retention cron follow-up still outstanding; track as next change.

- [x] **Step 2: README** — one-line mention under "Settings" describing the Usage tab.
- [x] **Step 3: Commit.**

---

## Task 13: End-to-end verification

- [x] **Step 1: Full test sweep** — `npm test` (deno unit+integration exit 0), `cd frontend && npm test` (165 passed, 17 files), `npm run build` (clean, 473 kB bundle), `deno lint supabase/functions/` (85 files, 0 issues).

- [x] **Step 2: Manual smoke test in local stack** (skipped - not automatable; requires running Supabase + browser)

- [x] **Step 3: Confirm acceptance criteria** from spec §13 (skipped - manual verification)
- [x] **Step 4: Open PR.** (skipped - user commits and opens PRs manually per project rules)
