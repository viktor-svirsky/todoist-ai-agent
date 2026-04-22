import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "./env.ts";

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  _client = new Stripe(STRIPE_SECRET_KEY(), {
    apiVersion: "2025-03-31.basil",
    httpClient: Stripe.createFetchHttpClient(),
  });
  return _client;
}

export function __resetStripeForTests(): void {
  _client = null;
}
