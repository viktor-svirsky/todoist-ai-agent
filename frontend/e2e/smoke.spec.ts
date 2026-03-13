import { test, expect } from "@playwright/test";

test("landing page shows heading", async ({ page }) => {
  await page.goto("/");
  const heading = page.locator("h1#landing-heading");
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText("Todoist AI Agent");
});

test("landing page shows Connect Todoist button", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Connect Todoist" });
  await expect(button).toBeVisible();
});

test("landing page shows features list", async ({ page }) => {
  await page.goto("/");
  const features = page.locator('ul[aria-label="Features"]');
  await expect(features).toBeVisible();
  const items = features.locator("li");
  await expect(items).toHaveCount(3);
});

test("unknown route shows 404 page", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page.locator("h1")).toContainText("404");
  await expect(page.getByText("doesn't exist")).toBeVisible();
});
