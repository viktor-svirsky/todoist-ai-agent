# Tier Model + AI-Message Quota — Design Spec

**Sub-project:** A of monetization (1 of 5).
**Date:** 2026-04-21.
**Status:** Approved for implementation planning (v2, post-review).
**Depends on:** none.
**Blocks:** sub-project B (Stripe integration), C (feature gating), D (pricing UI), E (usage dashboard).

## 1. Goal

Introduce a tier-aware quota for AI-generating comments so we can monetize a freemium plan. Backend enforcement + minimal Settings UI only. Stripe lives in sub-project B.

## 2. Tiers

| Tier | Price | AI Limit (default model Opus 4.7) | AI Provider |
|------|-------|-----------------------------------|-------------|
| Free | $0 | `AI_QUOTA_FREE_MAX` messages per rolling 24 h (default: 5) | Default (our cost) |
| Pro | $5 / month | Unlimited (no cap in this sub-project) | Default (our cost) |
| BYOK | $0 | Unlimited | User-provided key |

**Tier precedence (evaluated in DB):**
1. `custom_ai_api_key IS NOT NULL AND length(trim(custom_ai_api_key)) > 0` → `byok`.
2. `pro_until IS NOT NULL AND pro_until > now()` → `pro`.
3. Otherwise → `free`.

The BYOK predicate explicitly rejects empty and whitespace-only values — a null-only check would let a legacy empty string quietly grant unlimited while runtime still falls back to the default API key. The same predicate is used by every caller of tier derivation.

BYOK outranks Pro: a paying user who configures BYOK should not continue to pay for API usage we no longer incur. Sub-project B auto-cancels the subscription in that case.

Pro's unlimited-at-$5 is a **conscious risk** accepted for this sub-project. Post-launch usage data in sub-project B will decide whether a hidden fair-use cap becomes necessary.

## 3. Quota semantics

- **1 counted message** = 1 AI pipeline invocation that reaches the provider call after every pre-flight guard passes (control-task filter, self-comment filter, trigger-word match, `item:updated` AI-reply dedupe, quota allowed). Tool-loop rounds inside a single invocation count as 1.
- **Window** = rolling 24 h, computed as `event_time > now() - interval '24 hours'` against an exact event table. No two-bucket approximation.
- **Claim boundary.** `claim_ai_quota` is called from the top of `runAiForTask` (the single path leading to the provider call), after all webhook-level guards. This guarantees one claim per actual AI attempt.
- **Refund on upstream failure.** If the AI pipeline throws (provider error, Todoist comment post failure, user-token decrypt failure, etc.) before a reply is posted, the webhook calls `refund_ai_quota(event_id)` to mark the claimed row `counted = false`. The user's retry is not a double-burn.
- **Denied calls** insert an event row with `counted = false` for telemetry. They do **not** consume future budget.
- **"Next slot available"** = oldest *counted* event in the current window + 24 h. Shown in UI as a rolling concept; copy never says "today" or "midnight" (those imply a fixed reset).

## 4. Architecture

### 4.1 Modules

| File | New / Modified | Purpose |
|------|----------------|---------|
| `_shared/tier.ts` | new | Type definitions (`Tier`) + `formatUpsellComment(result, settingsUrl)` (pure, no derivation logic — DB is canonical). |
| `_shared/ai-quota.ts` | new | Wrappers for `claim_ai_quota` and `get_ai_quota_status` RPCs. Fail-closed. |
| `webhook/handler.ts` | modified | After existing anti-abuse rate limit + `shouldTriggerAi` returns true, call `claim_ai_quota`. Denied → post upsell (if `should_notify`) and 200-ack. |
| `settings/handler.ts` | modified | Add `GET /tier` subroute returning a flat `{ tier, used, limit, next_slot_at, pro_until }` (see §4.4 and §5.3). Read-only. |
| `frontend/src/pages/Settings.tsx` | modified | Render "Plan" card: tier badge, counter (Free only), disabled "Pro coming soon" CTA. |

### 4.2 Two-layer rate limiting

