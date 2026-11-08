import { describe, expect, it } from "vitest";
import { agendaOf, openGaps, placeInGap, planMyDay, type AgendaTimebox } from "./agenda.ts";
import type { CalEvent, PlacedEvent, Slot } from "../week/types.ts";
import type { Pick } from "./types.ts";

const T = (hm: string, date = "2026-11-02") => `${date}T${hm}:00-06:00`;
const ev = (id: string, a: string, b: string, extra: Partial<CalEvent> = {}): PlacedEvent => ({
  event: { id, source: "outlook", title: id, start: T(a), end: T(b), allDay: false, isPersonal: false, showAs: "busy", ...extra },
  clipStart: T(a),
  clipEnd: T(b),
  minutesInside: 0,
} as PlacedEvent);
const gap = (a: string, b: string) => ({ start: T(a), end: T(b), minutes: (Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3))) });

function slot(half: "AM" | "PM", events: PlacedEvent[], freeGaps: ReturnType<typeof gap>[], windows: [string, string][]): Slot {
  return {
    date: "2026-11-02", half, start: T(windows[0]![0]), end: T(windows.at(-1)![1]), view: { start: T(windows[0]![0]), end: T(windows.at(-1)![1]) },
    windows: windows.map(([a, b]) => ({ start: T(a), end: T(b) })), off: false, flex: [], focus: [], open: false, events, risks: [],
    longestFreeMinutes: Math.max(0, ...freeGaps.map((g) => g.minutes)), freeGaps, busyMeetingMinutes: 0, pto: false,
  };
}
const tb = (id: number, a: string, b: string, extra: Partial<AgendaTimebox> = {}): AgendaTimebox => ({ id, date: "2026-11-02", start: T(a), end: T(b), title: `tb${id}`, clientKey: "w", pickId: null, removedAt: null, ...extra });

// AM 8:00–12:00 with a 9:00–9:30 meeting and a personal 10:30–11:00 errand.
const am = slot("AM", [ev("Standup", "09:00", "09:30"), ev("Dentist", "10:30", "11:00", { isPersonal: true, source: "google" })], [gap("08:00", "09:00"), gap("09:30", "10:30"), gap("11:00", "12:00")], [["08:00", "12:00"]]);

describe("openGaps", () => {
  it("is the slot's free time minus timeboxes", () => {
    const g = openGaps(am, [tb(1, "09:30", "10:00")]);
    expect(g.map((x) => [x.start.slice(11, 16), x.end.slice(11, 16), x.minutes])).toEqual([
      ["08:00", "09:00", 60],
      ["10:00", "10:30", 30],
      ["11:00", "12:00", 60],
    ]);
  });
  it("ignores removed timeboxes and other days", () => {
    expect(openGaps(am, [tb(1, "08:00", "09:00", { removedAt: "x" }), tb(2, "08:00", "09:00", { date: "2026-11-03", start: T("08:00", "2026-11-03"), end: T("09:00", "2026-11-03") })])).toHaveLength(3);
  });
  it("starts at now on today and drops gaps under 15 minutes", () => {
    const g = openGaps(am, [tb(1, "11:00", "11:50")], T("09:40"));
    expect(g.map((x) => [x.start.slice(11, 16), x.minutes])).toEqual([["09:40", 50]]);
  });
  it("a timebox splitting a gap leaves both sides", () => {
    const g = openGaps(am, [tb(1, "08:15", "08:30")]);
    expect(g.slice(0, 2).map((x) => [x.start.slice(11, 16), x.end.slice(11, 16)])).toEqual([["08:00", "08:15"], ["08:30", "09:00"]]);
  });
});

