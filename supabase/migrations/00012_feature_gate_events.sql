-- supabase/migrations/00012_feature_gate_events.sql
-- Monetization sub-project C: feature gating telemetry + tier read RPC.
-- Spec: docs/superpowers/specs/2026-04-21-feature-gating-design.md

CREATE TABLE feature_gate_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users_config(id) ON DELETE CASCADE,
  tier        text NOT NULL CHECK (tier IN ('free','pro','byok')),
  feature     text NOT NULL CHECK (feature IN (
                'web_search','todoist_tools','custom_prompt','model_override'
              )),
  action      text NOT NULL CHECK (action IN (
                'allowed','filtered','silently_ignored','write_rejected'
              )),
  event_time  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feature_gate_events_feature_tier_time_idx
  ON feature_gate_events (feature, tier, event_time DESC);

CREATE INDEX feature_gate_events_user_time_idx
  ON feature_gate_events (user_id, event_time DESC);

ALTER TABLE feature_gate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_gate_events_deny_all ON feature_gate_events
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION get_user_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v_row users_config%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION log_feature_gate_event(
  p_user_id uuid, p_tier text, p_feature text, p_action text
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO feature_gate_events (user_id, tier, feature, action)
  VALUES (p_user_id, p_tier, p_feature, p_action);
$$;