- **Existing anti-abuse** (`check_rate_limit`, webhook-global): unchanged.
- **New AI quota** (`claim_ai_quota`, only for trigger-word matches): tier-gated limit.

Separate columns and tables; neither layer's tuning leaks into the other.

### 4.3 Webhook request flow

```
verify HMAC                                              (401 on fail)
parse event; idempotency check                           (200 on replay)
check_rate_limit (anti-abuse, existing)                  (200 on deny)
load + decrypt userConfig
classify event (note / item); pre-flight guards:
  - not bot's own comment (AI_INDICATOR / ERROR_PREFIX)
  - isAllowedTask (control_task_id)
  - trigger-word match
  - item:updated → no existing AI reply
if any guard fails                                       → 200, no claim
runAiForTask:
  result = claim_ai_quota(user_id, task_id) ──────────── one claim per real attempt
  ├─ result.error (rpc_failed) → Sentry + log              → 200, no action
  ├─ result.blocked                                        → 200, no action
  ├─ !result.allowed
  │    ├─ result.should_notify → post upsell comment → 200
  │    └─ else                                              → 200
  └─ result.allowed:
        try:
          build conversation → call AI → post reply
          (event row already counted=true)
        catch:
          refund_ai_quota(event_id)    ── mark counted=false
          Sentry + log
                                                            → 200
```

**All webhook outcomes return HTTP 200** except HMAC failure (401), malformed body (400), and `Method Not Allowed` (405 on non-POST). Todoist retries on non-2xx; our idempotency table guards replay. Reverting to non-2xx on quota events would cause retry storms.

The claim sits at the top of `runAiForTask` — the single narrow entry point shared by every trigger branch (note event, item:added, item:updated). Adding a new trigger branch in the future automatically gets quota enforcement for free.

### 4.4 Settings flow (`GET /tier`)

```
validate Authorization header (existing)
get_ai_quota_status(user_id)   ← pure read, no inserts
respond { tier, used, limit, next_slot_at, pro_until }     ← flat, see body shape below
```

