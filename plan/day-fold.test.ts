import { describe, expect, it } from "vitest";
import { arrivalScroll, foldCounts, foldWords, foldsByItself, isFolded, readHandFolds, writeHandFolds, type FoldFacts } from "./day-fold.ts";
import { parseConfig } from "../config/schema.ts";
import { setValue } from "../config/edit.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";

const base: FoldFacts = { isToday: true, ordinary: true, option: true, ended: true, working: false, panelOpen: false, dragOver: false, inside: false, hand: undefined };
const f = (o: Partial<FoldFacts>) => isFolded({ ...base, ...o });

describe("DY-1: what folds by itself", () => {
  it("a block of today that has ended folds, in the ordinary view, with the option on", () => {
    expect(f({})).toBe(true);
    expect(f({ ended: false })).toBe(false);
    expect(f({ option: false })).toBe(false);
  });
  it("never: another day, the flows or Timebox my day, a focus session in it, its panel open, the person in it", () => {
    expect(f({ isToday: false })).toBe(false);
    expect(f({ ordinary: false })).toBe(false);
    expect(f({ working: true })).toBe(false);
    expect(f({ panelOpen: true })).toBe(false);
    expect(f({ inside: true })).toBe(false);
  });
  it("by hand wins either way, on today in the ordinary view; a drag over it opens it", () => {
    expect(f({ hand: false })).toBe(false);
    expect(f({ ended: false, hand: true })).toBe(true);
    expect(f({ working: true, hand: true })).toBe(true);
    expect(f({ hand: true, dragOver: true })).toBe(false);
    expect(f({ hand: true, isToday: false })).toBe(false);
    expect(f({ hand: true, ordinary: false })).toBe(false);
  });
  it("foldsByItself ignores the hand and the drag", () => {
    expect(foldsByItself({ ...base })).toBe(true);
    expect(foldsByItself({ ...base, working: true })).toBe(false);
  });
});

describe("DY-1: the folded line", () => {
  const ev = (showAs?: string, extra: Record<string, unknown> = {}) => ({ event: { showAs, ...extra } });
  it("counts done and not done in the block, and its meetings (not free, all-day or unavailable time)", () => {
    const picks = [{ half: "AM", status: "done" }, { half: "AM", status: "planned" }, { half: "AM", status: "dropped" }, { half: "PM", status: "planned" }];
    expect(foldCounts(picks, "AM", [ev("busy"), ev("free"), ev(undefined, { allDay: true }), ev("busy", { unavailable: {} }), ev("tentative")])).toEqual({ done: 1, notDone: 1, meetings: 2 });
  });
  it("in words", () => {
    expect(foldWords({ done: 2, notDone: 1, meetings: 1 })).toEqual({ done: "2 done", notDone: "1 not done", meetings: "1 meeting" });
    expect(foldWords({ done: 0, notDone: 0, meetings: 3 })).toEqual({ done: "Nothing planned", notDone: null, meetings: "3 meetings" });
    expect(foldWords({ done: 0, notDone: 2, meetings: 0 })).toEqual({ done: null, notDone: "2 not done", meetings: null });
  });
});

describe("DY-1: folds by hand are kept for today only", () => {
  it("reads back today's, forgets another day's, and refuses junk", () => {
    const raw = writeHandFolds("2026-11-02", { AM: false, PM: true });
    expect(readHandFolds(raw, "2026-11-02")).toEqual({ AM: false, PM: true });
    expect(readHandFolds(raw, "2026-11-03")).toEqual({});
    expect(readHandFolds(null, "2026-11-02")).toEqual({});
    expect(readHandFolds("{not json", "2026-11-02")).toEqual({});
    expect(readHandFolds(JSON.stringify({ date: "2026-11-02", folds: { AM: "yes", XX: true, PM: true } }), "2026-11-02")).toEqual({ PM: true });
  });
});

describe("DY-1: arrival", () => {
  const m = { top: 120, bottom: 720, firstRows: 160, blockHead: 46 };
  it("doesn't scroll when the block and the now line are already on screen", () => {
    expect(arrivalScroll({ ...m, target: 300, now: 500 })).toBe(0);
    expect(arrivalScroll({ ...m, target: 300, now: null })).toBe(0);
  });
  it("scrolls as little as it takes to bring a block below the screen into view", () => {
    expect(arrivalScroll({ ...m, target: 800, now: null })).toBe(800 + 160 - 720);
  });
  it("in a long block, brings the now line into view under the block's header", () => {
    const d = arrivalScroll({ ...m, target: 746, now: 1113 });
    expect(1113 - d).toBeGreaterThanOrEqual(m.top + m.blockHead);
    expect(1113 - d).toBeLessThanOrEqual(m.bottom - 24);
  });
});

describe("DY-1: the option", () => {
  const STARTER = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');
  it("is on to start and read from [ui] fold_ended", () => {
    const on = parseConfig(STARTER);
    expect(on.ok && on.config.ui.foldEnded).toBe(true);
    const off = parseConfig(setValue(STARTER, "ui", "fold_ended", false, "test"));
    expect(off.ok && off.config.ui.foldEnded).toBe(false);
    expect(parseConfig(setValue(STARTER, "ui", "fold_ended", "no", "test")).ok).toBe(false);
  });
});
