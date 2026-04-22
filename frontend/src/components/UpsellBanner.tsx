import { useState } from "react";
import { Link } from "react-router-dom";
import { useTier } from "../hooks/useTier";

export function UpsellBanner() {
  const { data } = useTier();
  const [dismissed, setDismissed] = useState(false);
  if (!data || data.tier !== "free" || data.used == null || data.limit <= 0) {
    return null;
  }
  const threshold = Math.ceil(data.limit * 0.8);
  if (data.used < threshold || dismissed) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
      <div className="flex-1">
        <p className="text-sm text-amber-900">
          You've used {data.used} of {data.limit} AI messages in the last 24 hours.
        </p>
        <div className="mt-2 flex gap-3 text-sm">
          <Link to="/pricing" className="font-medium text-amber-900 underline">
            Upgrade to Pro
          </Link>
          <Link to="/pricing" className="text-amber-800">
            Learn more
          </Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="text-amber-700 hover:text-amber-900"
      >
        ×
      </button>
    </div>
  );
}
