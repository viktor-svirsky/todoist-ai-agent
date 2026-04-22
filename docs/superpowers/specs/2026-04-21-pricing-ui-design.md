# Pricing UI — Design Spec

**Sub-project:** D of monetization (4 of 5).
**Date:** 2026-04-21.
**Status:** Approved for implementation planning.
**Depends on:** A (tier + quota; merged), B (Stripe Edge endpoints `POST /billing/checkout`, `POST /billing/portal`; planned in parallel).
**Blocks:** none.

## 1. Goal

Ship the customer-facing surface that converts visitors and Free users to Pro: a public `/pricing` page, in-app upgrade entry points, and post-checkout success / cancel pages. No marketing-site polish, no A/B framework, no OG image generation.

The page must work without Stripe being live: the "Subscribe" CTA calls `POST /billing/checkout`; if that endpoint is not yet wired (feature flag `VITE_BILLING_ENABLED !== 'true'`), the CTA renders a "Coming soon" disabled state with a mailto fallback so the page ships independently of B.

## 2. Scope

In:

- Public, unauthenticated `/pricing` route with three columns: Free, Pro, BYOK.
- Per-tier feature checklist and explicit Free-tier quota copy: "5 AI messages per rolling 24 hours" (sourced from `AI_QUOTA_FREE_MAX`, default 5 — see §7).
- CTAs: "Start free" (Free → Todoist OAuth, i.e. the existing `/` hero CTA flow), "Subscribe" (Pro → `POST /billing/checkout`), "Use your own key" (BYOK → `/settings`).
- Navigation: when logged out, a "Pricing" link in the top nav on `/` (Landing hero) pointing to `/pricing`. Logged-in users see the link inside `<PlanCard/>` area only (no header nav change — Settings is already the landing for authed users).
- In-app upgrade entry points:
  - `<PlanCard/>` "Upgrade to Pro" button — link to `/pricing` (or directly to checkout when logged in Free user and billing is enabled; see §5.2).
  - Settings upsell banner when `tier === 'free' && limit > 0 && used >= limit * 0.8` ("You've used 4 of 5 AI messages today").
  - The existing upsell comment (`formatUpsellComment` in `_shared/tier.ts`) updated to link to `${APP_URL}/pricing` instead of `${APP_URL}/settings`.
- `/pricing/success` — post-checkout landing. Polls `GET /settings/tier` every 1s up to 10s until `tier === 'pro'`, then redirects to `/settings`. Shows fallback copy + manual Settings link if poll times out.
- `/pricing/canceled` — post-checkout cancel. One short screen, back-to-pricing CTA.

Out:

- Marketing hero polish beyond one screen.
- Testimonials, comparison vs competitors, FAQ, animated marquees.
- A/B framework. Copy is committed verbatim here.
- OG image generator. A static placeholder path (`/og-pricing.png`) is referenced; the asset itself is a follow-up.
- Currency switcher / tax display. USD only.

## 3. Routes + layout

| Route | Auth | Layout | Notes |
|-------|------|--------|-------|
| `/pricing` | Public | `<PublicLayout/>` (Landing-style nav + footer, no Settings chrome) | Single page; no anchors. |
| `/pricing/success` | Public | `<PublicLayout/>` | Reads session; if `user` present and token valid → poll tier. |
| `/pricing/canceled` | Public | `<PublicLayout/>` | Static content. |

`<PublicLayout/>` is a thin wrapper reusing `PageFooter` and adding a minimal top nav with logo + "Pricing" + (when logged out) "Sign in" → Todoist OAuth CTA. Same gray-50/white palette as Landing (light theme). No Settings-style dark chrome.

The root domain (`9635783.xyz`) and app domain (`app.9635783.xyz`) both serve the same SPA; `/pricing` is therefore reachable on both — confirmed to be acceptable for this sub-project. A follow-up DNS / redirect decision can split them later.

## 4. Component tree

