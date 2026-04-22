# Stripe Integration — Design Spec

**Sub-project:** B of monetization (2 of 5).
**Date:** 2026-04-21.
**Status:** Approved for implementation planning.
**Depends on:** sub-project A (tier model + AI quota) — merged.
**Blocks:** sub-project C (feature gating), D (pricing UI polish), E (usage dashboard).

## 1. Goal

Ship paid self-service for the Pro tier. Free users subscribe via Stripe Checkout; Stripe webhooks flip `users_config.pro_until` server-side; users cancel via the Stripe Billing Portal; a user who configures BYOK has their active subscription auto-cancelled.

Sub-project A defined tier precedence as BYOK > Pro > Free, with SQL as the single source of truth. This sub-project never writes `tier` — only `pro_until` (and BYOK auto-cancel requests). All tier derivation continues to live in `claim_ai_quota` / `get_ai_quota_status`.

## 2. Scope

**In:**
- Create Checkout Session (Free → Pro, $5/mo, USD, single price ID).
- Billing Portal session (cancel, update card, view invoices).
- Webhook endpoint (`/stripe-webhook`) consuming signed events; flips `pro_until`.
- Idempotent event processing (Stripe event id dedupe).
- BYOK auto-cancel (`cancel_at_period_end = true`) when Settings PUT adds a non-empty `custom_ai_api_key` and an active subscription exists.
- Frontend: enable the "Upgrade to Pro" CTA on the existing Settings Plan card; add a "Manage billing" link for Pro users.
- Tests (Deno fixture-based webhook tests + signature rejection + replay + BYOK path).

**Out:**
- Proration policies beyond Stripe defaults (we accept `create_prorations`).
- Teams / seats, annual plans, coupons, promo codes.
- Tax beyond the "Stripe Tax: enabled in dashboard" toggle (future).
- Dunning UI (Stripe hosts emails; our UI only reflects the derived `pro_until`).
- Refund-on-downgrade of AI quota (see §7.5 — explicitly out of scope).
- Multi-currency. USD only.

## 3. Architecture

### 3.1 Modules

| File | New / Modified | Purpose |
|------|----------------|---------|
| `_shared/stripe.ts` | new | Lazy singleton Stripe client (`stripe-node` v19). Exposes typed wrappers: `createCheckoutSession`, `createBillingPortalSession`, `cancelSubscriptionAtPeriodEnd`, `constructWebhookEvent` (Deno-safe: `constructEventAsync`). No side effects on import. |
| `_shared/billing.ts` | new | Pure mapping from Stripe `Subscription` + `Invoice` state to `pro_until` writes. No Stripe API calls, no DB calls — receives prepared inputs, returns a `ProUntilWrite` command. Enables unit tests without HTTP. |
| `stripe-checkout/index.ts` | new (function) | `POST /stripe-checkout` — auth-gated; returns `{ url }` for the hosted Checkout page. |
| `stripe-portal/index.ts` | new (function) | `POST /stripe-portal` — auth-gated; returns `{ url }` for the Billing Portal. |
| `stripe-webhook/index.ts` | new (function) | `POST /stripe-webhook` — unauthenticated (Stripe signs); verifies HMAC, dedupes event id, dispatches to `billing.ts`, writes `pro_until`. |
| `settings/handler.ts` | modified | On `PUT` that adds a non-empty `custom_ai_api_key` while `pro_until > now()` and a `stripe_subscription_id` exists, call `cancelSubscriptionAtPeriodEnd` (best-effort; Sentry on failure). Never blocks the PUT. |
| `frontend/src/components/PlanCard.tsx` | modified | Enable "Upgrade to Pro" button (POSTs to `/stripe-checkout`, redirects to `url`). Add "Manage billing" for `tier === "pro"`. |
| `frontend/src/pages/BillingReturn.tsx` | new | Success/cancel return page. Polls `GET /settings/tier` until `tier === "pro"` or 15s timeout. Handles the webhook-vs-redirect race (§5). |

