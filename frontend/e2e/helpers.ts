import { Page } from "@playwright/test";

export const MOCK_ACCESS_TOKEN = "test-access-token";

export const DEFAULT_SETTINGS = {
  trigger_word: "@ai",
  custom_ai_base_url: null,
  custom_ai_model: null,
  has_custom_ai_key: false,
  has_custom_brave_key: false,
  max_messages: 20,
  custom_prompt: null,
};

/** Intercept Supabase auth HTTP endpoints (token refresh, user info, logout). */
export async function interceptAuthEndpoints(page: Page) {
  const mockSession = {
    access_token: MOCK_ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "test-refresh-token",
    user: {
      id: "test-user-id",
      aud: "authenticated",
      role: "authenticated",
      email: "test@example.com",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    },
  };

  await page.route("**/auth/v1/token**", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify(mockSession),
      headers: { "Content-Type": "application/json" },
    }),
  );

  await page.route("**/auth/v1/user", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify(mockSession.user),
      headers: { "Content-Type": "application/json" },
    }),
  );

  await page.route("**/auth/v1/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
}

/**
 * Inject a mock Supabase session into localStorage.
 * Supports signOut (removeItem clears the session).
 * Must call before page.goto().
 */
export async function injectSession(page: Page) {
  await page.addInitScript(() => {
    let hasSession = true;
    const session = JSON.stringify({
      access_token: "test-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "test-refresh-token",
      user: {
        id: "test-user-id",
        aud: "authenticated",
        role: "authenticated",
        email: "test@example.com",
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    });

    const origGet = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    const origRemove = Storage.prototype.removeItem;

    Storage.prototype.getItem = function (key: string) {
      if (this === localStorage && /^sb-.*-auth-token$/.test(key)) {
        return hasSession ? session : null;
      }
      return origGet.call(this, key);
    };

    Storage.prototype.setItem = function (key: string, value: string) {
      if (this === localStorage && /^sb-.*-auth-token$/.test(key)) {
        hasSession = true;
        return;
      }
      return origSet.call(this, key, value);
    };

    Storage.prototype.removeItem = function (key: string) {
      if (this === localStorage && /^sb-.*-auth-token$/.test(key)) {
        hasSession = false;
        return;
      }
      return origRemove.call(this, key);
    };
  });
}

/** Full authenticated setup: session injection + auth endpoint interception. */
export async function setupAuth(page: Page) {
  await injectSession(page);
  await interceptAuthEndpoints(page);
}

export interface SettingsMockConfig {
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  loadStatus?: number;
  loadHeaders?: Record<string, string>;
  saveStatus?: number;
  saveHeaders?: Record<string, string>;
  testResult?: { valid: boolean; error?: string };
  testStatus?: number;
  deleteStatus?: number;
  deleteHeaders?: Record<string, string>;
}

/** Mock the /functions/v1/settings endpoint for all HTTP methods. */
export async function mockSettingsAPI(
  page: Page,
  config: SettingsMockConfig = {},
) {
  const settings = { ...DEFAULT_SETTINGS, ...config.settings };
  const loadStatus = config.loadStatus ?? 200;

  await page.route("**/functions/v1/settings", (route) => {
    const method = route.request().method();

    if (method === "GET") {
      route.fulfill({
        status: loadStatus,
        body:
          loadStatus >= 400
            ? JSON.stringify({ error: "Error" })
            : JSON.stringify(settings),
        headers: {
          "Content-Type": "application/json",
          ...(config.loadHeaders || {}),
        },
      });
    } else if (method === "PUT") {
      route.fulfill({
        status: config.saveStatus ?? 200,
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          ...(config.saveHeaders || {}),
        },
      });
    } else if (method === "POST") {
      route.fulfill({
        status: config.testStatus ?? 200,
        body: JSON.stringify(config.testResult ?? { valid: true }),
        headers: { "Content-Type": "application/json" },
      });
    } else if (method === "DELETE") {
      route.fulfill({
        status: config.deleteStatus ?? 200,
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          ...(config.deleteHeaders || {}),
        },
      });
    } else {
      route.continue();
    }
  });
}
