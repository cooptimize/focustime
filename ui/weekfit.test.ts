// WK-1, WK-2, WK-5: how Week's Board fits its width. WK-5 replaced WK-1's fold window around the selection (its tests
// "keeps the selected day and its neighbours open", "keeps the window inside the week", "opens fewer days only when
// three would still be under mini" and "keeps the open days' tiers when the week folds" went with it) by a wider day
// in focus and a fixed fold order, folding before any shown day is under its narrowest readable width.
import { describe, expect, it } from "vitest";
import { dayShare, FOCUS_SHARE, FOLD_PX, MIN_PX, minKind, tierFor, TIER_MIN, weekFit, type FitDay } from "./weekfit.ts";
import { foldOrder } from "../plan/weekdays.ts";

const LARGER = 1.3077;
const DATES = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KINDS = ["work", "work", "work", "work", "overflow", "weekend", "weekend"] as const;
const days = (n = 5) => KINDS.slice(0, n).map((kind, i) => ({ kind, date: DATES[i]!, weekday: NAMES[i]! }));

/** Content width of the grid at a window width: 2 × 16 px padding, and the panel (its width + 12 px) when open. */
const content = (w: number, panel: boolean) => w - 32 - (panel ? (w >= 1440 ? 440 : Math.min(440, Math.max(360, 0.3 * w))) + 12 : 0);
/** Week on Thursday (focus = today) unless told otherwise. */
const fit = (w: number, panel: boolean, o: { n?: number; scale?: number; focus?: number; today?: string } = {}) => {
  const ds = days(o.n ?? 5);
  const focus = o.focus ?? 3;
  const order = foldOrder(ds, ds.map(() => true), focus, o.today ?? DATES[3]!);
  return { f: weekFit({ contentPx: content(w, panel), gapPx: 12, scale: o.scale ?? 1, days: ds, focus, order }), ds: ds as readonly FitDay[] };
};

describe("tierFor", () => {
  it("steps down at each threshold", () => {
    expect(tierFor(TIER_MIN.rail)).toBe("rail");
    expect(tierFor(TIER_MIN.rail - 1)).toBe("ruler");
    expect(tierFor(TIER_MIN.ruler - 1)).toBe("strip");
    expect(tierFor(TIER_MIN.strip - 1)).toBe("mini");
    expect(tierFor(TIER_MIN.mini - 1)).toBe("fold");
  });
  it("scales the thresholds with the text size", () => {
    expect(tierFor(400, LARGER)).toBe("ruler");
    expect(tierFor(320 * LARGER, LARGER)).toBe("rail");
  });
});

describe("weekFit (WK-5)", () => {
  it("makes the focus day the widest column, about twice a working day when there's room", () => {
    for (const w of [1920, 1440, 1280])
      for (const panel of [false, true])
        for (const scale of [1, LARGER]) {
          const { f } = fit(w, panel, { scale, n: 7 });
          const others = f.widths.filter((_, i) => i !== 3 && f.open[i]);
          expect(Math.max(...others)).toBeLessThan(f.widths[3]!);
        }
    const { f } = fit(1920, false);
    expect(f.widths[3]! / f.widths[0]!).toBeCloseTo(FOCUS_SHARE, 1);
  });
  it("never leaves an open day under its narrowest readable width, and never folds the focus day", () => {
    for (const w of [1920, 1600, 1440, 1366, 1280, 1024])
      for (const panel of [false, true])
        for (const scale of [1, 1.1538, LARGER])
          for (const focus of [0, 2, 3, 4]) {
            const { f, ds } = fit(w, panel, { scale, n: 7, focus });
            expect(f.open[focus]).toBe(true);
            ds.forEach((d, i) => {
              if (f.open[i] && i !== focus) expect(f.widths[i]!).toBeGreaterThanOrEqual(MIN_PX[minKind(d)] * scale - 1);
              if (!f.open[i]) expect(f.widths[i]!).toBe(FOLD_PX * scale);
            });
            // Only the focus day can be squeezed, and only when everything else has folded.
            const used = f.widths.reduce((a, b) => a + b, 0) + 12 * 6;
            if (f.open.filter(Boolean).length > 1 || f.widths[focus]! > MIN_PX[minKind(ds[focus]!)] * scale + 1) expect(used).toBeLessThanOrEqual(content(w, panel) + 1);
          }
  });
  it("folds weekend days first, then the catch-up day, then past days farthest from the focus day", () => {
    const { f } = fit(1280, true, { n: 7 });
    expect(f.open.slice(4)).toEqual([false, false, false]);
    expect(f.open[3]).toBe(true);
    // Monday folds before Tuesday, Tuesday before Wednesday.
    if (!f.open[2]) expect(f.open[1]).toBe(false);
    if (!f.open[1]) expect(f.open[0]).toBe(false);
    expect(f.open[0]).toBe(false);
  });
  it("keeps every day open at 1920 with no panel, the weekend too", () => {
    expect(fit(1920, false, { n: 7 }).f.open.every(Boolean)).toBe(true);
    expect(fit(1920, false).f.open.every(Boolean)).toBe(true);
  });
  it("with no focus day, working days share the width as before", () => {
    const ds = days(5);
    const f = weekFit({ contentPx: content(1920, false), gapPx: 12, days: ds, focus: -1, order: foldOrder(ds, ds.map(() => true), -1, "2026-12-01") });
    expect(f.widths[0]).toBeCloseTo(f.widths[3]!, 5);
    expect(f.widths[4]! / f.widths[0]!).toBeCloseTo(0.6, 1);
  });
  it("gives each open column the tier of its own width", () => {
    const { f } = fit(1920, false);
    f.days.forEach((d, i) => {
      const own = tierFor(f.widths[i]!);
      expect(d.tier).toBe(own === "fold" ? "mini" : own);
    });
    expect(f.tier).toBe(f.days[3]!.tier);
  });
  it("writes the tracks as the columns' widths, folded days as strips", () => {
    const { f } = fit(1280, true, { n: 7 });
    const t = f.tracks.match(/minmax\(0, [\d.]+fr\)|\d+px/g) ?? [];
    expect(t).toHaveLength(7);
    expect(t[6]).toBe(`${FOLD_PX}px`);
    expect(t[3]).toMatch(/^minmax\(0, [\d.]+fr\)$/);
  });
});

describe("dayShare", () => {
  it("gives PTO and Friday the light share, the weekend the narrow one and the focus day twice a working day", () => {
    expect(dayShare({ kind: "work" }, false)).toBe(1);
    expect(dayShare({ kind: "work", pto: { titles: [] } }, false)).toBe(0.6);
    expect(dayShare({ kind: "overflow" }, false)).toBe(0.6);
    expect(dayShare({ kind: "weekend" }, false)).toBe(0.4);
    expect(dayShare({ kind: "overflow" }, true)).toBe(FOCUS_SHARE);
  });
});