### 3.2 Data model (additions on top of sub-project A)

Migration: `supabase/migrations/00011_stripe_billing.sql`.

```sql
-- Stripe customer + subscription linkage on the existing users_config row.
-- Decision (see §11.1): single-row extension, not a separate billing_accounts table.
ALTER TABLE users_config
  ADD COLUMN stripe_customer_id     text DEFAULT NULL,
  ADD COLUMN stripe_subscription_id text DEFAULT NULL,
  ADD COLUMN stripe_price_id        text DEFAULT NULL,
  ADD COLUMN stripe_status          text DEFAULT NULL,
  ADD COLUMN stripe_current_period_end  timestamptz DEFAULT NULL,
  ADD COLUMN stripe_cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX users_config_stripe_customer_id_idx
  ON users_config (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX users_config_stripe_subscription_id_idx
  ON users_config (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Idempotent event log: one row per Stripe event id we successfully processed.
CREATE TABLE stripe_events (
  id              text PRIMARY KEY,                   -- Stripe event.id ("evt_...")
  type            text NOT NULL,
  user_id         uuid REFERENCES users_config(id) ON DELETE SET NULL,
  livemode        boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  payload_digest  text NOT NULL                       -- sha256 of raw body, for audit
);

CREATE INDEX stripe_events_type_time_idx ON stripe_events (type, received_at DESC);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_events_deny_all ON stripe_events
  FOR ALL USING (false) WITH CHECK (false);
```

RLS: `stripe_events` is service-role only. `users_config` keeps its existing policy (`auth.uid() = id`); the new Stripe columns are never exposed to the anon role because the client reads tier-derived data through `GET /settings/tier` which scrubs them.

### 3.3 Checkout flow

```
user clicks "Upgrade to Pro"
  → frontend POST /stripe-checkout  (Authorization: Bearer <user jwt>)
  → function:
      validate auth (existing supabase user client)
      load users_config row
      if stripe_customer_id is null:
          customer = stripe.customers.create({
            email, metadata: { user_id }
          })
          UPDATE users_config SET stripe_customer_id = customer.id WHERE id = user.id
      session = stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripe_customer_id,
        line_items: [{ price: STRIPE_PRICE_ID_PRO_MONTHLY, quantity: 1 }],
        success_url: APP_URL + '/billing/return?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:  APP_URL + '/settings?billing=cancelled',
        client_reference_id: user.id,        // belt-and-suspenders; also metadata
        subscription_data: { metadata: { user_id: user.id } },
        metadata: { user_id: user.id },
        allow_promotion_codes: false,
        automatic_tax: { enabled: true }     // Stripe Tax toggle; no-op if disabled
      }, { idempotencyKey: 'checkout:' + user.id + ':' + minute_bucket() })
      return { url: session.url }
  → browser redirects to session.url
  → on success, Stripe redirects to APP_URL/billing/return
```

`minute_bucket()` is `floor(Date.now() / 60_000)` — scopes the idempotency key to a 60-second window so an accidental double-click returns the same Checkout URL, while a deliberate retry 2 minutes later produces a fresh session.

### 3.4 Billing Portal flow

```
user clicks "Manage billing" (tier === 'pro')
  → frontend POST /stripe-portal
  → function:
      validate auth
      load stripe_customer_id (404 if null — should not happen for Pro)
      session = stripe.billingPortal.sessions.create({
        customer: stripe_customer_id,
        return_url: APP_URL + '/settings'
      })
      return { url: session.url }
  → browser redirects
```

The portal owns cancel, update card, invoice history. No custom UI for these.

### 3.5 Webhook flow

