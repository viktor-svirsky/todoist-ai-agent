import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export interface UsageLive24h {
  used: number | null;
  limit: number;
  next_slot_at: string | null;
}

export interface UsageDailyRow {
  day_start: string;
  counted: number;
  denied: number;
  refunded: number;
}

export interface UsageSummary {
  days: number;
  total: number;
  counted: number;
  denied: number;
  refunded: number;
}

export interface UsageToolRow {
  tool_name: string;
  count: number;
}

export interface UsageData {
  live_24h: UsageLive24h;
  daily: UsageDailyRow[];
  summary: UsageSummary;
  tools: UsageToolRow[] | null;
}

export interface UseUsageState {
  data: UsageData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings/usage`
  : "/functions/v1/settings/usage";

export function useUsage(): UseUsageState {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  // Track the latest in-flight request so concurrent/stale responses can be
  // aborted and their setState calls dropped on unmount.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchUsage = async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) setLoading(true);
    try {
      // tz_offset: minutes ahead of UTC. JS getTimezoneOffset() is minutes behind UTC, so flip sign.
      const tzOffset = -new Date().getTimezoneOffset();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token ?? "";
      const url = `${FUNCTIONS_BASE}?tz_offset=${tzOffset}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as UsageData;
      if (controller.signal.aborted || !mountedRef.current) return;
      setData(json);
      setError(null);
    } catch (e) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setData(null);
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchUsage();
    const onFocus = () => {
      fetchUsage();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { data, loading, error, refresh: fetchUsage };
}
