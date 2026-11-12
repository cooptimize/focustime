import { describe, expect, it } from "vitest";
import { dayPanelOpens, WIDE } from "./daypanel.ts";

describe("Day's panel on first open (PS-1)", () => {
  it("opens on a wide window when nothing was left on this device", () => {
    expect(dayPanelOpens(null, WIDE)).toBe(true);
    expect(dayPanelOpens(null, 1920)).toBe(true);
    expect(dayPanelOpens(null, WIDE - 1)).toBe(false);
  });
  it("once closed it stays closed, at any width; once opened it opens", () => {
    expect(dayPanelOpens("closed", 1920)).toBe(false);
    expect(dayPanelOpens("open", 900)).toBe(true);
  });
});