```
POST /stripe-webhook
  read raw body (required for signature verification)
  sig = req.headers['stripe-signature']
  try:
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET)
  catch:
    → 400 (Stripe retries on non-2xx; signature failure is permanent but 400 is
           what the docs recommend so ops noise is obvious)

  INSERT INTO stripe_events (id, type, livemode, payload_digest)
    VALUES (event.id, event.type, event.livemode, sha256(raw))
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  if no row returned → replay; return 200 immediately (already processed)

  resolve user_id:
    - event.data.object.metadata.user_id     (preferred; we set it)
    - else: lookup users_config WHERE stripe_customer_id = event.data.object.customer
    - else: log + 200 (orphan; e.g., events from test-mode or deleted user)

  dispatch by event.type (§4):
    compute ProUntilWrite via billing.ts
    apply to users_config in a single UPDATE
    UPDATE stripe_events SET processed_at = now(), user_id = <id> WHERE id = event.id

  return 200
```

All DB writes for a single event run in one `UPDATE` so a partial failure leaves the event unprocessed (`processed_at IS NULL`); Stripe's retry will rerun it.

### 3.6 BYOK auto-cancel flow

```
PUT /settings  (user supplies non-empty custom_ai_api_key)
  existing encrypt + update as today
  after successful UPDATE:
    if old.pro_until is future AND old.stripe_subscription_id IS NOT NULL
       AND old.stripe_cancel_at_period_end = false:
      try:
        stripe.subscriptions.update(old.stripe_subscription_id,
                                    { cancel_at_period_end: true },
                                    { idempotencyKey: 'byok-cancel:' + user.id })
        UPDATE users_config SET stripe_cancel_at_period_end = true WHERE id = user.id
        log 'byok_auto_cancel_scheduled'
      catch err:
        Sentry.capture(err)
        log 'byok_auto_cancel_failed'
        -- Do NOT fail the PUT. BYOK key was saved; user keeps Pro until
        -- period end anyway; the next webhook or the cron reconciler will
        -- converge. Retry on next Settings PUT.
  return 200
```

Never cancels immediately with a prorated refund — see §11.3. Never rejects the Settings PUT on a Stripe failure — BYOK is the higher intent; the worst case is the user stays Pro for a few more days.

## 4. Webhook events handled

Minimum set (decision recorded in §11.2):

| Event | Action |
|-------|--------|
| `checkout.session.completed` | First Pro signup. Backfill `stripe_subscription_id`, `stripe_customer_id` (if changed), then treat as `customer.subscription.created`. |
| `customer.subscription.created` | Set `stripe_subscription_id`, `stripe_status`, `stripe_price_id`, `stripe_current_period_end`, `stripe_cancel_at_period_end`. Set `pro_until = current_period_end` iff `status in ('trialing','active')`. |
| `customer.subscription.updated` | Re-derive all four columns. Recompute `pro_until` per §4.1. |
| `customer.subscription.deleted` | Clear `stripe_subscription_id`; set `pro_until = LEAST(pro_until, now())`. (User falls back to Free — or BYOK if they set a key.) |
| `invoice.paid` | On renewal: set `pro_until = current_period_end` from `subscription` lookup on the invoice. |
| `invoice.payment_failed` | Log + observability only; `pro_until` is not shortened here — Stripe will eventually emit `subscription.updated` to `past_due` / `unpaid`, and finally `subscription.deleted` after dunning completes. |
| `charge.refunded` / `charge.dispute.created` | Set `pro_until = LEAST(pro_until, now())` so the user loses Pro immediately on chargeback/refund. (Stripe will follow with `subscription.deleted`; this is defensive — prevents Pro during the gap.) |

All other event types: insert the `stripe_events` row, `processed_at = now()`, no column writes. Unknown events are acknowledged, not dropped silently.

### 4.1 `pro_until` derivation

```
status          | cancel_at_period_end | pro_until
----------------+----------------------+----------------------------------
trialing/active | false                | subscription.current_period_end
trialing/active | true                 | subscription.current_period_end
past_due/unpaid | any                  | unchanged (grace = let Stripe retry)
incomplete      | any                  | unchanged (no Pro yet — they haven't paid)
canceled        | any                  | LEAST(pro_until, now())  (access ends immediately
                                           on a hard cancel; the portal's "cancel at
                                           period end" preserves access because Stripe
                                           keeps status=active until the period rolls)
```

