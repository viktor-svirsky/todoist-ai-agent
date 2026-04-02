import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Welcome from "./Welcome";

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

function renderWelcome() {
  return render(
    <MemoryRouter>
      <Welcome />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "tok" } },
  });
});

async function waitForReady() {
  await vi.waitFor(() =>
    expect(screen.getByText("You're Connected!")).toBeInTheDocument(),
  );
}

// ============================================================================
// Rendering
// ============================================================================

describe("Welcome: rendering", () => {
  it("renders 'You're Connected!' heading", async () => {
    renderWelcome();
    await waitForReady();
  });

  it("renders 'Try your first @ai command' section", async () => {
    renderWelcome();
    await waitForReady();
    expect(screen.getByText("Try your first @ai command")).toBeInTheDocument();
  });

  it("renders copyable example commands", async () => {
    renderWelcome();
    await waitForReady();
    expect(screen.getByText("@ai break this task into smaller steps")).toBeInTheDocument();
    expect(screen.getByText("@ai what should I do first?")).toBeInTheDocument();
    expect(screen.getByText("@ai help me plan this project")).toBeInTheDocument();
  });

  it("renders 'Open Todoist and Try It Now' link", async () => {
    renderWelcome();
    await waitForReady();
    expect(screen.getByText(/Open Todoist and Try It Now/)).toBeInTheDocument();
  });

  it("renders 'Go to Settings' button in customize section", async () => {
    renderWelcome();
    await waitForReady();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("renders footer links", async () => {
    renderWelcome();
    await waitForReady();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Report a Bug")).toBeInTheDocument();
    expect(screen.getByText("Request a Feature")).toBeInTheDocument();
  });
});

// ============================================================================
// Auth guard
// ============================================================================

describe("Welcome: auth guard", () => {
  it("redirects to / when no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    renderWelcome();
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/"),
    );
  });

  it("does not redirect when session exists", async () => {
    renderWelcome();
    await waitForReady();
    expect(mockNavigate).not.toHaveBeenCalledWith("/");
  });

  it("renders nothing while checking session", () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));
    const { container } = renderWelcome();
    expect(container.innerHTML).toBe("");
  });
});

// ============================================================================
// Navigation
// ============================================================================

describe("Welcome: navigation", () => {
  it("navigates to /settings on 'Go to Settings' click", async () => {
    const user = userEvent.setup();
    renderWelcome();
    await waitForReady();
    await user.click(screen.getByText("Go to Settings"));
    expect(mockNavigate).toHaveBeenCalledWith("/settings");
  });
});

// ============================================================================
// Accessibility
// ============================================================================

describe("Welcome: accessibility", () => {
  it("has main landmark with aria-labelledby", async () => {
    renderWelcome();
    await waitForReady();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "welcome-heading");
  });

  it("checkmark icon is aria-hidden", async () => {
    renderWelcome();
    await waitForReady();
    const checkmark = document.querySelector(".bg-green-100");
    expect(checkmark).toHaveAttribute("aria-hidden", "true");
  });
});
