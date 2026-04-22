import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

vi.mock("../lib/billingApi", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));

let __billingEnabled = true;
vi.mock("../lib/pricing-constants", () => ({
  AI_QUOTA_FREE_MAX: 5,
  get BILLING_ENABLED() {
    return __billingEnabled;
  },
  PRO_PRICE_USD: 5,
}));

import { PlanCard } from "./PlanCard";
import * as useTierModule from "../hooks/useTier";
import * as billingApi from "../lib/billingApi";

function renderPlanCard() {
  return render(
    <MemoryRouter>
      <PlanCard />
    </MemoryRouter>,
  );
}

const originalLocation = window.location;

beforeEach(() => {
  vi.restoreAllMocks();
  __billingEnabled = true;
  // Re-apply mocked module functions after restoreAllMocks clears them.
  vi.mocked(billingApi.startCheckout).mockReset();
  vi.mocked(billingApi.openBillingPortal).mockReset();

  // Stub window.location.assign.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: vi.fn() },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function mockTier(data: Partial<ReturnType<typeof useTierModule.useTier>>) {
  vi.spyOn(useTierModule, "useTier").mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refresh: async () => {},
    ...data,
  } as ReturnType<typeof useTierModule.useTier>);
}

describe("PlanCard", () => {
  it("Free: renders badge, counter, and enabled Upgrade button that calls startCheckout", async () => {
    mockTier({
      data: {
        tier: "free",
        used: 3,
        limit: 5,
        next_slot_at: new Date(
          Date.now() + 14 * 3600_000 + 22 * 60_000,
        ).toISOString(),
        pro_until: null,
      },
    });
    vi.mocked(billingApi.startCheckout).mockResolvedValue({
      url: "https://checkout.stripe.test/abc",
    });
    renderPlanCard();
    expect(screen.getByText(/Free/i)).toBeInTheDocument();
    expect(screen.getByText(/3.*of.*5/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /upgrade to pro/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(billingApi.startCheckout).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.test/abc",
      );
    });
  });

  it("Free: Upgrade error shows message and re-enables button", async () => {
    mockTier({
      data: {
        tier: "free",
        used: 0,
        limit: 5,
        next_slot_at: null,
        pro_until: null,
      },
    });
    vi.mocked(billingApi.startCheckout).mockRejectedValue(new Error("boom"));
    renderPlanCard();
    const btn = screen.getByRole("button", { name: /upgrade to pro/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/could not start checkout/i)).toBeInTheDocument();
    });
    expect(btn).not.toBeDisabled();
  });

  it("Pro: renders Manage billing button that opens billing portal", async () => {
    mockTier({
      data: {
        tier: "pro",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: "2026-05-21T00:00:00Z",
      },
    });
    vi.mocked(billingApi.openBillingPortal).mockResolvedValue({
      url: "https://billing.stripe.test/xyz",
    });
    renderPlanCard();
    expect(screen.getByText(/Unlimited/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-21/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /manage billing/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(billingApi.openBillingPortal).toHaveBeenCalledTimes(1);
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://billing.stripe.test/xyz",
      );
    });
  });

  it("Free: renders the four gate bullet points", () => {
    mockTier({
      data: {
        tier: "free",
        used: 1,
        limit: 5,
        next_slot_at: null,
        pro_until: null,
      },
    });
    renderPlanCard();
    const list = screen.getByTestId("free-gate-bullets");
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByText(/Web search is Pro-only/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only Todoist tools/)).toBeInTheDocument();
    expect(screen.getByText(/Custom prompts apply on Pro/)).toBeInTheDocument();
    expect(screen.getByText(/Custom model selection requires your own AI key/)).toBeInTheDocument();
  });

  it("Pro: does not render gate bullets", () => {
    mockTier({
      data: {
        tier: "pro",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: "2026-05-21T00:00:00Z",
      },
    });
    renderPlanCard();
    expect(screen.queryByTestId("free-gate-bullets")).toBeNull();
  });

  it("BYOK: renders unlimited, no billing buttons", () => {
    mockTier({
      data: {
        tier: "byok",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: null,
      },
    });
    renderPlanCard();
    expect(screen.getByText(/BYOK/i)).toBeInTheDocument();
    expect(screen.getByText(/your own AI key/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upgrade to pro/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /manage billing/i })).toBeNull();
  });

  it("Loading: does not crash, shows skeleton", () => {
    mockTier({ data: null, loading: true });
    renderPlanCard();
    expect(screen.getByTestId("plan-card-skeleton")).toBeInTheDocument();
  });

  it("Error: renders a small error state without leaking internals", () => {
    mockTier({ data: null, loading: false, error: new Error("anything") });
    renderPlanCard();
    expect(screen.getByText(/plan info unavailable/i)).toBeInTheDocument();
  });

  it("Free + billing disabled: Upgrade click does not call startCheckout", async () => {
    __billingEnabled = false;
    mockTier({
      data: {
        tier: "free",
        used: 1,
        limit: 5,
        next_slot_at: null,
        pro_until: null,
      },
    });
    renderPlanCard();
    const btn = screen.getByRole("button", { name: /upgrade to pro/i });
    fireEvent.click(btn);
    await Promise.resolve();
    expect(billingApi.startCheckout).not.toHaveBeenCalled();
  });
});
