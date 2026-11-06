// Step 15.1: shortest useful time per size in Timebox my day (D273), the didn't-fit summary and the offer (D274),
// and duplicate picks (D277).
import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_SIZES, didntFitText, placeInGap, planMyDay, smallerSize } from "./agenda.ts";
import { alreadyPlanned } from "./dup.ts";
import { offerAfterTimebox } from "./agenda.ts";
import type { Slot } from "../week/types.ts";
import type { Pick } from "./types.ts";
import { DEFAULT_PLAN, parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";

const T = (hm: string) => `2026-11-02T${hm}:00-05:00`;
const mins = (a: string, b: string) => (Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3)));
const gap = (a: string, b: string) => ({ start: T(a), end: T(b), minutes: mins(a, b) });
function slot(half: "AM" | "PM", gaps: [string, string][]): Slot {
  const [s, e] = half === "AM" ? ["09:00", "12:30"] : ["12:30", "17:00"];
  return { date: "2026-11-02", half, start: T(s), end: T(e), view: { start: T(s), end: T(e) }, windows: [{ start: T(s), end: T(e) }], focus: [], events: [], risks: [], freeGaps: gaps.map(([a, b]) => gap(a, b)), freeMinutes: 0, longestFreeMinutes: 0, open: false, off: false, flex: [], unavailable: [] } as unknown as Slot;
}
const pick = (id: number, half: "AM" | "PM", size: "S" | "M" | "L", extra: Partial<Pick> = {}): Pick => ({ id, date: "2026-11-02", half, clientKey: "Fabrikam", kind: "item", itemId: 7000 + id, draftId: null, title: `Pick ${id}`, itemType: "User Story", itemUrl: null, size, status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, followUpId: null, position: id, createdAt: "", updatedAt: "", ...extra });
const SIZES = { S: 60, M: 120, L: 210 };

