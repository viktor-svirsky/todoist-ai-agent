import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import NotFound from "./NotFound";

function renderNotFound() {
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
}

describe("NotFound", () => {
  it("renders 404 heading", () => {
    renderNotFound();
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("shows descriptive message", () => {
    renderNotFound();
    expect(
      screen.getByText("The page you're looking for doesn't exist."),
    ).toBeInTheDocument();
  });

  it("has a link to home", () => {
    renderNotFound();
    const link = screen.getByRole("link", { name: "Go Home" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("has main landmark with aria-labelledby", () => {
    renderNotFound();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "not-found-heading");
  });
});