describe("agendaOf", () => {
  it("lists meetings, personal events, timeboxes and free gaps in time order", () => {
    const a = agendaOf(am, [tb(1, "11:00", "11:45")]);
    expect(a.map((x) => [x.kind, x.start.slice(11, 16), x.title])).toEqual([
      ["free", "08:00", "Free"],
      ["meeting", "09:00", "Standup"],
      ["free", "09:30", "Free"],
      ["personal", "10:30", "Dentist"],
      ["timebox", "11:00", "tb1"],
      ["free", "11:45", "Free"],
    ]);
    expect(a[0]!.minutes).toBe(60);
  });
  it("lists only events inside the block's working time (not the evening or the view range around it)", () => {
    const s = slot("AM", [ev("Early", "07:00", "08:00"), ev("Standup", "09:00", "09:30"), ev("Late", "12:00", "13:00")], [gap("08:00", "09:00"), gap("09:30", "12:00")], [["08:00", "12:00"]]);
    expect(agendaOf(s, []).filter((x) => x.kind !== "free").map((x) => x.title)).toEqual(["Standup"]);
  });
  it("marks events shown as free, which leave the gap free", () => {
    const s = slot("AM", [ev("FYI", "08:00", "08:30", { showAs: "free" })], [gap("08:00", "12:00")], [["08:00", "12:00"]]);
    const a = agendaOf(s, []);
    expect(a.map((x) => [x.kind, x.free ?? false])).toEqual([["meeting", true], ["free", false]]);
  });
});

describe("placeInGap", () => {
  it("starts at the gap start for the size", () => {
    expect(placeInGap(gap("09:30", "11:00"), 60)).toEqual({ start: T("09:30"), end: T("10:30"), minutes: 60, trimmed: false });
  });
  it("trims to the gap end", () => {
    expect(placeInGap(gap("09:30", "10:15"), 120)).toEqual({ start: T("09:30"), end: T("10:15"), minutes: 45, trimmed: true });
  });
  it("rounds the start up to 5 minutes", () => {
    const g = { start: T("09:32"), end: T("10:30"), minutes: 58 };
    expect(placeInGap(g, 30)).toEqual({ start: T("09:35"), end: T("10:05"), minutes: 30, trimmed: false });
  });
  it("is null under 15 minutes", () => {
    expect(placeInGap(gap("09:30", "09:40"), 30)).toBeNull();
  });
});

describe("planMyDay", () => {
  const pick = (id: number, half: "AM" | "PM", size: "S" | "M" | "L", position = id): Pick => ({ id, date: "2026-11-02", half, clientKey: "w", kind: "item", itemId: id, draftId: null, title: `p${id}`, itemType: null, itemUrl: null, size, status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, followUpId: null, position, createdAt: "", updatedAt: "" });
  const sizes = { S: 30, M: 60, L: 120, unsized: 60 };
  const pm = slot("PM", [], [gap("13:00", "14:00"), gap("15:00", "17:00")], [["13:00", "17:00"]]);

  it("places musts first, then larger sizes, then pick order", () => {
    const r = planMyDay([pick(1, "PM", "S"), pick(2, "PM", "L"), pick(3, "PM", "M"), pick(4, "PM", "S")], { PM: pm }, [], sizes, new Set([4]));
    expect(r.placed.map((p) => [p.pickId, p.start.slice(11, 16), p.end.slice(11, 16)])).toEqual([
      [4, "13:00", "13:30"],
      [2, "15:00", "17:00"],
      [1, "13:30", "14:00"],
    ]);
    // M (60) doesn't fit whole after 4 and 2, and the 30 minutes left are under its shortest useful time (D273).
    expect(r.unplaced.map((u) => u.pickId)).toEqual([3]);
    expect(r.unplaced[0]!.reason).toBe("No gap of 1h or more left in the afternoon");
  });
  it("keeps each pick in its own block and skips timeboxed, done and dropped picks", () => {
    const done = { ...pick(5, "AM", "S"), status: "done" as const };
    const r = planMyDay([pick(1, "AM", "M"), pick(2, "PM", "M"), pick(3, "AM", "S"), done], { AM: am, PM: pm }, [tb(9, "08:00", "08:30", { pickId: 3 })], sizes, new Set());
    expect(r.placed.map((p) => [p.pickId, p.half, p.start.slice(11, 16)])).toEqual([
      [1, "AM", "09:30"],
      [2, "PM", "13:00"],
    ]);
    // 8:30–9:00 was only 30 minutes after the existing timebox, so the M pick went to the first gap that fits whole.
    expect(r.unplaced).toEqual([]);
  });
  it("starts at now on today", () => {
    const r = planMyDay([pick(1, "AM", "S")], { AM: am }, [], sizes, new Set(), T("11:10"));
    expect(r.placed[0]!.start).toBe(T("11:10"));
  });
});
