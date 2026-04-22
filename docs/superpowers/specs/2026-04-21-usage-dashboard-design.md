# Usage Dashboard — Design Spec

**Sub-project:** E of monetization (5 of 5).
**Date:** 2026-04-21.
**Status:** Approved for implementation planning.
**Depends on:** sub-project A (tier + quota; `ai_request_events` table + `get_ai_quota_status` RPC).
**Optionally integrates with:** sub-project C (tool-event telemetry) — tool-breakdown panel is gated on availability.
**Blocks:** none.

## 1. Goal

Give signed-in users a transparent view of their own AI usage so they can (a) self-diagnose "why was I throttled?", (b) understand their consumption shape ahead of an eventual Pro upgrade decision, and (c) export raw rows for their own records. No admin / cross-user views. No billing data. No new write paths — the dashboard is a read-only projection of the existing `ai_request_events` log.

Non-goals:
- Cross-user aggregates or admin analytics.
- Real-time streaming / websocket updates.
- Cost dollars (sub-project B owns pricing).
- Retention cron (tracked here but deferred — see §13).

## 2. Scope

A new "Usage" tab inside Settings, sibling to the existing "Plan" card. The tab renders four sections, top-to-bottom:

1. **Last 24h rolling count** — reuses the live quota figure exposed by `GET /settings/tier`. Single number, matches PlanCard exactly; no drift.
2. **Last 7 days** — per-day *counted* event count, shown as a 7-bar SVG chart plus a text table (date, count). Day buckets computed server-side in the user's browser timezone (offset passed in from client).
3. **Last 30 days summary** — one row: total attempts, counted, denied, refunded. No chart.
4. **Top tools (last 30 days)** — gated on presence of `tool_events` table (sub-project C). If table missing, render a "Requires sub-project C" placeholder with a disabled empty state; otherwise show top-5 tool names + invocation counts.

Plus:
5. **CSV export button** — downloads last 30 days of per-event rows for the signed-in user via `GET /settings/usage.csv`, streamed.

## 3. Data model

### 3.1 Existing (from sub-project A, unchanged)

```sql
CREATE TABLE ai_request_events (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users_config(id) ON DELETE CASCADE,
  todoist_user_id text NOT NULL,
  task_id         text,
  tier            text NOT NULL CHECK (tier IN ('free','pro','byok')),
  counted         boolean NOT NULL,
  event_time      timestamptz NOT NULL DEFAULT now()
);

-- Existing indexes cover the queries we need:
--   ai_request_events_user_time_counted_idx  (user_id, event_time DESC) WHERE counted = true
--   ai_request_events_user_time_all_idx      (user_id, event_time DESC)
```

RLS: service-role only. No user-facing direct-table access. All reads go through `SECURITY DEFINER` functions (see §3.3).

### 3.2 Distinguishing denied vs. refunded

`counted = false` is produced by two paths:
- **Denied** at claim time (quota exhausted / `is_disabled`): row inserted with `counted = false` directly.
- **Refunded** post-claim (AI pipeline exception before reply posted): row existed with `counted = true`, then flipped to `false` by `refund_ai_quota`.

Sub-project A intentionally did not add a `refunded_at` column; the spec notes this as a future addition if analytics needs it. For the dashboard's 30-day summary we need that distinction. Rather than break-change the write path, we add a **nullable** column in a new migration and populate going forward:

```sql
ALTER TABLE ai_request_events
  ADD COLUMN refunded_at timestamptz DEFAULT NULL;

CREATE INDEX ai_request_events_refunded_idx
  ON ai_request_events (user_id, refunded_at)
  WHERE refunded_at IS NOT NULL;
```

And update `refund_ai_quota` to set it:

```sql
CREATE OR REPLACE FUNCTION refund_ai_quota(p_event_id bigint)
RETURNS void LANGUAGE sql AS $$
  UPDATE ai_request_events
     SET counted     = false,
         refunded_at = now()
   WHERE id = p_event_id AND counted = true;
$$;
```

Historical rows (pre-migration) with `counted = false` AND `refunded_at IS NULL` are treated as **denied** in summaries — this is the correct semantic for the backfill window since refunds were rare during soak and the UI labels this cohort conservatively.

