// The time model (step 6b): split days, lunch, unavailable time, the evening slot, weekend flex sessions, the view
// range and weekend columns.
import { describe, expect, it } from "vitest";
import { capacityMinutes } from "../plan/rules.ts";
import { buildWeek } from "./build.ts";
import { hoursOn, noHoursPrompt, viewRange, workingMinutes, type TimeModel } from "./hours.ts";
import { config, meeting, NY } from "./test-helpers.ts";
import type { FlexSession, Unavailable, WeekConfig } from "./types.ts";

const WEEK = "2026-11-02"; // Mon Nov 2, 2026 (EST, -05:00)
const at = (local: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(NY).toInstant().toString();
const START = at("2026-11-02T00:00"); // before every slot starts, so capacity counts the whole slot

const model = (over: Partial<TimeModel> = {}): TimeModel => ({
  timeZone: NY,
  weekdays: { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }], wed: [{ start: "09:00", end: "17:00" }], thu: [{ start: "09:00", end: "17:00" }], fri: [], sat: [], sun: [] },
  lunch: { start: "12:00", end: "13:00" },
  overrides: [],
  ...over,
});
const cfg = (m: TimeModel): WeekConfig => ({ ...config, standingBlocks: [], hours: m });
const flex = (id: number, date: string, start: string, end: string, over: Partial<FlexSession> = {}): FlexSession => ({
  id,
  clientKey: "tw",
  start: at(`${date}T${start}`),
  end: at(`${date}T${end}`),
  itemId: null,
  itemTitle: null,
  itemUrl: null,
  note: null,
  ...over,
});
const unavailable = (id: number, date: string, start: string, end: string): Unavailable => ({ id, title: "Dentist", start: at(`${date}T${start}`), end: at(`${date}T${end}`), note: null });

describe("working hours for a day", () => {
  it("splits the main span at the lunch and leaves the lunch out of working time", () => {
    const h = hoursOn(model(), "2026-11-02");
    expect([h.am, h.pm]).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    expect(workingMinutes(h)).toBe(7 * 60);
  });

  it("without a lunch, splits at the middle of the day (to 15 minutes)", () => {
    const h = hoursOn(model({ lunch: null, weekdays: { ...model().weekdays, mon: [{ start: "08:00", end: "15:30" }] } }), "2026-11-02");
    expect(h.am!.end).toBe("11:45");
    expect(h.pm!.start).toBe("11:45");
  });

  it("applies a one-day override: a split day with an evening span and its own lunch", () => {
    const m = model({ overrides: [{ date: "2026-11-03", segments: [{ start: "20:00", end: "22:00" }, { start: "09:00", end: "16:00" }], lunch: { start: "12:30", end: "13:00" } }] });
    const h = hoursOn(m, "2026-11-03");
    expect(h.main).toEqual({ start: "09:00", end: "16:00" });
    expect(h.extra).toEqual([{ start: "20:00", end: "22:00" }]);
    expect(h.am!.end).toBe("12:30");
    expect(workingMinutes(h)).toBe(7 * 60 - 30 + 120);
    expect(hoursOn(m, "2026-11-04").overridden).toBe(false);
  });

  it("ignores a lunch outside the main span (the day splits in the middle instead)", () => {
    const m = model({ overrides: [{ date: "2026-11-03", segments: [{ start: "14:00", end: "18:00" }] }] });
    expect(hoursOn(m, "2026-11-03").lunch).toBeNull();
    expect(hoursOn(m, "2026-11-03").am!.end).toBe("16:00");
  });
});

describe("capacity from the time model", () => {
  it("counts only working windows: lunch is not capacity, unavailable time is taken like a meeting", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [], events: [meeting("2026-11-02T10:00", "2026-11-02T11:00")], config: cfg(model()), unavailable: [unavailable(1, "2026-11-02", "14:00", "15:30")] });
    const mon = w.days[0]!;
    expect(capacityMinutes(mon.am, START)).toBe(120); // 9–12 minus a 1h meeting
    expect(capacityMinutes(mon.pm, START)).toBe(4 * 60 - 90); // 13–17 minus 1.5h unavailable
    expect(mon.pm.busyMeetingMinutes).toBe(0); // unavailable time is not a meeting
    expect(mon.pm.events.map((e) => e.event.source)).toEqual(["focustime"]);
  });

  it("gives a split day an evening slot that holds its own capacity", () => {
    const m = model({ overrides: [{ date: "2026-11-03", segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }] }] });
    const tue = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(m) }).days[1]!;
    expect(capacityMinutes(tue.pm, START)).toBe(3 * 60);
    expect(tue.eve).not.toBeNull();
    expect(capacityMinutes(tue.eve!, START)).toBe(120);
    expect(tue.eve!.off).toBe(false);
  });

  it("puts a flex session after hours in the evening slot and one before the day starts in the morning", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()), flex: [flex(1, "2026-11-02", "19:00", "21:00"), flex(2, "2026-11-02", "07:00", "08:00")] });
    const mon = w.days[0]!;
    expect(mon.eve!.flex.map((f) => f.id)).toEqual([1]);
    expect(mon.am.flex.map((f) => f.id)).toEqual([2]);
    expect(capacityMinutes(mon.am, START)).toBe(4 * 60); // 7–8 plus 9–12
    expect(capacityMinutes(mon.eve!, START)).toBe(120);
    expect(mon.flexMinutes).toBe(180);
  });

  it("places an evening meeting in the evening slot, not past the end of the day", () => {
    const m = model({ overrides: [{ date: "2026-11-03", segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }] }] });
    const tue = buildWeek({ weekStart: WEEK, patterns: [], events: [meeting("2026-11-03T20:30", "2026-11-03T21:00")], config: cfg(m) }).days[1]!;
    expect(tue.eve!.events).toHaveLength(1);
    expect(tue.evening).toHaveLength(0);
    expect(capacityMinutes(tue.eve!, START)).toBe(90);
  });

  it("a day without working hours has no capacity and no open half-days", () => {
    const fri = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()) }).days[4]!;
    expect(fri.am.off && fri.pm.off).toBe(true);
    expect(capacityMinutes(fri.am, START) + capacityMinutes(fri.pm, START)).toBe(0);
    expect(fri.am.open).toBe(false);
  });
});

