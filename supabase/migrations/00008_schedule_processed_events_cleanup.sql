-- Schedule periodic cleanup of processed_events to prevent unbounded growth (#139).
-- Uses pg_cron (available on Supabase) to run every hour.

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Schedule hourly cleanup
SELECT cron.schedule(
  'cleanup-processed-events',
  '0 * * * *',  -- every hour at minute 0
  $$SELECT cleanup_processed_events()$$
);
