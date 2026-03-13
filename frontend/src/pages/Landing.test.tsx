import { render, screen } from "@testing-library/react";
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

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null } });
});

describe("Landing", () => {
  it("renders heading and connect button", () => {
    renderLanding();
    expect(screen.getByText("Todoist AI Agent")).toBeInTheDocument();
    expect(screen.getByText("Connect Todoist")).toBeInTheDocument();
  });

  it("has main landmark with aria-labelledby", () => {
    renderLanding();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "landing-heading");
  });

  it("feature list has aria-label", () => {
    renderLanding();
    expect(screen.getByRole("list", { name: "Features" })).toBeInTheDocument();
  });

  it("emoji icons are hidden from screen readers", () => {
    renderLanding();
    const emojis = screen.getAllByText(/💬|🔍|🔑/);
    emojis.forEach((el) => {
      expect(el).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("redirects to /settings if session exists", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "tok" } },
    });
    renderLanding();
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/settings"),
    );
  });
});
