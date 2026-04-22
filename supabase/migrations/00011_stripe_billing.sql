-- supabase/migrations/00011_stripe_billing.sql
-- Monetization sub-project B: Stripe integration.
-- Spec: docs/superpowers/specs/2026-04-21-stripe-integration-design.md

ALTER TABLE users_config
  ADD COLUMN stripe_customer_id           text DEFAULT NULL,
  ADD COLUMN stripe_subscription_id       text DEFAULT NULL,
  ADD COLUMN stripe_price_id              text DEFAULT NULL,
  ADD COLUMN stripe_status                text DEFAULT NULL,
  ADD COLUMN stripe_current_period_end    timestamptz DEFAULT NULL,
  ADD COLUMN stripe_cancel_at_period_end  boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX users_config_stripe_customer_id_idx
  ON users_config (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX users_config_stripe_subscription_id_idx
  ON users_config (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE stripe_events (
  id              text PRIMARY KEY,
  type            text NOT NULL,
  user_id         uuid REFERENCES users_config(id) ON DELETE SET NULL,
  livemode        boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  payload_digest  text NOT NULL
);

CREATE INDEX stripe_events_type_time_idx
  ON stripe_events (type, received_at DESC);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY stripe_events_deny_all ON stripe_events
  FOR ALL USING (false) WITH CHECK (false);
