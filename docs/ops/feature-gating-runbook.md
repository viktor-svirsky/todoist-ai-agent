# Feature Gating Runbook

_Monetization sub-project C — operational reference._

Spec: `docs/superpowers/specs/2026-04-21-feature-gating-design.md`

## Gate matrix

| Gate ID | Feature | Free | Pro | BYOK |
|---------|---------|------|-----|------|
| G1 | `web_search` tool | filtered | allowed | allowed |
| G2 | Todoist tools | read-only (`list_tasks`, `list_projects`, `list_labels`) | full | full |
| G3 | `custom_prompt` appended to system prompt | silently ignored | applied | applied |
| G4 | `custom_ai_model` override | rejected on write (409); ignored at runtime | ignored at runtime | applied |

Tier derivation is SQL-only: BYOK (non-empty `custom_ai_api_key`) > Pro (`pro_until > now()`) > Free.

## Disable gates globally (kill switch)

Set the env var on the Edge Function runtime:

```
FEATURE_GATES_ENABLED=false
```

When false, `resolveFeatureGates` returns the full capability set for every tier. Telemetry continues (harmless). No DB changes required. Flip back to `true` (or unset) to re-enable.

## Telemetry queries

Per-feature action mix, last 24h:

```sql
SELECT feature, action, tier, count(*)
FROM feature_gate_events
WHERE event_time > now() - interval '24 hours'
GROUP BY feature, action, tier
ORDER BY feature, tier, action;
```

Conversion signal — Free users hitting `web_search` filter:

```sql
SELECT date_trunc('hour', event_time) AS hour, count(DISTINCT user_id)
FROM feature_gate_events
WHERE feature = 'web_search' AND action = 'filtered' AND tier = 'free'
  AND event_time > now() - interval '7 days'
GROUP BY 1 ORDER BY 1;
```

Per-user gate history (support debugging):

```sql
SELECT event_time, feature, action, tier
FROM feature_gate_events
WHERE user_id = '<uuid>'
ORDER BY event_time DESC LIMIT 50;
```

## Force-upgrade a user (support)

Same SQL as the tier-quota runbook:

```sql
UPDATE users_config
SET pro_until = now() + interval '1 month'
WHERE todoist_user_id = '<todoist_id>';
```

Gate resolution picks this up on the next request — no cache to bust.

## On-call signals

- Spike in `feature_gate_log_failed` / `feature_gate_log_threw` log lines — `log_feature_gate_event` RPC regressed. Harmless for users (logging is fire-and-forget) but analytics will under-count.
- Settings PATCH surge of `write_rejected` on `model_override` — frontend likely missing the "Requires your own AI key" helper or the 409 handler.
- Zero `web_search` rows for Free tier over a deploy boundary — G1 may be bypassed; re-check `resolveFeatureGates` wiring in `runAiForTask`.

## Rollback

1. `FEATURE_GATES_ENABLED=false` and redeploy the Edge Functions.
2. Revert the Edge Function deploy to the prior commit.
3. Revert migration `00012_feature_gate_events.sql` — drops `feature_gate_events`, `get_user_tier`, `log_feature_gate_event`.
