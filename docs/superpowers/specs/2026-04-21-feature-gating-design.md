# Feature Gating — Design Spec

**Sub-project:** C of monetization (3 of 5).
**Date:** 2026-04-21.
**Status:** Approved for implementation planning.
**Depends on:** A (tier + quota) merged; B (Stripe / `pro_until` webhooks) lands before C.
**Blocks:** D (pricing UI surfacing), E (usage dashboard feature breakdown).

## 1. Goal

Introduce tier-aware **feature gating** on top of the already-merged tier model. Free users get a deliberately narrower AI surface; Pro and BYOK get the full surface. Gating is server-side, non-bypassable, and **secondary** to quota (which remains the primary monetization lever). Gating MUST NOT block the webhook happy path — it filters which capabilities the AI can use.

Non-goals: pricing page, Stripe flow (B), historical dashboards (E), per-feature overage pricing.

## 2. Scope

### 2.1 Gates shipped in C

| # | Feature | Free | Pro | BYOK | Primary enforcement |
|---|---------|------|-----|------|---------------------|
| G1 | `web_search` tool (Brave) | off | on | on | Server: tool-list filter in `runAiForTask` |
| G2 | Todoist agentic tools | **read-only** (`list_tasks`, `list_projects`, `list_labels`) | full | full | Server: tool-list filter in `runAiForTask` |
| G3 | `custom_prompt` (`users_config.custom_prompt`) | ignored | applied | applied | Server: prompt assembly in `runAiForTask` + Settings write-time warning (non-blocking) |
| G4 | Model selection (`custom_ai_model` applied without BYOK key) | default only | default only | any | Server: model resolution in `runAiForTask` + Settings write-time rejection when `custom_ai_model` set without `custom_ai_api_key` for Free |

All four gates resolve tier from a single call at the top of `runAiForTask` and branch from there. No second DB round-trip.

### 2.2 Candidates rejected

| Candidate | Reason rejected |
|-----------|-----------------|
| File / image attachment reading | No current feature exists; would require net-new pipeline. Out of scope — revisit after D. |
| `fetch-url.ts` tier gate | Used exclusively by Settings-side metadata lookup (favicon/title preview), not by the AI tool loop. No abuse vector tied to tier. |
| Pro "fallback model" variant of G4 | Default model + existing `DEFAULT_AI_FALLBACK_MODEL` env already covers Pro today; per-user Pro-fallback is a D/E concern once we have usage data. |
| Hard tool-loop round cap per tier | The existing `max 3 rounds` is already a cost guard; varying it by tier adds complexity without clear user value. |

### 2.3 What does NOT change

- Quota (`claim_ai_quota` / `refund_ai_quota`) semantics are unchanged. A denied gate does **not** refund quota — the AI call still happened.
- Webhook pre-flight guards (trigger-word match, HMAC, idempotency, self-comment filter) are unchanged and still run before any gating decision.
- Tier derivation stays in SQL. Gating reads the derived `tier` string; it never re-derives.

## 3. Enforcement architecture

### 3.1 Single tier read per AI attempt

`claim_ai_quota` already returns `tier` in its JSONB payload. We reuse that value — **no new RPC call** on the hot path. If the quota call short-circuits (blocked/denied/RPC error), we never reach gate evaluation, which is correct: gates only matter for allowed calls.

A new thin helper `resolveFeatureGates(tier, userConfig)` in `_shared/feature-gates.ts` returns a `FeatureGateSet`:

```ts
export interface FeatureGateSet {
  tier: Tier;
  webSearch: boolean;              // G1
  todoistTools: "full" | "read_only"; // G2
  customPrompt: boolean;           // G3 — whether to apply users_config.custom_prompt
  modelOverride: boolean;          // G4 — whether to honour custom_ai_model without a BYOK key
}
```

Pure function, DB-free, fully unit-testable.

### 3.2 Gate application points

| Gate | Where enforced | How |
|------|----------------|-----|
| G1 | `runAiForTask` → tools assembly (existing `buildTools(userConfig)` or inline) | If `!gates.webSearch`, omit the Brave `web_search` tool definition AND skip Brave API key injection. Sentry breadcrumb: `feature_gated`, feature=`web_search`. |
| G2 | `runAiForTask` → Todoist tool list assembly (`toAnthropicTools` / `toOpenAiTools`) | If `gates.todoistTools === "read_only"`, filter `TODOIST_TOOL_SPECS` to the allowlist `{list_tasks, list_projects, list_labels}` before conversion. |
| G3 | `runAiForTask` → system prompt composition | If `!gates.customPrompt`, skip the user's `custom_prompt` append. Do NOT surface an error to the AI or the user; Sentry breadcrumb only. |
| G4 | `runAiForTask` → model resolution + Settings PATCH validation | Server: if `!gates.modelOverride`, ignore `custom_ai_model` and use `DEFAULT_AI_MODEL`. Settings: write-time validator rejects `custom_ai_model` if `custom_ai_api_key` is empty AND caller is Free, returning `409 model_requires_byok`. Pro falls through to server-side ignore (no error) since BYOK is the pairing that enables model freedom. |

