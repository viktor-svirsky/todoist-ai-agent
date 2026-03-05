-- Account blocking
ALTER TABLE users_config ADD COLUMN is_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE users_config ADD COLUMN disabled_reason text DEFAULT NULL;

-- Usage statistics
ALTER TABLE users_config ADD COLUMN total_webhook_requests int NOT NULL DEFAULT 0;
ALTER TABLE users_config ADD COLUMN total_settings_requests int NOT NULL DEFAULT 0;
ALTER TABLE users_config ADD COLUMN last_webhook_at timestamptz DEFAULT NULL;
ALTER TABLE users_config ADD COLUMN last_settings_at timestamptz DEFAULT NULL;

-- Drop old functions (return type may differ)
DROP FUNCTION IF EXISTS check_rate_limit(text, int, int);
DROP FUNCTION IF EXISTS check_rate_limit_by_uuid(uuid, int, int);

-- Recreate check_rate_limit with blocking + usage stats
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_todoist_id text,
  p_max_requests int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_disabled boolean;
  v_count int;
  v_prev int;
  v_reset timestamptz;
  v_max int;
  v_effective numeric;
  v_remaining numeric;
  v_retry int;
BEGIN
  -- Atomically: check disabled, increment stats, rotate window
  UPDATE users_config
  SET
    total_webhook_requests = total_webhook_requests + 1,
    last_webhook_at = now(),
    rate_limit_prev_count = CASE
      WHEN rate_limit_reset_at <= now() THEN rate_limit_count
      ELSE rate_limit_prev_count
    END,
    rate_limit_count = CASE
      WHEN rate_limit_reset_at <= now() THEN 1
      ELSE LEAST(rate_limit_count + 1, COALESCE(rate_limit_max_requests, p_max_requests) + 1)
    END,
    rate_limit_reset_at = CASE
      WHEN rate_limit_reset_at <= now() THEN now() + (p_window_seconds || ' seconds')::interval
      ELSE rate_limit_reset_at
    END
  WHERE todoist_user_id = p_user_todoist_id
  RETURNING
    is_disabled,
    rate_limit_count,
    rate_limit_prev_count,
    rate_limit_reset_at,
    COALESCE(rate_limit_max_requests, p_max_requests)
  INTO v_disabled, v_count, v_prev, v_reset, v_max;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'blocked', false, 'retry_after', p_window_seconds);
  END IF;

  -- Check if account is disabled
  IF v_disabled THEN
    RETURN jsonb_build_object('allowed', false, 'blocked', true, 'retry_after', 0);
  END IF;

  -- Sliding window: weight previous window by remaining fraction
  v_remaining := GREATEST(EXTRACT(EPOCH FROM v_reset - now()), 0);
  v_effective := v_prev * (v_remaining / p_window_seconds) + v_count;

  IF v_effective > v_max THEN
    v_retry := GREATEST(CEIL(v_remaining), 1);
    RETURN jsonb_build_object('allowed', false, 'blocked', false, 'retry_after', v_retry);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'blocked', false, 'retry_after', 0);
END;
$$;

-- Recreate check_rate_limit_by_uuid with blocking + usage stats
CREATE OR REPLACE FUNCTION check_rate_limit_by_uuid(
  p_user_id uuid,
  p_max_requests int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_disabled boolean;
  v_count int;
  v_prev int;
  v_reset timestamptz;
  v_effective numeric;
  v_remaining numeric;
  v_retry int;
BEGIN
  UPDATE users_config
  SET
    total_settings_requests = total_settings_requests + 1,
    last_settings_at = now(),
    settings_rl_prev = CASE
      WHEN settings_rl_reset_at <= now() THEN settings_rl_count
      ELSE settings_rl_prev
    END,
    settings_rl_count = CASE
      WHEN settings_rl_reset_at <= now() THEN 1
      ELSE LEAST(settings_rl_count + 1, p_max_requests + 1)
    END,
    settings_rl_reset_at = CASE
      WHEN settings_rl_reset_at <= now() THEN now() + (p_window_seconds || ' seconds')::interval
      ELSE settings_rl_reset_at
    END
  WHERE id = p_user_id
  RETURNING
    is_disabled,
    settings_rl_count,
    settings_rl_prev,
    settings_rl_reset_at
  INTO v_disabled, v_count, v_prev, v_reset;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'blocked', false, 'retry_after', p_window_seconds);
  END IF;

  IF v_disabled THEN
    RETURN jsonb_build_object('allowed', false, 'blocked', true, 'retry_after', 0);
  END IF;

  v_remaining := GREATEST(EXTRACT(EPOCH FROM v_reset - now()), 0);
  v_effective := v_prev * (v_remaining / p_window_seconds) + v_count;

  IF v_effective > p_max_requests THEN
    v_retry := GREATEST(CEIL(v_remaining), 1);
    RETURN jsonb_build_object('allowed', false, 'blocked', false, 'retry_after', v_retry);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'blocked', false, 'retry_after', 0);
END;
$$;
