import type { ReactNode } from "react";

export interface PricingColumnCta {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
}

export interface PricingColumnProps {
  name: "Free" | "Pro" | "BYOK";
  priceLarge: string;
  priceMuted: string;
  tagline: string;
  features: string[];
  cta: PricingColumnCta;
  highlighted?: boolean;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.42.006l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.796-6.89a1 1 0 0 1 1.414-.006z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CtaButton({ cta }: { cta: PricingColumnCta }) {
  const base =
    "mt-6 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium";
  const enabledClass = "bg-gray-900 text-white hover:bg-gray-800";
  const disabledClass = "bg-gray-200 text-gray-500 cursor-not-allowed";

  if (cta.href && !cta.disabled) {
    return (
      <a
        href={cta.href}
        title={cta.title}
        className={`${base} ${enabledClass}`}
      >
        {cta.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={cta.onClick}
      disabled={cta.disabled}
      title={cta.title}
      className={`${base} ${cta.disabled ? disabledClass : enabledClass}`}
    >
      {cta.label}
    </button>
  );
}

export default function PricingColumn({
  name,
  priceLarge,
  priceMuted,
  tagline,
  features,
  cta,
  highlighted = false,
}: PricingColumnProps): ReactNode {
  const headingId = `col-${name.toLowerCase()}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-2xl p-6 flex flex-col ${
        highlighted
          ? "ring-2 ring-violet-500 bg-white shadow-xl"
          : "border border-gray-200 bg-white"
      }`}
    >
      {highlighted && (
        <span
          aria-label="Recommended"
          className="self-start mb-2 inline-flex items-center rounded-full bg-gradient-to-r from-red-500 to-violet-600 text-white text-xs px-2 py-0.5"
        >
          Recommended
        </span>
      )}
      <h2
        id={headingId}
        className="text-lg font-semibold text-gray-900"
      >
        {name}
      </h2>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold text-gray-900">
          {priceLarge}
        </span>
        <span className="text-sm text-gray-500">{priceMuted}</span>
      </p>
      <p className="mt-2 text-sm text-gray-600">{tagline}</p>
      <ul className="mt-6 space-y-2 text-sm text-gray-700 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <CtaButton cta={cta} />
    </section>
  );
}
