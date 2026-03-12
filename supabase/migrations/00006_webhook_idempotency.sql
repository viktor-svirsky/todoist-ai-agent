-- Webhook event deduplication to prevent duplicate AI responses.
-- Stores processed event IDs with auto-cleanup of old entries.

CREATE TABLE processed_events (
  event_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient cleanup of old entries
CREATE INDEX idx_processed_events_created_at ON processed_events (created_at);

-- Atomically try to claim an event for processing.
-- Returns true if this call claimed it (proceed), false if already claimed (skip).
CREATE OR REPLACE FUNCTION try_claim_event(p_event_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- Clean up events older than 1 hour (prevents unbounded growth)
  DELETE FROM processed_events WHERE created_at < now() - interval '1 hour';

  -- Try to insert; ON CONFLICT means it was already claimed
  INSERT INTO processed_events (event_id) VALUES (p_event_id)
  ON CONFLICT (event_id) DO NOTHING;

  RETURN FOUND;
END;
$$;

-- Also remove the unused webhook_secret column (issue #92)
ALTER TABLE users_config DROP COLUMN IF EXISTS webhook_secret;
