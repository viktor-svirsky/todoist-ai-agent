import { test, expect, Page } from "@playwright/test";
import {
  setupAuth,
  mockSettingsAPI,
  DEFAULT_SETTINGS,
  SettingsMockConfig,
} from "./helpers";

async function gotoSettings(
  page: Page,
  config?: SettingsMockConfig,
) {
  await setupAuth(page);
  await mockSettingsAPI(page, config);
  await page.goto("/settings");
}

async function switchToAdvanced(page: Page) {
  await page.getByRole("tab", { name: "Advanced" }).click();
}

// =============================================================================
// Auth & Loading
// =============================================================================

test.describe("Settings: auth & loading", () => {
  test("redirects to / when not authenticated", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForURL(/\/$/);
  });

  test("shows skeleton while fetching settings", async ({ page }) => {
    await setupAuth(page);
    let resolve: () => void;
    const loaded = new Promise<void>((r) => (resolve = r));
    await page.route("**/functions/v1/settings", async (route) => {
      if (route.request().method() === "GET") {
        await loaded;
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      }
    });
    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeVisible();
    resolve!();
    await expect(page.getByLabel("Loading settings")).not.toBeVisible();
  });
});

// =============================================================================
// Load errors
// =============================================================================

test.describe("Settings: load errors", () => {
  test("shows error on server error (500)", async ({ page }) => {
    await gotoSettings(page, { loadStatus: 500 });
    await expect(page.getByRole("alert")).toHaveText(
      "Failed to load settings.",
    );
  });

  test("shows rate limit error on 429", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) =>
      route.fulfill({
        status: 429,
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
          "Access-Control-Expose-Headers": "Retry-After",
        },
      }),
    );
    await page.goto("/settings");
    await expect(page.getByRole("alert")).toHaveText(
      "Too many requests. Please try again in 30 seconds.",
    );
  });

  test("shows disabled error on 403", async ({ page }) => {
    await gotoSettings(page, { loadStatus: 403 });
    await expect(page.getByRole("alert")).toHaveText(
      "Your account has been disabled. Please contact support.",
    );
  });

  test("shows network error", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => route.abort());
    await page.goto("/settings");
    await expect(page.getByRole("alert")).toHaveText(
      "Network error. Please check your connection and refresh.",
    );
  });

  test("retry button reloads settings successfully", async ({ page }) => {
    await setupAuth(page);
    let calls = 0;
    await page.route("**/functions/v1/settings", (route) => {
      calls++;
      if (calls === 1) {
        route.fulfill({ status: 500, body: "{}" });
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      }
    });
    await page.goto("/settings");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("#trigger-word")).toBeVisible();
  });
});

// =============================================================================
// Form display
// =============================================================================

test.describe("Settings: form display", () => {
  test("shows settings form with correct values", async ({ page }) => {
    await gotoSettings(page, {
      settings: {
        trigger_word: "@bot",
        custom_prompt: "Be helpful",
        custom_ai_base_url: "https://api.example.com",
        custom_ai_model: "gpt-4",
      },
    });
    await expect(page.locator("#trigger-word")).toHaveValue("@bot");
    await expect(page.locator("#custom-prompt")).toHaveValue("Be helpful");

    await switchToAdvanced(page);
    await expect(page.locator("#ai-base-url")).toHaveValue(
      "https://api.example.com",
    );
    await expect(page.locator("#ai-model")).toHaveValue("gpt-4");
  });

  test("shows heading and sign out button", async ({ page }) => {
    await gotoSettings(page);
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  });

  test("shows footer links", async ({ page }) => {
    await gotoSettings(page);
    for (const name of ["GitHub", "Report a Bug", "Request a Feature"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });

  test("main has aria-labelledby", async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByRole("main")).toHaveAttribute(
      "aria-labelledby",
      "settings-heading",
    );
  });
});

// =============================================================================
// Trigger word
// =============================================================================

test.describe("Settings: trigger word", () => {
  test("can edit trigger word", async ({ page }) => {
    await gotoSettings(page);
    const input = page.locator("#trigger-word");
    await input.fill("@assistant");
    await expect(input).toHaveValue("@assistant");
  });

  test("shows helper text", async ({ page }) => {
    await gotoSettings(page);
    await expect(
      page.getByText("The agent responds when this word appears"),
    ).toBeVisible();
  });
});

// =============================================================================
// Custom prompt
// =============================================================================

