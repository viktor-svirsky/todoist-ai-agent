import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

const SUPABASE_URL = "https://example.supabase.co";

describe("billingApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", SUPABASE_URL);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { supabase } = await import("./supabase");
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("startCheckout returns url on 200 and sends bearer token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/abc" }), {
        status: 200,
      }),
    );
    const { startCheckout } = await import("./billingApi");
    const result = await startCheckout();
    expect(result).toEqual({ url: "https://checkout.stripe.com/abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/stripe-checkout`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer token-abc" });
  });

  it("openBillingPortal returns url on 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.stripe.com/xyz" }), {
        status: 200,
      }),
    );
    const { openBillingPortal } = await import("./billingApi");
    const result = await openBillingPortal();
    expect(result).toEqual({ url: "https://billing.stripe.com/xyz" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE_URL}/functions/v1/stripe-portal`);
  });

  it("throws on non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const { startCheckout } = await import("./billingApi");
    await expect(startCheckout()).rejects.toThrow("stripe-checkout failed: 401");
  });

  it("throws when no session", async () => {
    const { supabase } = await import("./supabase");
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: null },
    });
    const { openBillingPortal } = await import("./billingApi");
    await expect(openBillingPortal()).rejects.toThrow("Not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
