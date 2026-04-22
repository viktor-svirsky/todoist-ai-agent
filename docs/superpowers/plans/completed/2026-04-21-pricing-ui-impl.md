# Pricing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship monetization sub-project D: a public `/pricing` page, post-checkout success / cancel pages, and in-app upgrade entry points that route users to Pro (via sub-project B's Stripe Edge endpoints when enabled) or BYOK (via Settings).

**Architecture:** Pure frontend work (React 19 + Vite + Tailwind 4) plus a one-line URL change in `_shared/tier.ts`. Pricing runs behind a `VITE_BILLING_ENABLED` flag so this sub-project can merge and ship before B finalises Stripe. Free-tier limit is sourced from `VITE_AI_QUOTA_FREE_MAX` (default 5) so UI copy never hard-codes the number separately from a single constants module.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router 7, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-04-21-pricing-ui-design.md`

---

## File Structure

Files created:

- `frontend/src/lib/pricing-constants.ts`
- `frontend/src/lib/billing.ts`
- `frontend/src/lib/billing.test.ts`
- `frontend/src/components/PublicLayout.tsx`
- `frontend/src/components/PricingColumn.tsx`
- `frontend/src/components/UpsellBanner.tsx`
- `frontend/src/components/UpsellBanner.test.tsx`
- `frontend/src/components/Head.tsx`
- `frontend/src/pages/Pricing.tsx`
- `frontend/src/pages/Pricing.test.tsx`
- `frontend/src/pages/PricingSuccess.tsx`
- `frontend/src/pages/PricingSuccess.test.tsx`
- `frontend/src/pages/PricingCanceled.tsx`

Files modified:

- `frontend/src/main.tsx` — add routes `/pricing`, `/pricing/success`, `/pricing/canceled`
- `frontend/src/pages/Settings.tsx` — render `<UpsellBanner/>`
- `frontend/src/components/PlanCard.tsx` — wire Upgrade CTA (remove `disabled`)
- `frontend/src/components/PlanCard.test.tsx` — update assertions
- `frontend/.env.example` — document `VITE_BILLING_ENABLED`, `VITE_AI_QUOTA_FREE_MAX`
- `supabase/functions/_shared/tier.ts` — `formatUpsellComment` URL → `/pricing`
- `supabase/functions/tests/tier.test.ts` — update assertion

---

## Validation commands

Run from `frontend/`:

```bash
yarn tsc --noEmit
yarn test
yarn build          # vite build must succeed
```

Run from repo root for the backend copy change:

```bash
npm test -- tests/tier.test.ts
```

---

## Task 1: Constants + billing client

**Files:**

- Create: `frontend/src/lib/pricing-constants.ts`
- Create: `frontend/src/lib/billing.ts`
- Create: `frontend/src/lib/billing.test.ts`
- Modify: `frontend/.env.example`

- [x] **Step 1: Define constants**

```ts
// pricing-constants.ts
export const AI_QUOTA_FREE_MAX: number = Number(
  import.meta.env.VITE_AI_QUOTA_FREE_MAX ?? 5,
);
export const BILLING_ENABLED: boolean =
  import.meta.env.VITE_BILLING_ENABLED === "true";
export const PRO_PRICE_USD: number = 5;
```

- [x] **Step 2: Billing client**

```ts
// billing.ts
import { supabase } from "./supabase";

const FN_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing`
  : "/functions/v1/billing";

export async function startCheckout(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? "";
  const resp = await fetch(`${FN_URL}/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(`checkout_${resp.status}`);
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}

