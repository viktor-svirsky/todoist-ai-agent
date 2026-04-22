import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "tok-123" } },
      }),
    },
  },
}));

import { UsageTab } from "./UsageTab";
import * as useUsageModule from "../hooks/useUsage";
import type { UsageData } from "../hooks/useUsage";

const baseData: UsageData = {
  live_24h: { used: 2, limit: 5, next_slot_at: null },
  daily: [
    { day_start: "2026-04-15T00:00:00Z", counted: 1, denied: 0, refunded: 0 },
    { day_start: "2026-04-16T00:00:00Z", counted: 3, denied: 1, refunded: 0 },
  ],
  summary: { days: 30, total: 5, counted: 3, denied: 2, refunded: 0 },
  tools: null,
};

function mockUsage(
  partial: Partial<ReturnType<typeof useUsageModule.useUsage>>,
) {
  vi.spyOn(useUsageModule, "useUsage").mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    ...partial,
  } as ReturnType<typeof useUsageModule.useUsage>);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsageTab", () => {
  it("renders skeleton while loading", () => {
    mockUsage({ loading: true });
    render(<UsageTab />);
    expect(screen.getByTestId("usage-tab-skeleton")).toBeInTheDocument();
  });

  it("renders error state with retry that calls refresh", async () => {
    const refresh = vi.fn(async () => {});
    mockUsage({ error: new Error("boom"), refresh });
    render(<UsageTab />);
    expect(screen.getByTestId("usage-tab-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders Live24h counter from data", () => {
    mockUsage({ data: baseData });
    render(<UsageTab />);
    const live = screen.getByTestId("usage-live-24h");
    expect(live.textContent).toMatch(/2/);
    expect(live.textContent).toMatch(/5/);
  });

  it("renders tools placeholder when data.tools is null", () => {
    mockUsage({ data: baseData });
    render(<UsageTab />);
    expect(
      screen.getByTestId("usage-tools-placeholder"),
    ).toBeInTheDocument();
    expect(screen.getByText(/sub-project C/i)).toBeInTheDocument();
  });

  it("renders tool list when data.tools is populated", () => {
    mockUsage({
      data: {
        ...baseData,
        tools: [
          { tool_name: "web_search", count: 4 },
          { tool_name: "list_tasks", count: 2 },
        ],
      },
    });
    render(<UsageTab />);
    const tools = screen.getByTestId("usage-tools");
    expect(tools).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("list_tasks")).toBeInTheDocument();
  });

  it("renders summary fields", () => {
    mockUsage({ data: baseData });
    render(<UsageTab />);
    const summary = screen.getByTestId("usage-summary");
    expect(summary.textContent).toMatch(/Last 30 days/);
    expect(summary.textContent).toMatch(/5/); // total
  });

  it("Export button fetches CSV with Authorization header", async () => {
    mockUsage({ data: baseData });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("event_time,tier\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    render(<UsageTab />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok-123");
    expect(String(fetchMock.mock.calls[0][0])).toContain("usage.csv?days=30");
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("Export button surfaces error on non-OK response", async () => {
    mockUsage({ data: baseData });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    render(<UsageTab />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