`users_config.stripe_cancel_at_period_end` is stored for UX ("Subscription ends 2026-05-21"); tier gating uses only `pro_until`.

## 5. Clock-skew / race: webhook before redirect return

The webhook (`checkout.session.completed`) frequently arrives before the browser redirect to `/billing/return`. Either order must render Pro correctly.

**Design:**
1. Webhook writes `pro_until` immediately on `checkout.session.completed`.
2. Browser arrives at `/billing/return?session_id=...`.
3. The return page calls `GET /settings/tier` in a polling loop: every 750 ms, up to 15 s, until `tier === "pro"`. Poll stops the instant Pro is observed.
4. If Pro is not observed in 15 s, the page shows a "Payment received — your plan will update shortly. Refresh if it doesn't appear in a minute." message (Pro will appear on the next automatic poll after webhook retry).
5. Crucially, the return page never writes state. It never trusts the `session_id` for upgrade — Stripe webhooks are the only path that writes `pro_until`. This eliminates the class of bugs where a forged `session_id` in the URL grants Pro.

The reverse race (redirect arrives, user opens Settings before any webhook) is resolved by the same poll. Users who hard-closed the tab will see Pro on next login; the DB is eventually consistent.

## 6. Env vars

Backend (`supabase/.env.local`, production Supabase secrets):

| Name | Purpose |
|------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_...` / `sk_live_...`. Required. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — signature verification for `/stripe-webhook`. Required. |
| `STRIPE_PRICE_ID_PRO_MONTHLY` | `price_...` for the $5/mo Pro subscription. Required. |
| `APP_URL` | Base URL for success/cancel/return redirects (`https://app.9635783.xyz`). Required. |

Frontend (`frontend/.env.local`): none. Checkout and Portal URLs are returned from backend; publishable key is not needed (no `Stripe.js` on-page).

Env preferred over DB config per CLAUDE.md. No value lives in `users_config`.

## 7. Security considerations

### 7.1 Webhook authentication

- Signature verified with `stripe.webhooks.constructEventAsync` (Deno / async crypto compatible — sync `constructEvent` would throw on Deno edge runtime).
- Raw body required. Deno `Request.text()` before any JSON parse.
- Signature mismatch → 400. Logged with truncated signature header; body is not logged.
- Rotation: `STRIPE_WEBHOOK_SECRET` rotation window handled by Stripe dashboard; we support one secret at a time (rotation procedure in ops runbook).

### 7.2 Replay protection

- `stripe_events.id` is `PRIMARY KEY`. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — if no id returned, event was already seen; short-circuit to 200. This makes every handler safe to retry.
- `payload_digest` (sha256 of raw body) is stored for audit and to detect the pathological case of two different payloads sharing an event id (forbidden by Stripe but verified cheaply).

### 7.3 Checkout session CSRF

Checkout is authenticated by the Supabase user JWT on `POST /stripe-checkout`; the returned URL is one-time and scoped to that user's customer id. `client_reference_id` and `metadata.user_id` are both set so webhook resolution never trusts only one path.

### 7.4 PCI surface

Stripe Checkout + Billing Portal: our server never sees card numbers or CVCs. PCI SAQ-A applicable. No Stripe.js on our page.

### 7.5 AI quota refund on downgrade — explicitly NOT refunded

When Pro lapses, the rolling-24h Free quota applies immediately to future attempts. Past AI messages are neither refunded nor deducted. Free tier has its own window; double-bookkeeping across tier boundaries would be a surprise. Stated here so sub-project E does not silently reintroduce the idea.

### 7.6 Protected path notice

`**/billing/**` and `**/stripe/**` are protected paths per CLAUDE.md. Reviewers are expected.

