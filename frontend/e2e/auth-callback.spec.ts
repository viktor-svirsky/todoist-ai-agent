import { test, expect } from "@playwright/test";
import { interceptAuthEndpoints, mockSettingsAPI } from "./helpers";

// An expired JWT (exp=0) that Supabase can decode — triggers the token refresh path
const EXPIRED_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjowfQ.test";

test.describe("Auth callback", () => {
  test("shows loading state while processing", async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("oauth_pending", "true");
      // Prevent React Strict Mode's second effect from clearing oauth_pending
      const origRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key: string) {
        if (this === sessionStorage && key === "oauth_pending") return;
        return origRemove.call(this, key);
      };
    });
    // Hold the token refresh request so setSession never completes
    await page.route("**/auth/v1/token**", () => {});
    await page.goto(
      `/auth/callback#access_token=${EXPIRED_JWT}&refresh_token=ref`,
    );
    await expect(page.getByText("Completing setup...")).toBeVisible();
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  test("redirects to error on state mismatch (no oauth_pending)", async ({
    page,
  }) => {
    await page.goto(
      `/auth/callback#access_token=${EXPIRED_JWT}&refresh_token=ref`,
    );
    await page.waitForURL(/\?error=state_mismatch/);
    await expect(page.getByRole("alert")).toHaveText(
      "Authentication failed. Please try again.",
    );
  });

  test("redirects to error with empty hash", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("oauth_pending", "true"),
    );
    await page.goto("/auth/callback");
    await page.waitForURL(/\?error=missing_session/);
  });

  test("redirects to error with only access_token", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("oauth_pending", "true"),
    );
    await page.goto(`/auth/callback#access_token=${EXPIRED_JWT}`);
    await page.waitForURL(/\?error=missing_session/);
  });

  test("redirects to error with only refresh_token", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("oauth_pending", "true"),
    );
    await page.goto("/auth/callback#refresh_token=ref");
    await page.waitForURL(/\?error=missing_session/);
  });

  test("successful auth redirects to /settings", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("oauth_pending", "true"),
    );
    await interceptAuthEndpoints(page);
    await mockSettingsAPI(page);
    // Support session storage after setSession stores the new session
    await page.addInitScript(() => {
      let stored: string | null = null;
      const origGet = Storage.prototype.getItem;
      const origSet = Storage.prototype.setItem;
      const origRemove = Storage.prototype.removeItem;
      Storage.prototype.getItem = function (key: string) {
        if (this === localStorage && /^sb-.*-auth-token$/.test(key))
          return stored;
        return origGet.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === localStorage && /^sb-.*-auth-token$/.test(key)) {
          stored = value;
          return;
        }
        return origSet.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key: string) {
        if (this === localStorage && /^sb-.*-auth-token$/.test(key)) {
          stored = null;
          return;
        }
        return origRemove.call(this, key);
      };
    });
    await page.goto(
      `/auth/callback#access_token=${EXPIRED_JWT}&refresh_token=test-ref`,
    );
    await page.waitForURL("**/welcome");
  });

  test("redirects to error when setSession fails", async ({ page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem("oauth_pending", "true"),
    );
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        status: 400,
        body: JSON.stringify({ error: "invalid_grant" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    await page.goto(
      `/auth/callback#access_token=${EXPIRED_JWT}&refresh_token=bad`,
    );
    await page.waitForURL(/\?error=session_failed/);
  });
});