test.describe("Settings: custom prompt", () => {
  test("can edit custom prompt", async ({ page }) => {
    await gotoSettings(page);
    const textarea = page.locator("#custom-prompt");
    await textarea.fill("Be concise and helpful");
    await expect(textarea).toHaveValue("Be concise and helpful");
  });

  test("shows character count starting at 0", async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByText("0/2000")).toBeVisible();
  });

  test("character count updates on typing", async ({ page }) => {
    await gotoSettings(page);
    await page.locator("#custom-prompt").fill("Hello");
    await expect(page.getByText("5/2000")).toBeVisible();
  });

  test("shows correct count for pre-populated prompt", async ({ page }) => {
    await gotoSettings(page, {
      settings: { custom_prompt: "Hello world" },
    });
    await expect(page.getByText("11/2000")).toBeVisible();
  });
});

// =============================================================================
// AI Provider
// =============================================================================

test.describe("Settings: AI provider", () => {
  test("shows provider section with info links", async ({ page }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    await expect(page.getByText("AI Provider", { exact: true })).toBeVisible();
    for (const name of ["Anthropic", "OpenAI", "OpenRouter", "Groq"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });

  test("Test Connection hidden when AI fields empty", async ({ page }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    await expect(
      page.getByRole("button", { name: "Test Connection" }),
    ).not.toBeVisible();
  });

  test("Test Connection visible when all AI fields filled", async ({
    page,
  }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    await page.locator("#ai-base-url").fill("https://api.openai.com/v1");
    await page.locator("#ai-api-key").fill("sk-test");
    await page.locator("#ai-model").fill("gpt-4");
    await expect(
      page.getByRole("button", { name: "Test Connection" }),
    ).toBeVisible();
  });

  test("Test Connection success shows green message", async ({ page }) => {
    await gotoSettings(page, { testResult: { valid: true } });
    await switchToAdvanced(page);
    await page.locator("#ai-base-url").fill("https://api.openai.com/v1");
    await page.locator("#ai-api-key").fill("sk-test");
    await page.locator("#ai-model").fill("gpt-4");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("Connection successful")).toBeVisible();
  });

  test("Test Connection failure shows error", async ({ page }) => {
    await gotoSettings(page, {
      testResult: { valid: false, error: "Invalid API key" },
    });
    await switchToAdvanced(page);
    await page.locator("#ai-base-url").fill("https://api.openai.com/v1");
    await page.locator("#ai-api-key").fill("sk-bad");
    await page.locator("#ai-model").fill("gpt-4");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("Invalid API key")).toBeVisible();
  });

  test("Test result clears when AI field changes", async ({ page }) => {
    await gotoSettings(page, { testResult: { valid: true } });
    await switchToAdvanced(page);
    await page.locator("#ai-base-url").fill("https://api.openai.com/v1");
    await page.locator("#ai-api-key").fill("sk-test");
    await page.locator("#ai-model").fill("gpt-4");
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("Connection successful")).toBeVisible();
    await page.locator("#ai-model").fill("gpt-3.5");
    await expect(
      page.getByText("Connection successful"),
    ).not.toBeVisible();
  });

  test("password visibility toggle for AI API key", async ({ page }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    const input = page.locator("#ai-api-key");
    await expect(input).toHaveAttribute("type", "password");
    await page
      .getByRole("button", { name: "Show password" })
      .first()
      .click();
    await expect(input).toHaveAttribute("type", "text");
    await page
      .getByRole("button", { name: "Hide password" })
      .first()
      .click();
    await expect(input).toHaveAttribute("type", "password");
  });

  test("Reset AI Settings visible when custom key exists", async ({
    page,
  }) => {
    await gotoSettings(page, { settings: { has_custom_ai_key: true } });
    await switchToAdvanced(page);
    await expect(
      page.getByRole("button", { name: "Reset AI Settings" }),
    ).toBeVisible();
  });

  test("Reset AI Settings clears fields", async ({ page }) => {
    await setupAuth(page);
    let resetDone = false;
    await page.route("**/functions/v1/settings", (route) => {
      const method = route.request().method();
      if (method === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(
            resetDone
              ? DEFAULT_SETTINGS
              : {
                  ...DEFAULT_SETTINGS,
                  has_custom_ai_key: true,
                  custom_ai_base_url: "https://api.example.com",
                  custom_ai_model: "gpt-4",
                },
          ),
          headers: { "Content-Type": "application/json" },
        });
      } else if (method === "PUT") {
        resetDone = true;
        route.fulfill({ status: 200, body: "{}" });
      } else {
        route.continue();
      }
    });
    await page.goto("/settings");
    await switchToAdvanced(page);
    await expect(page.locator("#ai-base-url")).toHaveValue(
      "https://api.example.com",
    );
    await page.getByRole("button", { name: "Reset AI Settings" }).click();
    await expect(page.locator("#ai-base-url")).toHaveValue("");
    await expect(page.locator("#ai-model")).toHaveValue("");
  });

  test("Reset AI Settings failure shows error", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            ...DEFAULT_SETTINGS,
            has_custom_ai_key: true,
          }),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "PUT") {
        route.fulfill({ status: 500, body: "{}" });
      }
    });
    await page.goto("/settings");
    await switchToAdvanced(page);
    await page.getByRole("button", { name: "Reset AI Settings" }).click();
    await expect(page.getByText("Failed to reset AI settings")).toBeVisible();
  });
});