### 3.3 New SQL functions

All read functions use **`SECURITY DEFINER` with `auth.uid()` verified inside the function body**. We picked this over `SECURITY INVOKER`:

- `ai_request_events` RLS is deny-all (service-role only). `SECURITY INVOKER` would require loosening RLS, which widens the blast radius (any future function impersonating the user could read the table).
- `SECURITY DEFINER` keeps RLS closed while the function itself enforces the `user_id = auth.uid()` boundary explicitly in every query.
- We do **not** accept `p_user_id` as a parameter — the function calls `auth.uid()` internally, so a buggy caller cannot pass someone else's UUID. This matches the pattern used by BYOK-sensitive code elsewhere.

Functions are marked `STABLE` (no writes), `SECURITY DEFINER`, owned by `postgres`, executable by `authenticated` (not `anon`).

```sql
CREATE OR REPLACE FUNCTION get_usage_daily(
  p_tz_offset_minutes int,   -- e.g. -420 for PDT; clamped to [-840, 840]
  p_days              int    -- 1..31; clamped
) RETURNS TABLE (
  day_start timestamptz,     -- midnight in the user's local tz, returned as UTC
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
    SELECT date_trunc(
      'day',
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
    COUNT(*) FILTER (WHERE e.counted = true)::int                                   AS counted,
    COUNT(*) FILTER (WHERE e.counted = false AND e.refunded_at IS NULL)::int        AS denied,
    COUNT(*) FILTER (WHERE e.refunded_at IS NOT NULL)::int                          AS refunded
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

```sql
CREATE OR REPLACE FUNCTION get_usage_summary(
  p_days int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    'days',     v_days,
    'total',    v_total,
    'counted',  v_counted,
    'denied',   v_denied,
    'refunded', v_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_summary(int) TO authenticated;
```

## 4. Endpoints

All routes added to the existing `settings` Edge Function handler. Pattern matches the existing `GET /settings/tier` subroute — the handler validates the `Authorization: Bearer <access_token>` header via a user-scoped Supabase client, then invokes the RPC.

### 4.1 `GET /settings/usage`

Query params:
- `tz_offset` — signed integer, minutes offset from UTC (e.g. `-420` for PDT). Required. Rejected if absent or not parseable (400).
- `days_7` — optional, default 7, clamped 1..31.
- `days_30` — optional, default 30, clamped 1..90.

Response:
```json
{
  "live_24h": { "used": 3, "limit": 5, "next_slot_at": "2026-04-22T14:02:00Z" },
  "daily": [
    { "day_start": "2026-04-15T07:00:00Z", "counted": 2, "denied": 0, "refunded": 0 },
    ...
  ],
  "summary": { "days": 30, "total": 42, "counted": 38, "denied": 3, "refunded": 1 },
  "tools": null
}
```

- `live_24h`: lifted verbatim from `get_ai_quota_status` (not a re-query — handler calls the same RPC PlanCard uses, then trims fields). No drift between PlanCard and the Usage tab.
- `tools`: `null` when `tool_events` table missing; otherwise array of `{ tool_name, count }` (see §8 for the check).
- 401 when auth header missing / invalid.
- 400 when `tz_offset` missing / malformed.

### 4.2 `GET /settings/usage.csv`

Auth: same Bearer header as above.

Query params:
- `days` — optional, default 30, clamped 1..90.

Response: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="todoist-ai-usage-YYYY-MM-DD.csv"`.

Streamed via `ReadableStream` — the handler paginates `ai_request_events` in chunks of 1000 rows ordered by `event_time DESC` and writes CSV chunks to the stream as each page returns. The full result set is never buffered.

Implementation sketch:

```ts
return new Response(new ReadableStream({
  async start(controller) {
    controller.enqueue(encoder.encode(
      "event_time,tier,counted,refunded_at,task_id\n"
    ));
    let cursor: string | null = null;
    while (true) {
      const { data, error } = await supabase.rpc("get_usage_csv_page", {
        p_before: cursor, p_limit: 1000, p_days: days
      });
      if (error) { controller.error(error); return; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        controller.enqueue(encoder.encode(csvLine(r)));
      }
      cursor = data[data.length - 1].event_time;
      if (data.length < 1000) break;
    }
    controller.close();
  }
}), { headers: { "Content-Type": "text/csv; charset=utf-8", ... } });
```

Accompanying RPC (same `SECURITY DEFINER` + `auth.uid()` pattern):

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
```

## 5. Component tree

```
frontend/src/pages/Settings.tsx
  <Tabs>
    <PlanTab>       (existing)
    <UsageTab>      (new)
      <Live24hCard data={data.live_24h} />
      <Last7DaysCard data={data.daily} />
        <UsageBarChart data={data.daily} />    ← inline SVG, 120px tall
        <DailyTable data={data.daily} />
      <SummaryCard data={data.summary} />
      <ToolsCard data={data.tools} />          ← placeholder when null
      <ExportButton />                          ← triggers /settings/usage.csv download
```

New files:
- `frontend/src/hooks/useUsage.ts` — mirrors `useTier.ts` shape; adds `tzOffset` detected via `-new Date().getTimezoneOffset()`.
- `frontend/src/components/UsageBarChart.tsx` — pure SVG, no dep.
- `frontend/src/components/UsageTab.tsx` — composes the cards.
- Tests alongside each.

## 6. CSV format

```
event_time,tier,counted,refunded_at,task_id
2026-04-21T17:14:02.118Z,free,true,,task_abc123
2026-04-21T17:02:41.004Z,free,false,,task_xyz987
2026-04-20T09:51:00.220Z,free,false,2026-04-20T10:00:12Z,task_def456
```

- Header row always emitted, even if body is empty.
- ISO-8601 UTC timestamps. Client displays in local tz; file ships in UTC to avoid ambiguity when shared.
- `task_id` may be `null` — rendered as empty field.
- Fields containing `,` / `"` / `\n` are double-quote escaped with `""` doubling. `task_id` is the only free-form column; practically Todoist IDs never contain separators, but the encoder handles it defensively anyway.

## 7. Timezone handling

**Decision:** Browser-supplied **minute offset**, not IANA name. Rationale:

- Minute offset is O(1) to validate (clamp to [-840, +840]) and arithmetic-only in SQL (`make_interval(mins => v_off)`).
- IANA names (e.g. `America/Los_Angeles`) require `AT TIME ZONE 'name'`, meaning every user-supplied string hits Postgres's tz catalog. An unknown name raises `invalid_parameter_value` — an extra failure mode.
- The dashboard buckets by *local midnight*, which for a fixed 7-day window is indistinguishable between "current offset" and "historical offsets" for all but DST-crossing weeks. Users viewing during a DST transition may see one day that is 23 or 25 hours long in local terms — acceptable UI behaviour; a banner can note the transition in a future iteration.
- Client obtains it via `-new Date().getTimezoneOffset()` (note the sign flip: JS returns minutes-behind-UTC; we store minutes-ahead-of-UTC).

Passed as query parameter, not header — easier to log and reproduce.

## 8. Tool usage breakdown (gated)

At handler start, query `information_schema.tables` once per cold start (cached in module scope):

```ts
const hasToolEvents = await supabase.rpc("has_tool_events_table");
```

With SQL:

```sql
CREATE OR REPLACE FUNCTION has_tool_events_table()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_events'
  );
$$;
GRANT EXECUTE ON FUNCTION has_tool_events_table() TO authenticated;
```

When `true`, expose `get_usage_tools(p_days)` (same `SECURITY DEFINER` + `auth.uid()` pattern) returning top-5 tool names. When `false`, handler returns `"tools": null` and the frontend renders the "Requires sub-project C" placeholder. No frontend changes needed when C lands later — the handler response automatically starts populating.

## 9. Performance

Expected scale (pulled from sub-project A's cutover section):
- Current: 49 active users, max 19 lifetime AI requests per user, avg 2.2.
- 30-day max rows per user: bounded above by `limit × 30` for Free (`5 × 30 = 150`), unbounded for Pro/BYOK but realistically < 1000.

Query cost:
- `get_usage_daily(7d)`: index range-scan on `(user_id, event_time)` → ~35 rows max for Free, ~1000 for heavy Pro. `GROUP BY day_start` runs in memory.
- `get_usage_summary(30d)`: same index; 4 `FILTER` aggregates in one pass.
- `get_usage_csv_page`: keyset pagination on `(event_time DESC)` with `LIMIT 1000`; each page is O(log n) seek + O(1000) scan.

No new indexes needed beyond `ai_request_events_user_time_all_idx` (already present) and the new partial index on `refunded_at` (§3.2).

Edge-function overhead per usage tab load: 3 RPC calls (`get_ai_quota_status`, `get_usage_daily`, `get_usage_summary`). All three fire in parallel via `Promise.all` in the handler.

## 10. Privacy + RLS

- `ai_request_events` RLS stays deny-all.
- Every read function is `SECURITY DEFINER` and derives the user from `auth.uid()` — no parameter path to pass a different UUID.
- `EXECUTE` granted only to `authenticated`, not `anon`.
- CSV endpoint validates the Bearer token via `supabase.auth.getUser(token)` before opening the stream. A missing/expired token returns 401 before any row leaves the DB.
- Logs emitted by the handler include `user_id` (already stored) but never `task_id` contents or tier-transition events beyond what sub-project A already logs.

## 11. Caching

**Decision:** No client-side stale-while-revalidate. Fetch once on tab mount, once on `window.focus`, once after an explicit "Refresh" button click. Matches `useTier`'s pattern.

Rationale:
- Live-24h figure must match PlanCard exactly; serving stale numbers from SWR cache while PlanCard shows fresh ones produces exactly the "drift" this spec aims to avoid.
- Usage data is small (< 1KB JSON) and the query is cheap (see §9). A cache layer adds a failure mode (stale data shown, user confused) with no measurable win.
- CSV is always a fresh server-side stream; never cached by the SW.

If future scale demands change this, the hook is the single place to add `swr` or `react-query` later without touching endpoints.

## 12. Test strategy

### 12.1 SQL function tests (Deno integration, pattern from `ai-quota-sql.test.ts`)

- `get_usage_daily` with `auth.uid()` = user A cannot read user B's rows — attempt via JWT-as-A returns zeros for B's tasks.
- 7-day bucketing: insert events at `local_midnight - 1h`, `local_midnight + 1h`, different `tz_offset` values → assert bucket boundaries shift accordingly.
- `refunded_at` column: claim then refund → appears in `refunded` column, not `denied`.
- `get_usage_summary(30)`: total = counted + denied + refunded; all four FILTER clauses mutually exclusive.
- `get_usage_csv_page`: keyset pagination returns non-overlapping pages ordered DESC; asking for 1001 rows returns 1000.
- Clamps: `p_days = 999` returns 90-day result; `p_days = 0` returns 1-day; `p_tz_offset_minutes = 9999` clamps to 840.
- Unauthenticated call (no JWT) raises `42501`.

### 12.2 Handler tests (Deno, mocked `fetch`)

- `GET /settings/usage` without Authorization → 401.
- `GET /settings/usage` without `tz_offset` → 400.
- `GET /settings/usage.csv` without Authorization → 401 (no stream opened).
- CSV response header is `text/csv; charset=utf-8` with `Content-Disposition: attachment`.
- CSV body starts with exact header row `event_time,tier,counted,refunded_at,task_id\n`.
- When `tool_events` absent → response has `tools: null`; handler does not crash.

### 12.3 Frontend Vitest

- `UsageBarChart` renders 7 `<rect>` elements for a frozen 7-day dataset; max-height bar equals `Math.max(...data)` count.
- `UsageBarChart` renders 7 zero-height bars (or min-height placeholder) when all counts are 0.
- `UsageTab` renders "Requires sub-project C" placeholder when `data.tools === null`.
- `useUsage` sends `tz_offset = -(-new Date().getTimezoneOffset())` i.e. the minutes-ahead-of-UTC offset; mock `fetch` asserts the query string.
- Export button click triggers `window.location.assign` (or `<a download>`) to the CSV URL with the current Bearer token in a signed query param OR — since fetch with auth header can't be a plain `<a href>` — uses `fetch` + `Blob` + `URL.createObjectURL` flow. See implementation plan for the chosen approach.

### 12.4 Chart library decision

**Inline SVG, no new dependency.** A 7-bar chart is ~40 lines of JSX. Adding Recharts (56KB gzipped) for this is disproportionate. If sub-project C's tool breakdown later needs a donut or >20 categories, revisit.

## 13. Acceptance criteria

- [ ] `refunded_at` migration applies cleanly on fresh and production-snapshot DBs; existing `counted = false` rows remain (`refunded_at` stays `NULL`).
- [ ] `refund_ai_quota` populates `refunded_at` on new refunds; existing sub-project A tests still pass (idempotent, no double-flip).
- [ ] `get_usage_daily`, `get_usage_summary`, `get_usage_csv_page` all reject unauthenticated calls (raise `42501`).
- [ ] Cross-user isolation test: user A's JWT cannot retrieve user B's rows via any of the three functions.
- [ ] `GET /settings/usage` returns 400 when `tz_offset` is missing or non-integer; 401 when auth header is absent.
- [ ] `GET /settings/usage.csv` streams; memory usage stays flat while exporting 10,000 synthetic rows (manual soak).
- [ ] Live 24h number in Usage tab matches PlanCard byte-for-byte during a single page session.
- [ ] 7-day chart buckets respect user's local midnight as declared by `tz_offset`.
- [ ] Tools section renders "Requires sub-project C" placeholder in prod today (table does not yet exist).
- [ ] CSV header row present even when body is empty.
- [ ] All existing sub-project A tests continue to pass (`ai-quota-sql.test.ts`, `webhook-quota.test.ts`, `settings-tier.test.ts`).
- [ ] Vitest covers `UsageBarChart` frozen dataset, zero-state, and tools placeholder.

## 14. Design decisions

1. **Server-side aggregation for 7d + 30d.** Picked over client aggregation. Reasons: (a) the browser never receives individual event rows for aggregated views — a compromised frontend cannot leak more data than the aggregate itself; (b) the aggregate payload is ~500 bytes vs. ~50KB raw; (c) the 30-day bar chart would otherwise require loading ~1000 rows just to count them. Raw rows only travel over the CSV endpoint, which the user explicitly requests. Second-opinion skill consulted: concurs on privacy-first framing.
2. **Timezone via minute offset, not IANA name.** See §7. Avoids a tz-catalog-lookup failure mode; DST-crossing weeks are an acceptable UI wart for v1.
3. **SQL functions are `SECURITY DEFINER` + `auth.uid()` internally.** See §3.3. Picked over `SECURITY INVOKER` because `ai_request_events` stays deny-all under RLS. `p_user_id` is never a parameter — callers cannot spoof it.
4. **No client-side SWR / caching.** See §11. Live-24h figure must equal PlanCard's; stale caches reintroduce drift. Explicit refresh + focus-refetch covers the UX need.
5. **Chart library: inline SVG, no dependency.** See §12.4. Recharts is 56KB gzipped for what is literally 7 rects + 7 labels.
6. **`refunded_at` as additive column, not a new table.** Preserves the append-only event-log invariant; a join against a separate refund-log table would need a view just to restore the shape we already have. Second-opinion skill consulted: concurs.
7. **CSV streaming via `ReadableStream` + keyset pagination.** Chosen over `OFFSET` pagination (O(n) scan per page on large sets) and over `COPY TO STDOUT` (no direct handle from PostgREST / Edge Function). Keyset on `(event_time DESC, id DESC)` would be strictly correct for ties; for a single user's event stream the timestamp collision probability is negligible (bigserial auto-ordered inserts), so we simplify to `event_time` alone.

## 15. Dependencies

- **Requires:** sub-project A merged (table + existing RPCs). ✓ Already merged.
- **Optional integration:** sub-project C (tool events). Gated via `has_tool_events_table()` function; no hard dep.
- **Deferred out of E into a future sub-project:** retention cron that deletes `ai_request_events` older than 90 days. Currently tracked in sub-project A §10 as owned by E; deferring again because (a) current scale (≤150 rows/day project-wide) makes the table trivially small, (b) the cron needs an ops runbook for pause/resume that belongs in its own change. Tracked as a follow-up in `docs/ops/tier-quota-runbook.md`.
