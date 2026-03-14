import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Landing from "./Landing";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockGetSession = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
    },
  },
}));

function renderLanding(searchParams = "") {
  // Set window.location.search before rendering
  Object.defineProperty(window, "location", {
    value: { ...window.location, search: searchParams, href: "" },
    writable: true,
  });
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null } });
  sessionStorage.clear();
});

// ============================================================================
// Rendering
// ============================================================================

describe("Landing: rendering", () => {
  it("renders heading and connect button", () => {
    renderLanding();
    expect(screen.getByText("Todoist AI Agent")).toBeInTheDocument();
    expect(screen.getByText("Connect Todoist")).toBeInTheDocument();
  });

  it("renders feature list items", () => {
    renderLanding();
    expect(screen.getByText(/Comment/)).toBeInTheDocument();
    expect(screen.getByText(/Web search/)).toBeInTheDocument();
    expect(screen.getByText(/Bring your own AI key/)).toBeInTheDocument();
  });

  it("renders GitHub links", () => {
    renderLanding();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Report a Bug")).toBeInTheDocument();
    expect(screen.getByText("Request a Feature")).toBeInTheDocument();
  });
});

// ============================================================================
// Session redirect
// ============================================================================

describe("Landing: session redirect", () => {
  it("redirects to /settings if session exists", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "tok" } },
    });
    renderLanding();
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/settings"),
    );
  });

  it("does not redirect when no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    renderLanding();
    // Wait for the getSession promise to resolve
    await vi.waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Connect button (OAuth initiation)
// ============================================================================

describe("Landing: connect button", () => {
  it("sets oauth_pending in sessionStorage and redirects on click", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByText("Connect Todoist"));

    expect(sessionStorage.getItem("oauth_pending")).toBe("true");
  });

  it("shows Redirecting... and disables button after click", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByText("Connect Todoist"));

    expect(screen.getByText("Redirecting...")).toBeInTheDocument();
    expect(screen.getByText("Redirecting...").closest("button")).toBeDisabled();
  });

  it("button has aria-busy while connecting", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByText("Connect Todoist"));

    expect(
      screen.getByText("Redirecting...").closest("button"),
    ).toHaveAttribute("aria-busy", "true");
  });
});

// ============================================================================
// Error display
// ============================================================================

describe("Landing: error display", () => {
  it("shows error message when ?error param is present", () => {
    renderLanding("?error=auth_failed");
    expect(
      screen.getByText("Authentication failed. Please try again."),
    ).toBeInTheDocument();
  });

  it("error message has role=alert", () => {
    renderLanding("?error=auth_failed");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not show error when no ?error param", () => {
    renderLanding();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ============================================================================
// Accessibility
// ============================================================================

describe("Landing: accessibility", () => {
  it("has main landmark with aria-labelledby", () => {
    renderLanding();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "landing-heading");
  });

  it("feature list has aria-label", () => {
    renderLanding();
    expect(
      screen.getByRole("list", { name: "Features" }),
    ).toBeInTheDocument();
  });

  it("emoji icons are hidden from screen readers", () => {
    renderLanding();
    const emojis = screen.getAllByText(/💬|🔍|🔑/);
    emojis.forEach((el) => {
      expect(el).toHaveAttribute("aria-hidden", "true");
    });
  });
});
