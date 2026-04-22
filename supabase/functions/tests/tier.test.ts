import { assertEquals } from "@std/assert";
import {
  isUnlimited,
  formatUpsellComment,
  type AiQuotaResult,
} from "../_shared/tier.ts";

function t(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

t("isUnlimited: -1 is unlimited, 0 and positive are not", () => {
  assertEquals(isUnlimited(-1), true);
  assertEquals(isUnlimited(-2), true);
  assertEquals(isUnlimited(0), false);
  assertEquals(isUnlimited(5), false);
});

t("formatUpsellComment: uses counts from RPC, no hard-coded numbers", () => {
  const result: AiQuotaResult = {
    allowed: false, blocked: false, tier: "free",
    used: 5, limit: 5,
    next_slot_at: "2026-04-22T14:02:00Z",
    should_notify: true, event_id: 123,
  };
  const msg = formatUpsellComment(result, "https://app.example/pricing");
  assertEquals(msg.includes("5/5"), true);
  assertEquals(msg.includes("last 24 hours"), true);
  assertEquals(msg.includes("https://app.example/pricing"), true);
  assertEquals(msg.includes("/settings"), false, "upsell must link to /pricing, not /settings");
  assertEquals(msg.includes("today"), false, "copy must not imply midnight reset");
});

t("formatUpsellComment: omits next-slot line when null", () => {
  const result: AiQuotaResult = {
    allowed: false, blocked: false, tier: "free",
    used: 5, limit: 5,
    next_slot_at: null,
    should_notify: true, event_id: 1,
  };
  const msg = formatUpsellComment(result, "https://x.example/pricing");
  assertEquals(msg.includes("Next message available"), false);
});