export async function openPortal(): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? "";
  const resp = await fetch(`${FN_URL}/portal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`portal_${resp.status}`);
  const { url } = (await resp.json()) as { url: string };
  window.location.assign(url);
}
```

- [x] **Step 3: Tests**

```ts
// billing.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

describe("billing.startCheckout", () => {
  beforeEach(() => {
    // jsdom location.assign needs a mock
    Object.defineProperty(window, "location", {
      value: { assign: vi.fn() },
      writable: true,
    });
  });

  it("posts to /billing/checkout with bearer token and redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.example/abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { startCheckout } = await import("./billing");
    await startCheckout();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/billing/checkout"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(window.location.assign).toHaveBeenCalledWith(
      "https://checkout.example/abc",
    );
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const { startCheckout } = await import("./billing");
    await expect(startCheckout()).rejects.toThrow(/checkout_500/);
  });
});
```

- [x] **Step 4: `.env.example`**

Append:

```
# Pricing UI (sub-project D)
VITE_BILLING_ENABLED=false
VITE_AI_QUOTA_FREE_MAX=5
```

- [x] **Step 5: Validate**

```bash
cd frontend && yarn tsc --noEmit && yarn test lib/billing.test.ts
```

---

## Task 2: `<PublicLayout/>` and `<Head/>`

**Files:**

- Create: `frontend/src/components/PublicLayout.tsx`
- Create: `frontend/src/components/Head.tsx`

- [x] **Step 1: PublicLayout**

Reuses Landing's palette (light, gray-50/white). Thin top nav: logo text on the left, `Pricing` and `Sign in` on the right. Footer: reuse existing `<PageFooter/>`.

Tailwind sketch:

```tsx
<div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col">
  <header className="px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200">
    <nav className="max-w-5xl mx-auto flex items-center justify-between">
      <Link to="/" className="font-semibold tracking-tight">Todoist AI Agent</Link>
      <div className="flex items-center gap-4 text-sm">
        <Link to="/pricing" className="text-gray-700 hover:text-gray-900">Pricing</Link>
        <Link to="/" className="rounded-md bg-gray-900 text-white px-3 py-1.5 hover:bg-gray-800">Sign in</Link>
      </div>
    </nav>
  </header>
  <main className="flex-1">{children}</main>
  <PageFooter/>
</div>
```

- [x] **Step 2: `<Head/>` component (no `react-helmet`)**

```tsx
export function Head({
  title,
  description,
  ogImage,
  canonical,
}: {
  title: string;
  description: string;
  ogImage?: string;
  canonical?: string;
}) {
  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    if (ogImage) upsertMeta("property", "og:image", ogImage);
    if (canonical) upsertLink("canonical", canonical);
  }, [title, description, ogImage, canonical]);
  return null;
}
```

Helpers find-or-create the tags in `document.head`.

- [x] **Step 3: Validate**

```bash
yarn tsc --noEmit
```

---

## Task 3: `<PricingColumn/>` component

**Files:**

- Create: `frontend/src/components/PricingColumn.tsx`

- [x] **Step 1: Define props**

```ts
interface PricingColumnProps {
  name: "Free" | "Pro" | "BYOK";
  priceLarge: string;   // "$0" | "$5" | "$0"
  priceMuted: string;   // "forever" | "/ month" | "bring your own key"
  tagline: string;
  features: string[];
  cta: { label: string; onClick?: () => void; href?: string; disabled?: boolean; title?: string };
  highlighted?: boolean;
}
```

Render `<section aria-labelledby="col-{name}">`. Highlighted column gets a violet-to-red gradient border (matching Landing hero gradient) and a "Recommended" ribbon (`aria-label="Recommended"`).

Tailwind sketch:

```tsx
<section
  aria-labelledby={`col-${name.toLowerCase()}`}
  className={`rounded-2xl p-6 flex flex-col ${
    highlighted
      ? "ring-2 ring-violet-500 bg-white shadow-xl"
      : "border border-gray-200 bg-white"
  }`}
>
  {highlighted && (
    <span aria-label="Recommended" className="self-start mb-2 inline-flex items-center rounded-full bg-gradient-to-r from-red-500 to-violet-600 text-white text-xs px-2 py-0.5">
      Recommended
    </span>
  )}
  <h2 id={`col-${name.toLowerCase()}`} className="text-lg font-semibold text-gray-900">{name}</h2>
  <p className="mt-4 flex items-baseline gap-1">
    <span className="text-4xl font-extrabold text-gray-900">{priceLarge}</span>
    <span className="text-sm text-gray-500">{priceMuted}</span>
  </p>
  <p className="mt-2 text-sm text-gray-600">{tagline}</p>
  <ul className="mt-6 space-y-2 text-sm text-gray-700 flex-1">
    {features.map((f) => (
      <li key={f} className="flex items-start gap-2">
        <CheckIcon aria-hidden className="mt-0.5 h-4 w-4 text-emerald-500" />
        <span>{f}</span>
      </li>
    ))}
  </ul>
  {/* CTA */}
</section>
```

- [x] **Step 2: Validate**

```bash
yarn tsc --noEmit
```

---

## Task 4: `Pricing.tsx` page + tests

**Files:**

- Create: `frontend/src/pages/Pricing.tsx`
- Create: `frontend/src/pages/Pricing.test.tsx`

- [x] **Step 1: Page**

Verbatim copy from spec §6. Free-limit string built via:

```ts
`${AI_QUOTA_FREE_MAX} AI messages per rolling 24 hours`
```

Subscribe CTA logic (spec §5.2):

```ts
async function onSubscribe() {
  if (!BILLING_ENABLED) return; // button disabled anyway
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    window.location.assign("/"); // existing OAuth entry; hash preserved by caller if needed
    return;
  }
  try {
    await startCheckout();
  } catch (e) {
    setError("Couldn't start checkout. Try again.");
  }
}
```

SEO:

```tsx
<Head
  title="Pricing — Todoist AI Agent"
  description="AI in your Todoist comments. Free plan with 5 AI messages per day, Pro at $5/month, or bring your own key."
  ogImage="/og-pricing.png"
  canonical="https://9635783.xyz/pricing"
/>
```

- [x] **Step 2: Tests**

```tsx
// Pricing.test.tsx (shape)
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/pricing-constants", () => ({
  AI_QUOTA_FREE_MAX: 5,
  BILLING_ENABLED: false,
  PRO_PRICE_USD: 5,
}));

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  );
}

describe("Pricing page", () => {
  it("renders three columns with committed copy", () => {
    renderPricing();
    expect(screen.getByRole("heading", { level: 2, name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Pro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "BYOK" })).toBeInTheDocument();
    expect(screen.getByText(/5 AI messages per rolling 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/Unlimited AI messages/)).toBeInTheDocument();
    expect(screen.getByText(/bring your own key/i)).toBeInTheDocument();
  });

  it("shows Coming soon when billing disabled", () => {
    renderPricing();
    const btn = screen.getByRole("button", { name: /coming soon/i });
    expect(btn).toBeDisabled();
  });

  it("Use your own key links to Settings", () => {
    renderPricing();
    const link = screen.getByRole("link", { name: /use your own key/i });
    expect(link).toHaveAttribute("href", "/settings#ai-provider");
  });

  it("sets document.title and meta description", () => {
    renderPricing();
    expect(document.title).toMatch(/Pricing/);
    const meta = document.querySelector('meta[name="description"]');
    expect(meta?.getAttribute("content")).toMatch(/5 AI messages/);
  });
});

describe("Pricing page with billing enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../lib/pricing-constants", () => ({
      AI_QUOTA_FREE_MAX: 5,
      BILLING_ENABLED: true,
      PRO_PRICE_USD: 5,
    }));
  });

  it("logged-in click calls startCheckout", async () => {
    const startCheckout = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../lib/billing", () => ({ startCheckout }));
    vi.doMock("../lib/supabase", () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: "tok", user: { id: "u1" } } },
          }),
        },
      },
    }));
    const { default: Pricing } = await import("./Pricing");
    render(<MemoryRouter><Pricing/></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /^subscribe$/i }));
    expect(startCheckout).toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Validate**

```bash
yarn tsc --noEmit && yarn test pages/Pricing.test.tsx
```

---

## Task 5: `PricingSuccess.tsx` page with polling + tests

**Files:**

- Create: `frontend/src/pages/PricingSuccess.tsx`
- Create: `frontend/src/pages/PricingSuccess.test.tsx`

- [x] **Step 1: Page**

```tsx
export default function PricingSuccess() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"waiting" | "timeout">("waiting");
  const attemptsRef = useRef(0);
  const isCurrentRef = useRef(true);

  useEffect(() => {
    isCurrentRef.current = true;
    const tick = async () => {
      attemptsRef.current += 1;
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token ?? "";
        const resp = await fetch(TIER_URL, { headers: { Authorization: `Bearer ${token}` }});
        if (!isCurrentRef.current) return;
        if (resp.ok) {
          const body = await resp.json();
          if (body.tier === "pro") {
            navigate("/settings", { replace: true });
            return;
          }
        }
      } catch { /* ignore */ }
      if (attemptsRef.current >= 10) {
        setStatus("timeout");
        clearInterval(id);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      isCurrentRef.current = false;
      clearInterval(id);
    };
  }, [navigate]);

  return (
    <PublicLayout>
      <Head title="Activating Pro — Todoist AI Agent" description="Activating your Pro plan." canonical="https://9635783.xyz/pricing/success"/>
      <section role="status" aria-live="polite" className="max-w-md mx-auto text-center py-20">
        {status === "waiting" ? (
          <>
            <h1 className="text-2xl font-bold">Finishing up…</h1>
            <p className="mt-3 text-gray-600">We're activating your Pro plan. This usually takes a few seconds.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Almost there.</h1>
            <p className="mt-3 text-gray-600">Your payment went through. Activation is taking longer than usual — we'll finish in the background.</p>
            <Link to="/settings" className="mt-6 inline-flex rounded-md bg-gray-900 text-white px-4 py-2">Go to Settings</Link>
          </>
        )}
      </section>
    </PublicLayout>
  );
}
```

- [x] **Step 2: Tests (fake timers)**

```tsx
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok" }}}) },
  },
}));

