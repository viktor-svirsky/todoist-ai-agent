-- Enable RLS on processed_events to prevent direct access via anon/authenticated roles.
-- Only service_role (used by Edge Functions) can access this table.

ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;

-- Optimise try_claim_event: remove inline cleanup to avoid lock contention.
-- Cleanup should be handled by a scheduled job (pg_cron) or application-level cron.
CREATE OR REPLACE FUNCTION try_claim_event(p_event_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO processed_events (event_id) VALUES (p_event_id)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

-- Scheduled cleanup function (can be called via pg_cron or application cron)
CREATE OR REPLACE FUNCTION cleanup_processed_events()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM processed_events WHERE created_at < now() - interval '1 hour';
END;
$$;
