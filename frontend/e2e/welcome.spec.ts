import { test, expect } from "@playwright/test";
import { setupAuth, mockSettingsAPI } from "./helpers";

// =============================================================================
// Auth guard
// =============================================================================

test.describe("Welcome: auth guard", () => {
  test("redirects to / when not authenticated", async ({ page }) => {
    await page.goto("/welcome");
    await page.waitForURL(/\/$/);
  });

});

// =============================================================================
// Rendering
// =============================================================================

test.describe("Welcome: rendering", () => {
  test("shows 'You're Connected!' heading", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(
      page.getByRole("heading", { name: "You're Connected!" }),
    ).toBeVisible();
  });

  test("shows how-to-use section with 3 steps", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(
      page.getByRole("heading", { name: "Here's How to Use It" }),
    ).toBeVisible();
    const steps = page.locator('ol[aria-label="Getting started steps"]');
    await expect(steps).toBeVisible();
    await expect(steps.locator("li")).toHaveCount(3);
  });

  test("shows step titles", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(page.getByText("Open Any Task in Todoist")).toBeVisible();
    await expect(
      page.getByText("Comment @ai With Your Question"),
    ).toBeVisible();
    await expect(page.getByText("Get an Instant AI Response")).toBeVisible();
  });

  test("shows Go to Settings button", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(
      page.getByRole("button", { name: "Go to Settings" }),
    ).toBeVisible();
  });

  test("shows Open Todoist link with target blank", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    const link = page.getByRole("link", { name: "Open Todoist" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("shows footer links", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    for (const name of ["GitHub", "Report a Bug", "Request a Feature"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });
});

// =============================================================================
// Navigation
// =============================================================================

test.describe("Welcome: navigation", () => {
  test("Go to Settings navigates to /settings", async ({ page }) => {
    await setupAuth(page);
    await mockSettingsAPI(page);
    await page.goto("/welcome");
    await page.getByRole("button", { name: "Go to Settings" }).click();
    await page.waitForURL("**/settings");
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
  });
});

// =============================================================================
// Accessibility
// =============================================================================

test.describe("Welcome: accessibility", () => {
  test("main has aria-labelledby pointing to heading", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(page.getByRole("main")).toHaveAttribute(
      "aria-labelledby",
      "welcome-heading",
    );
  });

  test("step numbers are decorative (aria-hidden)", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    const steps = page.locator('ol[aria-label="Getting started steps"] li');
    await expect(steps).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const badge = steps.nth(i).locator("span[aria-hidden='true']");
      await expect(badge).toBeVisible();
    }
  });
});
