// Step 15.1 (D276): the compact time ruler on medium cards: when it shows, and where bands sit.
import { describe, expect, it } from "vitest";
import { rulerSpan, showRuler } from "./layout.ts";

const slot = (extra: Partial<{ off: boolean; start: string; end: string }> = {}) => ({ off: false, start: "2026-11-02T12:30:00-05:00", end: "2026-11-02T17:00:00-05:00", ...extra });

describe("showRuler", () => {
  it("shows on medium cards when switched on and the block has working hours", () => {
    expect(showRuler("medium", true, slot())).toBe(true);
  });
  it("hides when switched off, on blocks with no working hours, and never at wide or narrow widths", () => {
    expect(showRuler("medium", false, slot())).toBe(false);
    expect(showRuler("medium", true, slot({ off: true }))).toBe(false);
    expect(showRuler("wide", true, slot())).toBe(false);
    expect(showRuler("narrow", true, slot())).toBe(false);
  });
});

describe("rulerSpan: a band's place in the block's working hours", () => {
  const s = slot();
  it("places a band by its start and end within the block", () => {
    // 1:00–2:00 PM in a 12:30–5:00 PM block (270 minutes).
    expect(rulerSpan(s, "2026-11-02T13:00:00-05:00", "2026-11-02T14:00:00-05:00")).toEqual({ top: 30 / 270, height: 60 / 270 });
  });
  it("clips an event that starts before or ends after the block, and drops one outside it", () => {
    expect(rulerSpan(s, "2026-11-02T12:00:00-05:00", "2026-11-02T13:00:00-05:00")).toEqual({ top: 0, height: 30 / 270 });
    expect(rulerSpan(s, "2026-11-02T16:30:00-05:00", "2026-11-02T18:00:00-05:00")).toEqual({ top: 240 / 270, height: 30 / 270 });
    expect(rulerSpan(s, "2026-11-02T08:00:00-05:00", "2026-11-02T09:00:00-05:00")).toBeNull();
  });
});