## 8. Failure modes

| # | Failure | Mitigation |
|---|--------|------------|
| 1 | Webhook arrives before redirect | `/billing/return` polls `GET /settings/tier`; webhook is canonical writer (§5). |
| 2 | Redirect arrives before webhook | Same poll handles it. |
| 3 | Webhook signature rotation mid-deploy | One-secret model; ops runbook documents dashboard rotation + immediate Supabase secret push before disabling old. |
| 4 | Duplicate webhook delivery | PK on `stripe_events.id` + `ON CONFLICT DO NOTHING`. |
| 5 | `checkout.session.completed` without `subscription.created` yet | `checkout.session.completed` handler calls `stripe.subscriptions.retrieve(session.subscription)` to hydrate period/status, then applies the same mapping. Avoids races inside Stripe. |
| 6 | BYOK auto-cancel call fails | Sentry + log; PUT still succeeds. Reconciler cron (§9) retries nightly. |
| 7 | Customer deleted manually in Stripe dashboard | `customer.deleted` event is ignored beyond logging. Row keeps `stripe_customer_id` so operator intervention is explicit; next Checkout creates a new customer only if the id is null — prevents ghost-row re-subscription without ops decision. Runbook covers the cleanup SQL. |
| 8 | Forged `session_id` in `/billing/return` | Page never grants Pro from URL; only polls `GET /settings/tier`. |
| 9 | Clock drift between DB `now()` and Stripe `current_period_end` | `pro_until = current_period_end` directly; quota derivation uses `now() < pro_until`. Few seconds of skew don't matter. |
| 10 | Subscription lingers after user deletes account | `ON DELETE SET NULL` on `stripe_events.user_id`. Operator must cancel the sub manually — documented in runbook; out of automated scope. |
| 11 | Stripe outage during Checkout creation | Surface 502 + user-visible "Payment service temporarily unavailable. Try again." Webhook flow is unaffected. |
| 12 | `invoice.payment_failed` with no recovery | Stripe emits `subscription.deleted` after its dunning window; we act on that. No custom dunning. |
| 13 | Multiple browser tabs hammer "Upgrade" | Minute-bucket idempotency key returns the same session URL inside a 60 s window. |

## 9. Observability

- Sentry: `stripe_webhook_signature_failure`, `stripe_webhook_unhandled_error`, `stripe_byok_cancel_failed`, `stripe_checkout_create_failed`.
- Structured logs on every event: `stripe_event_processed { id, type, user_id, action, duration_ms }`.
- Nightly reconciler (out of scope for this sub-project, noted for sub-project E): query Stripe for all active subs, compare against `users_config.stripe_subscription_id` / `pro_until`, alert on drift. Until then, Stripe's own replay tool in the dashboard is the recovery path.
- Dashboard query (runbook): `SELECT count(*) FROM stripe_events WHERE processed_at IS NULL AND received_at < now() - interval '5 minutes'` — should be 0.

## 10. Test strategy

### 10.1 Deno unit tests (no network)

| File | Coverage |
|------|----------|
| `tests/billing.test.ts` | `billing.ts` pure mapper: 1 case per row in the §4.1 table, plus `charge.refunded` → `pro_until = LEAST(pro_until, now())`, plus unknown event type → no-op. |
| `tests/stripe-client.test.ts` | Lazy singleton; throws with a helpful message if `STRIPE_SECRET_KEY` missing. |

### 10.2 Deno integration tests (fixture + mocked `fetch`)

All webhook tests build a raw body and a valid `stripe-signature` header signed with a **test** `STRIPE_WEBHOOK_SECRET` set at the top of the test file. Stripe's documented signature format is a timestamp + HMAC-SHA256; helper `sign(body, secret, t=Date.now())` lives in `tests/helpers/stripe-sig.ts`.

