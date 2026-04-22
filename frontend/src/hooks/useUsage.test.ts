import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

import { useUsage } from "./useUsage";

const sampleBody = {
  live_24h: { used: 2, limit: 5, next_slot_at: null },
  daily: [
    { day_start: "2026-04-15T00:00:00Z", counted: 1, denied: 0, refunded: 0 },
  ],
  summary: { days: 30, total: 3, counted: 2, denied: 1, refunded: 0 },
  tools: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useUsage", () => {
  it("sends sign-flipped tz_offset derived from getTimezoneOffset", async () => {
    // PDT: getTimezoneOffset = 420; tz_offset param should be -420.
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(420);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("tz_offset=-420");
    expect(result.current.data).toEqual(sampleBody);
    expect(result.current.error).toBe(null);
  });

  it("positive tz offset (JST) sends tz_offset=540", async () => {
    // JST: getTimezoneOffset = -540; tz_offset param should be 540.
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(String(fetchMock.mock.calls[0][0])).toContain("tz_offset=540");
  });

  it("surfaces error on 500", async () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })),
    );
    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).not.toBe(null);
  });

  it("re-fetches on window focus", async () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(sampleBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
