import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

async function flush() {
  // Allow queued microtasks (fetch + json promises) to settle.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("PricingSuccess polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigateMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("navigates to /settings when tier flips to pro", async () => {
    const responses: Array<{ tier: string }> = [
      { tier: "free" },
      { tier: "free" },
      { tier: "pro" },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => responses.shift() ?? { tier: "pro" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { default: PricingSuccess } = await import("./PricingSuccess");
    render(
      <MemoryRouter>
        <PricingSuccess />
      </MemoryRouter>,
    );

    await act(async () => {
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });

    expect(navigateMock).toHaveBeenCalledWith("/settings", { replace: true });
  });

  it("renders timeout copy after 10 attempts with no pro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tier: "free" }),
      })),
    );
    const { default: PricingSuccess } = await import("./PricingSuccess");
    render(
      <MemoryRouter>
        <PricingSuccess />
      </MemoryRouter>,
    );

    await act(async () => {
      await flush();
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await flush();
      });
    }

    expect(screen.getByText(/Almost there\./)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Go to Settings/i }),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("clears interval on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tier: "free" }),
      })),
    );
    const { default: PricingSuccess } = await import("./PricingSuccess");
    const { unmount } = render(
      <MemoryRouter>
        <PricingSuccess />
      </MemoryRouter>,
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
