import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { PlanCard } from "./PlanCard";
import * as useTierModule from "../hooks/useTier";

beforeEach(() => {
  vi.restoreAllMocks();
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
  it("Free: renders badge, counter, and disabled upgrade button", () => {
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
    render(<PlanCard />);
    expect(screen.getByText(/Free/i)).toBeInTheDocument();
    expect(screen.getByText(/3.*of.*5/i)).toBeInTheDocument();
    expect(screen.getByText(/last 24 hours/i)).toBeInTheDocument();
    expect(screen.queryByText(/today/i)).toBeNull();
    const btn = screen.getByRole("button", { name: /upgrade to pro/i });
    expect(btn).toBeDisabled();
  });

  it("Pro: renders unlimited and active-until line", () => {
    mockTier({
      data: {
        tier: "pro",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: "2026-05-21T00:00:00Z",
      },
    });
    render(<PlanCard />);
    expect(screen.getAllByText(/Pro/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Unlimited/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-21/)).toBeInTheDocument();
  });

  it("BYOK: renders unlimited with your-own-key note", () => {
    mockTier({
      data: {
        tier: "byok",
        used: null,
        limit: -1,
        next_slot_at: null,
        pro_until: null,
      },
    });
    render(<PlanCard />);
    expect(screen.getByText(/BYOK/i)).toBeInTheDocument();
    expect(screen.getByText(/your own AI key/i)).toBeInTheDocument();
  });

  it("Loading: does not crash, shows skeleton", () => {
    mockTier({ data: null, loading: true });
    render(<PlanCard />);
    expect(screen.getByTestId("plan-card-skeleton")).toBeInTheDocument();
  });

  it("Error: renders a small error state without leaking internals", () => {
    mockTier({ data: null, loading: false, error: new Error("anything") });
    render(<PlanCard />);
    expect(screen.getByText(/plan info unavailable/i)).toBeInTheDocument();
  });
});
