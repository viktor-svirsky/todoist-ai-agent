# Stripe Billing Runbook

Operational guide for the Stripe integration (Free → Pro $5/mo, Billing Portal, signed webhooks, BYOK auto-cancel).

Spec: `docs/superpowers/specs/2026-04-21-stripe-integration-design.md`

## Environment variables

| Var | Where | Notes |
|-----|-------|-------|
| `STRIPE_SECRET_KEY` | Edge Functions | `sk_test_...` locally, `sk_live_...` in prod |
| `STRIPE_WEBHOOK_SECRET` | Edge Functions | `whsec_...` from Stripe CLI (local) or dashboard endpoint (prod) |
| `STRIPE_PRICE_ID_PRO_MONTHLY` | Edge Functions | `price_...` of the recurring monthly Pro price |
| `APP_URL` | Edge Functions | e.g. `http://localhost:5173` or `https://todoist-ai-agent.pages.dev` |

## Local development loop

Stripe CLI forwards live test events from the Stripe servers to your local Supabase Edge Functions runtime.

```bash
# Terminal 1: serve functions
npm run functions:serve

# Terminal 2: forward webhooks (prints whsec_... — paste into supabase/.env.local)
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook

# Terminal 3: drive events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger charge.refunded
stripe trigger charge.dispute.created
```

End-to-end manual smoke (test card `4242 4242 4242 4242`, any future date, any CVC):

1. Sign in as a Free user in the frontend.
2. Click Upgrade → land on Stripe Checkout → pay.
3. `/billing/return` should flip to Pro within ~3s.
4. Settings PUT with non-empty `custom_ai_api_key` → `users_config.stripe_cancel_at_period_end = true`, visible in Stripe dashboard.
5. Click Manage billing → Stripe Billing Portal opens.
6. `stripe trigger charge.refunded` → `pro_until` clamps to `now()`; PlanCard reverts to Free.

## Webhook secret rotation (no downtime)

1. Stripe dashboard → Developers → Webhooks → endpoint → "Roll secret" (creates a new `whsec_...`, old one stays valid for the configured grace period).
2. Update Supabase secret:
   ```bash
   SUPABASE_ACCESS_TOKEN=... npx supabase secrets set \
     STRIPE_WEBHOOK_SECRET=whsec_new... \
     --project-ref nztpwctdgeexrxqcocjm
   ```
3. Wait for Edge Function rollout (`npx supabase functions deploy stripe-webhook` redeploys with the new env).
4. Send a test event from the dashboard; confirm 200.
5. Click "Disable old secret" in the Stripe dashboard.

## Observability

Run periodically (or alert on > 0):

```sql
-- Unprocessed events older than 5 minutes
SELECT id, type, received_at
FROM stripe_events
WHERE processed_at IS NULL
  AND received_at < now() - interval '5 minutes'
ORDER BY received_at ASC;

-- Recent event volume by type
SELECT type, count(*)
FROM stripe_events
WHERE received_at > now() - interval '1 day'
GROUP BY type
ORDER BY count(*) DESC;
```

Logs to grep in Edge Function output:
- `stripe_webhook_signature_failure` — bad/forged signature.
- `stripe_event_replay_ignored` — dedupe hit (expected, low volume).
- `byok_auto_cancel_scheduled` — BYOK PUT triggered subscription cancel.
- `byok_auto_cancel_failed` (Sentry) — Stripe call failed; PUT still succeeded.

## Manual operator actions

Grant Pro without going through Stripe (support comp, beta tester):

```sql
UPDATE users_config
SET pro_until = now() + interval '1 month'
WHERE id = '<user-uuid>';
```

Note: this bypasses Stripe entirely; the user has no subscription_id. Do not mix with a real Stripe subscription on the same row.

Resync from Stripe after a missed event (e.g. webhook outage):

```bash
stripe events resend <evt_id>
```

Identify a ghost customer (Stripe customer exists but no `users_config` row points at it):

```sql
SELECT stripe_customer_id, count(*)
FROM users_config
WHERE stripe_customer_id IS NOT NULL
GROUP BY stripe_customer_id
HAVING count(*) > 1;
-- expect zero rows
```

Force-clamp Pro for a specific user (refund issued out-of-band):

```sql
UPDATE users_config
SET pro_until = now()
WHERE id = '<user-uuid>'
  AND pro_until > now();
```

## Failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Webhook returns 400 in prod | Wrong `STRIPE_WEBHOOK_SECRET` after rotation | Re-set secret, redeploy function |
| Pro doesn't activate after Checkout | Webhook not reaching backend | Check Stripe dashboard → Webhooks → recent deliveries |
| Duplicate `pro_until` writes | `stripe_events` insert race | PK conflict path is idempotent — investigate if seen |
| BYOK PUT fails after Stripe error | Auto-cancel must be best-effort | Verify `maybeAutoCancelForByok` swallows errors via Sentry |
