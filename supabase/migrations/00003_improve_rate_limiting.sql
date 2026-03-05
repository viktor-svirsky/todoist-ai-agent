-- Sliding window support: previous window count
ALTER TABLE users_config ADD COLUMN rate_limit_prev_count int NOT NULL DEFAULT 0;

-- Per-user rate limit override (NULL = use global default)
ALTER TABLE users_config ADD COLUMN rate_limit_max_requests int DEFAULT NULL;

-- Separate settings endpoint rate limit counters
ALTER TABLE users_config ADD COLUMN settings_rl_count int NOT NULL DEFAULT 0;
ALTER TABLE users_config ADD COLUMN settings_rl_prev int NOT NULL DEFAULT 0;
ALTER TABLE users_config ADD COLUMN settings_rl_reset_at timestamptz NOT NULL DEFAULT now();

-- Replace check_rate_limit: sliding window, returns jsonb with retry_after
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_todoist_id text,
  p_max_requests int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
  v_prev int;
  v_reset timestamptz;
  v_max int;
  v_effective numeric;
  v_remaining numeric;
  v_retry int;
BEGIN
  -- Atomically rotate window and increment counter
  UPDATE users_config
  SET
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
    rate_limit_count,
    rate_limit_prev_count,
    rate_limit_reset_at,
    COALESCE(rate_limit_max_requests, p_max_requests)
  INTO v_count, v_prev, v_reset, v_max;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after', p_window_seconds);
  END IF;

  -- Sliding window: weight previous window by remaining fraction
  v_remaining := GREATEST(EXTRACT(EPOCH FROM v_reset - now()), 0);
  v_effective := v_prev * (v_remaining / p_window_seconds) + v_count;

  IF v_effective > v_max THEN
    v_retry := GREATEST(CEIL(v_remaining), 1);
    RETURN jsonb_build_object('allowed', false, 'retry_after', v_retry);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;

-- New function for settings endpoint (uses uuid, separate counters)
CREATE OR REPLACE FUNCTION check_rate_limit_by_uuid(
  p_user_id uuid,
  p_max_requests int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
  v_prev int;
  v_reset timestamptz;
  v_effective numeric;
  v_remaining numeric;
  v_retry int;
BEGIN
  UPDATE users_config
  SET
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
    settings_rl_count,
    settings_rl_prev,
    settings_rl_reset_at
  INTO v_count, v_prev, v_reset;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after', p_window_seconds);
  END IF;

  v_remaining := GREATEST(EXTRACT(EPOCH FROM v_reset - now()), 0);
  v_effective := v_prev * (v_remaining / p_window_seconds) + v_count;

  IF v_effective > p_max_requests THEN
    v_retry := GREATEST(CEIL(v_remaining), 1);
    RETURN jsonb_build_object('allowed', false, 'retry_after', v_retry);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;
