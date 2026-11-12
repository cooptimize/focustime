import { describe, expect, it } from "vitest";
import { blockLineShows, dayLineShows } from "./suggestlines.ts";

describe("Keep all · Clear lines (PS-1)", () => {
  it("a block with one suggestion has no line; two or more keep one", () => {
    expect(blockLineShows(0)).toBe(false);
    expect(blockLineShows(1)).toBe(false);
    expect(blockLineShows(2)).toBe(true);
    expect(blockLineShows(4)).toBe(true);
  });
  it("the day's line shows only when two or more blocks have suggestions", () => {
    expect(dayLineShows([])).toBe(false);
    expect(dayLineShows([{ half: "AM" }])).toBe(false);
    expect(dayLineShows([{ half: "AM" }, { half: "AM" }, { half: "AM" }])).toBe(false);
    expect(dayLineShows([{ half: "AM" }, { half: "PM" }])).toBe(true);
  });
});
