import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type Tier = "free" | "pro" | "byok";

export interface TierData {
  tier: Tier | null;
  used: number | null;
  limit: number;
  next_slot_at: string | null;
  pro_until: string | null;
}

export interface UseTierState {
  data: TierData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings/tier`
  : "/functions/v1/settings/tier";

export function useTier(): UseTierState {
  const [data, setData] = useState<TierData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTier = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token ?? "";
      const resp = await fetch(FUNCTIONS_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setData((await resp.json()) as TierData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTier();
  }, []);

  useEffect(() => {
    const onFocus = () => {
      fetchTier();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return { data, loading, error, refresh: fetchTier };
}
