import { test, expect } from "@playwright/test";
import { setupAuth, mockSettingsAPI } from "./helpers";

test.describe("Landing page", () => {
  test("renders heading and subtext", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1#landing-heading")).toHaveText(
      "AI that lives in your Todoist",
    );
    await expect(
      page.getByText(/Stop context-switching/),
    ).toBeVisible();
  });

  test("renders use cases list with 4 items", async ({ page }) => {
    await page.goto("/");
    const useCases = page.locator('ul[aria-label="Use cases"]');
    await expect(useCases).toBeVisible();
    await expect(useCases.locator("li")).toHaveCount(4);
    await expect(page.getByText("Break Down Complex Tasks")).toBeVisible();
    await expect(page.getByText("Research Without Leaving Todoist")).toBeVisible();
  });

  test("renders Connect Todoist buttons", async ({ page }) => {
    await page.goto("/");
    const buttons = page.getByRole("button", { name: /Connect Todoist/ });
    await expect(buttons).toHaveCount(2);
    await expect(buttons.first()).toBeEnabled();
    await expect(buttons.last()).toBeEnabled();
  });

  test("renders footer links with target blank", async ({ page }) => {
    await page.goto("/");
    for (const name of ["GitHub", "Report a Bug", "Request a Feature"]) {
      const link = page.getByRole("link", { name });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("shows error alert when ?error param present", async ({ page }) => {
    await page.goto("/?error=auth_failed");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(
      "Authentication failed. Please try again.",
    );
  });

  test("no error alert without ?error param", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("alert")).not.toBeVisible();
  });

  test("redirects to /settings if session exists", async ({ page }) => {
    await setupAuth(page);
    await mockSettingsAPI(page);
    await page.goto("/");
    await page.waitForURL("**/settings");
  });

  test("main landmark has aria-labelledby", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main).toHaveAttribute("aria-labelledby", "landing-heading");
  });
});
