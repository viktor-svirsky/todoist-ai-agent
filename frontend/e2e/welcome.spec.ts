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

  test("shows try-it-now section with example commands", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    await expect(
      page.getByRole("heading", { name: "Try your first @ai command" }),
    ).toBeVisible();
    await expect(page.getByText("@ai break this task into smaller steps")).toBeVisible();
    await expect(page.getByText("@ai what should I do first?")).toBeVisible();
    await expect(page.getByText("@ai help me plan this project")).toBeVisible();
  });

  test("shows copy buttons for example commands", async ({ page }) => {
    await setupAuth(page);
    await page.goto("/welcome");
    const copyButtons = page.getByRole("button", { name: "Copy" });
    await expect(copyButtons).toHaveCount(3);
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
    const link = page.getByRole("link", { name: /Open Todoist/ });
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
});
