import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok" } },
      }),
    },
  },
}));

describe("billing.startCheckout", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { assign: vi.fn() },
      writable: true,
    });
  });

  it("posts to /stripe-checkout with bearer token and redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://checkout.example/abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { startCheckout } = await import("./billing");
    await startCheckout();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/stripe-checkout"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(window.location.assign).toHaveBeenCalledWith(
      "https://checkout.example/abc",
    );
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const { startCheckout } = await import("./billing");
    await expect(startCheckout()).rejects.toThrow(/checkout_500/);
  });
});
