import { test, expect } from "@playwright/test";

test.describe("404 page", () => {
  test("shows 404 heading and message", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.locator("h1")).toContainText("404");
    await expect(page.getByText("doesn't exist")).toBeVisible();
  });

  test("Go Home link navigates to landing", async ({ page }) => {
    await page.goto("/nonexistent");
    await page.getByRole("link", { name: "Go Home" }).click();
    await expect(page.locator("h1#landing-heading")).toBeVisible();
  });

  test("main has correct aria attributes", async ({ page }) => {
    await page.goto("/nonexistent");
    const main = page.getByRole("main");
    await expect(main).toHaveAttribute(
      "aria-labelledby",
      "not-found-heading",
    );
  });
});
