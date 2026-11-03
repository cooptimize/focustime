// Step 17, slice 2: Plan ahead's timeline rules. Fictional data only.
import { describe, expect, it } from "vitest";
import { aheadColumns, aheadWeeks, barDates, dragBar, monthLoad, monthOf, overbooked, pastWords, readiness, timelineScale, type BarInput, type ReadinessInput } from "./ahead.ts";

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

describe("crowded months (E2: in hours)", () => {
  it("a month is crowded when its features due get less than 12h of free time each", () => {
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 20 * 60, 2)).toEqual({ month: "2026-12", label: "Dec", available: 1200, due: 2, crowded: true, text: "about 20h free, 2 features due" });
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 60 * 60, 2).crowded).toBe(false);
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 4 * 60, 0)).toMatchObject({ crowded: false, text: "about 4h free" });
    expect(monthLoad({ month: "2026-12", label: "Dec" }, 0, 1)).toMatchObject({ crowded: true, text: "No focus time, 1 feature due" });
  });
});

describe("over-booked weeks", () => {
  it("counts client weeks whose musts need more than their free time, and the features in them", () => {
    const clients = [
      { clientKey: "Contoso", weeks: [{ weekStart: "2026-11-02", plannedMinutes: 600, freeMinutes: 480 }, { weekStart: "2026-11-09", plannedMinutes: 480, freeMinutes: 480 }] },
      { clientKey: "Fabrikam", weeks: [{ weekStart: "2026-11-02", plannedMinutes: 120, freeMinutes: 0 }, { weekStart: "2026-11-09", plannedMinutes: 485, freeMinutes: 480 }] },
    ];
    const cells = [
      { clientKey: "Contoso", itemId: 1, weekStart: "2026-11-02", minutes: 600 },
      { clientKey: "Contoso", itemId: 2, weekStart: "2026-11-09", minutes: 480 },
      { clientKey: "Contoso", itemId: 3, weekStart: "2026-11-02", minutes: 0 },
      { clientKey: "Fabrikam", itemId: 9, weekStart: "2026-11-02", minutes: 120 },
    ];
    const o = overbooked(clients, cells);
    expect(o.weeks).toBe(2);
    expect([...o.items].sort()).toEqual(["Contoso:1", "Fabrikam:9"]);
  });
});

describe("the last 2 weeks: planned vs worked, in plain words", () => {
  it("adds two past weekly columns before this week", () => {
    const c = aheadColumns(weeks, ["2026-10-19", "2026-10-26"]);
    expect(c.slice(0, 3).map((x) => [x.kind, x.label])).toEqual([["past", "Oct 19"], ["past", "Oct 26"], ["week", "Nov 2"]]);
    const s = timelineScale(c, { week: 140, month: 200, past: 100 });
    expect(s.x("2026-11-02")).toBe(200);
    expect(s.from).toBe("2026-10-19");
  });
  it("planned and worked in whole hours; never a decimal or a block", () => {
    expect(pastWords(8 * 60, 200)).toBe("planned 8h, worked about 3h");
    expect(pastWords(6 * 60, 0)).toBe("planned 6h, no focus time");
    expect(pastWords(4 * 60, 20)).toBe("planned 4h, worked under 1h");
    expect(pastWords(0, 420)).toBe("not planned, worked about 7h");
    expect(pastWords(0, 0)).toBeNull();
    for (const [p, w] of [[90, 95], [0, 37], [4800, 4799]] as const) expect(pastWords(p, w)).not.toMatch(/[.,]\d|½|block/);
  });
});

describe("readiness flags, each with its next steps", () => {
  const base: ReadinessInput = {
    tier: "feature", state: "on_track", owned: true, stories: 3, start: "2026-11-09", target: "2026-12-11", today: "2026-11-02",
    weeks, plannedWeeks: ["2026-11-09", "2026-11-16", "2026-11-23"], crowdedMonths: new Set(), cols, needsStories: false,
  };
  const kinds = (i: Partial<ReadinessInput>) => readiness({ ...base, ...i }).map((f) => f.kind);
  it("a healthy feature has none", () => expect(readiness(base)).toEqual([]));
  it("starts in N weeks, not scoped: Break it down or Copy Coop brief", () => {
    const [f] = readiness({ ...base, state: "not_scoped", stories: 0, start: "2026-11-16" });
    expect(f).toEqual({ kind: "not_scoped", text: "Starts in 2 weeks, not scoped", next: ["breakdown", "brief"] });
    expect(readiness({ ...base, state: "not_scoped", stories: 0, start: "2026-11-03" })[0]!.text).toBe("Starts this week, not scoped");
    expect(readiness({ ...base, state: "not_scoped", stories: 0, start: "2026-10-20" })[0]!.text).toBe("Started, not scoped");
    expect(readiness({ ...base, tier: "epic", state: "not_scoped", stories: 0, start: "2026-11-16" })[0]).toEqual({ kind: "not_scoped", text: "Starts in 2 weeks, no features", next: ["draft_feature"] });
  });
  it("no target date: Set target date (mine), else ask the owner", () => {
    expect(readiness({ ...base, target: null, plannedWeeks: [] })).toEqual([{ kind: "no_target", text: "No target date", next: ["set_target"] }]);
    expect(readiness({ ...base, target: null, plannedWeeks: [], owned: false })[0]!.next).toEqual(["ask_owner"]);
  });
  it("target before its last planned week", () => {
    expect(kinds({ target: "2026-11-13" })).toEqual(["target_before_planned"]);
    expect(readiness({ ...base, target: "2026-11-13" })[0]!.text).toBe("Target date before its last planned week");
  });
  it("target in N weeks, nothing planned after week X (only inside weeks 1 to 4)", () => {
    expect(readiness({ ...base, target: "2026-11-27", plannedWeeks: ["2026-11-09"] })).toEqual([{ kind: "gap_before_target", text: "Target in 3 weeks, nothing planned after week 2", next: ["plan_weeks"] }]);
    // Target after week 4 and planned through week 4: nothing to flag yet.
    expect(kinds({ target: "2026-12-30", plannedWeeks: ["2026-11-23"] })).toEqual([]);
    expect(readiness({ ...base, target: "2026-11-20", plannedWeeks: [] })[0]!.text).toBe("Target in 2 weeks, nothing planned");
  });
  it("stalled or blocked: ask the owner as a follow-up, or find help", () => {
    expect(readiness({ ...base, state: "stalled" })).toEqual([{ kind: "stalled", text: "Stalled", next: ["ask_owner", "help"] }]);
    expect(readiness({ ...base, state: "blocked" })).toEqual([{ kind: "blocked", text: "Blocked", next: ["ask_owner", "help"] }]);
  });
  it("crowded month and a target beyond the 12 weeks", () => {
    expect(readiness({ ...base, crowdedMonths: new Set(["2026-12"]) })).toEqual([{ kind: "crowded", text: "Crowded month", next: ["set_target"] }]);
    expect(kinds({ target: "2027-03-01", plannedWeeks: [] })).toEqual(["beyond"]);
    expect(readiness({ ...base, target: "2027-03-01", plannedWeeks: [] })[0]!.text).toBe("Target beyond 12 weeks");
  });
  it("needs more stories (blocks not filled by stories, as step 16.4)", () => {
    expect(readiness({ ...base, needsStories: true })).toEqual([{ kind: "needs_stories", text: "Needs more stories", next: ["breakdown", "brief"] }]);
  });
  it("done rows have none", () => expect(readiness({ ...base, state: "done", target: null, stories: 0 })).toEqual([]));
});
