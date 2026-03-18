import { test, expect } from "@playwright/test";
import { setupAuth, mockSettingsAPI } from "./helpers";

test.describe("Landing page", () => {
  test("renders heading and subtext", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1#landing-heading")).toHaveText(
      "Todoist AI Agent",
    );
    await expect(
      page.getByText("An AI assistant that lives in your Todoist"),
    ).toBeVisible();
  });

  test("renders features list with 3 items", async ({ page }) => {
    await page.goto("/");
    const features = page.locator('ul[aria-label="Features"]');
    await expect(features).toBeVisible();
    await expect(features.locator("li")).toHaveCount(3);
    await expect(page.getByText(/Comment/)).toBeVisible();
    await expect(page.getByText("Web search included")).toBeVisible();
    await expect(page.getByText("Bring your own AI key")).toBeVisible();
  });

  test("renders Connect Todoist button", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "Connect Todoist" });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
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