```
src/pages/Pricing.tsx
  <PublicLayout>
    <PricingHero/>                       // h1 + subhead
    <PricingTable>
      <PricingColumn tier="free"/>
      <PricingColumn tier="pro" highlighted/>
      <PricingColumn tier="byok"/>
    </PricingTable>
    <PricingFaqStrip/>                   // 2-3 lines; not a full FAQ
  </PublicLayout>

src/pages/PricingSuccess.tsx
  <PublicLayout>
    <PollTierUntilPro onPro={goSettings} onTimeout={showFallback}/>
  </PublicLayout>

src/pages/PricingCanceled.tsx
  <PublicLayout>
    <CanceledCard/>
  </PublicLayout>

src/components/PublicLayout.tsx
src/components/PricingColumn.tsx
src/components/UpsellBanner.tsx          // rendered inside Settings
src/lib/billing.ts                       // startCheckout(), openPortal()
```

New files: `Pricing.tsx`, `PricingSuccess.tsx`, `PricingCanceled.tsx`, `PublicLayout.tsx`, `PricingColumn.tsx`, `UpsellBanner.tsx`, `lib/billing.ts`, plus tests.

Modified: `main.tsx` (routes), `pages/Settings.tsx` (render `<UpsellBanner/>`), `components/PlanCard.tsx` (wire Upgrade button), `_shared/tier.ts` (`formatUpsellComment` URL).

## 5. Data flow

### 5.1 `POST /billing/checkout` (sub-project B)

Request: `Authorization: Bearer <supabase token>`, body `{ return_url?: string }` (optional; default server-side to `${APP_URL}/pricing/success`).
Response: `{ url: string }` → client does `window.location.assign(url)`.

Errors: any non-2xx shows inline error ("Couldn't start checkout. Try again.") and keeps the user on `/pricing`. No silent redirect.

### 5.2 "Subscribe" CTA wiring

```
if (!billingEnabled)            → show "Coming soon" disabled state
else if (no session)            → /auth/start (Todoist OAuth), then return to /pricing#pro
else                            → startCheckout() → window.location.assign(url)
```

`billingEnabled = import.meta.env.VITE_BILLING_ENABLED === 'true'`.

The PlanCard "Upgrade to Pro" button, when the user is logged in and billing is enabled, calls `startCheckout()` directly (skipping the `/pricing` detour). When disabled, it navigates to `/pricing`.

### 5.3 `/pricing/success` polling

```
mount:
  fetch GET /settings/tier
  if tier === 'pro' → navigate('/settings')
  else              → schedule setInterval(1000ms), max 10 attempts
on each tick:       same check
on attempt 10:      show <FallbackCopy/> with manual link to /settings
unmount:            clearInterval
```

Uses `useTier()` but with a manual `refresh()` cadence (the hook already exposes it). No AbortController needed for a plain fetch with a 1s cadence; stale responses are ignored via an `isCurrent` ref.

### 5.4 Upsell banner (Settings)

Reads from `useTier()` (already fetched by `<PlanCard/>`). Banner shows when `tier === 'free' && limit > 0 && used !== null && used >= Math.ceil(limit * 0.8)`. Banner dismissal is session-local (no persistence this sub-project).

## 6. Copy (verbatim — this is the spec)

### 6.1 `/pricing` hero

- **H1:** `Simple pricing. Cancel anytime.`
- **Subhead:** `AI in your Todoist comments. Free to try, affordable to scale.`

### 6.2 Column: Free

- **Name:** `Free`
- **Price line:** `$0` (large) · `forever` (muted)
- **Tagline:** `Try the agent with no card required.`
- **Features (each prefixed with a check mark icon):**
  - `5 AI messages per rolling 24 hours`
  - `Web search, memory, and tool use`
  - `Works on every Todoist task`
  - `Email support`
- **CTA:** `Start free` → `/auth/start` (existing Todoist OAuth entry point).

### 6.3 Column: Pro (highlighted)

- **Name:** `Pro`
- **Price line:** `$5` (large) · `/ month` (muted)
- **Tagline:** `For power users. Unlimited AI, priority support.`
- **Features:**
  - `Unlimited AI messages`
  - `Everything in Free`
  - `Priority support`
  - `Cancel anytime from Settings`
- **CTA (logged-out):** `Start free, then upgrade` → `/auth/start` with hash `#pro` preserved.
- **CTA (logged-in, billing enabled):** `Subscribe` → `startCheckout()`.
- **CTA (billing disabled):** `Coming soon` (disabled button, tooltip: `Stripe checkout launches soon — contact hi@9635783.xyz to be notified.`).

### 6.4 Column: BYOK

