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
