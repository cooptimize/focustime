import { describe, expect, it } from "vitest";
import { dayShare, FOLD_PX, tierFor, TIER_MIN, weekFit } from "./weekfit.ts";

// A week with Mon–Thu working and Friday catch-up, and one with Thursday PTO.
const PLAIN = [1, 1, 1, 1, 0.6];
const PTO_THU = [1, 1, 1, 0.6, 0.6];
const LARGER = 1.3077;

/** Content width of the medium grid at a window width: 2 × 16 px padding, and the panel (its width + 12 px) when open. */
const content = (w: number, panel: number | null = null) => w - 32 - (panel === null ? 0 : panel + 12);
/** The panel's width: clamp(360px, 30vw, 440px) below 1440, 440 from 1440 (560 from 3000). */
const panelW = (w: number) => (w >= 1440 ? 440 : Math.min(440, Math.max(360, 0.3 * w)));
const fit = (w: number, panel: boolean, shares = PLAIN, scale = 1, selected = 0) => weekFit({ contentPx: content(w, panel ? panelW(w) : null), gapPx: 12, scale, shares, selected });

describe("tierFor", () => {
  it("steps down at each threshold", () => {
    expect(tierFor(TIER_MIN.rail)).toBe("rail");
    expect(tierFor(TIER_MIN.rail - 1)).toBe("ruler");
    expect(tierFor(TIER_MIN.ruler)).toBe("ruler");
    expect(tierFor(TIER_MIN.ruler - 1)).toBe("strip");
    expect(tierFor(TIER_MIN.strip)).toBe("strip");
    expect(tierFor(TIER_MIN.strip - 1)).toBe("mini");
    expect(tierFor(TIER_MIN.mini)).toBe("mini");
    expect(tierFor(TIER_MIN.mini - 1)).toBe("fold");
  });
  it("scales the thresholds with the text size", () => {
    expect(tierFor(400, LARGER)).toBe("ruler");
    expect(tierFor(320 * LARGER, LARGER)).toBe("rail");
  });
});

describe("weekFit", () => {
  it("keeps all five days open down to 1024 without the panel, at both text sizes", () => {
    for (const w of [1920, 1600, 1440, 1366, 1280, 1024])
      for (const s of [1, LARGER]) {
        const f = fit(w, false, PLAIN, s);
        expect(f.open.every(Boolean)).toBe(true);
      }
  });
  it("gives each width its tier", () => {
    expect(fit(1920, false).tier).toBe("rail");
    // 1440 with no panel keeps the rail with titles (a 324 px column).
    expect(fit(1440, false, PTO_THU).tier).toBe("rail");
    expect(fit(1366, false).tier).toBe("ruler");
    expect(fit(1024, false).tier).toBe("strip");
    expect(fit(1366, true).tier).toBe("strip");
    expect(fit(1280, true, PLAIN, LARGER).tier).toBe("mini");
    expect(fit(1366, false, PTO_THU).tier).toBe("ruler");
  });
  it("folds when even mini doesn't fit (1024 with the panel), keeping the selected day and its neighbours open", () => {
    const f = fit(1024, true, PLAIN, 1, 2);
    expect(f.open).toEqual([false, true, true, true, false]);
    expect(f.tier).toBe("mini");
    expect(f.tracks).toBe(`${FOLD_PX}px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) ${FOLD_PX}px`);
  });
  it("keeps the window inside the week at its ends", () => {
    expect(fit(1024, true, PLAIN, 1, 0).open).toEqual([true, true, true, false, false]);
    expect(fit(1024, true, PLAIN, 1, 4).open).toEqual([false, false, true, true, true]);
  });
  it("opens fewer days only when three would still be under mini (1024, panel, Larger)", () => {
    const f = fit(1024, true, PLAIN, LARGER, 1);
    expect(f.open.filter(Boolean).length).toBeLessThan(3);
    expect(f.open[1]).toBe(true);
    expect(f.col / LARGER).toBeGreaterThanOrEqual(TIER_MIN.mini);
  });
  it("gives the rail what the column leaves after the text, 140 to 186 px", () => {
    expect(fit(1920, false).railPx).toBe(186);
    expect(fit(1440, false, PTO_THU).railPx).toBe(140);
  });
  it("never makes Friday wider than a working day", () => {
    for (const w of [1920, 1366, 1024]) {
      const f = fit(w, true);
      expect(f.tracks.split(" ").length).toBeGreaterThan(0);
      expect(PLAIN[4]! * f.col).toBeLessThanOrEqual(f.col);
    }
  });
});

describe("weekFit per column (WK-2)", () => {
  const order = ["rail", "ruler", "strip", "mini"];
  it("gives Friday the tier of its own width, not the working days'", () => {
    // 1896 with no panel: Mon–Thu about 400 px (rail), Friday about 240 (strip), Dev's cramped case.
    const f = fit(1896, false);
    expect(f.tier).toBe("rail");
    expect(f.days.slice(0, 4).every((d) => d.tier === "rail")).toBe(true);
    expect(f.days[4]!.tier).toBe(tierFor(f.col * 0.6) as string);
    expect(f.days[4]!.tier).not.toBe("rail");
  });
  it("gives a PTO day and Friday their own tier, never wider than a working day's", () => {
    for (const w of [2560, 1920, 1600, 1440, 1366, 1280, 1024])
      for (const panel of [false, true])
        for (const s of [1, LARGER]) {
          const f = fit(w, panel, PTO_THU, s);
          f.days.forEach((d, i) => {
            if (!f.open[i]) return;
            const own = tierFor(f.col * Math.min(1, PTO_THU[i]!), s);
            expect(d.tier).toBe(own === "fold" ? "mini" : own);
            expect(order.indexOf(d.tier)).toBeGreaterThanOrEqual(order.indexOf(f.tier));
          });
        }
  });
  it("sizes each column's rail from its own width, 140 to 186 px", () => {
    const f = fit(2560, false);
    expect(f.days[0]!.railPx).toBe(186);
    expect(f.days[4]!.railPx).toBeGreaterThanOrEqual(140);
    expect(f.days[4]!.railPx).toBeLessThanOrEqual(186);
    expect(f.days[4]!.railPx).toBeLessThanOrEqual(f.days[0]!.railPx);
  });
  it("keeps the open days' tiers when the week folds", () => {
    const f = fit(1024, true, PLAIN, 1, 4);
    expect(f.open).toEqual([false, false, true, true, true]);
    expect(f.days[2]!.tier).toBe(f.tier);
    expect(order.indexOf(f.days[4]!.tier)).toBeGreaterThanOrEqual(order.indexOf(f.tier));
  });
});

describe("dayShare", () => {
  it("gives PTO and Friday the light share and the planned day the wide one", () => {
    expect(dayShare({ kind: "work" }, false)).toBe(1);
    expect(dayShare({ kind: "work", pto: { titles: [] } }, false)).toBe(0.6);
    expect(dayShare({ kind: "overflow" }, false)).toBe(0.6);
    expect(dayShare({ kind: "work" }, true)).toBe(2.6);
  });
});