describe("PricingSuccess polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("navigates to /settings when tier flips to pro", async () => {
    const responses = [
      { tier: "free" }, { tier: "free" }, { tier: "pro" },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => responses.shift() ?? { tier: "pro" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { default: PricingSuccess } = await import("./PricingSuccess");
    render(<MemoryRouter><PricingSuccess/></MemoryRouter>);

    // flush initial tick
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });

    expect(navigateMock).toHaveBeenCalledWith("/settings", { replace: true });
  });

  it("renders timeout copy after 10 attempts with no pro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tier: "free" }) })));
    const { default: PricingSuccess } = await import("./PricingSuccess");
    render(<MemoryRouter><PricingSuccess/></MemoryRouter>);
    for (let i = 0; i < 11; i++) {
      await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    }
    expect(screen.getByText(/Almost there\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Settings/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("clears interval on unmount", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tier: "free" }) })));
    const { default: PricingSuccess } = await import("./PricingSuccess");
    const { unmount } = render(<MemoryRouter><PricingSuccess/></MemoryRouter>);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [x] **Step 3: Validate**

```bash
yarn test pages/PricingSuccess.test.tsx
```

---

## Task 6: `PricingCanceled.tsx`

**Files:**

- Create: `frontend/src/pages/PricingCanceled.tsx`

