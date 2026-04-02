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
    expect(screen.getByText("AI that lives in your Todoist")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Connect Todoist/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders use case list items", () => {
    renderLanding();
    const useCaseList = screen.getByRole("list", { name: "Use cases" });
    const items = useCaseList.querySelectorAll("li");
    expect(items.length).toBe(4);
  });

  it("renders GitHub links", () => {
    renderLanding();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Report a Bug")).toBeInTheDocument();
    expect(screen.getByText("Request a Feature")).toBeInTheDocument();
  });
});

// ============================================================================
// Sections
// ============================================================================

describe("Landing: sections", () => {
  it("renders hero section with main heading", () => {
    renderLanding();
    expect(screen.getByText("AI that lives in your Todoist")).toBeInTheDocument();
    expect(
      screen.getByText(/Stop context-switching/),
    ).toBeInTheDocument();
  });

  it("renders demo section", () => {
    renderLanding();
    expect(screen.getByText("See it in action")).toBeInTheDocument();
    expect(screen.getByAltText(/Demo showing/)).toBeInTheDocument();
  });

  it("renders use cases section with heading", () => {
    renderLanding();
    expect(
      screen.getByText("What Can You Do With It?"),
    ).toBeInTheDocument();
  });

  it("renders power features section", () => {
    renderLanding();
    expect(screen.getByText("For Power Users")).toBeInTheDocument();
  });

  it("renders how it works section", () => {
    renderLanding();
    expect(screen.getByText("How It Works")).toBeInTheDocument();
    expect(screen.getByText("Connect Your Todoist")).toBeInTheDocument();
  });

  it("renders FAQ section with expandable items", () => {
    renderLanding();
    expect(
      screen.getByText("Frequently Asked Questions"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Is Todoist AI Agent free?"),
    ).toBeInTheDocument();
  });

  it("renders CTA section", () => {
    renderLanding();
    expect(
      screen.getByText("Ready to Add AI to Your Todoist?"),
    ).toBeInTheDocument();
  });

  it("renders social proof badge when stats load", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ users: 55 }),
    });
    renderLanding();
    await vi.waitFor(() =>
      expect(screen.getByText(/50\+ Todoist users connected/)).toBeInTheDocument(),
    );
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
    const buttons = screen.getAllByText(/Connect Todoist/);
    await user.click(buttons[0]);
    expect(sessionStorage.getItem("oauth_pending")).toBe("true");
  });

  it("shows Redirecting... and disables button after click", async () => {
    const user = userEvent.setup();
    renderLanding();
    const buttons = screen.getAllByText(/Connect Todoist/);
    await user.click(buttons[0]);
    const redirecting = screen.getAllByText("Redirecting...");
    expect(redirecting.length).toBeGreaterThanOrEqual(1);
    expect(redirecting[0].closest("button")).toBeDisabled();
  });

  it("button has aria-busy while connecting", async () => {
    const user = userEvent.setup();
    renderLanding();
    const buttons = screen.getAllByText(/Connect Todoist/);
    await user.click(buttons[0]);
    const redirecting = screen.getAllByText("Redirecting...");
    expect(redirecting[0].closest("button")).toHaveAttribute("aria-busy", "true");
  });

  it("both hero and CTA buttons reflect connecting state", async () => {
    const user = userEvent.setup();
    renderLanding();
    const buttons = screen.getAllByText(/Connect Todoist/);
    expect(buttons.length).toBe(2);
    await user.click(buttons[0]);
    const redirecting = screen.getAllByText("Redirecting...");
    expect(redirecting.length).toBe(2);
    redirecting.forEach((el) => {
      expect(el.closest("button")).toBeDisabled();
    });
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

  it("use cases list has aria-label", () => {
    renderLanding();
    expect(
      screen.getByRole("list", { name: "Use cases" }),
    ).toBeInTheDocument();
  });

  it("emoji icons are hidden from screen readers", () => {
    renderLanding();
    const emojis = screen.getAllByText(/🎯|🔍|💡|📎|🧠|🔑|⚡/);
    emojis.forEach((el) => {
      expect(el).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("FAQ items are accessible with details/summary", () => {
    renderLanding();
    const details = document.querySelectorAll("details");
    expect(details.length).toBe(6);
  });
});
