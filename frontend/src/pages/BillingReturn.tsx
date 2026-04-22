import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Status = "polling" | "pro" | "timeout";

const POLL_INTERVAL_MS = 750;
const POLL_TIMEOUT_MS = 15_000;
const REDIRECT_DELAY_MS = 400;

export default function BillingReturn() {
  const [status, setStatus] = useState<Status>("polling");

  useEffect(() => {
    const started = Date.now();
    let cancelled = false;

    const tick = async () => {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) return;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings/tier`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { tier?: string };
      if (cancelled) return;
      if (body.tier === "pro") {
        setStatus("pro");
        clearInterval(timer);
        setTimeout(() => {
          window.location.assign("/settings");
        }, REDIRECT_DELAY_MS);
      } else if (Date.now() - started > POLL_TIMEOUT_MS) {
        setStatus("timeout");
        clearInterval(timer);
      }
    };

    const timer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main
      className="min-h-screen bg-gray-100 flex items-center justify-center px-4 sm:px-6"
      role="main"
      aria-labelledby="billing-return-heading"
    >
      <div className="bg-white rounded-2xl shadow-xl p-8 sm:p-10 text-center max-w-md">
        <h1 id="billing-return-heading" className="text-xl font-semibold text-gray-900 mb-3">
          {status === "pro" ? "Pro activated" : "Finalizing your subscription"}
        </h1>
        {status === "polling" && (
          <p className="text-gray-600" role="status">
            Hang tight while we confirm your payment with Stripe…
          </p>
        )}
        {status === "pro" && (
          <p className="text-gray-600" role="status">
            Pro activated. Redirecting to Settings…
          </p>
        )}
        {status === "timeout" && (
          <p className="text-gray-600" role="status">
            Payment received. Your plan will update shortly. Refresh if it doesn't appear in a minute.
          </p>
        )}
      </div>
    </main>
  );
}