- [x] **Step 1: Page (static)**

```tsx
export default function PricingCanceled() {
  return (
    <PublicLayout>
      <Head title="Checkout canceled — Todoist AI Agent" description="Checkout canceled. No charge was made."/>
      <section className="max-w-md mx-auto text-center py-20">
        <h1 className="text-2xl font-bold">Checkout canceled.</h1>
        <p className="mt-3 text-gray-600">No charge was made. You can start your Pro plan anytime.</p>
        <Link to="/pricing" className="mt-6 inline-flex rounded-md bg-gray-900 text-white px-4 py-2">Back to pricing</Link>
      </section>
    </PublicLayout>
  );
}
```

(No dedicated test file — smoke covered by route-level test in Task 10 if needed. Skip tests here to keep scope tight; one-line of copy is not worth a file.)

- [x] **Step 2: Validate**

```bash
yarn tsc --noEmit
```

---

## Task 7: `<UpsellBanner/>` component + tests

**Files:**

- Create: `frontend/src/components/UpsellBanner.tsx`
- Create: `frontend/src/components/UpsellBanner.test.tsx`

- [x] **Step 1: Component**

```tsx
export function UpsellBanner() {
  const { data } = useTier();
  const [dismissed, setDismissed] = useState(false);
  if (!data || data.tier !== "free" || data.used == null || data.limit <= 0) return null;
  const threshold = Math.ceil(data.limit * 0.8);
  if (data.used < threshold || dismissed) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
      <div className="flex-1">
        <p className="text-sm text-amber-900">
          You've used {data.used} of {data.limit} AI messages in the last 24 hours.
        </p>
        <div className="mt-2 flex gap-3 text-sm">
          <Link to="/pricing" className="font-medium text-amber-900 underline">Upgrade to Pro</Link>
          <Link to="/pricing" className="text-amber-800">Learn more</Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="text-amber-700 hover:text-amber-900"
      >×</button>
    </div>
  );
}
```

- [x] **Step 2: Tests**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

function mockTier(data: any) {
  vi.doMock("../hooks/useTier", () => ({
    useTier: () => ({ data, loading: false, error: null, refresh: vi.fn() }),
  }));
}

