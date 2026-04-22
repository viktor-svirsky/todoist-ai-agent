import { assertThrows } from "@std/assert";

Deno.test({
  name: "getStripe throws with helpful message when STRIPE_SECRET_KEY is missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    Deno.env.delete("STRIPE_SECRET_KEY");
    const mod = await import(
      `../_shared/stripe.ts?t=${Date.now()}`
    );
    mod.__resetStripeForTests();
    assertThrows(() => mod.getStripe(), Error, "STRIPE_SECRET_KEY");
  },
});