| File | Coverage |
|------|----------|
| `tests/stripe-webhook.test.ts` | (a) Bad signature → 400, no `stripe_events` row. (b) Replay: same event id posted twice → 200/200, one row, single `pro_until` write. (c) `checkout.session.completed` → `pro_until = current_period_end`. (d) `customer.subscription.updated` with `cancel_at_period_end=true` → `stripe_cancel_at_period_end = true`, `pro_until` unchanged. (e) `customer.subscription.deleted` → `pro_until = LEAST(pro_until, now())`. (f) `invoice.paid` on renewal → `pro_until` moves forward. (g) `charge.refunded` → `pro_until` clamped to now. (h) Unknown event type → 200, row inserted, no column write. (i) Orphan event (no `user_id` resolvable) → 200, row inserted with `user_id = NULL`. |
| `tests/stripe-checkout.test.ts` | (a) Unauth → 401. (b) First call creates customer and returns `url`. (c) Second call (same minute) returns identical URL via idempotency key. |
| `tests/stripe-portal.test.ts` | (a) Unauth → 401. (b) No `stripe_customer_id` → 409. (c) Happy path returns `url`. |
| `tests/settings-byok-cancel.test.ts` | (a) PUT adding non-empty `custom_ai_api_key` while `pro_until` future and `stripe_subscription_id` set → `cancel_at_period_end` call observed; `stripe_cancel_at_period_end = true`. (b) Stripe API error → PUT still 200; Sentry captured. (c) Empty / whitespace key → no cancel call. (d) Already-cancelled sub → no second cancel call. |

### 10.3 SQL tests

Migration applies cleanly on fresh DB and on a snapshot. Unique partial indexes reject two users sharing one `stripe_customer_id`.

### 10.4 Local-dev loop (Stripe CLI)

