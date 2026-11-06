// Step 15.1 (D276): the compact time ruler on medium cards: when it shows, and where bands sit.
import { describe, expect, it } from "vitest";
import { railFor, rulerSpan } from "./layout.ts";

const slot = (extra: Partial<{ off: boolean; start: string; end: string }> = {}) => ({ off: false, start: "2026-11-02T12:30:00-05:00", end: "2026-11-02T17:00:00-05:00", ...extra });

describe("railFor (WK-1: the card draws exactly its tier's element)", () => {
  it("maps each tier to the rail, the slim ruler or the day strip", () => {
    expect(railFor("rail", slot())).toBe("rail");
    expect(railFor("ruler", slot())).toBe("slim");
    expect(railFor("strip", slot())).toBe("strip");
    expect(railFor("mini", slot())).toBe("strip");
  });
  it("draws nothing on blocks with no working hours, on the phone, or outside the medium layout", () => {
    expect(railFor("rail", slot({ off: true }))).toBe(null);
    expect(railFor("rail", slot(), true)).toBe(null);
    expect(railFor(null, slot())).toBe(null);
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