**Server-side is non-negotiable for G1, G2, G4.** G3 is Pro-signalling rather than cost/security — server-side ignore is still required so a Free user who set a prompt before losing Pro cannot keep using it.

### 3.3 Failure philosophy

- Gate evaluation is pure over already-loaded values. It cannot fail except by programmer error — any thrown exception is treated as "all gates off" (most restrictive = Free defaults) and Sentry-captured.
- A blocked feature is **silently ignored** with a single Sentry breadcrumb per invocation — never an error in the reply comment. Rationale: users whose custom prompt is silently dropped learn via Settings UX (D), not via a broken-looking AI reply.
- Quota is already claimed before gating runs. Gate denial does not refund.

### 3.4 Settings write-time gate (G4 only)

`settings/handler.ts` PATCH already normalises input. We add one check *after* the payload is validated and *before* the DB update:

```
if (body.custom_ai_model && !body.custom_ai_api_key && existing.custom_ai_api_key is empty):
  tier = (await get_user_tier(user.id))  // new STABLE RPC, see §4.2
  if tier === 'free':
    return 409 { code: 'model_requires_byok',
                  message: 'Custom model requires a custom AI key or Pro plan.' }
```

Pro users may save a custom model but server-side gating still ignores it unless BYOK. This is intentional: the field persists so that a user upgrading to BYOK does not have to re-enter it. We surface this in the UI (§5).

## 4. Data model changes

### 4.1 New table `feature_gate_events`

**Second-opinion decision (§9):** new table, not a column on `ai_request_events`.

```sql
-- Migration 00012_feature_gate_events.sql  (00011 is reserved for sub-project B)
CREATE TABLE feature_gate_events (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users_config(id) ON DELETE CASCADE,
  tier         text NOT NULL CHECK (tier IN ('free','pro','byok')),
  feature      text NOT NULL CHECK (feature IN (
                 'web_search','todoist_tools','custom_prompt','model_override'
               )),
  action       text NOT NULL CHECK (action IN (
                 'allowed','filtered','silently_ignored','write_rejected'
               )),
  event_time   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feature_gate_events_feature_tier_time_idx
  ON feature_gate_events (feature, tier, event_time DESC);

CREATE INDEX feature_gate_events_user_time_idx
  ON feature_gate_events (user_id, event_time DESC);

ALTER TABLE feature_gate_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_gate_events_deny_all ON feature_gate_events
  FOR ALL USING (false) WITH CHECK (false);
```

- **Only non-`allowed` outcomes are written.** Logging every allowed invocation would duplicate quota data; the analytics query subtracts from `ai_request_events` when needed.
- Retention: reuses the 90-day retention cron introduced in sub-project E. Until E lands, growth is ≤ (denials × 4 gates) per day — negligible at current scale.
- `action='write_rejected'` is only emitted by the Settings PATCH path (G4), never by the webhook path.

### 4.2 Read-only RPC `get_user_tier`

Used by Settings PATCH only; webhook reuses the tier returned by `claim_ai_quota`.

```sql
CREATE OR REPLACE FUNCTION get_user_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v_row users_config%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;
END;
$$;
```

Duplicates the SQL expression from `claim_ai_quota` / `get_ai_quota_status` verbatim. A future refactor can extract a shared SQL function; for now correctness via copy is preferred over premature abstraction (three copies, all tested).

### 4.3 Telemetry RPC `log_feature_gate_event`

```sql
CREATE OR REPLACE FUNCTION log_feature_gate_event(
  p_user_id uuid, p_tier text, p_feature text, p_action text
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO feature_gate_events (user_id, tier, feature, action)
  VALUES (p_user_id, p_tier, p_feature, p_action);
$$;
```

Fire-and-forget from Deno via a best-effort wrapper. Throw is swallowed + Sentry breadcrumb; telemetry MUST NOT affect the user-facing AI reply.

## 5. UX / upsell surfaces

