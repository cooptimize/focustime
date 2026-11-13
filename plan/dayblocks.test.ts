// RS-2: Day shows, for any day, the blocks Week shows for it. STEP 0.3's case first (a working catch-up day, which Day
// used to draw empty), then a walk over every day of the fixture weeks and the demo's week.
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aPto, aWeek, aWeekConfig } from "../test/builders/index.ts";
import { legacyHours, parseConfig } from "../config/schema.ts";
import { weekConfig as neutral } from "../config/defaults.ts";
import { fourDayWeekConfig } from "../fixtures/four-day-week.ts";
import { sampleGoogle, sampleOutlook, samplePatterns, SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import { DEMO_CONFIG, demoGoogle, demoOutlook, demoPatterns, demoPto } from "../sources/demo/data.ts";
import { buildWeek } from "../week/build.ts";
import { ptoByDate } from "../week/pto.ts";
import { weekDates7 } from "../week/dates.ts";
import type { Day, Week, WeekConfig } from "../week/types.ts";
import { cardHalves, dayBlocks } from "./dayblocks.ts";
import { todayShape } from "./todayday.ts";

const north = aClient({ name: "Northwind" });
const patterns = [aFocusBlock({ client: north, days: { Mon: "AllDay", Tue: "AllDay", Wed: "AllDay", Thu: "AllDay" } })];
const base = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" });
const withFriday = (c: WeekConfig): WeekConfig => ({ ...c, hours: { ...c.hours, weekdays: { ...c.hours.weekdays, fri: [{ start: "09:00", end: "17:00" }] } } });

/** What Day draws for a day, from the same inputs Day has (today's own answer for "today", here every day in turn). */
const dayOf = (d: Day) => todayShape(d, { date: d.date, today: d.date, todayWorkday: d.hours.segments.length > 0 || d.flexMinutes > 0, picked: new Set(["AM", "PM"]) });

describe("STEP 0.3: a working catch-up day", () => {
  // A person whose catch-up day has working hours (new people get 9 to 5 on it by default).
  const week = aWeek({ patterns, config: withFriday(aWeekConfig({ hours: base })) });
  const fri = week.days.find((d) => d.kind === "overflow")!;

  it("Week draws its morning and afternoon cards, and Day lists the same blocks", () => {
    expect(fri.hours.segments.length).toBeGreaterThan(0);
    expect(cardHalves(fri)).toEqual(["AM", "PM"]);
    expect(dayOf(fri).blocks.map((b) => b.slot.half)).toEqual(["AM", "PM"]);
    expect(dayOf(fri).whole).toBeNull();
  });

  it("with no working hours it is Week's one Catch-up cell on both", () => {
    const off = aWeek({ patterns, config: aWeekConfig({ hours: base }) }).days.find((d) => d.kind === "overflow")!;
    expect(dayBlocks(off)).toEqual({ weekend: false, whole: "catchup", halves: [] });
    expect(dayOf(off)).toMatchObject({ whole: "catchup", blocks: [] });
  });
});

/** Every day of a week: Day's blocks are Week's cards. Weekends are their own plain list on both; a day off is the exception named below. */
function walk(name: string, week: Week) {
  for (const d of week.days)
    it(`${name}: ${d.weekday} ${d.date}`, () => {
      const w = dayBlocks(d);
      const shape = dayOf(d);
      if (w.weekend) return expect(d.kind).toBe("weekend");
      expect(shape.whole).toBe(w.whole);
      if (w.whole === "pto") return expect(shape.ptoDay).toBe(true);
      if (w.whole === "catchup") return expect(shape.blocks).toEqual([]);
      if (!shape.workday) {
        // A weekday with no working hours (a day off): Week's cards say "No working hours", Day says so in one line.
        expect(w.halves.every((h) => (h === "AM" ? d.am : h === "PM" ? d.pm : d.eve!).off)).toBe(true);
        return expect(shape.blocks).toEqual([]);
      }
      expect(shape.blocks.map((b) => b.slot.half)).toEqual(w.halves);
    });
}

describe("every day of the fixture weeks and the demo: Day's blocks are Week's cards", () => {
  const flexAt = (date: string, from: string, to: string, id: number) => ({ id, clientKey: north.clientKey, start: `${date}T${from}:00-05:00`, end: `${date}T${to}:00-05:00`, itemId: null, itemTitle: null, itemUrl: null, note: null }) as never;
  walk("builder week", aWeek({ patterns, pto: [aPto({ date: "2026-11-05" }), aPto({ date: "2026-11-04", half: "PM" })] }));
  walk("builder week, working Friday", aWeek({ patterns, config: withFriday(aWeekConfig({ hours: base })) }));
  walk("builder week, a weekend flex session and plans", aWeek({ patterns, flex: [flexAt("2026-11-07", "10:00", "12:00", 1), flexAt("2026-11-03", "19:00", "21:00", 2)], weekendPlanned: new Set(["2026-11-08"]) }));
  walk("sample week", buildWeek({ weekStart: SAMPLE_WEEK, patterns: samplePatterns, events: [...sampleOutlook, ...sampleGoogle], config: fourDayWeekConfig }));
  walk("sample week, neutral defaults", buildWeek({ weekStart: SAMPLE_WEEK, patterns: samplePatterns, events: [...sampleOutlook, ...sampleGoogle], config: neutral }));
  const demo = parseConfig(DEMO_CONFIG);
  if (!demo.ok) throw new Error("the demo config doesn't parse");
  for (const today of weekDates7(SAMPLE_WEEK).slice(0, 5)) {
    const input = { weekStart: SAMPLE_WEEK, patterns: demoPatterns(), events: [...demoOutlook(SAMPLE_WEEK), ...demoGoogle(SAMPLE_WEEK, today)], pto: ptoByDate(demoPto(SAMPLE_WEEK, "2026-11-08", today), weekDates7(SAMPLE_WEEK)) };
    walk(`demo on ${today}`, buildWeek({ ...input, config: demo.config.week }));
    walk(`demo on ${today}, a working Friday`, buildWeek({ ...input, config: withFriday(demo.config.week) }));
  }
});
