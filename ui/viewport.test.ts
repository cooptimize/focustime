import { describe, expect, it } from "vitest";
import { chooseLayout, MIN_WIDTH, narrowCompact, SIZES } from "./viewport.ts";

describe("chooseLayout", () => {
  it("keeps the timeline layout on the 3840 ultrawide", () => {
    expect(chooseLayout(3840)).toBe("wide");
  });

  it("uses compact cards for 1920 and 1366 windows", () => {
    expect(chooseLayout(1920)).toBe("medium");
    expect(chooseLayout(1896)).toBe("medium");
    expect(chooseLayout(1366)).toBe("medium");
  });

  it("shows one day at a time when compact cards no longer fit", () => {
    expect(chooseLayout(MIN_WIDTH.medium - 1)).toBe("narrow");
    expect(chooseLayout(700)).toBe("narrow");
    expect(chooseLayout(0)).toBe("narrow");
  });

  it("switches exactly where a column stops fitting its content", () => {
    expect(chooseLayout(MIN_WIDTH.wide)).toBe("wide");
    expect(chooseLayout(MIN_WIDTH.wide - 1)).toBe("medium");
    expect(chooseLayout(MIN_WIDTH.medium)).toBe("medium");
    const column = (w: number) => (w - SIZES.chromePx) / SIZES.shares;
    expect(column(MIN_WIDTH.wide)).toBeGreaterThanOrEqual(SIZES.railPx + SIZES.minTimelinePx);
    // Medium: Friday keeps its minimum, Mon–Thu share the rest.
    expect((MIN_WIDTH.medium - SIZES.chromePx - SIZES.minFridayCardPx) / 4).toBeGreaterThanOrEqual(SIZES.minCardPx);
  });

  it("stacks the single day as a card once rail and timeline no longer fit side by side", () => {
    expect(narrowCompact(900)).toBe(false);
    expect(narrowCompact(MIN_WIDTH.dayTimeline)).toBe(false);
    expect(narrowCompact(MIN_WIDTH.dayTimeline - 1)).toBe(true);
    expect(narrowCompact(480)).toBe(true);
  });
});