// =============================================================================
// Web Search
// =============================================================================

test.describe("Settings: web search", () => {
  test("shows web search section with Brave link", async ({ page }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    await expect(page.getByText("Web Search", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Brave Search API" }),
    ).toBeVisible();
  });

  test("password visibility toggle for Brave key", async ({ page }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    const input = page.locator("#brave-key");
    await expect(input).toHaveAttribute("type", "password");
    const braveSection = page.locator("fieldset", {
      has: page.getByText("Web Search"),
    });
    await braveSection.getByRole("button", { name: "Show password" }).click();
    await expect(input).toHaveAttribute("type", "text");
  });

  test("Reset Search Key visible when custom brave key exists", async ({
    page,
  }) => {
    await gotoSettings(page, { settings: { has_custom_brave_key: true } });
    await switchToAdvanced(page);
    await expect(
      page.getByRole("button", { name: "Reset Search Key" }),
    ).toBeVisible();
  });

  test("Reset Search Key hidden when no custom brave key", async ({
    page,
  }) => {
    await gotoSettings(page);
    await switchToAdvanced(page);
    await expect(
      page.getByRole("button", { name: "Reset Search Key" }),
    ).not.toBeVisible();
  });

  test("Reset Search Key clears key and hides button", async ({ page }) => {
    await setupAuth(page);
    let resetDone = false;
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(
            resetDone
              ? DEFAULT_SETTINGS
              : { ...DEFAULT_SETTINGS, has_custom_brave_key: true },
          ),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "PUT") {
        resetDone = true;
        route.fulfill({ status: 200, body: "{}" });
      }
    });
    await page.goto("/settings");
    await switchToAdvanced(page);
    await page.getByRole("button", { name: "Reset Search Key" }).click();
    await expect(
      page.getByRole("button", { name: "Reset Search Key" }),
    ).not.toBeVisible();
  });

  test("Reset Search Key failure shows error", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            ...DEFAULT_SETTINGS,
            has_custom_brave_key: true,
          }),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "PUT") {
        route.fulfill({ status: 500, body: "{}" });
      }
    });
    await page.goto("/settings");
    await switchToAdvanced(page);
    await page.getByRole("button", { name: "Reset Search Key" }).click();
    await expect(page.getByText("Failed to reset search key")).toBeVisible();
  });
});

// =============================================================================
// Save settings
// =============================================================================

