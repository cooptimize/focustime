// BD-1: Break down's label follows the parent's type from the process model; the review's running total counts kept
// proposals in hours (unsized as the assumption, 1h by default); moving a card for drag and keyboard reorder.
import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import { describe, expect, it } from "vitest";
import { breakdownLabel, moveCard, reviewTotal } from "./breakdown.ts";

describe("Break down", () => {
  it("labels the button with the parent's type", () => {
    expect(breakdownLabel("Feature")).toBe("Break down Feature");
    expect(breakdownLabel("Recurring")).toBe("Break down Recurring");
    expect(breakdownLabel(null)).toBe("Break down item");
  });

  it("totals the kept proposals in hours, unsized as 1h, dropped ones out", () => {
    expect(reviewTotal([{ keep: true, size: "S" }, { keep: true, size: "L" }, { keep: true, size: null }, { keep: false, size: "L" }, { keep: true, size: "M" }], DEFAULT_SIZE_SCALE)).toBe("4 items · about 8h");
    expect(reviewTotal([{ keep: true, size: "S" }], DEFAULT_SIZE_SCALE)).toBe("1 item · about 1h");
    expect(reviewTotal([{ keep: false, size: "S" }], DEFAULT_SIZE_SCALE)).toBe("Nothing kept");
  });

  it("moves a card up, down, or to a dropped-on place, clamped", () => {
    expect(moveCard(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveCard(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveCard(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveCard(["a", "b", "c"], 2, 9)).toEqual(["a", "b", "c"]);
  });
});
