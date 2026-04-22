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

-- Atomically claim a quota slot for a user + derive tier.
-- Returns jsonb with: allowed, blocked, tier, used, limit, next_slot_at, should_notify, event_id.
CREATE OR REPLACE FUNCTION claim_ai_quota(
  p_user_id uuid,
  p_task_id text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row        users_config%ROWTYPE;
  v_tier       text;
  v_limit      int;
  v_used       int;
  v_allowed    boolean;
  v_oldest     timestamptz;
  v_next_slot  timestamptz;
  v_notify     boolean := false;
  v_free_max   int;
  v_window     interval := interval '24 hours';
  v_event_id   bigint;
BEGIN
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false, 'blocked', false, 'tier', NULL,
      'used', 0, 'limit', 0, 'next_slot_at', NULL,
      'should_notify', false, 'event_id', NULL, 'error', 'no_user'
    );
  END IF;

  IF v_row.is_disabled THEN
    RETURN jsonb_build_object(
      'allowed', false, 'blocked', true, 'tier', NULL,
      'used', 0, 'limit', 0, 'next_slot_at', NULL,
      'should_notify', false, 'event_id', NULL
    );
  END IF;

  v_tier := CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;

  BEGIN
    v_free_max := current_setting('app.ai_quota_free_max')::int;
    IF v_free_max IS NULL OR v_free_max <= 0 THEN
      v_free_max := 5;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_free_max := 5;
  END;

  v_limit := CASE v_tier WHEN 'free' THEN v_free_max ELSE -1 END;

  IF v_limit > 0 THEN
    SELECT COUNT(*), MIN(event_time)
    INTO v_used, v_oldest
    FROM ai_request_events
    WHERE user_id = p_user_id
      AND counted = true
      AND event_time > now() - v_window;

    v_allowed   := v_used < v_limit;
    v_next_slot := CASE
      WHEN v_oldest IS NOT NULL THEN v_oldest + v_window
      ELSE now() + v_window
    END;
  ELSE
    v_used      := NULL;
    v_allowed   := true;
    v_next_slot := NULL;
  END IF;

  INSERT INTO ai_request_events (
    user_id, todoist_user_id, task_id, tier, counted
  ) VALUES (
    p_user_id, v_row.todoist_user_id, p_task_id, v_tier, v_allowed
  ) RETURNING id INTO v_event_id;

  IF NOT v_allowed THEN
    UPDATE users_config
    SET ai_quota_denied_notified_at = now()
    WHERE id = p_user_id
      AND (ai_quota_denied_notified_at IS NULL
           OR ai_quota_denied_notified_at < now() - v_window)
    RETURNING true INTO v_notify;
    v_notify := COALESCE(v_notify, false);
  END IF;

  RETURN jsonb_build_object(
    'allowed',       v_allowed,
    'blocked',       false,
    'tier',          v_tier,
    'used',          v_used,
    'limit',         v_limit,
    'next_slot_at',  v_next_slot,
    'should_notify', v_notify,
    'event_id',      v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION refund_ai_quota(p_event_id bigint)
RETURNS void LANGUAGE sql AS $$
  UPDATE ai_request_events SET counted = false
  WHERE id = p_event_id AND counted = true;
$$;

-- Read-only: current tier + rolling-window usage. Does not insert events.
CREATE OR REPLACE FUNCTION get_ai_quota_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row        users_config%ROWTYPE;
  v_tier       text;
  v_limit      int;
  v_used       int;
  v_oldest     timestamptz;
  v_next_slot  timestamptz;
  v_free_max   int;
  v_window     interval := interval '24 hours';
BEGIN
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tier', NULL, 'used', 0, 'limit', 0,
      'next_slot_at', NULL, 'pro_until', NULL
    );
  END IF;

  v_tier := CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;

  BEGIN
    v_free_max := current_setting('app.ai_quota_free_max')::int;
    IF v_free_max IS NULL OR v_free_max <= 0 THEN
      v_free_max := 5;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_free_max := 5;
  END;

  v_limit := CASE v_tier WHEN 'free' THEN v_free_max ELSE -1 END;

  IF v_limit > 0 THEN
    SELECT COUNT(*), MIN(event_time) INTO v_used, v_oldest
    FROM ai_request_events
    WHERE user_id = p_user_id
      AND counted = true
      AND event_time > now() - v_window;
    v_next_slot := CASE
      WHEN v_oldest IS NOT NULL THEN v_oldest + v_window
      ELSE NULL
    END;
  ELSE
    v_used      := NULL;
    v_next_slot := NULL;
  END IF;

  RETURN jsonb_build_object(
    'tier',         v_tier,
    'used',         v_used,
    'limit',        v_limit,
    'next_slot_at', v_next_slot,
    'pro_until',    CASE WHEN v_tier = 'pro' THEN v_row.pro_until ELSE NULL END
  );
END;
$$;