Response body shape (flat — matches the RPC's JSONB output verbatim):
```json
{
  "tier":         "free" | "pro" | "byok",
  "used":         3,
  "limit":        5,
  "next_slot_at": "2026-04-22T14:02:00Z",
  "pro_until":    null
}
```

- `used`: `number` for Free, `null` for Pro/BYOK.
- `limit`: `-1` for Pro/BYOK, otherwise the integer cap.
- `next_slot_at`: `null` when no counted events exist or when unlimited.
- `pro_until`: ISO-8601 when `tier === "pro"`, `null` otherwise.

Frontend consumes this shape directly; no transformation layer.

## 5. Schema

Migration: `supabase/migrations/00010_tier_and_ai_quota.sql`.

### 5.1 Columns & table

```sql
-- Pro tier state (null = not Pro)
ALTER TABLE users_config
  ADD COLUMN pro_until timestamptz DEFAULT NULL;

CREATE INDEX users_config_pro_until_idx
  ON users_config (pro_until) WHERE pro_until IS NOT NULL;

-- Last time we posted an upsell comment to this user (dedupe)
ALTER TABLE users_config
  ADD COLUMN ai_quota_denied_notified_at timestamptz DEFAULT NULL;

-- Exact per-event log for rolling-window quota
CREATE TABLE ai_request_events (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users_config(id) ON DELETE CASCADE,
  todoist_user_id text NOT NULL,
  task_id         text,
  tier            text NOT NULL CHECK (tier IN ('free','pro','byok')),
  counted         boolean NOT NULL,      -- true: accepted; false: denied
  event_time      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_request_events_user_time_idx
  ON ai_request_events (user_id, event_time DESC)
  WHERE counted = true;

CREATE INDEX ai_request_events_user_all_idx
  ON ai_request_events (user_id, event_time DESC);

-- Retention: cron (sub-project E will formalize) deletes rows older than 90 days.
-- Until then, table grows at ≤ ~150 rows/day project-wide (current scale).
```

RLS: `ai_request_events` is service-role only (no user-facing reads). Deny-all policy with a single service-role bypass.

### 5.2 RPC: `claim_ai_quota` (single-atomic source of truth)

```sql
CREATE OR REPLACE FUNCTION claim_ai_quota(
  p_user_id uuid,
  p_task_id text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row        users_config%ROWTYPE;
  v_tier       text;
  v_limit      int;
  v_used       int;
  v_allowed    boolean;
  v_oldest     timestamptz;
  v_next_slot  timestamptz;
  v_notify     boolean := false;
  v_free_max   int;
  v_window     interval := interval '24 hours';
  v_event_id   bigint;
BEGIN
  -- Row-lock: serializes concurrent calls for the same user.
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false, 'blocked', false,
      'tier', null, 'used', 0, 'limit', 0,
      'next_slot_at', null, 'should_notify', false,
      'error', 'no_user'
    );
  END IF;

  IF v_row.is_disabled THEN
    RETURN jsonb_build_object(
      'allowed', false, 'blocked', true,
      'tier', null, 'used', 0, 'limit', 0,
      'next_slot_at', null, 'should_notify', false
    );
  END IF;

  -- Tier derivation (DB-side, single source of truth)
  v_tier := CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;

  -- Limit lookup: Postgres setting for runtime override; fallback to 5.
  -- Any invalid / missing / non-positive value clamps to 5 (fail-closed on
  -- misconfig — never silently grants unlimited).
  BEGIN
    v_free_max := current_setting('app.ai_quota_free_max')::int;
    IF v_free_max IS NULL OR v_free_max <= 0 THEN
      v_free_max := 5;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_free_max := 5;
  END;

  v_limit := CASE v_tier WHEN 'free' THEN v_free_max ELSE -1 END;

  IF v_limit > 0 THEN
    SELECT COUNT(*), MIN(event_time)
    INTO v_used, v_oldest
    FROM ai_request_events
    WHERE user_id = p_user_id
      AND counted = true
      AND event_time > now() - v_window;

    v_allowed   := v_used < v_limit;
    v_next_slot := CASE
      WHEN v_oldest IS NOT NULL THEN v_oldest + v_window
      ELSE now() + v_window
    END;
  ELSE
    v_used      := NULL;  -- "unlimited"; callers must treat null as no-cap
    v_allowed   := true;
    v_next_slot := NULL;
  END IF;

  -- Log event (always). Returns event_id so the caller can refund on failure.
  INSERT INTO ai_request_events (
    user_id, todoist_user_id, task_id, tier, counted
  ) VALUES (
    p_user_id, v_row.todoist_user_id, p_task_id, v_tier, v_allowed
  ) RETURNING id INTO v_event_id;

  -- Lifetime stats (total_ai_requests, last_ai_request_at) are updated by the
  -- existing post-AI path (increment_ai_requests or its replacement) so that
  -- their meaning ("completed AI processing") does not change. claim_ai_quota
  -- only touches the event log and notification-dedupe column.

  -- Atomic notification claim (denied only)
  IF NOT v_allowed THEN
    UPDATE users_config
    SET ai_quota_denied_notified_at = now()
    WHERE id = p_user_id
      AND (ai_quota_denied_notified_at IS NULL
           OR ai_quota_denied_notified_at < now() - v_window)
    RETURNING true INTO v_notify;
    v_notify := COALESCE(v_notify, false);
  END IF;

  RETURN jsonb_build_object(
    'allowed',       v_allowed,
    'blocked',       false,
    'tier',          v_tier,
    'used',          v_used,
    'limit',         v_limit,
    'next_slot_at',  v_next_slot,
    'should_notify', v_notify,
    'event_id',      v_event_id
  );
END;
$$;
```

Notes:
- `FOR UPDATE` on `users_config` row plus the conditional `UPDATE ... RETURNING` on `ai_quota_denied_notified_at` make the notification claim race-free.
- `limit = -1` means unlimited. `used = null` for unlimited tiers. Both frontend and backend must treat `null used` as "no counter to display".
- Free limit sourced from Postgres GUC `app.ai_quota_free_max` (settable per-database via `ALTER DATABASE ... SET app.ai_quota_free_max = '5';`). Env-level override happens at deploy time, not per-request. **Any misconfig (missing, null, zero, negative) falls back to 5 — never to unlimited.**
- `event_id` allows the caller to refund on downstream failure via `refund_ai_quota`.

### 5.2a RPC: `refund_ai_quota`

```sql
CREATE OR REPLACE FUNCTION refund_ai_quota(p_event_id bigint)
RETURNS void LANGUAGE sql AS $$
  UPDATE ai_request_events SET counted = false
  WHERE id = p_event_id AND counted = true;
$$;
```

Idempotent. Flipping to `counted = false` removes the row from the window count. Does not delete; keeps the event trail for analytics (refunded events can be distinguished from denied ones via a future `refunded_at` column if needed — out of scope here).

Called on:
- AI provider exception (after retries exhausted) before any reply is posted.
- Todoist comment POST failure for the final reply.
- Any pre-reply exception during `runAiForTask` (guarded by `replyPosted === false` — see §6.3).

**Not** called on:
- Denial (`!allowed`) — the row is already `counted = false`.
- Post-reply exceptions (telemetry, stats update, logging) — the user already received the reply; refund would reward a failure they did not perceive.

### 5.3 RPC: `get_ai_quota_status` (read-only)

```sql
CREATE OR REPLACE FUNCTION get_ai_quota_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row        users_config%ROWTYPE;
  v_tier       text;
  v_limit      int;
  v_used       int;
  v_oldest     timestamptz;
  v_next_slot  timestamptz;
  v_free_max   int;
  v_window     interval := interval '24 hours';
BEGIN
  SELECT * INTO v_row FROM users_config WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tier', null, 'used', 0, 'limit', 0,
      'next_slot_at', null, 'pro_until', null
    );
  END IF;

  v_tier := CASE
    WHEN v_row.custom_ai_api_key IS NOT NULL
         AND length(trim(v_row.custom_ai_api_key)) > 0 THEN 'byok'
    WHEN v_row.pro_until IS NOT NULL AND v_row.pro_until > now() THEN 'pro'
    ELSE 'free'
  END;

  BEGIN
    v_free_max := current_setting('app.ai_quota_free_max')::int;
    IF v_free_max IS NULL OR v_free_max <= 0 THEN
      v_free_max := 5;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_free_max := 5;
  END;

  v_limit := CASE v_tier WHEN 'free' THEN v_free_max ELSE -1 END;

  IF v_limit > 0 THEN
    SELECT COUNT(*), MIN(event_time) INTO v_used, v_oldest
    FROM ai_request_events
    WHERE user_id = p_user_id
      AND counted = true
      AND event_time > now() - v_window;
    v_next_slot := CASE
      WHEN v_oldest IS NOT NULL THEN v_oldest + v_window
      ELSE NULL   -- no usage yet → no imminent slot concept
    END;
  ELSE
    v_used      := NULL;
    v_next_slot := NULL;
  END IF;

  RETURN jsonb_build_object(
    'tier',         v_tier,
    'used',         v_used,
    'limit',        v_limit,
    'next_slot_at', v_next_slot,
    'pro_until',    CASE WHEN v_tier = 'pro' THEN v_row.pro_until ELSE NULL END
  );
END;
$$;
```

`STABLE` volatility. No side effects. Tests assert `ai_request_events` unchanged after call. `pro_until` is scrubbed to `null` unless the derived tier is `pro` — prevents the UI from showing a stale "Pro until …" line for a user who has since switched to BYOK (BYOK wins precedence even with a future `pro_until` still on the row).

### 5.4 Legacy `increment_ai_requests`

`claim_ai_quota` does **not** update lifetime stats. `total_ai_requests` and `last_ai_request_at` continue to be updated by `increment_ai_requests` (or its replacement) from the existing post-AI-success path. Semantics are preserved: `total_ai_requests` counts completed AI replies, not attempts or denials.

Audit during implementation:

1. `grep -r 'increment_ai_requests' supabase/` to confirm it is called only on successful AI completion.
2. Keep the function; it is still the canonical bump point.
3. If a refactor moves the counter update elsewhere, the replacement must also fire only on successful reply.

Integration test: assert `total_ai_requests` increments exactly once per **successfully delivered** AI reply. Denied and refunded attempts do not bump it.

## 6. Code shape

### 6.1 `_shared/tier.ts`

```ts
export type Tier = "free" | "pro" | "byok";

export interface AiQuotaResult {
  allowed:       boolean;
  blocked:       boolean;
  tier:          Tier | null;
  used:          number | null;   // null = unlimited tier
  limit:         number;          // -1 = unlimited
  next_slot_at:  string | null;
  should_notify: boolean;
  event_id:      number | null;   // id in ai_request_events; null on error/no_user
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
  settingsUrl: string,
): string {
  // All numbers come from the RPC — no hard-coded "5" or "24h".
  const used  = result.used  ?? 0;
  const limit = result.limit;
  const slot  = result.next_slot_at
    ? `Next message available in ${humanizeRelative(result.next_slot_at)}.`
    : "";
  return [
    `You've used ${used}/${limit} AI messages in the last 24 hours (free tier).`,
    slot,
    `Upgrade to Pro — coming soon. Or add your own AI key in Settings: ${settingsUrl}`,
  ].filter(Boolean).join(" ");
}
```

No `deriveTier` in TS; DB is canonical. This prevents JS/DB clock drift on Pro expiry boundaries.

### 6.2 `_shared/ai-quota.ts`

```ts
export async function claimAiQuota(
  supabase,
  userId: string,
  taskId: string | null,
): Promise<AiQuotaResult>;