- **Name:** `BYOK`
- **Price line:** `$0` (large) · `bring your own key` (muted)
- **Tagline:** `Use your own AI provider. We don't mark up tokens.`
- **Features:**
  - `Unlimited messages on your key`
  - `Anthropic, OpenAI, or any OpenAI-compatible endpoint`
  - `Everything in Free`
  - `You pay your provider directly`
- **CTA:** `Use your own key` → `/settings#ai-provider` (in-app anchor; Settings already has this section).

### 6.5 FAQ strip (2 lines, no dropdowns)

- `What counts as an AI message? Every time the agent actually calls the model. Edits, tool loops, and retries inside one response count as one.`
- `Can I switch later? Yes — upgrade, downgrade, or switch to BYOK anytime from Settings.`

### 6.6 Upsell banner (Settings)

- **Body:** `You've used {used} of {limit} AI messages in the last 24 hours.`
- **CTA:** `Upgrade to Pro` → `/pricing` (or direct checkout per §5.2).
- **Secondary link:** `Learn more` → `/pricing`.

### 6.7 `/pricing/success`

- **H1 (waiting):** `Finishing up…`
- **Body (waiting):** `We're activating your Pro plan. This usually takes a few seconds.`
- **H1 (done):** `You're on Pro.` (shown briefly before redirect)
- **H1 (timeout):** `Almost there.`
- **Body (timeout):** `Your payment went through. Activation is taking longer than usual — we'll finish in the background.`
- **Timeout CTA:** `Go to Settings` → `/settings`.

### 6.8 `/pricing/canceled`

- **H1:** `Checkout canceled.`
- **Body:** `No charge was made. You can start your Pro plan anytime.`
- **CTA:** `Back to pricing` → `/pricing`.

### 6.9 Upsell comment (updated from A)

`formatUpsellComment` keeps its existing shape but points at `/pricing`:

```
You've used {used}/{limit} AI messages in the last 24 hours (free tier). Next message available in {humanized}. Upgrade to Pro: {APP_URL}/pricing
```

(The BYOK mention is dropped from this one-line comment to keep it short; BYOK discoverability already lives in `/pricing` and Settings.)

## 7. Sourcing the Free limit

UI copy must not hard-code `5`. The `/pricing` page reads the limit from an anonymous endpoint that returns the runtime GUC value.

Two options:

- **(a)** Surface the limit via a new public `GET /settings/limits` Edge Function returning `{ ai_quota_free_max: number }`. Read from the same `app.ai_quota_free_max` GUC. No auth.
- **(b)** Inline the limit into the frontend build via `VITE_AI_QUOTA_FREE_MAX` env var (default 5), validated at build time.

**Decision:** (b) for this sub-project. Rationale: the GUC is set at deploy time via `ALTER DATABASE` (per A runbook), identical cadence to a frontend redeploy; introducing a public unauth endpoint widens the attack surface for negligible value at our scale (49 users). When the GUC changes, both the DB `ALTER DATABASE` and the Vite env var are bumped in the same PR. See §12 Design decisions.

The build-time constant is imported from a single module `src/lib/pricing-constants.ts` so tests can assert the string never contains a hard-coded `5` separate from that constant.

## 8. Accessibility

- Each pricing column is a `<section>` with `aria-labelledby` pointing at its `<h2>` name.
- Feature lists are `<ul>` with check icons hidden from AT (`aria-hidden`).
- Pro column has `aria-label="Recommended"` on the highlighted ribbon.
- All CTAs are real `<button>` or `<a>`; no clickable `<div>`.
- Disabled "Coming soon" button uses `aria-disabled="true"` and `disabled`, with accessible tooltip text mirrored in `title` and a visually-hidden `<span>`.
- Success-page polling region has `role="status"` and `aria-live="polite"` so the countdown / state change is announced.
- Colour contrast on highlighted column verified against WCAG AA (the red-to-violet Landing gradient already passes; reuse).

## 9. SEO

