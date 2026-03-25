import { describe, it, expect } from "vitest";

describe("sentry", () => {
  it("initSentry does not throw when VITE_SENTRY_DSN is not set", async () => {
    const { initSentry } = await import("./sentry");
    expect(() => initSentry()).not.toThrow();
  });
});