export async function getAiQuotaStatus(
  supabase,
  userId: string,
): Promise<AiQuotaStatus>;
```

**Fail-closed on RPC error.** Returns `{ allowed: false, blocked: false, should_notify: false, error: "rpc_failed", ... }`. Caller (webhook) posts **no** comment (we don't know the user's state), but logs + Sentry the exception. HTTP response is still 200 to Todoist.

Rationale: fail-open on a paywall is a bypass. Fail-closed without a comment avoids spamming users during DB outages while honouring the paywall. A repeated-failure Sentry alert (sub-project B sets thresholds) will page.

### 6.3 Webhook integration

Insertion point: top of `runAiForTask` in `webhook/handler.ts`. Every event-classification branch (`handleNoteEvent`, `handleItemEvent` for added/updated) already routes through `runAiForTask` after its own trigger guards, so one insertion covers all paths.

```ts
async function runAiForTask(taskId, user, userId, requestId, preloadedComments?) {
  const q = await claimAiQuota(supabase, user.id, taskId);

  if (q.error) return;                          // fail-closed; Sentry inside wrapper
  if (q.blocked) return;                         // is_disabled
  if (!q.allowed) {
    if (q.should_notify) {
      await safePostUpsell(user, taskId, q);     // best-effort, swallowed errors
    }
    return;                                      // ack webhook in outer handler
  }

  let replyPosted = false;
  try {
    // existing: fetch/decrypt user, build conversation, call AI
    // ↓ single await that actually delivers value to the user
    await postAiReplyToTodoist(...);
    replyPosted = true;
    // increment_ai_requests fires here on success (unchanged from today)
  } catch (err) {
    if (!replyPosted) {
      await refundAiQuota(supabase, q.event_id); // idempotent; best-effort
    }
    await captureException(err);
    throw err;                                    // outer handler still returns 200
  }
}
```

Refund scope: **only when no reply was delivered**. Once `replyPosted = true`, any later bookkeeping/telemetry exception does not trigger a refund — the user already received the value, and the quota should stay consumed. This prevents a late exception (e.g., during Sentry capture or stats update) from gifting a free retry.

`safePostUpsell` wraps the comment POST in try/catch and Sentry-captures on failure. We do **not** un-claim `ai_quota_denied_notified_at` on upsell post failure — doing so would re-enable spam if the outage is on Todoist's side. Missing one upsell is preferable to spamming.

`refundAiQuota` is idempotent (the SQL uses `WHERE counted = true`). Calling it twice on the same `event_id` is a no-op.

## 7. Frontend (Settings page)

### 7.1 "Plan" card

```
┌─ Plan ─────────────────────────────────────────┐
│  {badge: tier}                                   │
│  {tier === free}                                 │
│      3 of 5 AI messages used (last 24 hours)     │
│      Next slot available in 14h 22m              │
│  {tier === pro}                                  │
│      Unlimited AI messages                       │
│      Pro active until 2026-05-21                 │
│  {tier === byok}                                 │
│      Unlimited (using your own AI key)           │
│  [ Upgrade to Pro — coming soon ] (disabled)     │
└──────────────────────────────────────────────────┘
```

Copy never says "today" or "resets at midnight" — the window is rolling 24 h.

- Badge colour per tier.
- Counter + next-slot **only** when `limit > 0`.
- "Pro active until" shown when `pro_until` present and future.
- CTA disabled in this sub-project; tooltip: "Pro tier launches in sub-project B."

### 7.2 Data fetching

`useTier()` hook calls `GET /functions/v1/settings/tier`. Fetched once on page load and on window focus. No polling. No optimistic updates.

### 7.3 Tests (Vitest)

- Renders badge per tier (3 cases).
- Counter visible iff `limit > 0`.
- "Pro active until" shown iff `tier === pro && pro_until`.
- CTA disabled + accessible tooltip.
- Loading / error / empty states.
- Copy contains neither hard-coded "5/5" nor hard-coded "24h".

## 8. Testing strategy

### 8.1 Deno unit tests

| File | Coverage |
|------|----------|
| `tests/tier.test.ts` | `formatUpsellComment` snapshot (includes "last 24 hours", no "today"); `isUnlimited` truth table. |
| `tests/ai-quota.test.ts` | `claimAiQuota` mocks RPC: allowed, denied, blocked, should_notify, unlimited (null used), RPC error → fail-closed; `getAiQuotaStatus` same; `refundAiQuota` idempotent. |

### 8.2 Deno integration tests (real local Supabase)

| File | Coverage |
|------|----------|
| `tests/webhook-quota.test.ts` | **Free** user's 6th trigger in 24 h → denied + upsell posted once + 200. Rapid duplicate denials → 1 comment. **Pro** user's 100th → allowed. **BYOK** user's 100th → allowed. BYOK predicate: empty-string `custom_ai_api_key` does NOT grant BYOK. Event rows: 5 counted, 1 uncounted per free user scenario. Anti-abuse rate-limit still fires independently. **AI pipeline exception after claim → refund flips the row to `counted = false`; retry succeeds and counts as a fresh attempt.** **Claim skipped when a pre-flight guard fails (e.g. `item:updated` with existing AI reply)** — no event row inserted. |
| `tests/settings-tier.test.ts` | `GET /tier` shape per tier, 401 without auth, `ai_request_events` count unchanged after 5 calls. |
| `tests/ai-quota-window.test.ts` | Insert 5 counted events spaced over 25h — on hour 25, 6th call allowed (oldest expired); `next_slot_at` math correct; concurrency test using `Promise.all(10 denials)` → exactly 1 `should_notify === true`. |

### 8.3 SQL function tests

Invoked from Deno via service-role client:

- `claim_ai_quota` allowed/denied/blocked paths.
- Tier derivation truth table — 12 cases: `custom_ai_api_key × pro_until` including `custom_ai_api_key = ''` (empty string → free, not byok), `custom_ai_api_key = '  '` (whitespace → free), `pro_until` past / future / null, `is_disabled = true`.
- `ai_quota_denied_notified_at` atomic claim: 10 parallel denied calls → exactly 1 returns `should_notify = true`.
- `get_ai_quota_status` never inserts into `ai_request_events` (assert `count` unchanged).
- `current_setting('app.ai_quota_free_max')` override respected when positive; 0, negative, non-numeric, or missing → all fall back to 5.
- `refund_ai_quota` flips `counted` to false; calling twice is a no-op (idempotent); unknown `event_id` is silently ignored.
- Quota window respects exact event timestamps: insert 5 counted events over a 25-hour span with 4 in last 24h → the 5th-oldest rotates out as soon as it crosses the 24h boundary.

### 8.4 Frontend Vitest

See 7.3.

### 8.5 E2E

Not required for this sub-project. Sub-project B adds an e2e path once Stripe flow exists.

## 9. Observability

### 9.1 Sentry

- `capture_exception` on RPC failure (`claim_ai_quota` or `get_ai_quota_status` threw or returned `error`).
- `capture_exception` on upsell-comment post failure.
- Denial events: **structured log only** (tier, used, limit, user id). Sentry messages are not used for business-telemetry volume; a future analytics pipeline ingests logs instead. Avoids Sentry-noise complaints.

### 9.2 Logs

- `ai_quota_checked` per call: `{ tier, allowed, used, limit, next_slot_at, request_id }`.
- `ai_quota_upsell_posted` with outcome (ok/failure).
- `ai_quota_rpc_failure` counter — feeds the paging alert defined in sub-project B.

## 10. Cutover plan

1. Merge migration 00010 — columns and table added; existing rows get `pro_until = NULL` (= Free). `ai_request_events` starts empty — first-24h denial impossible until users accumulate real events.
2. Deploy function changes.
3. Per live data (2026-04-21): 49 non-BYOK users, max lifetime AI requests per user = 19, avg 2.2. Expected denials in first 24 h: ~0.
4. Soak 72 h. Monitor `ai_quota_rpc_failure` log events; zero tolerance.

### 10.1 Rollback

- Revert function deploy → behaviour returns to pre-quota. Table rows accumulate until retention cron sweeps (sub-project E).
- Revert migration 00010 → drops table, columns, functions. Existing rate-limit columns untouched.

## 11. Manual operations

### 11.1 Grant Pro

```sql
UPDATE users_config
SET pro_until = now() + interval '1 month'
WHERE todoist_user_id = '<todoist_id>';
```

### 11.2 Revoke Pro

```sql
UPDATE users_config SET pro_until = NULL
WHERE todoist_user_id = '<todoist_id>';
```

### 11.3 Reset AI quota (support only)

```sql
DELETE FROM ai_request_events WHERE user_id = '<uuid>';
UPDATE users_config
SET ai_quota_denied_notified_at = NULL
WHERE id = '<uuid>';
```

### 11.4 Change the Free limit globally

```sql
ALTER DATABASE postgres SET app.ai_quota_free_max = '10';
-- New connections pick this up. Existing poolers may require SELECT pg_reload_conf().
```

## 12. Risks & mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Upsell-comment spam on retry | Atomic `UPDATE ... WHERE ai_quota_denied_notified_at OLD RETURNING`. Concurrency test exercises 10 parallel denials. |
| 2 | Fail-open bypasses paywall | **Fail-closed** on RPC error. No upsell on error to avoid user-visible spam during outages. Sentry + log alert page on failure spikes. |
| 3 | Clock skew JS ↔ DB | All tier derivation and window math in DB (`now()`). Frontend only renders strings the RPC returned. |
| 4 | Counter pollution from Settings reads | Dedicated `STABLE`, insert-free `get_ai_quota_status`. Integration test asserts no event inserted. |
| 5 | Cost blowout on Pro | Accepted. Sub-project B revisits with real usage. |
| 6 | `ai_request_events` unbounded growth | Retention cron (sub-project E) deletes `event_time < now() - 90 days`. Current scale: ≤ 150 rows/day project-wide. Indexed for 24h lookup (partial index `WHERE counted`). |
| 7 | Todoist retries on 4xx/5xx → replay storms | All paths except HMAC/malformed return 200. Existing idempotency table handles duplicates anyway. |
| 8 | Double-count via legacy `increment_ai_requests` | Migration drops or redirects the function. Integration test asserts exactly +1 on `total_ai_requests` per trigger. |
| 9 | Trigger-word drift (user changes custom `trigger_word`) | Quota check runs inside the existing `shouldTriggerAi` branch; matches current detection exactly. No new trigger logic. |
| 10 | Sentry flood on denial events | Denials go to logs, not Sentry. |
| 11 | `app.ai_quota_free_max` GUC missing or misconfigured (0, negative, non-numeric) | RPC clamps any invalid value to 5 — never silently grants unlimited. Unit test covers all bad values. |
| 12 | AI pipeline failure burns free-tier quota | Refund via `refund_ai_quota(event_id)` in the webhook `catch`. Idempotent. Retry is free. |
| 13 | BYOK bypass via empty/whitespace key | Tier predicate requires `length(trim(custom_ai_api_key)) > 0`. Direct unit test on empty and whitespace inputs. |
| 14 | Quota claimed for non-AI webhook paths (`item:updated` dedupe, control-task filter, self-comment) | Claim moved to top of `runAiForTask` — single entry point for every real AI attempt. Pre-flight guards run first. Integration test asserts no event row for guarded-out paths. |

## 13. Out of scope

- **B** — Stripe checkout, webhooks, `pro_until` automation, dunning, fair-use caps.
- **C** — Feature-level gating (web_search, digest, model picker by tier).
- **D** — Landing-page pricing cards + rich Settings upgrade flow.
- **E** — Historical usage dashboard, retention cron.

Integration contract with future sub-projects: **`pro_until` on `users_config` + tier derivation inside `claim_ai_quota` / `get_ai_quota_status`**. Changing either requires a new spec.

## 14. Acceptance criteria

- [ ] Migration 00010 applies cleanly on fresh and production snapshot DB.
- [ ] Tier derivation correct for all 12 signal combinations (DB function test); empty/whitespace `custom_ai_api_key` resolves to `free`, not `byok`.
- [ ] Free user's 6th trigger in 24 h → denied, upsell posted exactly once, response 200.
- [ ] Pro user with `pro_until > now()` → allowed regardless of count; event row `counted = true`.
- [ ] BYOK user → allowed regardless of count; event row `counted = true`.
- [ ] 10 concurrent denials → exactly 1 upsell comment (concurrency test).
- [ ] `GET /tier` returns correct shape per tier and inserts **zero** rows into `ai_request_events`.
- [ ] Settings page renders tier badge + counter (Free only) + disabled CTA; no hard-coded "5" or "24h" in UI source; copy never says "today".
- [ ] Webhook returns 200 for every quota outcome (allowed / denied / blocked / RPC failure); 401 only on HMAC failure; 400 only on malformed body; 405 only on non-POST.
- [ ] `claim_ai_quota` call happens exactly once per real AI attempt, inside `runAiForTask`, after all pre-flight guards; guarded-out webhook events insert zero rows.
- [ ] AI-pipeline exception after claim → `refund_ai_quota(event_id)` flips the row to `counted = false`; quota count decreases by 1; retry succeeds as a fresh attempt.
- [ ] `total_ai_requests` increments exactly once per **successful** AI reply (unchanged semantics from today) — not on denial, not on refunded failure.
- [ ] Legacy `increment_ai_requests` either dropped (with migration 00010) or retained with documented reason; no dual-increment paths.
- [ ] `app.ai_quota_free_max` misconfigurations (0, negative, non-numeric, missing) all resolve to 5.
- [ ] Manual Pro grant / revoke / reset SQL documented in README and in `docs/ops/`.
- [ ] All Deno unit + integration + SQL function tests pass; frontend Vitest passes.
- [ ] Zero `ai_quota_rpc_failure` logs during 24 h staging soak.

## 15. Implementation order (hand-off to writing-plans)

1. Migration 00010 — columns, table, indexes, RPCs, tests for each RPC path.
2. `_shared/tier.ts` + unit tests (`formatUpsellComment`, `isUnlimited`).
3. `_shared/ai-quota.ts` + unit tests (RPC wrappers, fail-closed).
4. Webhook integration in `webhook/handler.ts` + integration tests.
5. Settings `GET /tier` subroute + integration tests.
6. Frontend Plan card + Vitest.
7. Legacy-function audit + cleanup + migration adjustment.
8. README + manual-ops docs + cutover runbook.