describe("shortest useful time (D273)", () => {
  it("defaults to 30, 60 and 90 minutes", () => {
    expect(DEFAULT_MIN_SIZES).toEqual({ S: 30, M: 60, L: 90 });
    expect(DEFAULT_PLAN.minSizes).toEqual({ S: 30, M: 60, L: 90 });
  });
  it("placeInGap refuses a gap shorter than the minimum and trims down to it, not below", () => {
    expect(placeInGap(gap("11:45", "12:00"), 120, 60)).toBeNull();
    expect(placeInGap(gap("11:00", "12:00"), 120, 60)).toEqual({ start: T("11:00"), end: T("12:00"), minutes: 60, trimmed: true });
    expect(placeInGap(gap("11:00", "11:55"), 120, 60)).toBeNull();
  });
  it("never puts an M pick into a 15 minute gap (the real Monday case)", () => {
    const am = slot("AM", [["11:45", "12:00"]]);
    const r = planMyDay([pick(1, "AM", "M")], { AM: am }, [], SIZES, new Set(), undefined, DEFAULT_MIN_SIZES);
    expect(r.placed).toEqual([]);
    expect(r.unplaced).toEqual([{ pickId: 1, half: "AM", title: "Pick 1", size: "M", reason: "No gap of 1h or more left in the morning" }]);
  });
  it("E2: an unsized pick is placed as 2h, never left out for having no size", () => {
    const am = slot("AM", [["09:00", "12:00"]]);
    const r = planMyDay([pick(1, "AM", "M", { size: null })], { AM: am }, [], SIZES, new Set(), undefined, DEFAULT_MIN_SIZES);
    expect(r.placed.map((p) => [p.pickId, p.start.slice(11, 16), p.end.slice(11, 16)])).toEqual([[1, "09:00", "11:00"]]);
    expect(r.unplaced).toEqual([]);
  });
  it("prefers a gap that holds the pick whole, then the largest gap of at least the minimum", () => {
    const pm = slot("PM", [["13:00", "13:20"], ["14:00", "15:15"], ["15:30", "17:00"]]);
    const r = planMyDay([pick(1, "PM", "L"), pick(2, "PM", "M"), pick(3, "PM", "S")], { PM: pm }, [], SIZES, new Set(), undefined, DEFAULT_MIN_SIZES);
    // L (210) fits nowhere whole: the largest gap of 90m or more (15:30–17:00) trimmed to 90.
    // M (120) fits nowhere whole: 14:00–15:15 (75m, at least 60) trimmed. S (60): only 13:00–13:20 is left, under 30.
    expect(r.placed.map((p) => [p.pickId, p.start.slice(11, 16), p.end.slice(11, 16), p.trimmed])).toEqual([
      [1, "15:30", "17:00", true],
      [2, "14:00", "15:15", true],
    ]);
    expect(r.unplaced.map((u) => [u.pickId, u.reason])).toEqual([[3, "No gap of 30m or more left in the afternoon"]]);
  });
  it("reads min_s, min_m and min_l from config, each at most its size", () => {
    const base = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"');
    const plan = (lines: string) => `${base}\n[plan]\n${lines}\n`;
    const ok = parseConfig(plan("min_s = 20\nmin_m = 45\nmin_l = 120"));
    expect(ok.ok && ok.config.plan.minSizes).toEqual({ S: 20, M: 45, L: 120 });
    // E2: sizes are fixed (S 1h); a size_s set before is read and ignored, never an error.
    const bad = parseConfig(plan("size_s = 30\nmin_s = 75\nmin_m = 7"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toContainEqual({ field: "plan.min_s", message: "Must be at most size S (60)" });
      expect(bad.errors.some((e) => e.field === "plan.size_s")).toBe(false);
      expect(bad.errors).toContainEqual({ field: "plan.min_m", message: "Must be 15 to 480 in steps of 5" });
    }
  });
});

describe("didn't fit, said plainly (D274)", () => {
  it("names each pick with its size", () => {
    expect(didntFitText([])).toBe("");
    expect(didntFitText([{ title: "Export spec draft", size: "M" }])).toBe("1 to-do didn't fit: Export spec draft (M).");
    expect(didntFitText([{ title: "Export spec draft", size: "M" }, { title: "Delay alerts", size: "S" }])).toBe("2 to-dos didn't fit: Export spec draft (M), Delay alerts (S).");
  });
  it("makes a pick one size smaller, and S has nothing smaller", () => {
    expect(smallerSize("L")).toBe("M");
    expect(smallerSize("M")).toBe("S");
    expect(smallerSize("S")).toBeNull();
  });
  it("clears the 'no time yet' offer once the summary is shown, and says so when everything fit", () => {
    expect(offerAfterTimebox({ placed: 3, unplaced: [] })).toEqual({ offer: false, summary: null, notice: "Timeboxed 3 to-dos" });
    expect(offerAfterTimebox({ placed: 1, unplaced: [{ pickId: 2, title: "Delay alerts", size: "S" }] })).toEqual({
      offer: false,
      summary: { text: "1 to-do didn't fit: Delay alerts (S).", picks: [{ pickId: 2, title: "Delay alerts", size: "S" }] },
      notice: "Timeboxed 1 to-do",
    });
    expect(offerAfterTimebox({ placed: 0, unplaced: [{ pickId: 2, title: "Delay alerts", size: "S" }] }).notice).toBeNull();
  });
});

describe("duplicate picks (D277)", () => {
  const picks = [pick(6, "PM", "M", { itemId: 501 }), pick(7, "PM", "S", { itemId: 503, status: "dropped" }), pick(8, "AM", "M", { itemId: 381, status: "done" })];
  it("finds the same item planned or done in a block", () => {
    expect(alreadyPlanned(picks, { clientKey: "Fabrikam", itemId: 501 }, "2026-11-02", "PM")?.id).toBe(6);
    expect(alreadyPlanned(picks, { clientKey: "Fabrikam", itemId: 381 }, "2026-11-02", "AM")?.id).toBe(8);
  });
  it("ignores dropped and moved picks, other blocks, other clients and the pick being moved", () => {
    expect(alreadyPlanned(picks, { clientKey: "Fabrikam", itemId: 503 }, "2026-11-02", "PM")).toBeNull();
    expect(alreadyPlanned(picks, { clientKey: "Fabrikam", itemId: 501 }, "2026-11-02", "AM")).toBeNull();
    expect(alreadyPlanned(picks, { clientKey: "Contoso", itemId: 501 }, "2026-11-02", "PM")).toBeNull();
    expect(alreadyPlanned(picks, { clientKey: "Fabrikam", itemId: 501 }, "2026-11-02", "PM", 6)).toBeNull();
  });
  it("matches drafts and follow-ups by their own ids", () => {
    const more = [pick(20, "AM", "S", { kind: "draft", itemId: null, draftId: 4 }), pick(21, "AM", "S", { kind: "intention", itemId: null, followUpId: 9 })];
    expect(alreadyPlanned(more, { clientKey: "Fabrikam", draftId: 4 }, "2026-11-02", "AM")?.id).toBe(20);
    expect(alreadyPlanned(more, { clientKey: "Fabrikam", followUpId: 9 }, "2026-11-02", "AM")?.id).toBe(21);
    expect(alreadyPlanned(more, { clientKey: "Fabrikam", followUpId: 10 }, "2026-11-02", "AM")).toBeNull();
  });
});
