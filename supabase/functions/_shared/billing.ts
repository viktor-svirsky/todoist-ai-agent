import type Stripe from 'stripe';

export interface ProUntilWrite {
  pro_until?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  stripe_status?: string | null;
  stripe_current_period_end?: string | null;
  stripe_cancel_at_period_end?: boolean;
  stripe_customer_id?: string | null;
}

export function writeFromSubscription(
  sub: Stripe.Subscription,
  existingProUntil: string | null,
): ProUntilWrite {
  // Stripe API 2025-03-31.basil moved current_period_end from Subscription
  // onto each SubscriptionItem. Fall back to the legacy field for older
  // payloads (and test fixtures) that still carry it on the subscription.
  const periodEndUnix = sub.items?.data?.[0]?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof periodEndUnix !== 'number' || !Number.isFinite(periodEndUnix)) {
    throw new Error(`subscription ${sub.id} missing current_period_end`);
  }
  const periodEnd = new Date(periodEndUnix * 1000).toISOString();
  const base: ProUntilWrite = {
    stripe_subscription_id: sub.id,
    stripe_price_id: sub.items.data[0]?.price.id ?? null,
    stripe_status: sub.status,
    stripe_current_period_end: periodEnd,
    stripe_cancel_at_period_end: Boolean(sub.cancel_at_period_end),
  };

  switch (sub.status) {
    case 'trialing':
    case 'active':
      return { ...base, pro_until: periodEnd };
    case 'canceled':
      return {
        ...base,
        stripe_subscription_id: null,
        pro_until: clampToNow(existingProUntil),
      };
    default:
      return base;
  }
}

export function writeFromRefund(existingProUntil: string | null): ProUntilWrite {
  return { pro_until: clampToNow(existingProUntil) };
}

function clampToNow(existing: string | null): string | null {
  if (!existing) return null;
  const now = new Date().toISOString();
  return existing < now ? existing : now;
}