- `<title>Pricing — Todoist AI Agent</title>`
- `<meta name="description" content="AI in your Todoist comments. Free plan with 5 AI messages per day, Pro at $5/month, or bring your own key.">`
- `<meta property="og:title">`, `<meta property="og:description">` mirrored.
- `<meta property="og:image" content="/og-pricing.png">` — placeholder path; asset delivered by follow-up. Build must not fail if the file is missing (Vite serves 404; social scrapers degrade gracefully).
- `<link rel="canonical" href="https://9635783.xyz/pricing">`.
- Meta tags applied per-route via a tiny `<Head/>` component that uses `useEffect` to set `document.title` and upsert meta tags. No `react-helmet` dep; SPA SEO is best-effort since we don't SSR. Accepted limitation.

## 10. Telemetry

None this sub-project. Placeholders not added. A future analytics pipeline (sub-project E scope or later) will ingest structured logs; do not wire `window.gtag` or `window.plausible` calls speculatively.

## 11. Test strategy (Vitest)

All component + hook tests run under the existing Vitest + React Testing Library setup.

### 11.1 `Pricing.test.tsx`

- Renders three columns with verbatim copy from §6.
- Free-limit placeholder renders the value from `VITE_AI_QUOTA_FREE_MAX` (mock env); no hard-coded `5` in the test except the env default.
- "Start free" CTA has href `/auth/start` (or triggers OAuth redirect per existing Landing pattern).
- "Use your own key" CTA has href `/settings#ai-provider`.
- Subscribe CTA with `VITE_BILLING_ENABLED=false` → renders disabled "Coming soon".
- Subscribe CTA with `billingEnabled=true` and no session → redirects to `/auth/start` (assert via mocked `window.location.assign` or router spy).
- Subscribe CTA with `billingEnabled=true` and session present → calls `startCheckout()` which fetches `/functions/v1/billing/checkout` and `assign`s the returned URL (mock `fetch`).
- SEO: `document.title` set; meta description tag present.

### 11.2 `PricingSuccess.test.tsx`

- Fake timers (`vi.useFakeTimers()`).
- Mocks `fetch` for `/settings/tier`:
  - First two calls → `{ tier: 'free', ... }`, third call → `{ tier: 'pro', ... }`. Advance timers 3s, assert `navigate('/settings')` called.
  - All 10 calls return `free` → advance 10s, assert timeout copy renders and `navigate` NOT called.
- Unmount mid-poll → no pending timers (`vi.getTimerCount() === 0`).

### 11.3 `PricingCanceled.test.tsx`

- Renders H1 + body + CTA href `/pricing`. Smoke only.

### 11.4 `PlanCard.test.tsx` (additions)

- "Upgrade to Pro" button: no longer disabled. Clicking navigates to `/pricing` when billing disabled; calls `startCheckout()` when enabled + logged in.
- Tooltip copy updated.

### 11.5 `UpsellBanner.test.tsx`

- Does not render for `tier=pro`, `tier=byok`, or `used < 0.8*limit`.
- Renders and contains exact copy for `used=4, limit=5`.
- CTA link `/pricing`.
- Dismissal hides banner within same session (state, not storage).

### 11.6 `lib/billing.test.ts`

- `startCheckout()` — mocked `fetch`, asserts Authorization header, POST verb, handles 200 + error cases.

### 11.7 Integration with existing `useTier` tests

No changes required; `useTier` is re-used unchanged.

## 12. Design decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Pricing route inside app shell or separate layout? | Separate `<PublicLayout/>` (light theme, Landing-style). | `/pricing` is public-facing and linked from outside the app; reusing the dark Settings chrome would confuse logged-out visitors. Reusing Landing's palette keeps visual coherence. |
| 2 | BYOK copy for non-technical users | `Use your own AI provider. We don't mark up tokens.` + feature bullet naming Anthropic/OpenAI explicitly. | Avoids jargon in the tagline; the explicit providers in the bullet ground it for readers who do know. The name "BYOK" is kept in the column header because it's used throughout the app (Settings, tier badge) — consistency matters more than perfect approachability. |
| 3 | Single-page `/pricing` vs. multi-page with `#compare` | Single page, no anchors. | Three columns fit on one screen above the fold on desktop; anchors add complexity without payoff at this scope. |
| 4 | SEO scope | Add `<title>`, `<meta description>`, OG tags with placeholder image path, canonical link. No SSR, no OG generator. | SPA-only SEO is known-limited; social crawlers (Slack, Twitter) render the static HTML meta tags Vite produces at build. Good enough for launch. |
| 5 | Source Free limit in UI | Build-time `VITE_AI_QUOTA_FREE_MAX` env var (default 5). | A public unauth endpoint costs surface area; at our scale the GUC and env var move together. Contract: update both in the same PR. |
| 6 | Highlight which column | Pro (middle). | Standard SaaS pricing convention; no A/B in scope. |
| 7 | Logged-out Subscribe CTA | Redirect through OAuth first, resume at `/pricing#pro`. | Stripe Checkout needs a customer email and our user id — we can't create a Stripe customer for a ghost visitor. Forcing OAuth first keeps the checkout session authoritative. |

