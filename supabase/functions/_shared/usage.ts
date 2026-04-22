import { captureException } from "./sentry.ts";

interface RpcClient {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
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

export async function getUsageDaily(
  supabase: RpcClient,
  tzOffsetMinutes: number,
  days: number,
): Promise<UsageDailyRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_usage_daily", {
      p_tz_offset_minutes: tzOffsetMinutes,
      p_days: days,
    });
    if (error) {
      console.error("get_usage_daily RPC failed", { error });
      await captureException(error);
      return [];
    }
    return (data as UsageDailyRow[] | null) ?? [];
  } catch (e) {
    console.error("get_usage_daily threw", { error: e });
    await captureException(e);
    return [];
  }
}

export async function getUsageSummary(
  supabase: RpcClient,
  days: number,
): Promise<UsageSummary> {
  try {
    const { data, error } = await supabase.rpc("get_usage_summary", { p_days: days });
    if (error || !data) {
      console.error("get_usage_summary RPC failed", { error });
      await captureException(error ?? new Error("get_usage_summary returned no data"));
      return emptySummary(days);
    }
    const parsed = typeof data === "string"
      ? JSON.parse(data) as UsageSummary
      : data as UsageSummary;
    return parsed;
  } catch (e) {
    console.error("get_usage_summary threw", { error: e });
    await captureException(e);
    return emptySummary(days);
  }
}

// Cache only the positive case (table exists) for the lifetime of the
// process. A negative/errored result is not cached so a freshly-migrated
// tool_events table is picked up on the next request without redeploy, and
// transient RPC failures don't pin the dashboard's tools branch to `false`.
let toolEventsTableCache: boolean | null = null;

export async function hasToolEventsTable(
  supabase: RpcClient,
): Promise<boolean> {
  if (toolEventsTableCache === true) return true;
  try {
    const { data, error } = await supabase.rpc("has_tool_events_table", {});
    if (error) {
      console.error("has_tool_events_table RPC failed", { error });
      await captureException(error);
      return false;
    }
    const exists = data === true;
    if (exists) toolEventsTableCache = true;
    return exists;
  } catch (e) {
    console.error("has_tool_events_table threw", { error: e });
    await captureException(e);
    return false;
  }
}

export function __resetToolEventsTableCacheForTests(): void {
  toolEventsTableCache = null;
}

function emptySummary(days: number): UsageSummary {
  return { days, total: 0, counted: 0, denied: 0, refunded: 0 };
}
