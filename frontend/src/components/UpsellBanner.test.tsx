import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

function mockTier(data: unknown) {
  vi.doMock("../hooks/useTier", () => ({
    useTier: () => ({ data, loading: false, error: null, refresh: vi.fn() }),
  }));
}

describe("UpsellBanner", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not render for pro", async () => {
    mockTier({
      tier: "pro",
      used: null,
      limit: -1,
      next_slot_at: null,
      pro_until: null,
    });
    const { UpsellBanner } = await import("./UpsellBanner");
    const { container } = render(
      <MemoryRouter>
        <UpsellBanner />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not render below 80%", async () => {
    mockTier({
      tier: "free",
      used: 3,
      limit: 5,
      next_slot_at: null,
      pro_until: null,
    });
    const { UpsellBanner } = await import("./UpsellBanner");
    const { container } = render(
      <MemoryRouter>
        <UpsellBanner />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders at >= 80% with exact copy", async () => {
    mockTier({
      tier: "free",
      used: 4,
      limit: 5,
      next_slot_at: null,
      pro_until: null,
    });
    const { UpsellBanner } = await import("./UpsellBanner");
    render(
      <MemoryRouter>
        <UpsellBanner />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        /You've used 4 of 5 AI messages in the last 24 hours\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Upgrade to Pro/i }),
    ).toHaveAttribute("href", "/pricing");
  });

  it("dismisses within session", async () => {
    mockTier({
      tier: "free",
      used: 5,
      limit: 5,
      next_slot_at: null,
      pro_until: null,
    });
    const { UpsellBanner } = await import("./UpsellBanner");
    render(
      <MemoryRouter>
        <UpsellBanner />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText(/You've used/)).not.toBeInTheDocument();
  });

  it("does not render when data is null", async () => {
    mockTier(null);
    const { UpsellBanner } = await import("./UpsellBanner");
    const { container } = render(
      <MemoryRouter>
        <UpsellBanner />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
