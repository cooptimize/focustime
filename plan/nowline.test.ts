import { describe, expect, it } from "vitest";
import { aPto, aWeek, aWeekConfig } from "../test/builders/index.ts";
import { agendaNowIndex, nowClock, nowSpot, ownsNow, pillSpot, railAt, type Box } from "./nowline.ts";

const NY = "America/New_York";
const at = (t: string, tz = NY) => Temporal.PlainDateTime.from(t).toZonedDateTime(tz).toInstant().toString();
const week = aWeek({ pto: [aPto({ date: "2026-11-05" })] });
const tue = week.days.find((d) => d.date === "2026-11-03")!;
const thu = week.days.find((d) => d.date === "2026-11-05")!;

describe("now line (UI-B, NL-1: only on a block under way)", () => {
  it("sits on the block under way, at a fraction of its rail", () => {
    const am = tue.am.view;
    expect(railAt(am, am.start)).toBe(0);
    expect(railAt(am, am.end)).toBeNull();
    const s = nowSpot(tue, at("2026-11-03T10:03"), NY, false);
    expect(s).toMatchObject({ kind: "rail", half: "AM" });
    expect((s as { at: number }).at).toBeCloseTo((10.05 - 9) / (12.5 - 9));
  });

  it("shows at a block's exact start, not at its exact end; the next block takes it when it starts then", () => {
    expect(nowSpot(tue, tue.am.start, NY, false)).toEqual({ kind: "rail", half: "AM", at: 0 });
    expect(nowSpot(tue, tue.am.end, NY, false)).toEqual({ kind: "rail", half: "PM", at: 0 });
    expect(nowSpot(tue, at("2026-11-03T12:30"), NY, false)).toMatchObject({ kind: "rail", half: "PM" });
    expect(nowSpot(tue, tue.pm.end, NY, false)).toEqual({ kind: "none" });
  });

  it("shows nowhere before the day's first block or after its last", () => {
    expect(nowSpot(tue, at("2026-11-03T06:30"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(tue, at("2026-11-03T22:03"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(tue, at("2026-11-03T00:00"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(tue, at("2026-11-03T23:59"), NY, false)).toEqual({ kind: "none" });
  });

  it("shows nowhere in a gap between two blocks whose hours don't touch (a lunch)", () => {
    const w = aWeek({ config: aWeekConfig({ hours: { ...aWeekConfig().hours, lunch: { start: "12:00", end: "13:00" } } }) });
    const d = w.days.find((x) => x.date === "2026-11-03")!;
    // The morning's rail runs to the afternoon's start; the morning block's hours end at the lunch.
    expect(railAt(d.am.view, at("2026-11-03T12:30"))).not.toBeNull();
    expect(nowSpot(d, at("2026-11-03T11:59"), NY, false)).toMatchObject({ kind: "rail", half: "AM" });
    expect(nowSpot(d, at("2026-11-03T12:00"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(d, at("2026-11-03T12:30"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(d, at("2026-11-03T13:00"), NY, false)).toEqual({ kind: "rail", half: "PM", at: 0 });
  });

  it("goes by the block's hours, not the wider timeline range (24 hours)", () => {
    const w = aWeek({ viewRange: "24h" });
    const d = w.days.find((x) => x.date === "2026-11-03")!;
    expect(nowSpot(d, at("2026-11-03T06:30"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(d, at("2026-11-03T22:03"), NY, false)).toEqual({ kind: "none" });
  });

  it("on a day with an evening block: on it inside its hours, nowhere between the afternoon and it, nowhere after", () => {
    const base = aWeekConfig().hours;
    const hours = { ...base, overrides: [{ date: "2026-11-03", segments: [{ start: "09:00", end: "17:00" }, { start: "20:00", end: "22:00" }] }] };
    const d = aWeek({ config: aWeekConfig({ hours }) }).days.find((x) => x.date === "2026-11-03")!;
    expect(d.eve).not.toBeNull();
    expect(nowSpot(d, at("2026-11-03T18:30"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(d, at("2026-11-03T20:00"), NY, false)).toMatchObject({ kind: "rail", half: "EVE" });
    expect(nowSpot(d, at("2026-11-03T21:59"), NY, false)).toMatchObject({ kind: "rail", half: "EVE" });
    expect(nowSpot(d, at("2026-11-03T22:00"), NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(d, at("2026-11-03T22:03"), NY, false)).toEqual({ kind: "none" });
  });

  it("a workday with no working hours (nominal bounds only) is never under way", () => {
    const hours = { ...aWeekConfig().hours, overrides: [{ date: "2026-11-03", segments: [] }] };
    const d = aWeek({ config: aWeekConfig({ hours }) }).days.find((x) => x.date === "2026-11-03")!;
    expect(d.am.off && d.pm.off).toBe(true);
    expect(nowSpot(d, at("2026-11-03T10:03"), NY, false)).toEqual({ kind: "none" });
    expect(ownsNow(d.am, at("2026-11-03T10:03"))).toBe(false);
  });

  // NM-1: a day drawn as one cell has no block, so nothing is under way on it: no line at any time of day.
  it("a whole-day cell (PTO, a catch-up day with no working hours) never gets a line", () => {
    for (const t of ["06:30", "09:00", "13:00", "22:03"]) expect(nowSpot(thu, at(`2026-11-05T${t}`), NY, true), t).toEqual({ kind: "none" });
    expect(nowSpot(thu, thu.am.start, NY, true)).toEqual({ kind: "none" });
    const fri = week.days.find((d) => d.date === "2026-11-06")!;
    for (const t of ["10:03", "22:03"]) expect(nowSpot(fri, at(`2026-11-06T${t}`), NY, true), t).toEqual({ kind: "none" });
    // The same day drawn as blocks (a catch-up day with working hours) follows the block rule.
    expect(nowSpot(thu, at("2026-11-05T10:03"), NY, false)).toMatchObject({ kind: "rail", half: "AM" });
  });

  it("is null on another day and in another week", () => {
    expect(nowSpot(tue, at("2026-11-05T10:03"), NY, false)).toBeNull();
    expect(nowSpot(tue, at("2026-11-10T10:03"), NY, false)).toBeNull();
    expect(nowSpot(thu, at("2026-11-12T13:00"), NY, true)).toBeNull();
  });

  it("uses the person's zone for today and the time", () => {
    // 01:30 in London on Wednesday is still Tuesday 20:30 in New York: after the day, so no line.
    const now = at("2026-11-04T01:30", "Europe/London");
    expect(nowSpot(tue, now, NY, false)).toEqual({ kind: "none" });
    expect(nowSpot(tue, now, "Europe/London", false)).toBeNull();
    expect(nowClock(now, NY)).toBe("8:30");
  });

  it("goes into the agenda before the first row that starts at or after now", () => {
    const rows = [at("2026-11-03T09:00"), Temporal.Instant.from(at("2026-11-03T11:00")).epochMilliseconds];
    expect(agendaNowIndex(rows, at("2026-11-03T10:00"), "2026-11-03", NY)).toBe(1);
    expect(agendaNowIndex(rows, at("2026-11-03T12:00"), "2026-11-03", NY)).toBe(2);
    expect(agendaNowIndex(rows, at("2026-11-03T08:00"), "2026-11-03", NY)).toBe(0);
    // A free gap from now on starts at now: the line goes before it.
    expect(agendaNowIndex(rows, at("2026-11-03T11:00"), "2026-11-03", NY)).toBe(1);
    expect(agendaNowIndex(rows, at("2026-11-03T10:00"), "2026-11-04", NY)).toBeNull();
  });

  it("is in one block's agenda only, the one under way; never the morning before the day starts", () => {
    expect(ownsNow(tue.am, at("2026-11-03T06:30"))).toBe(false);
    expect(ownsNow(tue.pm, at("2026-11-03T06:30"))).toBe(false);
    expect(ownsNow(tue.am, at("2026-11-03T10:03"))).toBe(true);
    expect(ownsNow(tue.am, at("2026-11-03T14:00"))).toBe(false);
    expect(ownsNow(tue.pm, at("2026-11-03T14:00"))).toBe(true);
    expect(ownsNow(tue.pm, tue.pm.end)).toBe(false);
    expect(ownsNow(tue.pm, at("2026-11-03T22:03"))).toBe(false);
  });
});

describe("the now pill on a compact rail (HK-3)", () => {
  // A 200 px rail, 60 px wide; hour labels 14 px tall just under each hour line, at the left.
  const label = (y: number): Box => ({ top: y + 1, bottom: y + 15, left: 3, right: 17 });
  const base = { pill: { width: 30, height: 16 }, left: 6, rail: { width: 60, height: 200 } };
  it("stays on the line away from the marks", () => {
    expect(pillSpot({ ...base, line: 40, labels: [label(0), label(100)] })).toEqual({ spot: "center", top: 32 });
  });
  it("moves just above or below the mark it would cover, whichever is nearer the line", () => {
    // Just above the 10:00 line: above the label.
    expect(pillSpot({ ...base, line: 98, labels: [label(0), label(100)] })).toEqual({ spot: "above", top: 84 });
    // Just after it: below the label.
    expect(pillSpot({ ...base, line: 110, labels: [label(0), label(100)] })).toEqual({ spot: "below", top: 116 });
  });
  it("goes to the rail's right end when neither fits (marks close together on a short card)", () => {
    const tight = [label(0), label(30), label(60)];
    expect(pillSpot({ ...base, rail: { width: 60, height: 90 }, line: 33, labels: tight })).toEqual({ spot: "end", top: 25 });
  });
});
