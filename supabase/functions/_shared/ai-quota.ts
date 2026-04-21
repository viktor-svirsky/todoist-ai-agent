import { captureException } from "./sentry.ts";
import type { AiQuotaResult, AiQuotaStatus } from "./tier.ts";

interface RpcClient {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

function parseJsonb<T>(data: unknown): T {
  return typeof data === "string" ? JSON.parse(data) as T : data as T;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "no data");
}

export async function claimAiQuota(
  supabase: RpcClient,
  userId: string,
  taskId: string | null,
): Promise<AiQuotaResult> {
  try {
    const { data, error } = await supabase.rpc("claim_ai_quota", {
      p_user_id: userId,
      p_task_id: taskId,
    });
    if (error || !data) {
      console.error("claim_ai_quota RPC failed; fail-closed", {
        userId,
        error: errorMessage(error),
      });
      await captureException(error ?? new Error("claim_ai_quota returned no data"));
      return failClosed();
    }
    return parseJsonb<AiQuotaResult>(data);
  } catch (e) {
    console.error("claim_ai_quota threw; fail-closed", { userId, error: e });
    await captureException(e);
    return failClosed();
  }
}

export async function refundAiQuota(
  supabase: RpcClient,
  eventId: number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("refund_ai_quota", { p_event_id: eventId });
    if (error) {
      console.error("refund_ai_quota failed", { eventId, error });
      await captureException(error);
    }
  } catch (e) {
    console.error("refund_ai_quota threw", { eventId, error: e });
    await captureException(e);
  }
}

export async function getAiQuotaStatus(
  supabase: RpcClient,
  userId: string,
): Promise<AiQuotaStatus> {
  try {
    const { data, error } = await supabase.rpc("get_ai_quota_status", {
      p_user_id: userId,
    });
    if (error || !data) {
      console.error("get_ai_quota_status RPC failed", { userId, error });
      await captureException(error ?? new Error("get_ai_quota_status returned no data"));
      return emptyStatus();
    }
    return parseJsonb<AiQuotaStatus>(data);
  } catch (e) {
    console.error("get_ai_quota_status threw", { userId, error: e });
    await captureException(e);
    return emptyStatus();
  }
}

function failClosed(): AiQuotaResult {
  return {
    allowed: false,
    blocked: false,
    tier: null,
    used: 0,
    limit: 0,
    next_slot_at: null,
    should_notify: false,
    event_id: null,
    error: "rpc_failed",
  };
}

function emptyStatus(): AiQuotaStatus {
  return { tier: null, used: 0, limit: 0, next_slot_at: null, pro_until: null };
}
