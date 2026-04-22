import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Pricing page (billing disabled)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../lib/pricing-constants", () => ({
      AI_QUOTA_FREE_MAX: 5,
      BILLING_ENABLED: false,
      PRO_PRICE_USD: 5,
    }));
    vi.doMock("../lib/supabase", () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        },
      },
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../lib/pricing-constants");
    vi.doUnmock("../lib/supabase");
  });

  async function renderPricing() {
    const { default: Pricing } = await import("./Pricing");
    return render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
  }

  it("renders three columns with committed copy", async () => {
    await renderPricing();
    expect(
      screen.getByRole("heading", { level: 2, name: "Free" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Pro" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "BYOK" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/5 AI messages per rolling 24 hours/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unlimited AI messages/)).toBeInTheDocument();
    expect(screen.getByText(/bring your own key/i)).toBeInTheDocument();
  });

  it("shows Coming soon when billing disabled", async () => {
    await renderPricing();
    const btn = screen.getByRole("button", { name: /coming soon/i });
    expect(btn).toBeDisabled();
  });

  it("Use your own key links to Settings", async () => {
    await renderPricing();
    const link = screen.getByRole("link", { name: /use your own key/i });
    expect(link).toHaveAttribute("href", "/settings#ai-provider");
  });

  it("sets document.title and meta description", async () => {
    await renderPricing();
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

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../lib/pricing-constants");
    vi.doUnmock("../lib/supabase");
    vi.doUnmock("../lib/billing");
  });

  it("logged-in click calls startCheckout", async () => {
    const startCheckout = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../lib/billing", () => ({
      startCheckout,
      openPortal: vi.fn(),
    }));
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
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
    // Wait for session effect to resolve so the Subscribe CTA shows
    const btn = await screen.findByRole("button", { name: /^subscribe$/i });
    await userEvent.click(btn);
    expect(startCheckout).toHaveBeenCalled();
  });
});
