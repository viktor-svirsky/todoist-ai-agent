import { describe, it, expect, vi, beforeEach } from "vitest";
import { statsHandler } from "../stats/handler.ts";

const mockSelect = vi.fn();
vi.mock("../_shared/supabase.ts", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("statsHandler", () => {
  it("returns 405 for non-GET requests", async () => {
    const req = new Request("http://localhost/stats", { method: "POST" });
    const res = await statsHandler(req);
    expect(res.status).toBe(405);
  });

  it("returns user count on success", async () => {
    mockSelect.mockResolvedValue({ count: 55, error: null });
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await statsHandler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(55);
  });

  it("returns cache headers", async () => {
    mockSelect.mockResolvedValue({ count: 10, error: null });
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await statsHandler(req);
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });

  it("returns CORS header", async () => {
    mockSelect.mockResolvedValue({ count: 10, error: null });
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await statsHandler(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://todoist-ai-agent.pages.dev"
    );
  });

  it("returns 500 on database error", async () => {
    mockSelect.mockResolvedValue({ count: null, error: { message: "fail" } });
    const req = new Request("http://localhost/stats", { method: "GET" });
    const res = await statsHandler(req);
    expect(res.status).toBe(500);
  });
});
