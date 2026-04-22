import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { startCheckout } from "../lib/billing";
import {
  AI_QUOTA_FREE_MAX,
  BILLING_ENABLED,
  PRO_PRICE_USD,
} from "../lib/pricing-constants";
import PublicLayout from "../components/PublicLayout";
import PricingColumn from "../components/PricingColumn";
import type { PricingColumnCta } from "../components/PricingColumn";
import { Head } from "../components/Head";

function startOAuth(hash?: string) {
  sessionStorage.setItem("oauth_pending", "true");
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const suffix = hash ? `#${hash}` : "";
  window.location.href = `${supabaseUrl}/functions/v1/auth-start${suffix}`;
}

export default function Pricing() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  async function onSubscribe() {
    if (!BILLING_ENABLED) return;
    if (!session) {
      startOAuth("pro");
      return;
    }
    try {
      await startCheckout();
    } catch {
      setError("Couldn't start checkout. Try again.");
    }
  }

  const freeFeatures = [
    `${AI_QUOTA_FREE_MAX} AI messages per rolling 24 hours`,
    "Web search, memory, and tool use",
    "Works on every Todoist task",
    "Email support",
  ];

  const proFeatures = [
    "Unlimited AI messages",
    "Everything in Free",
    "Priority support",
    "Cancel anytime from Settings",
  ];

  const byokFeatures = [
    "Unlimited messages on your key",
    "Anthropic, OpenAI, or any OpenAI-compatible endpoint",
    "Everything in Free",
    "You pay your provider directly",
  ];

  const freeCta: PricingColumnCta = {
    label: "Start free",
    onClick: session ? undefined : () => startOAuth(),
    href: session ? "/settings" : undefined,
  };

  let proCta: PricingColumnCta;
  if (!BILLING_ENABLED) {
    proCta = {
      label: "Coming soon",
      disabled: true,
      title:
        "Stripe checkout launches soon — contact hi@9635783.xyz to be notified.",
    };
  } else if (!session) {
    proCta = {
      label: "Start free, then upgrade",
      onClick: () => startOAuth("pro"),
    };
  } else {
    proCta = { label: "Subscribe", onClick: onSubscribe };
  }

  const byokCta: PricingColumnCta = {
    label: "Use your own key",
    href: "/settings#ai-provider",
  };

  return (
    <PublicLayout>
      <Head
        title="Pricing — Todoist AI Agent"
        description={`AI in your Todoist comments. Free plan with ${AI_QUOTA_FREE_MAX} AI messages per day, Pro at $${PRO_PRICE_USD}/month, or bring your own key.`}
        canonical="https://9635783.xyz/pricing"
      />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            Simple pricing. Cancel anytime.
          </h1>
          <p className="mt-3 text-base sm:text-lg text-gray-600">
            AI in your Todoist comments. Free to try, affordable to scale.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <PricingColumn
            name="Free"
            priceLarge="$0"
            priceMuted="forever"
            tagline="Try the agent with no card required."
            features={freeFeatures}
            cta={freeCta}
          />
          <PricingColumn
            name="Pro"
            priceLarge={`$${PRO_PRICE_USD}`}
            priceMuted="/ month"
            tagline="For power users. Unlimited AI, priority support."
            features={proFeatures}
            cta={proCta}
            highlighted
          />
          <PricingColumn
            name="BYOK"
            priceLarge="$0"
            priceMuted="bring your own key"
            tagline="Use your own AI provider. We don't mark up tokens."
            features={byokFeatures}
            cta={byokCta}
          />
        </div>

        <div className="mt-12 max-w-3xl mx-auto space-y-3 text-sm text-gray-600">
          <p>
            <strong className="text-gray-900">What counts as an AI message?</strong>{" "}
            Every time the agent actually calls the model. Edits, tool loops,
            and retries inside one response count as one.
          </p>
          <p>
            <strong className="text-gray-900">Can I switch later?</strong>{" "}
            Yes — upgrade, downgrade, or switch to BYOK anytime from Settings.
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
