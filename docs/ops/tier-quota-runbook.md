# Tier Quota Runbook

_Monetization sub-project A — operational reference._

## Tiers

| Tier | Cap (24h rolling) | Notes |
|------|-------------------|-------|
| Free | 5 AI messages     | Default for every account without BYOK or Pro |
| Pro  | Unlimited         | Granted manually (pre-Stripe) via SQL; $5/month once launched |
| BYOK | Unlimited         | Any account with a non-empty `custom_ai_api_key` |

## Grant Pro manually

```sql
UPDATE users_config
SET pro_until = now() + interval '1 month'
WHERE todoist_user_id = '<todoist_id>';
```

## Revoke Pro

```sql
UPDATE users_config SET pro_until = NULL
WHERE todoist_user_id = '<todoist_id>';
```

## Reset an individual user's AI quota (support only)

```sql
DELETE FROM ai_request_events WHERE user_id = '<uuid>';
UPDATE users_config SET ai_quota_denied_notified_at = NULL WHERE id = '<uuid>';
```

## Change the Free limit globally

```sql
ALTER DATABASE postgres SET app.ai_quota_free_max = '10';
```

Invalid values (0, negative, missing) fall back to **5**. Never silently grants unlimited.

## Diagnosing denials

```sql
SELECT tier, counted, event_time, task_id
FROM ai_request_events
WHERE user_id = '<uuid>'
ORDER BY event_time DESC
LIMIT 20;
```

`counted = false` rows are denied or refunded events.

## On-call signals

- Spike in `ai_quota_rpc_failure` log events — DB likely slow or RPC regressed. Fail-closed is active, so users are denied silently. Investigate immediately.
- Spike in `ai_quota_denied` structured logs but zero conversion interest — upsell copy / frontend CTA likely broken.

## Usage dashboard (sub-project E)

Read-only Settings → Usage tab backed by `SECURITY DEFINER` RPCs scoped to `auth.uid()`.

### Endpoints

- `GET /settings/usage?tz_offset=<minutes>&days_7=7&days_30=30` — JSON. Combines `get_ai_quota_status` (live 24h), `get_usage_daily` (7-day buckets in caller's tz), `get_usage_summary` (30-day totals), and an optional tool breakdown if the `tool_events` table exists. `tz_offset` is required and is minutes-ahead-of-UTC (clamped to ±840).
- `GET /settings/usage.csv?days=30` — streamed CSV (`event_time,tier,counted,refunded_at,task_id`). Keyset paginated server-side (1000 rows/page), `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`.

Both subroutes validate the Authorization header via the Supabase user client (no Edge Function JWT verify).

### Support: pull a user's 30-day usage

Impersonate the user's JWT context inside a transaction so RLS + `auth.uid()` resolve correctly, then call the summary RPC:

```sql
BEGIN;
SET LOCAL request.jwt.claim.sub = '<user-uuid>';
SELECT get_usage_summary(30);
SELECT * FROM get_usage_daily(0, 7);
ROLLBACK;
```

`refunded_at` (added in migration `00014`) lets `get_usage_daily` separate **denied** (`counted=false AND refunded_at IS NULL`) from **refunded** (`refunded_at IS NOT NULL`). `refund_ai_quota(event_id)` now stamps both columns; replays remain idempotent (filter on `counted=true`).

### Outstanding follow-up

- **Retention cron** for `ai_request_events` is still pending. The CSV/dashboard read up to 90 days; once retention lands, document the trim cadence and update the day-cap clamps if needed.
