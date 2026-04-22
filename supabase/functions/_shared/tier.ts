export type Tier = "free" | "pro" | "byok";

export interface AiQuotaResult {
  allowed:       boolean;
  blocked:       boolean;
  tier:          Tier | null;
  used:          number | null;
  limit:         number;
  next_slot_at:  string | null;
  should_notify: boolean;
  event_id:      number | null;
  error?:        string;
}

export interface AiQuotaStatus {
  tier:          Tier | null;
  used:          number | null;
  limit:         number;
  next_slot_at:  string | null;
  pro_until:     string | null;
}

export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

export function formatUpsellComment(
  result: AiQuotaResult,
  pricingUrl: string,
): string {
  const used  = result.used  ?? 0;
  const limit = result.limit;
  const slot  = result.next_slot_at
    ? `Next message available in ${humanizeRelative(result.next_slot_at)}.`
    : "";
  return [
    `You've used ${used}/${limit} AI messages in the last 24 hours (free tier).`,
    slot,
    `Upgrade to Pro: ${pricingUrl}`,
  ].filter(Boolean).join(" ");
}

export function humanizeRelative(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  const diffMs = Math.max(0, target - now.getTime());
  const totalMinutes = Math.round(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
