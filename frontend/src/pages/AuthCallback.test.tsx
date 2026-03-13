import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AuthCallback from "./AuthCallback";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockSetSession = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  },
}));

function renderCallback(hash = "") {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hash },
    writable: true,
  });
  return render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Loading state
// ============================================================================

describe("AuthCallback: loading state", () => {
  it("shows 'Completing setup...' text", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockReturnValue(new Promise(() => {}));
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    expect(screen.getByText("Completing setup...")).toBeInTheDocument();
  });

  it("has aria-busy on main element", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockReturnValue(new Promise(() => {}));
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("has status role with aria-live for screen readers", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockReturnValue(new Promise(() => {}));
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });
});

// ============================================================================
// CSRF state verification
// ============================================================================

describe("AuthCallback: CSRF state verification", () => {
  it("redirects to /?error=state_mismatch when oauth_pending is missing", () => {
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    expect(mockNavigate).toHaveBeenCalledWith("/?error=state_mismatch");
  });

  it("removes oauth_pending from sessionStorage after reading", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockResolvedValue({ error: null });
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    expect(sessionStorage.getItem("oauth_pending")).toBeNull();
  });
});

// ============================================================================
// Missing tokens
// ============================================================================

describe("AuthCallback: missing tokens", () => {
  it("redirects to /?error=missing_session when access_token is missing", () => {
    sessionStorage.setItem("oauth_pending", "true");
    renderCallback("#refresh_token=test-refresh");
    expect(mockNavigate).toHaveBeenCalledWith("/?error=missing_session");
  });

  it("redirects to /?error=missing_session when refresh_token is missing", () => {
    sessionStorage.setItem("oauth_pending", "true");
    renderCallback("#access_token=test-access");
    expect(mockNavigate).toHaveBeenCalledWith("/?error=missing_session");
  });

  it("redirects to /?error=missing_session when hash is empty", () => {
    sessionStorage.setItem("oauth_pending", "true");
    renderCallback("");
    expect(mockNavigate).toHaveBeenCalledWith("/?error=missing_session");
  });
});

// ============================================================================
// Successful auth
// ============================================================================

describe("AuthCallback: successful auth", () => {
  it("calls setSession with tokens from URL hash", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockResolvedValue({ error: null });
    renderCallback(
      "#access_token=my-access-tok&refresh_token=my-refresh-tok",
    );
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: "my-access-tok",
      refresh_token: "my-refresh-tok",
    });
  });

  it("navigates to /settings on successful session", async () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockResolvedValue({ error: null });
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/settings"),
    );
  });
});

// ============================================================================
// Session errors
// ============================================================================

describe("AuthCallback: session errors", () => {
  it("navigates to /?error=session_failed when setSession returns error", async () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockResolvedValue({
      error: new Error("Invalid token"),
    });
    renderCallback(
      "#access_token=bad-token&refresh_token=bad-refresh",
    );
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/?error=session_failed"),
    );
  });
});

// ============================================================================
// Timeout
// ============================================================================

describe("AuthCallback: timeout", () => {
  it("navigates to /?error=timeout after 10 seconds", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockReturnValue(new Promise(() => {})); // never resolves
    renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );

    vi.advanceTimersByTime(10_000);
    expect(mockNavigate).toHaveBeenCalledWith("/?error=timeout");
  });

  it("clears timeout on component unmount", () => {
    sessionStorage.setItem("oauth_pending", "true");
    mockSetSession.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderCallback(
      "#access_token=test-access&refresh_token=test-refresh",
    );

    unmount();
    vi.advanceTimersByTime(10_000);
    // Timeout should have been cleared on unmount
    expect(mockNavigate).not.toHaveBeenCalledWith("/?error=timeout");
  });
});
