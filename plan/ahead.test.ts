// Step 17, slice 2: Plan ahead's timeline rules. Fictional data only.
import { describe, expect, it } from "vitest";
import { aheadColumns, aheadWeeks, barDates, cellChoices, dragBar, monthLoad, monthOf, overbooked, stepCell, timelineScale, type BarInput } from "./ahead.ts";

const weeks = aheadWeeks("2026-11-02");
const cols = aheadColumns(weeks);

describe("the timeline's columns", () => {
  it("12 weeks from this week's Monday: four weekly columns, then a column per month", () => {
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toBe("2027-01-18");
    expect(cols.map((c) => c.label)).toEqual(["Nov 2", "Nov 9", "Nov 16", "Nov 23", "Dec", "Jan"]);
    // Nov 30's Thursday is Dec 3: that week is December's.
    expect(cols[4]).toMatchObject({ kind: "month", month: "2026-12", weeks: ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"], from: "2026-11-30", to: "2027-01-04" });
    expect(cols[5]).toMatchObject({ month: "2027-01", from: "2027-01-04", to: "2027-01-25" });
  });
  it("positions dates within each column's width; outside dates clamp to the edges; and back again", () => {
    const s = timelineScale(cols, { week: 140, month: 200 });
    expect(s.width).toBe(4 * 140 + 2 * 200);
    expect(s.x("2026-11-02")).toBe(0);
    expect(s.x("2026-11-09")).toBe(140);
    expect(s.x("2026-11-12")).toBe(200);
    expect(s.x("2026-11-30")).toBe(560);
    expect(s.x("2027-01-04")).toBe(760);
    expect(s.x("2026-10-01")).toBe(0);
    expect(s.x("2027-06-01")).toBe(960);
    expect(s.dateAt(200)).toBe("2026-11-12");
    expect(s.dateAt(560)).toBe("2026-11-30");
    expect(s.dateAt(5000)).toBe("2027-01-24");
  });
  it("which month a date falls in", () => {
    expect(monthOf(cols, "2026-12-11")).toBe("2026-12");
    expect(monthOf(cols, "2026-11-20")).toBeNull();
    expect(monthOf(cols, "2027-02-01")).toBeNull();
  });
});

describe("bar dates: DevOps first, then estimates (D349)", () => {
  const base: BarInput = { hasStartField: true, startDate: "2026-11-09", targetDate: "2026-12-11", local: null, plannedWeeks: [], firstActivity: null, forecastEnd: null, today: "2026-11-02" };
  it("solid with both DevOps dates", () => {
    expect(barDates(base)).toEqual({ start: "2026-11-09", end: "2026-12-11", startFrom: "devops", endFrom: "devops", solid: true, target: "2026-12-11", ghostEnd: null, changed: false });
  });
  it("estimated (hatched) when the process has no Start Date, even with one in the data", () => {
    const b = barDates({ ...base, hasStartField: false, plannedWeeks: ["2026-11-16", "2026-11-09"] });
    expect(b).toMatchObject({ start: "2026-11-09", startFrom: "planned", end: "2026-12-11", endFrom: "devops", solid: false });
  });
  it("start: first planned week, else first story activity, else today", () => {
    expect(barDates({ ...base, startDate: null, plannedWeeks: ["2026-11-16"] })).toMatchObject({ start: "2026-11-16", startFrom: "planned" });
    expect(barDates({ ...base, startDate: null, firstActivity: "2026-10-20T14:00:00Z" })).toMatchObject({ start: "2026-10-20", startFrom: "activity" });
    expect(barDates({ ...base, startDate: null })).toMatchObject({ start: "2026-11-02", startFrom: "today" });
  });
  it("end: target date, else the last planned week's Friday, else the pace, else two weeks", () => {
    const n = { ...base, targetDate: null };
    expect(barDates({ ...n, plannedWeeks: ["2026-11-09", "2026-11-23"] })).toMatchObject({ end: "2026-11-27", endFrom: "planned" });
    expect(barDates({ ...n, forecastEnd: "2026-12-20" })).toMatchObject({ end: "2026-12-20", endFrom: "pace" });
    expect(barDates(n)).toMatchObject({ end: "2026-11-22", endFrom: "default", target: null });
    // Started weeks ago with nothing else to go on: two weeks from today, not from its start.
    expect(barDates({ ...n, startDate: null, firstActivity: "2026-10-09T15:00:00Z" })).toMatchObject({ start: "2026-10-09", end: "2026-11-15", endFrom: "default" });
  });
  it("the pace forecast past the target: a ghost extension past the diamond", () => {
    expect(barDates({ ...base, forecastEnd: "2027-01-08" })).toMatchObject({ end: "2026-12-11", ghostEnd: "2027-01-08" });
    expect(barDates({ ...base, forecastEnd: "2026-12-01" }).ghostEnd).toBeNull();
  });
  it("dragged dates win until saved, and say so", () => {
    expect(barDates({ ...base, local: { start: "2026-11-16", end: "2026-12-18" } })).toMatchObject({ start: "2026-11-16", end: "2026-12-18", startFrom: "local", endFrom: "local", solid: false, changed: true, target: "2026-12-11" });
  });
  it("never ends before it starts", () => {
    expect(barDates({ ...base, startDate: "2026-12-20" })).toMatchObject({ start: "2026-12-20", end: "2026-12-20" });
  });
});

describe("dragging a bar (local estimates)", () => {
  const b = { start: "2026-11-09", end: "2026-11-27" };
  it("the body moves both dates; an end moves one; whole days", () => {
    expect(dragBar(b, "move", 7)).toEqual({ start: "2026-11-16", end: "2026-12-04" });
    expect(dragBar(b, "start", -3.4)).toEqual({ start: "2026-11-06", end: "2026-11-27" });
    expect(dragBar(b, "end", 10)).toEqual({ start: "2026-11-09", end: "2026-12-07" });
  });
  it("an end never crosses the other", () => {
    expect(dragBar(b, "start", 40)).toEqual({ start: "2026-11-27", end: "2026-11-27" });
    expect(dragBar(b, "end", -40)).toEqual({ start: "2026-11-09", end: "2026-11-09" });
  });
});

describe("week cells and crowded months: whole numbers", () => {
  it("cells offer 0 to the budget (or what is set, if more); + and − stay inside", () => {
    expect(cellChoices(3, 1)).toEqual([0, 1, 2, 3]);
    expect(cellChoices(2, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(stepCell(3, 1, 3)).toBe(3);
    expect(stepCell(0, -1, 3)).toBe(0);
    expect(stepCell(1, 1, 3)).toBe(2);
  });
  it("a month is crowded when its features due get fewer than 3 blocks each", () => {
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 5, 2)).toEqual({ month: "2026-12", label: "Dec", available: 5, due: 2, crowded: true, text: "5 blocks, 2 features due" });
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 15, 2).crowded).toBe(false);
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 1, 0)).toMatchObject({ crowded: false, text: "1 block" });
  });
});

describe("over-booked weeks", () => {
  it("counts client weeks with more musts than blocks, and the features in them", () => {
    const clients = [
      { clientKey: "Contoso", weeks: [{ weekStart: "2026-11-02", planned: 3, budget: 2 }, { weekStart: "2026-11-09", planned: 2, budget: 2 }] },
      { clientKey: "Fabrikam", weeks: [{ weekStart: "2026-11-02", planned: 1, budget: 0 }] },
    ];
    const cells = [
      { clientKey: "Contoso", itemId: 1, weekStart: "2026-11-02", blocks: 2 },
      { clientKey: "Contoso", itemId: 2, weekStart: "2026-11-09", blocks: 2 },
      { clientKey: "Contoso", itemId: 3, weekStart: "2026-11-02", blocks: 0 },
      { clientKey: "Fabrikam", itemId: 9, weekStart: "2026-11-02", blocks: 1 },
    ];
    const o = overbooked(clients, cells);
    expect(o.weeks).toBe(2);
    expect([...o.items].sort()).toEqual(["Contoso:1", "Fabrikam:9"]);
  });
});
