import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetSession = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

import { useTier } from "./useTier";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTier", () => {
  it("returns flat fields parsed from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tier: "free",
            used: 3,
            limit: 5,
            next_slot_at: "2026-04-22T14:02:00Z",
            pro_until: null,
          }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useTier());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({
      tier: "free",
      used: 3,
      limit: 5,
      next_slot_at: "2026-04-22T14:02:00Z",
      pro_until: null,
    });
    expect(result.current.error).toBe(null);
  });

  it("surfaces errors without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })),
    );
    const { result } = renderHook(() => useTier());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).not.toBe(null);
  });

  it("refresh re-fetches the tier endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tier: "free",
            used: 1,
            limit: 5,
            next_slot_at: null,
            pro_until: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tier: "pro",
            used: 0,
            limit: 1000,
            next_slot_at: null,
            pro_until: "2099-01-01T00:00:00Z",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTier());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.tier).toBe("free");

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.data?.tier).toBe("pro"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