| Gate | Free-user surface | Copy |
|------|-------------------|------|
| G1 web_search | Settings "Plan" card adds a bullet under Free: "Web search is Pro-only." | No inline webhook comment — avoids spamming one-off trigger users. |
| G2 agentic tools | Settings "Plan" card bullet: "Read-only Todoist tools. Upgrade to let AI create, update, and complete tasks." | If the AI attempts a disallowed tool, the tool loop returns a plain-text `Tool error (update_task): not available on Free tier.` from the tool dispatcher. This *is* a user-visible string (routed back to the AI, which typically paraphrases it). No direct webhook comment. |
| G3 custom_prompt | Settings custom-prompt textarea shows badge "Pro" and a helper "Saved prompts apply on Pro or with your own AI key." Still editable (persists for future upgrade). | Silent server-side ignore. |
| G4 custom model | Settings model input shows "Requires your own AI key" when BYOK absent. PATCH returns `409 model_requires_byok` with human-readable `message`. | Client surfaces inline error. |

All upsell routing goes through Settings, not inline Todoist comments. Sub-project A already owns the single inline upsell (quota-denial). Stacking more would make the bot noisy.

## 6. Telemetry

- Table: `feature_gate_events` (§4.1). Append-only, service-role.
- Sentry breadcrumbs on every filtered / silently_ignored event with `{feature, tier, user_id_hash}`. No Sentry *events* — breadcrumbs only — to stay under noise budget.
- Logs: structured line `feature_gate` per webhook request when any gate fires, with an array of `{feature, action}`. One log line per request regardless of gate count.
- Analytics query (for D/E): `SELECT count(DISTINCT user_id) FROM feature_gate_events WHERE tier='free' AND feature='web_search' AND event_time > now() - interval '7 days';` — O(ms) on the `(feature, tier, event_time)` index.

## 7. Failure modes

| # | Failure | Behaviour |
|---|---------|-----------|
| 1 | `log_feature_gate_event` RPC throws | Swallowed, Sentry breadcrumb. AI reply continues. |
| 2 | Tier resolved to `null` (no_user) in quota path | `claim_ai_quota` already short-circuits; gating code unreachable. |
| 3 | Programmer error in `resolveFeatureGates` (exception) | Caught in `runAiForTask`, treated as Free defaults (most restrictive), Sentry-captured. User gets a reply with reduced capability rather than a crash. |
| 4 | `get_user_tier` throws on Settings PATCH | Fail-closed: treat as Free → reject model write with 409. Sentry-captured. |
| 5 | User upgrades mid-conversation (Pro granted between two webhooks) | Next webhook re-claims quota → re-resolves gates. No caching. |
| 6 | Tool loop triggers a filtered Todoist tool name | `handleTodoistTool` returns `"Tool error (update_task): not available on Free tier."` — existing error-return pattern. AI loop treats it as a tool failure and responds gracefully. |
| 7 | `custom_ai_model` set but user downgrades from Pro to Free | Gate G4 silently ignores `custom_ai_model` in the webhook path → default model used. Settings field remains populated (no silent data loss). |

## 8. Test strategy

### 8.1 Deno unit tests (`tests/feature-gates.test.ts`)

Pure `resolveFeatureGates` table-driven tests:
- 3 tiers × 4 gates = 12 assertions.
- `tier=null` → Free defaults (defensive).

### 8.2 Deno unit tests (`tests/tools-filter.test.ts`)

- `filterTodoistTools(specs, "full")` returns all specs.
- `filterTodoistTools(specs, "read_only")` returns exactly `list_tasks`, `list_projects`, `list_labels`.
- `handleTodoistTool("update_task", ..., client, "read_only")` returns the "not available on Free tier" string without touching the Todoist client (spy asserts zero calls).

### 8.3 Deno integration tests (`tests/webhook-gates.test.ts`)

Using a real local Supabase:
- **Free** trigger with a prompt that would call `web_search`: the tool is absent from the request body sent to the provider (mock fetch inspection); AI reply posts; quota counts 1; `feature_gate_events` row with action=`filtered`.
- **Pro** (same prompt): `web_search` present in provider request body; no `feature_gate_events` row.
- **BYOK** (same prompt): `web_search` present; no event row.
- **Free** with `custom_prompt` set: provider system prompt does not contain the custom prompt text; event row with feature=`custom_prompt`, action=`silently_ignored`.
- **Free** with `custom_ai_model="gpt-4o"`: provider URL/model uses `DEFAULT_AI_MODEL`, NOT `gpt-4o`; event row feature=`model_override`, action=`silently_ignored`.
- **Free** AI emits a `update_task` tool call: tool loop short-circuits with "not available on Free tier"; quota still counted once (regression guard).

### 8.4 Regression test (`tests/webhook-gates-quota.test.ts`)

- Assert that when G2 blocks a mid-loop tool call, the `ai_request_events` row count delta is exactly 1 (allowed), and `counted=true`. No refund. No double-claim. This is the "do not double-charge / do not refund on gate" hard requirement.

