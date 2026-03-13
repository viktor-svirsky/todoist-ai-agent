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
  it("shows loading skeleton initially", () => {
    mockGetSession.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();
    expect(screen.getByLabelText("Loading settings")).toBeInTheDocument();
  });

  it("skeleton has aria-busy attribute", () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));
    renderSettings();
    expect(screen.getByLabelText("Loading settings")).toHaveAttribute(
      "aria-busy",
      "true",
    );
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
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("@ai")).toBeInTheDocument();
    expect(screen.getByText("Save Settings")).toBeInTheDocument();
    expect(
      screen.getByText("Disconnect & Delete Account"),
    ).toBeInTheDocument();
  });

  it("renders Sign Out button", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.getByDisplayValue("@bot")).toBeInTheDocument(),
    );
    expect(
      screen.getByDisplayValue("https://api.openai.com/v1"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Be concise")).toBeInTheDocument();
  });

  it("shows (key set) placeholder when custom AI key exists", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ...mockSettings, has_custom_ai_key: true }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
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
      expect(
        screen.getByText("Failed to load settings."),
      ).toBeInTheDocument(),
    );
  });

  it("error message has role=alert for screen readers", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
      headers: new Headers(),
    } as Response);

    renderSettings();
    await waitFor(() => {
      const errorEl = screen.getByText("Failed to load settings.");
      expect(errorEl).toHaveAttribute("role", "alert");
    });
  });

  it("shows network error on fetch exception", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network failure"));

    renderSettings();
    await waitFor(() =>
      expect(
        screen.getByText(
          "Network error. Please check your connection and refresh.",
        ),
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
        screen.getByText(
          "Too many requests. Please try again in 30 seconds.",
        ),
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
        screen.getByText(
          "Your account has been disabled. Please contact support.",
        ),
      ).toBeInTheDocument(),
    );
  });
});

// ============================================================================
// Sign Out
// ============================================================================

describe("Settings: sign out", () => {
  it("calls signOut and navigates to / on Sign Out click", async () => {
    const user = userEvent.setup();
    mockSignOut.mockResolvedValue(undefined);
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Sign Out"));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });
});

// ============================================================================
// Delete account modal
// ============================================================================

describe("Settings: delete account modal", () => {
  it("opens confirmation modal on disconnect click", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Disconnect & Delete Account"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/permanently delete your account/),
    ).toBeInTheDocument();
  });

  it("closes modal on Cancel", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Disconnect & Delete Account"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes modal on Escape key", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Disconnect & Delete Account"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("modal has correct ARIA attributes", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Disconnect & Delete Account"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "confirm-modal-title");
  });

  it("proceeds with deletion on confirm", async () => {
    const user = userEvent.setup();
    mockSignOut.mockResolvedValue(undefined);
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Disconnect & Delete Account"));
    // Click the confirm button in the modal (not the trigger button)
    const confirmBtn = screen.getByRole("button", { name: "Delete Account" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });
});

// ============================================================================
// Password visibility toggle
// ============================================================================

describe("Settings: password visibility toggle", () => {
  it("toggles AI API key visibility", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    const aiKeyInput = screen.getByLabelText("AI provider API key");
    expect(aiKeyInput).toHaveAttribute("type", "password");

    // Get the toggle button closest to the AI key input
    const toggleBtns = screen.getAllByLabelText("Show password");
    await user.click(toggleBtns[0]);
    expect(aiKeyInput).toHaveAttribute("type", "text");

    const hideBtns = screen.getAllByLabelText("Hide password");
    await user.click(hideBtns[0]);
    expect(aiKeyInput).toHaveAttribute("type", "password");
  });
});

// ============================================================================
// Save
// ============================================================================

describe("Settings: save", () => {
  it("shows success message on save", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

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
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: "Rate limit exceeded" }),
      headers: new Headers({ "Retry-After": "45" }),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Too many requests. Please try again in 45 seconds.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("shows disabled message on 403 during save", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

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
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() =>
      expect(
        screen.getByText("Failed to save settings."),
      ).toBeInTheDocument(),
    );
  });

  it("shows Saving... while request is in flight", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    // Make save hang
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByText("Save Settings"));
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("save button has aria-busy while saving", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByText("Save Settings"));
    expect(screen.getByText("Saving...").closest("button")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

// ============================================================================
// Form interactions
// ============================================================================

describe("Settings: form interactions", () => {
  it("updates trigger word on input", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    const input = screen.getByDisplayValue("@ai");
    await user.clear(input);
    await user.type(input, "@bot");
    expect(input).toHaveValue("@bot");
  });

  it("shows character count for custom prompt", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    expect(screen.getByText("0/2000")).toBeInTheDocument();
  });

  it("updates character count on custom prompt input", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText(/I live in Berlin/);
    await user.type(textarea, "Hello");
    expect(screen.getByText("5/2000")).toBeInTheDocument();
  });
});

// ============================================================================
// Accessibility
// ============================================================================

describe("Settings: accessibility", () => {
  it("has main landmark with aria-labelledby", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "settings-heading");
  });

  it("form inputs have associated labels via htmlFor", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Trigger word")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom Instructions")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });

  it("trigger word input has aria-describedby", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    const input = screen.getByLabelText("Trigger word");
    expect(input).toHaveAttribute("aria-describedby", "trigger-word-desc");
  });

  it("status message has aria-live=polite", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockSettings),
      headers: new Headers(),
    } as Response);

    await user.click(screen.getByText("Save Settings"));
    await waitFor(() => {
      const msg = screen.getByText("Settings saved.");
      expect(msg.closest("[aria-live]")).toHaveAttribute(
        "aria-live",
        "polite",
      );
    });
  });

  it("fieldsets have screen-reader-only legends", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );
    expect(screen.getByText("AI Provider Settings")).toBeInTheDocument();
    expect(screen.getByText("Web Search Settings")).toBeInTheDocument();
  });
});

// ============================================================================
// Message styling
// ============================================================================

describe("Settings: message styling", () => {
  it("success message has green styling", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

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
    await waitFor(() =>
      expect(screen.getByText("Settings")).toBeInTheDocument(),
    );

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