```
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

Runbook documents `stripe fixtures` to exercise the full lifecycle.

### 10.5 Frontend Vitest

- `PlanCard` with `tier === "free"` renders enabled "Upgrade to Pro" button; click calls `POST /stripe-checkout` (mocked) and sets `window.location`.
- `PlanCard` with `tier === "pro"` renders "Manage billing"; click calls `POST /stripe-portal`.
- `BillingReturn` polls `GET /settings/tier`, stops on Pro, shows timeout message after 15 s (fake timers).

### 10.6 E2E

Out of scope for the fixture-driven tests above. Sub-project D will run a scripted Checkout against Stripe test mode in CI against a long-lived test account.

## 11. Design decisions

### 11.1 Customer id storage: single-row vs. separate `billing_accounts`

**Decision:** extend `users_config` with Stripe columns.

Rationale: every `users_config` row maps 1:1 to one Stripe customer. We will never attach two customers to one user or vice versa (no teams in scope). A join table buys composability we don't need and costs us an extra query on the hot tier-derivation path (`claim_ai_quota` already `SELECT *` from `users_config`). If teams land, a future migration moves these columns into `billing_accounts` and backfills in one pass — the public contract (`pro_until`) remains on `users_config`.

Unique partial indexes on `stripe_customer_id` and `stripe_subscription_id` defend against double-write bugs.

### 11.2 Webhook events handled

**Decision:** the table in §4. Rationale: minimum set that correctly tracks `pro_until` through trial, pay, renew, fail, cancel, refund, chargeback. `invoice.payment_failed` is intentionally observe-only — Stripe's dunning is the authority on "when does access really end".

Idempotency: `stripe_events.id` primary key + `ON CONFLICT DO NOTHING RETURNING id` short-circuit. Tested by posting the same event twice (§10.2.b).

### 11.3 BYOK auto-cancel trigger — cancel at period end vs. immediate+prorate

**Decision:** `cancel_at_period_end = true` (Stripe default). No prorated refund.

Rationale: the user is mid-billing-period and is switching to BYOK of their own volition, not as a refund claim. Proration refund opens an abuse vector (subscribe, burn quota, flip BYOK for refund, repeat). Cancel-at-period-end preserves "you got what you paid for" and keeps our books simple (Stripe's default proration behaviour). The user keeps Pro until the period naturally ends — and since BYOK wins precedence anyway (sub-project A), they get BYOK-unlimited immediately with no downside.

Second-opinion check skipped — the abuse-vector argument is decisive.

### 11.4 Clock-skew / webhook-before-redirect race

**Decision:** return page polls `GET /settings/tier`; never writes state. See §5.

Alternative (rejected): have the return page call a server endpoint that reads `session_id` from URL, verifies with Stripe, and grants Pro. Rejected because (a) it duplicates webhook logic, (b) the `session_id` in the URL is attacker-influencable, (c) a forged `session_id` + a timing window could grant Pro without payment; the signed-webhook-only path is strictly more secure.

### 11.5 AI quota refund on downgrade

**Decision:** not refunded. Stated for the record in §7.5. Free tier's rolling-24h window self-heals within a day; explicit refunds would leak Pro-era usage into the Free telemetry and violate the "DB is the source of truth for quota" invariant.

### 11.6 Test strategy

**Decision:** Stripe CLI for local, fixture-based + signed webhook tests in Deno for CI. Covered in §10. No live-API calls in CI.

## 12. Acceptance criteria

- [ ] Migration 00011 applies cleanly on a fresh DB and on a production snapshot.
- [ ] `POST /stripe-checkout` (Free user) returns a Checkout URL; browser redirect to Stripe loads.
- [ ] `POST /stripe-portal` (Pro user) returns a Billing Portal URL.
- [ ] `POST /stripe-portal` when `stripe_customer_id IS NULL` returns 409.
- [ ] Webhook with invalid signature returns 400; no row in `stripe_events`.
- [ ] Webhook event delivered twice → single `users_config` write; second call returns 200 without re-dispatching.
- [ ] Each of the 7 event types in §4 flips `pro_until` / Stripe mirror columns per §4.1, with a dedicated test case.
- [ ] BYOK PUT while Pro-active triggers `cancel_at_period_end` on Stripe; `stripe_cancel_at_period_end = true`; PUT still returns 200 if Stripe call fails.
- [ ] Stripe `cancel_at_period_end` call is idempotent: rapid double-PUT results in a single Stripe call (observed via test fetch-mock counter).
- [ ] `/billing/return` polls `GET /settings/tier` and renders Pro within 15 s of webhook processing; never writes state.
- [ ] Frontend `PlanCard` renders "Upgrade to Pro" for Free, "Manage billing" for Pro; both POST to the correct endpoint and redirect to the returned URL.
- [ ] `deno lint` and `deno test supabase/functions/tests/` pass.
- [ ] `tsc --noEmit` on frontend passes; Vitest suite passes.
- [ ] Runbook `docs/ops/stripe-runbook.md` covers: local Stripe CLI loop, webhook secret rotation, manual customer-cleanup, observability queries.
- [ ] No emoji anywhere in code or docs.

## 13. Out of scope / future

- Annual plans, coupons, promo codes.
- Stripe Tax auto-file (we enable the toggle; filings are future).
- Teams / seats.
- Dunning UI.
- Nightly Stripe ↔ DB reconciler cron (sub-project E).
- Refund-on-downgrade of AI quota.
- Proration policies beyond Stripe's defaults.
- Multi-currency.

## 14. Implementation order (hand-off to writing-plans)

1. Migration 00011 — columns, indexes, `stripe_events` table, RLS.
2. `_shared/stripe.ts` lazy client + `_shared/billing.ts` pure mapper + unit tests.
3. `stripe-webhook` function + signed fixture tests.
4. `stripe-checkout` function + auth + idempotency tests.
5. `stripe-portal` function + tests.
6. Settings BYOK auto-cancel hook + tests.
7. Frontend `PlanCard` CTA wiring + `BillingReturn` page + Vitest.
8. Runbook + README.
