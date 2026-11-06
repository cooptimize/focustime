// QF-1 (parts 1 and 2): what Today shows for today, another day, a PTO day and a PTO half-day.
import { describe, expect, it } from "vitest";
import { aClient, aFocusBlock, aPto, aWeek } from "../test/builders/index.ts";
import { nextWorkingDay, todayShape } from "./todayday.ts";

const north = aClient({ name: "Northwind" });
const patterns = [aFocusBlock({ client: north, days: { Mon: "AllDay", Tue: "AllDay", Wed: "AllDay", Thu: "AllDay" } })];
const week = aWeek({ patterns, pto: [aPto({ date: "2026-11-05", titles: ["Day off"] }), aPto({ date: "2026-11-04", titles: ["Dentist"], half: "PM" })] });
const day = (d: string) => week.days.find((x) => x.date === d)!;
const none = new Set<never>();

describe("Today's shape", () => {
  it("today: blocks, nudges, editable", () => {
    const s = todayShape(day("2026-11-03"), { date: "2026-11-03", today: "2026-11-03", todayWorkday: true, picked: none });
    expect(s).toMatchObject({ isToday: true, workday: true, nudges: true, readOnly: false, ptoDay: false });
    expect(s.blocks.map((b) => [b.slot.half, b.muted])).toEqual([["AM", false], ["PM", false]]);
  });

  it("another day, past or ahead: the same blocks, read only, no nudges", () => {
    for (const today of ["2026-11-02", "2026-11-04"]) {
      const s = todayShape(day("2026-11-03"), { date: "2026-11-03", today, todayWorkday: true, picked: none });
      expect(s).toMatchObject({ isToday: false, past: today > "2026-11-03", workday: true, nudges: false, readOnly: true });
      expect(s.blocks).toHaveLength(2);
    }
  });

  it("a PTO day: never blank, read only, nothing nags, only blocks that still hold a pick, muted", () => {
    const empty = todayShape(day("2026-11-05"), { date: "2026-11-05", today: "2026-11-05", todayWorkday: false, picked: none });
    expect(empty).toMatchObject({ ptoDay: true, workday: false, nudges: false, readOnly: true, blocks: [] });
    const planned = todayShape(day("2026-11-05"), { date: "2026-11-05", today: "2026-11-05", todayWorkday: false, picked: new Set(["AM" as const]) });
    expect(planned.blocks.map((b) => [b.slot.half, b.muted])).toEqual([["AM", true]]);
  });

  it("a PTO half-day: only that half is muted; the day still nudges and stays editable", () => {
    const s = todayShape(day("2026-11-04"), { date: "2026-11-04", today: "2026-11-04", todayWorkday: true, picked: none });
    expect(s).toMatchObject({ ptoDay: false, workday: true, nudges: true, readOnly: false });
    expect(s.blocks.map((b) => [b.slot.half, b.muted])).toEqual([["AM", false], ["PM", true]]);
  });

  it("a day not loaded yet: nothing", () => {
    expect(todayShape(null, { date: "2026-11-10", today: "2026-11-03", todayWorkday: true, picked: none }).blocks).toEqual([]);
  });
});

describe("a PTO day's next working day", () => {
  it("skips days without hours and PTO, across weeks", () => {
    const hours = (d: string) => Temporal.PlainDate.from(d).dayOfWeek <= 4;
    expect(nextWorkingDay("2026-11-05", hours, () => false)).toBe("2026-11-09");
    expect(nextWorkingDay("2026-11-05", hours, (d) => d === "2026-11-09")).toBe("2026-11-10");
  });
});
