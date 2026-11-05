import { describe, expect, it } from "vitest";
import { legacyHours } from "../config/schema.ts";
import { aClient, aFocusBlock, aPick, aPto, aWeek, aWeekConfig, WEEK } from "../test/builders/index.ts";
import { carryListed, nextBlockFor, originNote, suggestCarry } from "./suggest.ts";

const contoso = aClient({ name: "Contoso" });
const other = aClient({ name: "Fabrikam" });
const at = (t: string) => Temporal.PlainDateTime.from(t).toZonedDateTime("America/New_York").toInstant().toString();
const wedPm = at("2026-11-04T18:00");

describe("nextBlockFor (UI-B)", () => {
  it("skips a PTO day and the catch-up day; none left this week", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: contoso, days: { Wed: "AllDay", Thu: "AllDay" } })], pto: [aPto({ date: "2026-11-05" })] });
    expect(nextBlockFor(week.days, contoso.clientKey, wedPm)).toBeNull();
  });

  it("takes the client's own next block that hasn't ended, not another client's or an Open half-day", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: other, days: { Tue: "AllDay" } }), aFocusBlock({ client: contoso, days: { Mon: "AM", Wed: "PM" } })] });
    expect(nextBlockFor(week.days, contoso.clientKey, at("2026-11-02T13:00"))).toEqual({ date: "2026-11-04", half: "PM" });
    expect(nextBlockFor(week.days, contoso.clientKey, at("2026-11-02T08:00"))).toEqual({ date: WEEK, half: "AM" });
  });

  it("skips a PTO half", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: contoso, days: { Tue: "AllDay" } })], pto: [aPto({ date: "2026-11-03", half: "AM" })] });
    expect(nextBlockFor(week.days, contoso.clientKey, at("2026-11-02T18:00"))).toEqual({ date: "2026-11-03", half: "PM" });
  });

  it("skips a block on a day with no working hours", () => {
    const hours = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" });
    const week = aWeek({ config: aWeekConfig({ hours: { ...hours, weekdays: { ...hours.weekdays, tue: [] } } }), patterns: [aFocusBlock({ client: contoso, days: { Tue: "AM", Wed: "AM" } })] });
    expect(nextBlockFor(week.days, contoso.clientKey, at("2026-11-02T18:00"))).toEqual({ date: "2026-11-04", half: "AM" });
  });
});

describe("suggestCarry (UI-B)", () => {
  const week = aWeek({ patterns: [aFocusBlock({ client: contoso, days: { Mon: "AM", Thu: "PM" } })] });

  it("puts this week's unfinished picks in their client's next block, the rest in the lists", () => {
    const mine = aPick({ clientKey: contoso.clientKey, date: "2026-11-02" });
    const noBlock = aPick({ clientKey: other.clientKey, date: "2026-11-03" });
    const lastWeek = aPick({ clientKey: contoso.clientKey, date: "2026-10-29" });
    const r = suggestCarry([mine, noBlock, lastWeek], week.days, WEEK, at("2026-11-04T09:00"));
    expect(r.cards).toEqual([{ pick: mine, to: { date: "2026-11-05", half: "PM" } }]);
    expect(r.earlierDays).toEqual([noBlock]);
    // Earlier weeks always use the list, even with a block this week.
    expect(r.earlierWeeks).toEqual([lastWeek]);
  });

  it("falls back to the list once the client's last block of the week has ended", () => {
    const p = aPick({ clientKey: contoso.clientKey, date: "2026-11-02" });
    const r = suggestCarry([p], week.days, WEEK, at("2026-11-05T17:30"));
    expect(r.cards).toEqual([]);
    expect(r.earlierDays).toEqual([p]);
  });
});

describe("originNote (UI-B)", () => {
  it("says where a pick is suggested, and where it went once kept", () => {
    const p = aPick({ id: 7, date: "2026-11-02" });
    expect(originNote(p, new Map([[7, { date: "2026-11-05", half: "PM" as const }]]))).toBe("→ suggested Thu PM");
    expect(originNote({ ...p, status: "moved", carriedTo: { date: "2026-11-05", half: "PM" } }, new Map())).toBe("→ moved to Thu PM");
    expect(originNote(p, new Map())).toBeNull();
  });
});

describe("Plan today's list (HK-3)", () => {
  it("leaves out picks suggested in a block, this day's or another day's; keeps those with no block left", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: contoso, days: { Wed: "PM", Thu: "AM" } })] });
    const here = aPick({ clientKey: contoso.clientKey, date: "2026-11-02" });
    const noBlock = aPick({ clientKey: other.clientKey, date: "2026-11-03" });
    const lastWeek = aPick({ clientKey: other.clientKey, date: "2026-10-28" });
    // Wednesday afternoon: Contoso's next block is Wed PM.
    const wed = suggestCarry([here, noBlock, lastWeek], week.days, WEEK, at("2026-11-04T13:00"));
    const suggested = new Map(wed.cards.map((s) => [s.pick.id, s.to] as const));
    expect(carryListed([here, noBlock, lastWeek], suggested).map((p) => p.id)).toEqual([noBlock.id, lastWeek.id]);
    // After Wednesday's block ends it is suggested Thursday morning: still not in Wednesday's list.
    const thu = suggestCarry([here], week.days, WEEK, at("2026-11-04T18:00"));
    expect(thu.cards[0]?.to).toEqual({ date: "2026-11-05", half: "AM" });
    expect(carryListed([here], new Map(thu.cards.map((s) => [s.pick.id, s.to] as const)))).toEqual([]);
  });
});