### 8.5 Settings PATCH tests (`tests/settings-gate.test.ts`)

- Free user PATCH with `custom_ai_model` and no `custom_ai_api_key` → 409 `model_requires_byok`; no DB write; `feature_gate_events` row with action=`write_rejected`.
- BYOK user PATCH same body → 200, DB updated, no event row.
- Pro user PATCH same body → 200, DB updated, no event row (server-side webhook-path gate will still ignore the value — covered by 8.3).

### 8.6 Frontend Vitest (`PlanCard.test.tsx`, `Settings.test.tsx`)

- Free Plan card lists the four gate bullets.
- Model input shows "Requires your own AI key" helper when BYOK absent.
- Custom-prompt field shows "Pro" badge when `tier !== 'pro' && tier !== 'byok'`.
- 409 `model_requires_byok` renders inline error under the model input.

## 9. Design decisions

**D1. Telemetry table vs. column on `ai_request_events`.**
Chosen: new `feature_gate_events` table (§4.1). `ai_request_events` is a hot-path table with a partial index on `WHERE counted=true` tuned for the rolling-window quota query; adding a nullable jsonb gated-features column would inflate row size in that hot index and conflate two concerns (billing truth vs. gating analytics) on the same retention and RLS policy. A dedicated table gets its own `(feature, tier, event_time)` index — the exact shape of the "how many Free users hit web_search in 7 days" analytics query. Write amplification stays bounded because we only log non-`allowed` outcomes.

**D2. Reuse quota tier vs. new RPC on hot path.**
Chosen: reuse `claim_ai_quota`'s returned `tier`. Zero extra round-trip. `get_user_tier` exists only for the Settings PATCH path where no quota claim happens.

**D3. Silent ignore vs. visible error on gate block.**
Chosen: silent ignore with Sentry breadcrumb for G1/G3/G4. G2 surfaces "not available on Free tier" *inside* the tool-dispatch error return, which the AI paraphrases to the user — this is consistent with existing tool-error handling and avoids a brand-new error channel.

**D4. Upsell surface placement.**
Chosen: Settings-side only. Sub-project A already owns the single inline Todoist comment (quota denial). Stacking per-feature inline nags would degrade the product more than it would convert.

**D5. Persisting `custom_ai_model` / `custom_prompt` for Free users.**
Chosen: persist silently, ignore at runtime. Avoids data loss on downgrade. Field visibility and helper copy communicate the gating state.

## 10. Dependencies on sub-project B

- B owns Stripe webhook handlers that set/clear `users_config.pro_until`. C only reads that column through `get_ai_quota_status` / `get_user_tier`.
- C must merge **after** B so that real Pro users exist to exercise the Pro branch in staging. If B slips, C can still merge behind the feature flag `FEATURE_GATES_ENABLED=false` (env-level; defaulted `true` once B is live).
- C introduces no new webhook contract with B.

## 11. Acceptance criteria

- [ ] Migration 00012 applies cleanly on fresh and production snapshot.
- [ ] `get_user_tier` truth table matches `claim_ai_quota` tier derivation byte-for-byte (identical 12-case test).
- [ ] Free webhook request with a web-search-requiring prompt: provider call body omits the `web_search` tool, reply still posts, quota +1, `feature_gate_events` +1 with `filtered`.
- [ ] Pro / BYOK equivalents: no `feature_gate_events` row; `web_search` present.
- [ ] Free `custom_prompt`: provider system prompt unchanged from default; `feature_gate_events` row `silently_ignored`.
- [ ] Free `custom_ai_model`: provider request uses `DEFAULT_AI_MODEL`; `feature_gate_events` row `silently_ignored`.
- [ ] Free AI emits `update_task`: tool dispatcher returns the "not available" string; Todoist client never called; `ai_request_events` has exactly one `counted=true` row (no refund, no double-claim).
- [ ] Settings PATCH `custom_ai_model` without BYOK as Free → 409 `model_requires_byok`; no DB change; event row `write_rejected`.
- [ ] Plan card renders the four Free-tier bullets and per-gate indicators; no hard-coded tier strings in JSX (values come from the `/tier` response).
- [ ] All gate decisions resolve in-process from the tier value already returned by `claim_ai_quota` — webhook does not issue an extra tier RPC.
- [ ] Telemetry failures (`log_feature_gate_event` throw) never break the AI reply path — simulated via fault injection.

## 12. Out of scope

- Attachment / image tools (future feature, not tier-gated yet because it does not exist).
- Per-feature upgrade CTAs inline in Todoist comments.
- Per-tier tool-loop round caps.
- Historical dashboards (sub-project E will query `feature_gate_events`).
