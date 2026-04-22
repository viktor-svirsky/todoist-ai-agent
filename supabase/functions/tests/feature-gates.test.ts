import { assertEquals } from "@std/assert";
import {
  logFeatureGateEvent,
  resolveFeatureGates,
} from "../_shared/feature-gates.ts";
import type { Tier } from "../_shared/tier.ts";

function t(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const matrix: Array<
  {
    tier: Tier | null;
    webSearch: boolean;
    todoistTools: "full" | "read_only";
    customPrompt: boolean;
    modelOverride: boolean;
    expectedTier: Tier;
  }
> = [
  {
    tier: "free",
    webSearch: false,
    todoistTools: "read_only",
    customPrompt: false,
    modelOverride: false,
    expectedTier: "free",
  },
  {
    tier: "pro",
    webSearch: true,
    todoistTools: "full",
    customPrompt: true,
    modelOverride: false,
    expectedTier: "pro",
  },
  {
    tier: "byok",
    webSearch: true,
    todoistTools: "full",
    customPrompt: true,
    modelOverride: true,
    expectedTier: "byok",
  },
  {
    tier: null,
    webSearch: false,
    todoistTools: "read_only",
    customPrompt: false,
    modelOverride: false,
    expectedTier: "free",
  },
];

for (const row of matrix) {
  t(`resolveFeatureGates: tier=${row.tier ?? "null"}`, () => {
    const prev = Deno.env.get("FEATURE_GATES_ENABLED");
    Deno.env.delete("FEATURE_GATES_ENABLED");
    try {
      const gates = resolveFeatureGates(row.tier);
      assertEquals(gates.tier, row.expectedTier);
      assertEquals(gates.webSearch, row.webSearch);
      assertEquals(gates.todoistTools, row.todoistTools);
      assertEquals(gates.customPrompt, row.customPrompt);
      assertEquals(gates.modelOverride, row.modelOverride);
    } finally {
      if (prev !== undefined) Deno.env.set("FEATURE_GATES_ENABLED", prev);
    }
  });
}

t("resolveFeatureGates: FEATURE_GATES_ENABLED=false unlocks all gates for every tier", () => {
  const prev = Deno.env.get("FEATURE_GATES_ENABLED");
  Deno.env.set("FEATURE_GATES_ENABLED", "false");
  try {
    for (const tier of ["free", "pro", "byok", null] as const) {
      const gates = resolveFeatureGates(tier);
      assertEquals(gates.webSearch, true);
      assertEquals(gates.todoistTools, "full");
      assertEquals(gates.customPrompt, true);
      assertEquals(gates.modelOverride, true);
      assertEquals(gates.tier, tier ?? "free");
    }
  } finally {
    if (prev === undefined) Deno.env.delete("FEATURE_GATES_ENABLED");
    else Deno.env.set("FEATURE_GATES_ENABLED", prev);
  }
});

t("resolveFeatureGates: FEATURE_GATES_ENABLED=true leaves gates active (only 'false' disables)", () => {
  const prev = Deno.env.get("FEATURE_GATES_ENABLED");
  Deno.env.set("FEATURE_GATES_ENABLED", "true");
  try {
    const gates = resolveFeatureGates("free");
    assertEquals(gates.webSearch, false);
    assertEquals(gates.todoistTools, "read_only");
  } finally {
    if (prev === undefined) Deno.env.delete("FEATURE_GATES_ENABLED");
    else Deno.env.set("FEATURE_GATES_ENABLED", prev);
  }
});

t("logFeatureGateEvent: swallows rpc error return", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const fakeClient = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ error: { message: "boom" } });
    },
  };
  await logFeatureGateEvent(
    fakeClient,
    "user-1",
    "free",
    "web_search",
    "filtered",
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "log_feature_gate_event");
  assertEquals(calls[0].args, {
    p_user_id: "user-1",
    p_tier: "free",
    p_feature: "web_search",
    p_action: "filtered",
  });
});

t("logFeatureGateEvent: swallows thrown exceptions", async () => {
  const fakeClient = {
    rpc(_fn: string, _args: Record<string, unknown>) {
      return Promise.reject(new Error("network down"));
    },
  };
  await logFeatureGateEvent(
    fakeClient,
    "user-2",
    "pro",
    "model_override",
    "silently_ignored",
  );
});

t("logFeatureGateEvent: passes all four feature/action combos through", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fakeClient = {
    rpc(_fn: string, args: Record<string, unknown>) {
      seen.push(args);
      return Promise.resolve({ error: null });
    },
  };
  const features = [
    "web_search",
    "todoist_tools",
    "custom_prompt",
    "model_override",
  ] as const;
  const actions = [
    "allowed",
    "filtered",
    "silently_ignored",
    "write_rejected",
  ] as const;
  for (const f of features) {
    for (const a of actions) {
      await logFeatureGateEvent(fakeClient, "u", "byok", f, a);
    }
  }
  assertEquals(seen.length, features.length * actions.length);
});
