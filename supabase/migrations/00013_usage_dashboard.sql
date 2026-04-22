-- Monetization sub-project E: usage dashboard.
-- Spec: docs/superpowers/specs/2026-04-21-usage-dashboard-design.md

ALTER TABLE ai_request_events
  ADD COLUMN refunded_at timestamptz DEFAULT NULL;

CREATE INDEX ai_request_events_refunded_idx
  ON ai_request_events (user_id, refunded_at)
  WHERE refunded_at IS NOT NULL;

-- Usage dashboard queries filter by user_id and event_time (daily buckets,
-- summary window, CSV keyset). Without this index they seq-scan as the table
-- grows.
CREATE INDEX IF NOT EXISTS ai_request_events_user_time_idx
  ON ai_request_events (user_id, event_time DESC);

CREATE OR REPLACE FUNCTION refund_ai_quota(p_event_id bigint)
RETURNS void LANGUAGE sql AS $$
  UPDATE ai_request_events
     SET counted     = false,
         refunded_at = now()
   WHERE id = p_event_id AND counted = true;
$$;

-- Defense in depth: refund is a service-role-only path (called from the
-- webhook handler when a reply fails to post). Deny execution to anon and
-- authenticated roles so a future permissive policy on ai_request_events
-- cannot turn this into "refund any event by guessed id".
REVOKE EXECUTE ON FUNCTION refund_ai_quota(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_ai_quota(bigint) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION get_usage_daily(
  p_tz_offset_minutes int,
  p_days              int
) RETURNS TABLE (
  day_start timestamptz,
  counted   int,
  denied    int,
  refunded  int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_off   int  := GREATEST(LEAST(COALESCE(p_tz_offset_minutes, 0), 840), -840);
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 7), 31), 1);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH bounds AS (
    SELECT date_trunc('day',
             (now() AT TIME ZONE 'UTC') + make_interval(mins => v_off)
           ) - make_interval(mins => v_off) AS today_start
  ),
  series AS (
    SELECT generate_series(
      (SELECT today_start FROM bounds) - make_interval(days => v_days - 1),
      (SELECT today_start FROM bounds),
      interval '1 day'
    ) AS day_start
  )
  SELECT
    s.day_start,
    COUNT(*) FILTER (WHERE e.counted = true)::int,
    COUNT(*) FILTER (WHERE e.counted = false AND e.refunded_at IS NULL)::int,
    COUNT(*) FILTER (WHERE e.refunded_at IS NOT NULL)::int
  FROM series s
  LEFT JOIN ai_request_events e
    ON e.user_id = v_uid
   AND e.event_time >= s.day_start
   AND e.event_time <  s.day_start + interval '1 day'
  GROUP BY s.day_start
  ORDER BY s.day_start;
END;
$$;

REVOKE ALL ON FUNCTION get_usage_daily(int, int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_daily(int, int) TO authenticated;

CREATE OR REPLACE FUNCTION get_usage_summary(p_days int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 30), 90), 1);
  v_total int; v_counted int; v_denied int; v_refunded int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE counted = true)::int,
    COUNT(*) FILTER (WHERE counted = false AND refunded_at IS NULL)::int,
    COUNT(*) FILTER (WHERE refunded_at IS NOT NULL)::int
  INTO v_total, v_counted, v_denied, v_refunded
  FROM ai_request_events
  WHERE user_id = v_uid
    AND event_time > now() - make_interval(days => v_days);
  RETURN jsonb_build_object(
    'days', v_days, 'total', v_total, 'counted', v_counted,
    'denied', v_denied, 'refunded', v_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_summary(int) TO authenticated;

CREATE OR REPLACE FUNCTION get_usage_csv_page(
  p_before    timestamptz,
  p_before_id bigint,
  p_limit     int,
  p_days      int
) RETURNS TABLE (
  id          bigint,
  event_time  timestamptz,
  tier        text,
  counted     boolean,
  refunded_at timestamptz,
  task_id     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int  := GREATEST(LEAST(COALESCE(p_limit, 1000), 1000), 1);
  v_days  int  := GREATEST(LEAST(COALESCE(p_days, 30), 90), 1);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  -- Keyset on (event_time DESC, id DESC) so rows sharing an event_time are
  -- not dropped at page boundaries.
  RETURN QUERY
  SELECT e.id, e.event_time, e.tier, e.counted, e.refunded_at, e.task_id
  FROM ai_request_events e
  WHERE e.user_id = v_uid
    AND e.event_time > now() - make_interval(days => v_days)
    AND (
      p_before IS NULL
      OR e.event_time < p_before
      OR (e.event_time = p_before AND p_before_id IS NOT NULL AND e.id < p_before_id)
    )
  ORDER BY e.event_time DESC, e.id DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION get_usage_csv_page(timestamptz, bigint, int, int) FROM public;
GRANT EXECUTE ON FUNCTION get_usage_csv_page(timestamptz, bigint, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION has_tool_events_table()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_events'
  );
$$;
GRANT EXECUTE ON FUNCTION has_tool_events_table() TO authenticated;
