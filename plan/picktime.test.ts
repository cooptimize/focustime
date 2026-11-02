import { describe, expect, it } from "vitest";
import type { AgendaTimebox } from "./agenda.ts";
import { dragTimes, pickTime, timeChoices } from "./picktime.ts";
import type { Slot } from "../week/types.ts";

const T = (hm: string) => `2026-11-02T${hm}:00-05:00`;
const hm = (iso: string) => iso.slice(11, 16);
// AM 8:00–12:00, a meeting 9:00–9:30: free 8:00–9:00 and 9:30–12:00.
const am: Slot = {
  date: "2026-11-02", half: "AM", start: T("08:00"), end: T("12:00"), view: { start: T("08:00"), end: T("12:00") },
  windows: [{ start: T("08:00"), end: T("12:00") }], off: false, flex: [], focus: [], open: false, events: [], risks: [],
  longestFreeMinutes: 150, freeGaps: [{ start: T("08:00"), end: T("09:00"), minutes: 60 }, { start: T("09:30"), end: T("12:00"), minutes: 150 }], busyMeetingMinutes: 30, pto: false,
};
const tb = (id: number, a: string, b: string, extra: Partial<AgendaTimebox & { outlook: boolean }> = {}) => ({ id, date: "2026-11-02", start: T(a), end: T(b), title: `tb${id}`, clientKey: "w", pickId: null, removedAt: null, outlook: false, ...extra });
const SIZES = { S: 30, M: 90, L: 180 } as const;

describe("pickTime: the three row states (D259)", () => {
  it("untimed, timed, and timed with Put on Outlook on", () => {
    expect(pickTime(7, [])).toEqual({ state: "untimed", timebox: null });
    expect(pickTime(7, [tb(1, "08:00", "09:00", { pickId: 7 })]).state).toBe("timed");
    expect(pickTime(7, [tb(1, "08:00", "09:00", { pickId: 7, outlook: true })]).state).toBe("outlook");
  });
  it("a removed timebox doesn't count", () => {
    expect(pickTime(7, [tb(1, "08:00", "09:00", { pickId: 7, removedAt: "x" })]).state).toBe("untimed");
  });
});

describe("timeChoices: + time and the editor's gap list", () => {
  it("an untimed pick gets the block's free gaps, placed at its size", () => {
    const c = timeChoices(am, [], { id: 7, size: "S" }, SIZES);
    expect(c.map((x) => [x.kind, hm(x.start), hm(x.end)])).toEqual([["gap", "08:00", "08:30"], ["gap", "09:30", "10:00"]]);
  });
  it("an already-timed pick: Keep current first, and its own timebox doesn't use up the block", () => {
    // Its own timebox fills 9:30–12:00 and another fills 8:00–9:00: without the fix there is "no free time".
    const own = tb(1, "09:30", "12:00", { pickId: 7 });
    const c = timeChoices(am, [own, tb(2, "08:00", "09:00")], { id: 7, size: "M" }, SIZES);
    expect(c).toEqual([expect.objectContaining({ kind: "keep", start: own.start, end: own.end })]);
  });
  it("a timed pick with room after it is offered right after its current end, not its own spot again", () => {
    const c = timeChoices(am, [tb(1, "09:30", "10:30", { pickId: 7 })], { id: 7, size: "S" }, SIZES);
    expect(c.map((x) => [x.kind, hm(x.start), hm(x.end)])).toEqual([["keep", "09:30", "10:30"], ["gap", "08:00", "09:00"], ["gap", "10:30", "11:30"]]);
  });
  it("a timed pick keeps its length when moved to another gap", () => {
    const c = timeChoices(am, [tb(1, "08:00", "08:45", { pickId: 7 })], { id: 7, size: "L" }, SIZES);
    const g = c.find((x) => x.kind === "gap" && hm(x.start) === "09:30")!;
    expect(hm(g.end)).toBe("10:15");
  });
  it("from now on today", () => {
    const c = timeChoices(am, [], { id: 7, size: "S" }, SIZES, T("10:05"));
    expect(c.map((x) => hm(x.start))).toEqual(["10:05"]);
  });
});

describe("dragTimes: move and resize by either edge (15 minute steps)", () => {
  it("move shifts both ends", () => {
    expect(dragTimes("move", T("09:00"), T("10:00"), 32)).toEqual({ start: T("09:30"), end: T("10:30") });
  });
  it("the top edge moves the start; the bottom edge the end", () => {
    expect(dragTimes("start", T("09:00"), T("10:00"), -14)).toEqual({ start: T("08:45"), end: T("10:00") });
    expect(dragTimes("end", T("09:00"), T("10:00"), 50)).toEqual({ start: T("09:00"), end: T("10:45") });
  });
  it("keeps at least 15 minutes", () => {
    expect(dragTimes("start", T("09:00"), T("10:00"), 90)).toEqual({ start: T("09:45"), end: T("10:00") });
    expect(dragTimes("end", T("09:00"), T("10:00"), -90)).toEqual({ start: T("09:00"), end: T("09:15") });
  });
  it("no change under half a step", () => {
    expect(dragTimes("move", T("09:00"), T("10:00"), 7)).toBeNull();
  });
});