describe("weekend columns", () => {
  it("shows Mon–Fri only in a week with nothing on the weekend", () => {
    expect(buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()) }).days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("adds a weekend day with a flex session, as an evening-style slot with its capacity", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()), flex: [flex(1, "2026-11-07", "10:00", "12:00")] });
    expect(w.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    const sat = w.days[5]!;
    expect(sat.kind).toBe("weekend");
    expect(sat.eve!.flex.map((f) => f.id)).toEqual([1]);
    expect(capacityMinutes(sat.eve!, START)).toBe(120);
    expect(sat.am.off).toBe(true);
  });

  it("adds a weekend day with working hours, unavailable time or picks, and not a weekend meeting alone", () => {
    const withHours = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model({ weekdays: { ...model().weekdays, sun: [{ start: "10:00", end: "14:00" }] } })) });
    expect(withHours.days.at(-1)!.weekday).toBe("Sun");
    expect(withHours.days.at(-1)!.am.windows).toHaveLength(1);
    expect(buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()), unavailable: [unavailable(1, "2026-11-08", "10:00", "11:00")] }).days).toHaveLength(6);
    expect(buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()), weekendPlanned: new Set(["2026-11-07"]) }).days).toHaveLength(6);
    expect(buildWeek({ weekStart: WEEK, patterns: [], events: [meeting("2026-11-07T10:00", "2026-11-07T11:00")], config: cfg(model()) }).days).toHaveLength(5);
  });
});

describe("view range", () => {
  const days = (m: TimeModel) => ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => hoursOn(m, d));

  it("business hours: the earliest start to the latest end of the week's working days", () => {
    expect(viewRange("business", days(model()), [])).toEqual({ start: "09:00", end: "17:00", expanded: false });
    const early = model({ overrides: [{ date: "2026-11-04", segments: [{ start: "07:30", end: "15:00" }] }] });
    expect(viewRange("business", days(early), [])).toEqual({ start: "07:00", end: "17:00", expanded: false });
  });

  it("12h and 24h are fixed, and every range widens to the whole hour around planned time outside it", () => {
    expect(viewRange("12h", days(model()), [])).toEqual({ start: "07:00", end: "19:00", expanded: false });
    expect(viewRange("24h", days(model()), [])).toEqual({ start: "00:00", end: "24:00", expanded: false });
    expect(viewRange("business", days(model()), [{ start: "17:30", end: "18:15" }])).toEqual({ start: "09:00", end: "19:00", expanded: true });
    expect(viewRange("12h", days(model()), [{ start: "06:10", end: "06:40" }])).toEqual({ start: "06:00", end: "19:00", expanded: true });
  });

  it("the week's timelines show evening flex sessions beyond the range", () => {
    const w = buildWeek({ weekStart: WEEK, patterns: [], events: [], config: cfg(model()), flex: [flex(1, "2026-11-02", "19:00", "21:00")] });
    expect(w.range).toMatchObject({ mode: "business", start: "09:00", end: "17:00" });
    const mon = w.days[0]!;
    const same = (a: string, b: string) => Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b)) === 0;
    expect(same(mon.eve!.view.end, at("2026-11-02T21:00"))).toBe(true);
    expect(same(mon.eve!.view.start, at("2026-11-02T17:00"))).toBe(true);
  });
});

describe("moving a pick to a day with no working hours (step 13.5, Friday since 13.6)", () => {
  it("asks on a weekend day with no hours, by its weekday name; never on a day with hours", () => {
    expect(noHoursPrompt(model(), "2026-11-07")).toBe("Saturday has no working hours. Add hours for that day?");
    expect(noHoursPrompt(model(), "2026-11-08")).toBe("Sunday has no working hours. Add hours for that day?");
    expect(noHoursPrompt(model(), "2026-11-05")).toBeNull();
    // A one-day override with hours counts.
    expect(noHoursPrompt(model({ overrides: [{ date: "2026-11-07", segments: [{ start: "09:00", end: "12:00" }] }] }), "2026-11-07")).toBeNull();
    // Further than a week out, the date says which day.
    expect(noHoursPrompt(model(), "2026-11-21", "2026-11-02")).toBe("Saturday, Nov 21 has no working hours. Add hours for that day?");
  });
  it("never asks for Friday, the overflow day (Q78, D238), with or without hours", () => {
    expect(noHoursPrompt(model(), "2026-11-06")).toBeNull();
    expect(noHoursPrompt(model(), "2026-11-20", "2026-11-02")).toBeNull();
  });
  it("asks for any other weekday without hours (a Wednesday made a day off)", () => {
    const off = model({ overrides: [{ date: "2026-11-04", segments: [] }] });
    expect(noHoursPrompt(off, "2026-11-04")).toBe("Wednesday has no working hours. Add hours for that day?");
  });
});
