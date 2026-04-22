import type { Tier } from "./tier.ts";

export type GateFeature =
  | "web_search"
  | "todoist_tools"
  | "custom_prompt"
  | "model_override";

export type GateAction =
  | "allowed"
  | "filtered"
  | "silently_ignored"
  | "write_rejected";

export interface FeatureGateSet {
  tier: Tier;
  webSearch: boolean;
  todoistTools: "full" | "read_only";
  customPrompt: boolean;
  modelOverride: boolean;
}

export function resolveFeatureGates(tier: Tier | null): FeatureGateSet {
  const effective: Tier = tier ?? "free";
  // Kill switch: env flag bypasses gating, returning full capabilities. Telemetry
  // still fires at call sites; quota accounting is unaffected.
  if (Deno.env.get("FEATURE_GATES_ENABLED") === "false") {
    return {
      tier: effective,
      webSearch: true,
      todoistTools: "full",
      customPrompt: true,
      modelOverride: true,
    };
  }
  const isPaidOrByok = effective === "pro" || effective === "byok";
  return {
    tier: effective,
    webSearch: isPaidOrByok,
    todoistTools: isPaidOrByok ? "full" : "read_only",
    customPrompt: isPaidOrByok,
    modelOverride: effective === "byok",
  };
}

export async function logFeatureGateEvent(
  supabase: {
    rpc(fn: string, args: Record<string, unknown>): Promise<{ error: unknown }>;
  },
  userId: string,
  tier: Tier,
  feature: GateFeature,
  action: GateAction,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_feature_gate_event", {
      p_user_id: userId,
      p_tier: tier,
      p_feature: feature,
      p_action: action,
    });
    if (error) {
      console.warn("feature_gate_log_failed", { feature, action, error });
    }
  } catch (err) {
    console.warn("feature_gate_log_threw", { feature, action, err });
  }
}
