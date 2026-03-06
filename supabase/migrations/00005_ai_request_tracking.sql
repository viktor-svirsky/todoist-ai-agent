-- Track webhooks that actually trigger AI processing (pass all filters)
ALTER TABLE users_config ADD COLUMN total_ai_requests int NOT NULL DEFAULT 0;
ALTER TABLE users_config ADD COLUMN last_ai_request_at timestamptz DEFAULT NULL;

-- Atomic increment for AI request counter
CREATE OR REPLACE FUNCTION increment_ai_requests(p_todoist_user_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE users_config
  SET
    total_ai_requests = total_ai_requests + 1,
    last_ai_request_at = now()
  WHERE todoist_user_id = p_todoist_user_id;
END;
$$;
