import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
    },
  },
}));

const mockSettings = {
  trigger_word: "@ai",
  custom_ai_base_url: null,
  custom_ai_model: null,
  has_custom_ai_key: false,
  has_custom_brave_key: false,
  max_messages: 20,
  custom_prompt: null,
  digest_enabled: false,
  digest_time: "08:00",
  digest_timezone: "UTC",
  digest_project_id: null,
};

const mockSession = {
  data: { session: { access_token: "test-token" } },
};

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(mockSession);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSettings),
      headers: new Headers(),
    }),
  );
});

// ============================================================================
// Loading & initial render
// ============================================================================

describe("Settings: loading state", () => {
  it("shows loading text initially", () => {
    mockGetSession.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("redirects to / when no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    renderSettings();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });
});

// ============================================================================
// Settings display
// ============================================================================

describe("Settings: display", () => {
  it("renders settings form after loading", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());
    expect(screen.getByDisplayValue("@ai")).toBeInTheDocument();
    expect(screen.getByText("Save Settings")).toBeInTheDocument();
    expect(screen.getByText("Disconnect & Delete Account")).toBeInTheDocument();
  });

  it("populates fields from loaded settings", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ...mockSettings,
          trigger_word: "@bot",
          custom_ai_base_url: "https://api.openai.com/v1",
          custom_ai_model: "gpt-4o",
          custom_prompt: "Be concise",
        }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() => expect(screen.getByDisplayValue("@bot")).toBeInTheDocument());
    expect(screen.getByDisplayValue("https://api.openai.com/v1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Be concise")).toBeInTheDocument();
  });

  it("shows (key set) placeholder when custom AI key exists", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockSettings, has_custom_ai_key: true }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());
    const aiKeyInput = screen.getByPlaceholderText(/key set/);
    expect(aiKeyInput).toBeInTheDocument();
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("Settings: error handling", () => {
  it("shows error when load fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Failed to load settings.")).toBeInTheDocument(),
    );
  });

  it("shows network error on fetch exception", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network failure"));

    renderSettings();
    await waitFor(() =>
      expect(
        screen.getByText("Network error. Please check your connection and refresh."),
      ).toBeInTheDocument(),
    );
  });

  it("shows rate limit message on 429 during load", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "Rate limit exceeded" }),
      headers: new Headers({ "Retry-After": "30" }),
    } as Response);

    renderSettings();
    await waitFor(() =>
      expect(
        screen.getByText("Too many requests. Please try again in 30 seconds."),
      ).toBeInTheDocument(),
    );
  });

  it("shows disabled message on 403 during load", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Account disabled" }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() =>
      expect(
        screen.getByText("Your account has been disabled. Please contact support."),
      ).toBeInTheDocument(),
    );
  });
});

// ============================================================================
// Save
// ============================================================================

describe("Settings: save", () => {
  it("shows success message on save", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    // fetch is called once for load, then for save, then reload
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSettings),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(screen.getByText("Settings saved.")).toBeInTheDocument(),
    );
  });

  it("shows rate limit message on 429 during save", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "Rate limit exceeded" }),
      headers: new Headers({ "Retry-After": "45" }),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(
        screen.getByText("Too many requests. Please try again in 45 seconds."),
      ).toBeInTheDocument(),
    );
  });

  it("shows disabled message on 403 during save", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Account disabled" }),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Your account has been disabled. Please contact support.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("shows generic failure on other save errors", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(screen.getByText("Failed to save settings.")).toBeInTheDocument(),
    );
  });

  it("shows Saving... while request is in flight", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    // Make save hang
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByText("Save Settings"));
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });
});

// ============================================================================
// Form interactions
// ============================================================================

describe("Settings: form interactions", () => {
  it("updates trigger word on input", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    const input = screen.getByDisplayValue("@ai");
    await user.clear(input);
    await user.type(input, "@bot");
    expect(input).toHaveValue("@bot");
  });

  it("shows character count for custom prompt", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());
    expect(screen.getByText("0/2000")).toBeInTheDocument();
  });

  it("updates character count on custom prompt input", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/I live in Berlin/);
    await user.type(textarea, "Hello");
    expect(screen.getByText("5/2000")).toBeInTheDocument();
  });
});

// ============================================================================
// Digest settings
// ============================================================================

describe("Settings: digest", () => {
  it("renders digest toggle and can toggle it", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Daily Digest")).toBeInTheDocument());

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("shows time and timezone fields when digest is enabled", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockSettings, digest_enabled: true }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() => expect(screen.getByText("Delivery Time")).toBeInTheDocument());
    expect(screen.getByText("Timezone")).toBeInTheDocument();
  });

  it("hides time and timezone fields when digest is disabled", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText("Daily Digest")).toBeInTheDocument());
    expect(screen.queryByText("Delivery Time")).not.toBeInTheDocument();
  });

  it("sends digest fields in PUT request on save", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockSettings, digest_enabled: true }),
      headers: new Headers(),
    } as Response);

    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSettings),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());

    // Verify fetch was called with digest fields
    const saveCall = vi.mocked(fetch).mock.calls.find(
      (call) => (call[1] as RequestInit)?.method === "PUT",
    );
    expect(saveCall).toBeTruthy();
    const body = JSON.parse((saveCall![1] as RequestInit).body as string);
    expect(body).toHaveProperty("digest_enabled");
    expect(body).toHaveProperty("digest_time");
    expect(body).toHaveProperty("digest_timezone");
  });
});

// ============================================================================
// Message styling
// ============================================================================

describe("Settings: message styling", () => {
  it("success message has green styling", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSettings),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const msg = screen.getByText("Settings saved.");
      expect(msg.closest(".bg-green-50")).toBeInTheDocument();
    });
  });

  it("error message has red styling", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() => expect(screen.getByText("Settings")).toBeInTheDocument());

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const msg = screen.getByText("Failed to save settings.");
      expect(msg.closest(".bg-red-50")).toBeInTheDocument();
    });
  });
});
