import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UsageBarChart } from "./UsageBarChart";

function makeData(counts: number[]) {
  const base = new Date("2026-04-14T00:00:00Z").getTime();
  return counts.map((c, i) => ({
    day_start: new Date(base + i * 86400000).toISOString(),
    counted: c,
  }));
}

describe("UsageBarChart", () => {
  it("renders seven rects with tallest matching max value", () => {
    const data = makeData([3, 1, 4, 1, 5, 9, 2]);
    const { container } = render(<UsageBarChart data={data} />);
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(7);
    const heights = Array.from(rects).map((r) =>
      parseFloat(r.getAttribute("height") ?? "0"),
    );
    const maxIdx = heights.indexOf(Math.max(...heights));
    expect(maxIdx).toBe(5);
  });

  it("all-zero dataset renders seven rects with min-height >= 2", () => {
    const data = makeData([0, 0, 0, 0, 0, 0, 0]);
    const { container } = render(<UsageBarChart data={data} />);
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(7);
    for (const r of rects) {
      const h = parseFloat(r.getAttribute("height") ?? "0");
      expect(h).toBeGreaterThanOrEqual(2);
    }
  });

  it("has role=img and aria-label for accessibility", () => {
    const { container } = render(<UsageBarChart data={makeData([1, 2, 3])} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("7-day usage");
  });
});
