-- supabase/migrations/00010_tier_and_ai_quota.sql
-- Monetization sub-project A: tier model + AI-message quota.
-- Spec: docs/superpowers/specs/2026-04-21-tier-quota-design.md

-- Pro tier state (null = not Pro).
ALTER TABLE users_config
  ADD COLUMN pro_until timestamptz DEFAULT NULL;

CREATE INDEX users_config_pro_until_idx
  ON users_config (pro_until) WHERE pro_until IS NOT NULL;

-- Last time we posted an upsell reply (dedupe notifications).
ALTER TABLE users_config
  ADD COLUMN ai_quota_denied_notified_at timestamptz DEFAULT NULL;

-- Exact per-event log for rolling-window quota.
CREATE TABLE ai_request_events (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users_config(id) ON DELETE CASCADE,
  todoist_user_id text NOT NULL,
  task_id         text,
  tier            text NOT NULL CHECK (tier IN ('free','pro','byok')),
  counted         boolean NOT NULL,
  event_time      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_request_events_user_time_counted_idx
  ON ai_request_events (user_id, event_time DESC)
  WHERE counted = true;

CREATE INDEX ai_request_events_user_time_all_idx
  ON ai_request_events (user_id, event_time DESC);

-- RLS: service-role only.
ALTER TABLE ai_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_request_events_deny_all ON ai_request_events
  FOR ALL USING (false) WITH CHECK (false);
