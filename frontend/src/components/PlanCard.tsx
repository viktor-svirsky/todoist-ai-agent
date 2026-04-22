import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTier, type TierData } from "../hooks/useTier";
import { openBillingPortal, startCheckout } from "../lib/billingApi";
import { BILLING_ENABLED } from "../lib/pricing-constants";

const FREE_GATE_BULLETS = [
  "Web search is Pro-only.",
  "Read-only Todoist tools. Upgrade to let AI create, update, and complete tasks.",
  "Custom prompts apply on Pro or with your own AI key.",
  "Custom model selection requires your own AI key.",
];

function humanizeRelative(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.max(0, new Date(iso).getTime() - Date.now());
  const minutes = Math.round(diff / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h >= 1 ? `${h}h ${m}m` : `${m}m`;
}

function Badge({ tier }: { tier: TierData["tier"] }) {
  const label = tier === "pro" ? "Pro" : tier === "byok" ? "BYOK" : "Free";
  const color =
    tier === "pro"
      ? "bg-violet-500/20 text-violet-300"
      : tier === "byok"
        ? "bg-emerald-500/20 text-emerald-300"
        : "bg-slate-500/20 text-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

function UpgradeButton() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          if (!BILLING_ENABLED) {
            navigate("/pricing");
            return;
          }
          setLoading(true);
          setError(null);
          try {
            const { url } = await startCheckout();
            window.location.assign(url);
          } catch {
            setError("Could not start checkout. Please try again.");
            setLoading(false);
          }
        }}
        className="mt-2 inline-flex items-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Upgrade to Pro"}
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </>
  );
}

function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const { url } = await openBillingPortal();
            window.location.assign(url);
          } catch {
            setError("Could not open billing portal. Please try again.");
            setLoading(false);
          }
        }}
        className="mt-2 inline-flex items-center rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Manage billing"}
      </button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </>
  );
}

export function PlanCard() {
  const { data, loading, error } = useTier();

  if (loading) {
    return (
      <div
        data-testid="plan-card-skeleton"
        className="rounded-lg border border-slate-700 p-4 animate-pulse"
      >
        <div className="h-4 w-24 bg-slate-700 rounded mb-2" />
        <div className="h-3 w-48 bg-slate-700 rounded" />
      </div>
    );
  }
  if (error || !data || data.tier === null) {
    return (
      <div className="rounded-lg border border-slate-700 p-4 text-sm text-slate-400">
        Plan info unavailable.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-700 p-4 space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Plan</h3>
        <Badge tier={data.tier} />
      </header>

      {data.tier === "free" && data.used !== null && (
        <>
          <p className="text-sm text-slate-300">
            {data.used} of {data.limit} AI messages used (last 24 hours)
          </p>
          {data.next_slot_at && (
            <p className="text-xs text-slate-400">
              Next slot available in {humanizeRelative(data.next_slot_at)}
            </p>
          )}
        </>
      )}

      {data.tier === "pro" && (
        <>
          <p className="text-sm text-slate-300">Unlimited AI messages</p>
          {data.pro_until && (
            <p className="text-xs text-slate-400">
              Pro active until {data.pro_until.slice(0, 10)}
            </p>
          )}
        </>
      )}

      {data.tier === "byok" && (
        <p className="text-sm text-slate-300">
          Unlimited (using your own AI key)
        </p>
      )}

      {data.tier === "free" && (
        <ul
          data-testid="free-gate-bullets"
          className="mt-1 list-disc pl-5 text-xs text-slate-400 space-y-1"
        >
          {FREE_GATE_BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {data.tier === "free" && <UpgradeButton />}
      {data.tier === "pro" && <ManageBillingButton />}
    </section>
  );
}
