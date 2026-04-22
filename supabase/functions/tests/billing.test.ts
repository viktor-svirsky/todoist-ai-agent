import { assertEquals } from '@std/assert';
import { writeFromRefund, writeFromSubscription } from '../_shared/billing.ts';

// deno-lint-ignore no-explicit-any
const SUB = (over: Partial<any> = {}): any => ({
  id: 'sub_1',
  status: 'active',
  current_period_end: Math.floor(Date.parse('2026-05-21T00:00:00Z') / 1000),
  cancel_at_period_end: false,
  items: { data: [{ price: { id: 'price_1' } }] },
  ...over,
});

Deno.test('active -> pro_until = period_end', () => {
  const w = writeFromSubscription(SUB(), null);
  assertEquals(w.pro_until, '2026-05-21T00:00:00.000Z');
  assertEquals(w.stripe_status, 'active');
  assertEquals(w.stripe_cancel_at_period_end, false);
  assertEquals(w.stripe_subscription_id, 'sub_1');
  assertEquals(w.stripe_price_id, 'price_1');
  assertEquals(w.stripe_current_period_end, '2026-05-21T00:00:00.000Z');
});

Deno.test('trialing -> pro_until = period_end', () => {
  const w = writeFromSubscription(SUB({ status: 'trialing' }), null);
  assertEquals(w.pro_until, '2026-05-21T00:00:00.000Z');
  assertEquals(w.stripe_status, 'trialing');
});

Deno.test('active + cancel_at_period_end -> pro_until still period_end', () => {
  const w = writeFromSubscription(SUB({ cancel_at_period_end: true }), null);
  assertEquals(w.pro_until, '2026-05-21T00:00:00.000Z');
  assertEquals(w.stripe_cancel_at_period_end, true);
});

Deno.test('past_due -> pro_until omitted', () => {
  const w = writeFromSubscription(SUB({ status: 'past_due' }), '2099-01-01T00:00:00Z');
  assertEquals(w.pro_until, undefined);
  assertEquals(w.stripe_status, 'past_due');
});

Deno.test('unpaid -> pro_until omitted', () => {
  const w = writeFromSubscription(SUB({ status: 'unpaid' }), '2099-01-01T00:00:00Z');
  assertEquals(w.pro_until, undefined);
});

Deno.test('incomplete -> pro_until omitted', () => {
  const w = writeFromSubscription(SUB({ status: 'incomplete' }), null);
  assertEquals(w.pro_until, undefined);
});

Deno.test('canceled -> subscription_id cleared and pro_until clamped to now', () => {
  const far = '2099-01-01T00:00:00Z';
  const w = writeFromSubscription(SUB({ status: 'canceled' }), far);
  assertEquals(w.stripe_subscription_id, null);
  if (!w.pro_until || w.pro_until >= far) throw new Error('pro_until must be clamped');
});

Deno.test('canceled with no existing pro_until -> null', () => {
  const w = writeFromSubscription(SUB({ status: 'canceled' }), null);
  assertEquals(w.pro_until, null);
});

Deno.test('canceled with already-past pro_until preserves past value', () => {
  const past = '2000-01-01T00:00:00Z';
  const w = writeFromSubscription(SUB({ status: 'canceled' }), past);
  assertEquals(w.pro_until, past);
});

Deno.test('missing price item -> stripe_price_id null', () => {
  const w = writeFromSubscription(SUB({ items: { data: [] } }), null);
  assertEquals(w.stripe_price_id, null);
});

Deno.test('refund clamps pro_until to now', () => {
  const w = writeFromRefund('2099-01-01T00:00:00Z');
  if (!w.pro_until || w.pro_until >= '2099-01-01T00:00:00Z') {
    throw new Error('not clamped');
  }
});

Deno.test('refund on already-expired pro_until leaves past value alone', () => {
  const past = '2000-01-01T00:00:00Z';
  const w = writeFromRefund(past);
  assertEquals(w.pro_until, past);
});

Deno.test('refund on null pro_until -> null', () => {
  const w = writeFromRefund(null);
  assertEquals(w.pro_until, null);
});