test.describe("Settings: save", () => {
  test("success shows green message", async ({ page }) => {
    await gotoSettings(page);
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  });

  test("shows Saving... while request is in flight", async ({ page }) => {
    await setupAuth(page);
    let resolveSave!: () => void;
    const saveComplete = new Promise<void>((r) => (resolveSave = r));
    await page.route("**/functions/v1/settings", async (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "PUT") {
        await saveComplete;
        route.fulfill({ status: 200, body: "{}" });
      }
    });
    await page.goto("/settings");
    await expect(page.locator("#trigger-word")).toBeVisible();
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(
      page.getByRole("button", { name: "Saving..." }),
    ).toBeDisabled();
    resolveSave();
    await expect(
      page.getByRole("button", { name: "Save Settings" }),
    ).toBeEnabled();
  });

  test("sends correct payload", async ({ page }) => {
    await gotoSettings(page);
    await page.locator("#trigger-word").fill("@bot");
    await page.locator("#custom-prompt").fill("Be concise");
    await switchToAdvanced(page);
    await page.locator("#ai-base-url").fill("https://api.example.com");
    await page.locator("#ai-api-key").fill("sk-test123");
    await page.locator("#ai-model").fill("gpt-4");
    await page.locator("#brave-key").fill("BSA-test");

    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/functions/v1/settings") &&
        req.method() === "PUT",
    );
    await page.getByRole("button", { name: "Save Settings" }).click();

    const request = await requestPromise;
    const body = JSON.parse(request.postData()!);
    expect(body.trigger_word).toBe("@bot");
    expect(body.custom_prompt).toBe("Be concise");
    expect(body.custom_ai_base_url).toBe("https://api.example.com");
    expect(body.custom_ai_api_key).toBe("sk-test123");
    expect(body.custom_ai_model).toBe("gpt-4");
    expect(body.custom_brave_key).toBe("BSA-test");
  });

  test("429 error shows rate limit message", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "PUT") {
        route.fulfill({
          status: 429,
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "45",
            "Access-Control-Expose-Headers": "Retry-After",
          },
        });
      }
    });
    await page.goto("/settings");
    await expect(page.locator("#trigger-word")).toBeVisible();
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(
      page.getByText("Too many requests. Please try again in 45 seconds."),
    ).toBeVisible();
  });

  test("403 error shows disabled message", async ({ page }) => {
    await gotoSettings(page, { saveStatus: 403 });
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(
      page.getByText("Your account has been disabled. Please contact support."),
    ).toBeVisible();
  });

  test("500 error shows failure message", async ({ page }) => {
    await gotoSettings(page, { saveStatus: 500 });
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(page.getByText("Failed to save settings.")).toBeVisible();
  });

  test("network error shows error message", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      } else {
        route.abort();
      }
    });
    await page.goto("/settings");
    await expect(page.locator("#trigger-word")).toBeVisible();
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(
      page.getByText("Network error. Please try again."),
    ).toBeVisible();
  });
});

// =============================================================================
// Sign out
// =============================================================================

test.describe("Settings: sign out", () => {
  test("redirects to landing page", async ({ page }) => {
    await gotoSettings(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/$/);
  });
});

// =============================================================================
// Delete account
// =============================================================================

test.describe("Settings: delete account", () => {
  test("shows disconnect button", async ({ page }) => {
    await gotoSettings(page);
    await expect(
      page.getByRole("button", { name: "Disconnect & Delete Account" }),
    ).toBeVisible();
  });

  test("opens confirmation modal with correct content", async ({ page }) => {
    await gotoSettings(page);
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Delete Account" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("This will permanently delete your account"),
    ).toBeVisible();
  });

  test("Cancel closes modal", async ({ page }) => {
    await gotoSettings(page);
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("Escape closes modal", async ({ page }) => {
    await gotoSettings(page);
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("overlay click closes modal", async ({ page }) => {
    await gotoSettings(page);
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Click top-left corner of overlay (outside modal content)
    await dialog.click({ position: { x: 10, y: 10 } });
    await expect(dialog).not.toBeVisible();
  });

  test("confirm deletes account and redirects to /", async ({ page }) => {
    await gotoSettings(page);
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete Account" })
      .click();
    await page.waitForURL(/\/$/);
  });

  test("delete server error shows failure message", async ({ page }) => {
    await gotoSettings(page, { deleteStatus: 500 });
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete Account" })
      .click();
    await expect(page.getByText("Failed to delete account")).toBeVisible();
  });

  test("delete 429 shows rate limit message", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "DELETE") {
        route.fulfill({
          status: 429,
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
            "Access-Control-Expose-Headers": "Retry-After",
          },
        });
      }
    });
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete Account" })
      .click();
    await expect(
      page.getByText("Too many requests. Please try again in 60 seconds."),
    ).toBeVisible();
  });

  test("delete 403 shows disabled message", async ({ page }) => {
    await gotoSettings(page, { deleteStatus: 403 });
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete Account" })
      .click();
    await expect(
      page.getByText("Your account has been disabled. Please contact support."),
    ).toBeVisible();
  });

  test("delete network error shows error message", async ({ page }) => {
    await setupAuth(page);
    await page.route("**/functions/v1/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          body: JSON.stringify(DEFAULT_SETTINGS),
          headers: { "Content-Type": "application/json" },
        });
      } else if (route.request().method() === "DELETE") {
        route.abort();
      }
    });
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Disconnect & Delete Account" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete Account" })
      .click();
    await expect(
      page.getByText("Network error. Please try again."),
    ).toBeVisible();
  });
});
