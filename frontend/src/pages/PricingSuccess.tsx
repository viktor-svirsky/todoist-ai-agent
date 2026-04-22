import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import PublicLayout from "../components/PublicLayout";
import { Head } from "../components/Head";

const TIER_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/settings/tier`
  : "/functions/v1/settings/tier";

const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1000;

export default function PricingSuccess() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"waiting" | "timeout">("waiting");
  const attemptsRef = useRef(0);
  const isCurrentRef = useRef(true);

  useEffect(() => {
    isCurrentRef.current = true;
    // eslint-disable-next-line prefer-const -- reassigned once after tick closure captures it
    let id: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      attemptsRef.current += 1;
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token ?? "";
        const resp = await fetch(TIER_URL, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!isCurrentRef.current) return;
        if (resp.ok) {
          const body = (await resp.json()) as { tier?: string };
          if (body.tier === "pro") {
            if (id) clearInterval(id);
            navigate("/settings", { replace: true });
            return;
          }
        }
      } catch {
        // ignore transient errors; attempt count still increments
      }
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        if (id) clearInterval(id);
        if (isCurrentRef.current) setStatus("timeout");
      }
    };

    void tick();
    id = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      isCurrentRef.current = false;
      if (id) clearInterval(id);
    };
  }, [navigate]);

  return (
    <PublicLayout>
      <Head
        title="Activating Pro — Todoist AI Agent"
        description="Activating your Pro plan."
        canonical="https://9635783.xyz/pricing/success"
      />
      <section
        role="status"
        aria-live="polite"
        className="max-w-md mx-auto text-center py-20 px-4"
      >
        {status === "waiting" ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Finishing up…</h1>
            <p className="mt-3 text-gray-600">
              We're activating your Pro plan. This usually takes a few seconds.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900">Almost there.</h1>
            <p className="mt-3 text-gray-600">
              Your payment went through. Activation is taking longer than
              usual — we'll finish in the background.
            </p>
            <Link
              to="/settings"
              className="mt-6 inline-flex rounded-md bg-gray-900 text-white px-4 py-2 hover:bg-gray-800"
            >
              Go to Settings
            </Link>
          </>
        )}
      </section>
    </PublicLayout>
  );
}
