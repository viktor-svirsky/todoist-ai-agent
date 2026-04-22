import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

const SUPABASE_URL = "https://example.supabase.co";

describe("BillingReturn", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let assignMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign: assignMock },
    });

    const { supabase } = await import("../lib/supabase");
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { access_token: "tok" } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function flush() {
    // Let microtasks resolve between timer advances.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("flips to Pro and redirects once settings/tier reports pro", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "free" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "free" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "pro" }), { status: 200 }),
      );

    const { default: BillingReturn } = await import("./BillingReturn");
    render(
      <MemoryRouter>
        <BillingReturn />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Finalizing your subscription/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await flush();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await flush();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await flush();
    });

    expect(
      screen.getByText(/Pro activated\. Redirecting to Settings/i),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(assignMock).toHaveBeenCalledWith("/settings");

    const fetchUrl = fetchMock.mock.calls[0][0];
    expect(fetchUrl).toBe(`${SUPABASE_URL}/functions/v1/settings/tier`);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("shows timeout copy after 15s of free tier", async () => {
    fetchMock.mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ tier: "free" }), { status: 200 }),
        ),
    );

    const { default: BillingReturn } = await import("./BillingReturn");
    render(
      <MemoryRouter>
        <BillingReturn />
      </MemoryRouter>,
    );

    for (let i = 0; i < 25; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800);
        await flush();
      });
    }

    expect(
      screen.getByText(/Payment received\. Your plan will update shortly/i),
    ).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
