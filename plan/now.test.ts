import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import type { TimeModel } from "../week/hours.ts";
import { meeting, NY, pattern } from "../week/test-helpers.ts";
import type { Day, FlexSession, WeekConfig } from "../week/types.ts";
import { nowStrip, type NowInput } from "./now.ts";
import type { Pick } from "./types.ts";

const WEEK = "2026-11-02"; // Mon
const span = (start: string, end: string) => ({ start, end });
const model: TimeModel = {
  timeZone: NY,
  lunch: span("12:00", "12:30"),
  weekdays: { mon: [span("09:00", "17:00")], tue: [span("09:00", "17:00")], wed: [span("09:00", "17:00")], thu: [span("09:00", "17:00")], fri: [], sat: [], sun: [] },
  overrides: [{ date: "2026-11-03", segments: [span("09:00", "16:00"), span("20:00", "22:00")] }],
};
const config: WeekConfig = { hours: model, thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 }, standingBlocks: [] };
const flex: FlexSession = { id: 1, clientKey: "adatum", start: "2026-11-06T10:00:00-05:00", end: "2026-11-06T12:00:00-05:00", itemId: 7, itemTitle: "Fix export", itemUrl: null, note: null };

const week = buildWeek({
  weekStart: WEEK,
  patterns: [pattern({ clientKey: "adatum", clientName: "Adatum", days: { Mon: "AM", Tue: "AM" } })],
  events: [meeting("2026-11-02T10:00", "2026-11-02T10:30", { title: "Standup" }), meeting("2026-11-02T14:00", "2026-11-02T15:00", { title: "Review", showAs: "free" })],
  config,
  flex: [flex],
});
const day = (date: string): Day => week.days.find((d) => d.date === date)!;

let id = 0;
const pick = (half: Pick["half"], title: string, over: Partial<Pick> = {}): Pick => ({
  id: ++id, date: "2026-11-02", half, clientKey: "adatum", kind: "intention", itemId: null, draftId: null, title, itemType: null, itemUrl: null,
  size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: id, createdAt: "", updatedAt: "", ...over,
});

const at = (local: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(NY);
const input = (local: string, over: Partial<NowInput> = {}): NowInput => {
  const now = at(local);
  return { now, day: day(now.toPlainDate().toString()), picks: [], committed: false, pto: false, nextWorkday: null, clientName: (k) => k.toUpperCase(), ...over };
};

describe("Now strip", () => {
  it("names the current block, the next event and time left", () => {
    const s = nowStrip(input("2026-11-02T09:40"));
    expect(s).toMatchObject({ kind: "slot", half: "AM", title: "Adatum focus", until: "12:00" });
    expect(s.event).toEqual({ title: "Standup", at: "10:00", minutes: 20, now: false });
  });

  it("shows the event under way, and skips free and declined events", () => {
    expect(nowStrip(input("2026-11-02T10:10")).event).toEqual({ title: "Standup", at: "10:30", minutes: 20, now: true });
    // The 14:00 review is shown as free: no event ahead after the standup.
    expect(nowStrip(input("2026-11-02T13:00")).event).toBeNull();
  });

  it("counts picks done for the day, the current block's over-by, and the next pick", () => {
    const picks = [pick("AM", "Done one", { status: "done" }), pick("AM", "Big one", { size: "L" }), pick("AM", "Another", { size: "M" }), pick("PM", "Later"), pick("PM", "Dropped", { status: "dropped" })];
    const s = nowStrip(input("2026-11-02T10:40", { picks, committed: true }));
    expect(s.picks).toEqual({ done: 1, total: 4 });
    // Free from 10:40 to 12:00 is 80 min; 210 + 120 planned.
    expect(s.overBy).toBe(250);
    expect(s.nextPick).toBe("Big one");
    // With the morning's picks done, the next pick comes from later in the day.
    const later = nowStrip(input("2026-11-02T11:00", { picks: picks.map((p) => (p.half === "AM" ? { ...p, status: "done" as const } : p)), committed: true }));
    expect(later.nextPick).toBe("Later");
    expect(later.overBy).toBeNull();
  });

  it("before commit the picks are drafts (Q38, step 6c)", () => {
    const s = nowStrip(input("2026-11-02T09:40", { picks: [pick("AM", "Draft")] }));
    expect(s).toMatchObject({ picks: { done: 0, total: 1 }, draft: true, nextPick: "Draft", overBy: null });
    expect(nowStrip(input("2026-11-02T09:40", { picks: [pick("AM", "Draft")], committed: true })).draft).toBe(false);
  });

  it("handles before work, lunch and the end of the day", () => {
    expect(nowStrip(input("2026-11-02T08:30"))).toMatchObject({ kind: "before", half: "AM", until: "09:00", untilMinutes: 30, title: "Work starts" });
    expect(nowStrip(input("2026-11-02T12:10"))).toMatchObject({ kind: "lunch", half: "PM", until: "12:30" });
    expect(nowStrip(input("2026-11-02T13:00"))).toMatchObject({ kind: "slot", half: "PM", title: "Open", until: "17:00" });
    expect(nowStrip(input("2026-11-02T17:30"))).toMatchObject({ kind: "after", half: "PM", title: "Done for today" });
  });

  it("covers an evening slot on a split day, and the gap before it", () => {
    expect(nowStrip(input("2026-11-03T18:00"))).toMatchObject({ kind: "before", half: "EVE", until: "20:00", title: "Evening starts" });
    expect(nowStrip(input("2026-11-03T20:30"))).toMatchObject({ kind: "slot", half: "EVE", title: "Evening", until: "22:00" });
  });

  it("names a flex session and its item", () => {
    const s = nowStrip(input("2026-11-06T10:15"));
    expect(s).toMatchObject({ kind: "slot", title: "Flex session: ADATUM", until: "12:00", nextPick: "Fix export", flex: true });
    expect(["AM", "EVE"]).toContain(s.half);
  });

  it("says when there is no work today and when work is next", () => {
    expect(nowStrip(input("2026-11-05T10:00", { day: { ...day("2026-11-05"), am: { ...day("2026-11-05").am, off: true, windows: [] }, pm: { ...day("2026-11-05").pm, off: true, windows: [] } }, nextWorkday: "2026-11-09" }))).toMatchObject({ kind: "off", half: null, title: "No work today", next: "2026-11-09" });
    expect(nowStrip(input("2026-11-02T10:00", { pto: true, nextWorkday: "2026-11-03" }))).toMatchObject({ kind: "pto", half: null, title: "PTO today", event: null, picks: null, next: "2026-11-03" });
  });

  it("when today is on another week, says so", () => {
    expect(nowStrip(input("2026-11-02T10:00", { day: null }))).toMatchObject({ kind: "away", half: null });
    // A quiet Saturday isn't a column on any week: still "no work today".
    expect(nowStrip(input("2026-11-07T10:00", { day: null, noHoursToday: true, nextWorkday: "2026-11-09" }))).toMatchObject({ kind: "off", next: "2026-11-09" });
  });
});