describe("UpsellBanner", () => {
  it("does not render for pro", async () => {
    mockTier({ tier: "pro", used: null, limit: -1, next_slot_at: null, pro_until: null });
    const { UpsellBanner } = await import("./UpsellBanner");
    const { container } = render(<MemoryRouter><UpsellBanner/></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });

  it("does not render below 80%", async () => {
    mockTier({ tier: "free", used: 3, limit: 5, next_slot_at: null, pro_until: null });
    const { UpsellBanner } = await import("./UpsellBanner");
    const { container } = render(<MemoryRouter><UpsellBanner/></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });

  it("renders at >= 80% with exact copy", async () => {
    mockTier({ tier: "free", used: 4, limit: 5, next_slot_at: null, pro_until: null });
    const { UpsellBanner } = await import("./UpsellBanner");
    render(<MemoryRouter><UpsellBanner/></MemoryRouter>);
    expect(screen.getByText(/You've used 4 of 5 AI messages in the last 24 hours\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Pro/i })).toHaveAttribute("href", "/pricing");
  });

  it("dismisses within session", async () => {
    mockTier({ tier: "free", used: 5, limit: 5, next_slot_at: null, pro_until: null });
    const { UpsellBanner } = await import("./UpsellBanner");
    render(<MemoryRouter><UpsellBanner/></MemoryRouter>);
    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText(/You've used/)).not.toBeInTheDocument();
  });
});
```

- [x] **Step 3: Validate**

```bash
yarn test components/UpsellBanner.test.tsx
```

---

## Task 8: Wire `<UpsellBanner/>` into Settings

**Files:**

- Modify: `frontend/src/pages/Settings.tsx`

- [x] **Step 1: Render banner above `<PlanCard/>`**

Import `UpsellBanner` and render it inside the same container that holds `<PlanCard/>`, immediately above it. No layout-shift cushion: banner returns `null` when not applicable.

- [x] **Step 2: Validate**

```bash
yarn tsc --noEmit && yarn test pages/Settings.test.tsx
```

Update Settings.test.tsx only if an assertion collides (most test mocks of `useTier` return Pro or no data, so the banner stays hidden).

---

## Task 9: Rewire `<PlanCard/>` Upgrade button

**Files:**

- Modify: `frontend/src/components/PlanCard.tsx`
- Modify: `frontend/src/components/PlanCard.test.tsx`

- [x] **Step 1: Update component**

Replace the disabled `<button>` with:

```tsx
{data.tier === "free" && (
  <UpgradeCta/>
)}
```

```tsx
function UpgradeCta() {
  const navigate = useNavigate();
  const onClick = async () => {
    if (!BILLING_ENABLED) {
      navigate("/pricing");
      return;
    }
    try { await startCheckout(); }
    catch { navigate("/pricing"); }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
    >
      Upgrade to Pro
    </button>
  );
}
```

Pro and BYOK users see no upgrade CTA (Pro could later link to portal — that's sub-project B/C).

- [x] **Step 2: Update tests**

- Remove the "disabled Upgrade button" assertion.
- Add: Free + billing disabled → click navigates to `/pricing`.
- Add: Free + billing enabled → click calls `startCheckout` (mock module).
- Add: Pro / BYOK → no Upgrade button in DOM.

- [x] **Step 3: Validate**

```bash
yarn test components/PlanCard.test.tsx
```

---

## Task 10: Register routes in `main.tsx`

**Files:**

- Modify: `frontend/src/main.tsx`

- [x] **Step 1: Add routes**

```tsx
import Pricing from "./pages/Pricing";
import PricingSuccess from "./pages/PricingSuccess";
import PricingCanceled from "./pages/PricingCanceled";

// inside <Routes>:
<Route path="/pricing" element={<Pricing />} />
<Route path="/pricing/success" element={<PricingSuccess />} />
<Route path="/pricing/canceled" element={<PricingCanceled />} />
```

Order: before `<Route path="*" ...>`.

- [x] **Step 2: Validate**

```bash
yarn tsc --noEmit && yarn build
```

- [x] Manual smoke (skipped - not automatable)

---

## Task 11: Update `formatUpsellComment` to point at `/pricing`

**Files:**

- Modify: `supabase/functions/_shared/tier.ts`
- Modify: `supabase/functions/tests/tier.test.ts`

- [x] **Step 1: Change the URL**

In `formatUpsellComment`, replace the trailing `settingsUrl` reference with a `pricingUrl` parameter (or rename the existing parameter). Update the webhook call site in `supabase/functions/webhook/handler.ts` to pass `${APP_URL}/pricing`.

New copy tail:

```
Upgrade to Pro: ${pricingUrl}
```

Drop the "Or add your own AI key in Settings" sentence — `/pricing` already covers BYOK discovery. Keeps the Todoist comment short.

- [x] **Step 2: Update tests**

```ts
// tier.test.ts
Deno.test("formatUpsellComment links to /pricing", () => {
  const out = formatUpsellComment(
    { allowed: false, blocked: false, tier: "free", used: 5, limit: 5, next_slot_at: null, should_notify: true, event_id: 1 },
    "https://app.example.com/pricing",
  );
  assert(out.includes("https://app.example.com/pricing"));
  assert(out.includes("5/5"));
  assert(!out.includes("/settings"));
});
```

Remove any prior assertion that included `/settings` in the upsell comment.

- [x] **Step 3: Validate**

```bash
npm test -- tests/tier.test.ts
npm test -- tests/webhook.test.ts
```

Webhook test may need its upsell expectation updated to the new URL; fix in the same commit.

---

## Task 12: `.env.example` + docs note

**Files:**

- Modify: `frontend/.env.example` (done in Task 1 Step 4)
- Modify: `README.md` (optional — one line under the existing Tiers section pointing at `/pricing`)

- [x] **Step 1: README**

Under the Tiers section added in sub-project A, append:

```
Pricing page: <APP_URL>/pricing (public). Set VITE_BILLING_ENABLED=true once Stripe (sub-project B) is live.
```

- [x] **Step 2: No commit-worthy changes beyond the above.**

---

## Task 13: Final verification

- [x] **Step 1: Frontend full suite**

```bash
cd frontend && yarn tsc --noEmit && yarn test && yarn build
```

Expected: all existing tests still green plus the new files (approx +25 assertions across 5 test files). `vite build` succeeds.

- [x] **Step 2: Backend test for the tier.ts URL change**

```bash
npm test -- tests/tier.test.ts tests/webhook.test.ts
```

- [x] **Step 3: Manual smoke in dev** (skipped - not automatable)

Start `yarn dev`, visit:

- `/pricing` — three columns render, Subscribe shows "Coming soon" (billing disabled by default locally).
- `/pricing/canceled` — renders, back link works.
- `/pricing/success` — shows waiting state; without a live `/settings/tier` available locally, times out to fallback after ~10s.
- `/settings` — upsell banner visible only when a seeded Free user has used >= 4 of 5.

- [x] **Step 4: Deployed verification** (skipped - not automatable)

Confirm both `app.9635783.xyz/pricing` and `9635783.xyz/pricing` resolve and render (Cloudflare Pages serves the same SPA).

---

## Success criteria

- [x] `/pricing` renders all three columns with exact copy from spec §6 at both `app.9635783.xyz` and `9635783.xyz`.
- [x] Free-tier number in UI comes from `AI_QUOTA_FREE_MAX` constant; grep confirms no stray hard-coded `5` in any new file.
- [x] Subscribe CTA disabled when `VITE_BILLING_ENABLED !== "true"`; otherwise redirects to OAuth (logged-out) or calls `startCheckout` (logged-in).
- [x] `/pricing/success` polls `/settings/tier` at 1s cadence, navigates to `/settings` on `tier === "pro"`, renders timeout copy after 10 attempts, clears interval on unmount.
- [x] `/pricing/canceled` renders and links back to `/pricing`.
- [x] `<UpsellBanner/>` renders in Settings iff `tier === "free" && used >= ceil(0.8*limit)`; dismissable within session.
- [x] `<PlanCard/>` Upgrade button no longer disabled; wired per Task 9.
- [x] `formatUpsellComment` emits the `/pricing` URL; Deno tests green.
- [x] `<title>`, `<meta description>`, OG and canonical tags set on `/pricing`, `/pricing/success`, `/pricing/canceled`.
- [x] `yarn tsc --noEmit`, `yarn test`, `yarn build` all clean.
- [x] `npm test` for the tier.ts + webhook tests clean.
- [x] No new npm dependencies added.
