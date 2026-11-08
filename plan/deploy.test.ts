// WK-3 (DP-0): Deployment to-dos: the window rule, where a window sits, the after-hours count and the "it's deployed"
// draft.
import { describe, expect, it } from "vitest";
import { aDeployment, aPick, aWeekConfig, WEEK } from "../test/builders/index.ts";
import { hoursOn } from "../week/hours.ts";
import { weekDates7 } from "../week/dates.ts";
import { afterHours, afterHoursText, deployedText, windowHalf, windowProblem, windowText } from "./deploy.ts";
import { pickNeed, SIZE_MINUTES } from "./types.ts";

const model = aWeekConfig().hours;
const dates = weekDates7(WEEK);
const count = (picks: Parameters<typeof afterHours>[0]["picks"], more: Partial<Parameters<typeof afterHours>[0]> = {}) =>
  afterHours({ model, dates, picks, minutesOf: (p) => pickNeed(p, SIZE_MINUTES), ...more });

describe("a deployment's window", () => {
  it("needs a start and an end on one day, 15 minutes to 16 hours", () => {
    expect(windowProblem(null)).toMatch(/needs a start and an end/);
    expect(windowProblem({ start: "19:00" })).toMatch(/needs a start and an end/);
    expect(windowProblem({ start: "7pm", end: "21:00" })).toMatch(/start must be a time/);
    expect(windowProblem({ start: "21:00", end: "19:00" })).toMatch(/end must be after the start/);
    expect(windowProblem({ start: "19:00", end: "19:10" })).toMatch(/at least 15 minutes/);
    expect(windowProblem({ start: "06:00", end: "23:00" })).toMatch(/at most 16 hours/);
    expect(windowProblem({ start: "19:00", end: "24:00" })).toBeNull();
    expect(windowProblem({ start: "09:00", end: "11:00" })).toBeNull();
  });

  it("reads as hours without a leading zero", () => {
    expect(windowText({ start: "09:00", end: "11:00" })).toBe("9:00–11:00");
    expect(windowText({ start: "19:00", end: "21:30" })).toBe("19:00–21:30");
  });

  it("sits in the morning, the afternoon or the evening of a working day, and the evening on a weekend", () => {
    const mon = hoursOn(model, "2026-11-02");
    expect(windowHalf(mon, { start: "10:00", end: "11:00" })).toBe("AM");
    expect(windowHalf(mon, { start: "14:00", end: "15:00" })).toBe("PM");
    expect(windowHalf(mon, { start: "17:00", end: "19:00" })).toBe("EVE");
    expect(windowHalf(hoursOn(model, "2026-11-07"), { start: "09:00", end: "11:00" })).toBe("EVE");
  });
});

describe("after-hours time this week", () => {
  it("counts a weekend deployment's whole window and a Friday evening one", () => {
    const r = count([aDeployment(), aDeployment({ date: "2026-11-06", window: { start: "19:00", end: "21:00" } })]);
    expect(r.minutes).toBe(240);
    expect(afterHoursText(r.minutes)).toBe("4h after hours this week");
  });

  it("counts only the part of a window outside the day shape, and nothing for one inside it", () => {
    expect(count([aDeployment({ date: "2026-11-03", half: "PM", window: { start: "14:00", end: "16:00" } })]).minutes).toBe(0);
    expect(count([aDeployment({ date: "2026-11-03", half: "PM", window: { start: "16:00", end: "18:30" } })]).minutes).toBe(90);
    expect(count([aDeployment({ date: "2026-11-03", half: "AM", window: { start: "07:00", end: "10:00" } })]).minutes).toBe(120);
  });

  it("counts a whole window on a PTO day", () => {
    expect(count([aDeployment({ date: "2026-11-03", half: "PM", window: { start: "14:00", end: "16:00" } })], { pto: new Set(["2026-11-03"]) }).minutes).toBe(120);
  });

  it("counts other to-dos I put in an evening or on a weekend: their timebox outside the shape, else their size", () => {
    const eve = aPick({ date: "2026-11-04", half: "EVE", size: "S" });
    const sat = aPick({ date: "2026-11-08", half: "AM", size: "L" });
    const boxed = aPick({ date: "2026-11-05", half: "EVE", size: "L" });
    const r = count([eve, sat, boxed, aPick({ date: "2026-11-04", half: "PM" })], { pickSpans: new Map([[boxed.id, { start: 16 * 60 + 30, end: 18 * 60 }]]) });
    expect(r.parts.map((p) => [p.why, p.minutes])).toEqual([["evening", 60], ["weekend", 240], ["evening", 60]]);
  });

  it("leaves out moved and dropped to-dos, other weeks and calendar events", () => {
    expect(count([aDeployment({ status: "moved" }), aDeployment({ status: "dropped" }), aDeployment({ date: "2026-11-14" })]).minutes).toBe(0);
    expect(count([aDeployment({ status: "done" })]).minutes).toBe(120);
  });

  it("counts FocusTime's own timeboxes without a to-do after the day's end or on a weekend", () => {
    const r = count([], { looseSpans: [{ date: "2026-11-02", title: "Prep", span: { start: 18 * 60, end: 19 * 60 } }, { date: "2026-11-02", title: "Work", span: { start: 10 * 60, end: 11 * 60 } }, { date: "2026-11-07", title: "Sat", span: { start: 600, end: 630 } }] });
    expect(r.minutes).toBe(90);
  });

  it("says nothing at zero", () => {
    expect(afterHoursText(0)).toBeNull();
    expect(afterHoursText(90)).toBe("1h 30m after hours this week");
    expect(afterHoursText(30)).toBe("30m after hours this week");
  });
});

describe("Tell <client> it's deployed", () => {
  it("drafts from the note and the items, by first name, with a sign-off", () => {
    const t = deployedText({ who: "Jordan Lee", clientName: "Northwind", title: "Release 4.2.", note: "code, SQL objects, the sales model", links: [{ id: 101, title: "Order sync" }, { id: 102, title: "Sales report " }], myName: "Sam Rivera" });
    expect(t).toBe(["Hi Jordan,", "", "Release 4.2 is deployed.", "", "What went: code, SQL objects, the sales model", "", "Items:", "- #101 Order sync", "- #102 Sales report", "", "Let me know if you see anything off.", "", "Sam"].join("\n"));
  });

  it("drafts a plain one without who, a note or items", () => {
    expect(deployedText({ who: null, clientName: "Northwind", title: "Deployment", note: null, links: [], myName: null })).toBe("Hi,\n\nDeployment is deployed.\n\nLet me know if you see anything off.");
  });
});