Second-opinion calls made during design: decisions 1 and 5 were cross-checked via the `second-opinion` skill; both confirmed. Recorded here rather than in a separate log.

## 13. Dependencies

- **Sub-project B** — `POST /billing/checkout` and `POST /billing/portal` Edge Functions. D ships behind `VITE_BILLING_ENABLED`, so B does not block merge.
- **Sub-project A (merged)** — `GET /settings/tier` is already live; success-page polling reads it directly. `formatUpsellComment` URL change in `_shared/tier.ts` is a one-line edit in D's scope.
- **No schema changes.** D is pure frontend + a copy tweak on an existing shared module.

## 14. Acceptance criteria

- [ ] `/pricing` renders three columns with verbatim copy from §6 at `app.9635783.xyz/pricing` and `9635783.xyz/pricing`.
- [ ] No hard-coded `5` or `24 hours` in any Pricing / PlanCard / UpsellBanner source file except via `pricing-constants.ts`.
- [ ] "Start free" CTA triggers existing Todoist OAuth entry.
- [ ] "Use your own key" CTA routes to `/settings#ai-provider`.
- [ ] `Subscribe` CTA: disabled "Coming soon" when `VITE_BILLING_ENABLED !== 'true'`; redirects to OAuth when logged out; calls `/functions/v1/billing/checkout` and `window.location.assign` when logged in and enabled.
- [ ] `/pricing/success` polls `/settings/tier` every 1s up to 10s; navigates to `/settings` on `tier === 'pro'`; renders timeout copy + manual link otherwise; clears interval on unmount.
- [ ] `/pricing/canceled` renders and links back to `/pricing`.
- [ ] `<PlanCard/>` "Upgrade to Pro" button wired per §5.2; no longer disabled.
- [ ] Settings upsell banner renders iff `tier === 'free' && used >= ceil(0.8*limit)`; dismissable within session.
- [ ] `formatUpsellComment` links to `${APP_URL}/pricing`; tier.test.ts updated.
- [ ] `<title>`, `<meta description>`, OG tags, canonical tag present on `/pricing` and sub-pages.
- [ ] Accessibility: column sections labelled, CTAs are real buttons/anchors, polling region `role="status" aria-live="polite"`.
- [ ] Vitest suite green (`yarn test`), `yarn tsc --noEmit` clean, `yarn build` succeeds on both machines.
- [ ] No new direct dependencies added beyond what's already in `frontend/package.json` (no `react-helmet`, no analytics libs).

## 15. Out of scope

- Stripe Checkout / webhook wiring (sub-project B).
- Feature-level gating beyond tier (sub-project C).
- Usage dashboard beyond the Plan card (sub-project E).
- Marketing copy polish beyond §6. Testimonials. FAQ expansion. A/B infra. OG image asset generation.

## 16. Implementation order (hand-off to writing-plans)

1. `lib/pricing-constants.ts` + `lib/billing.ts` + tests.
2. `components/PublicLayout.tsx` + `components/PricingColumn.tsx`.
3. `pages/Pricing.tsx` + tests.
4. `pages/PricingSuccess.tsx` + polling tests (fake timers).
5. `pages/PricingCanceled.tsx`.
6. `components/UpsellBanner.tsx` + tests.
7. Wire `<UpsellBanner/>` into `Settings.tsx`.
8. Rewire `<PlanCard/>` Upgrade button; update PlanCard tests.
9. Update `_shared/tier.ts` `formatUpsellComment` URL + tests.
10. Register routes in `main.tsx`.
11. Add SEO `<Head/>` component; apply to the three new pages.
12. Final `yarn tsc --noEmit && yarn test && yarn build`; visual spot-check at both domains.
