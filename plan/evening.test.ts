// WK-3: the Evening band under a weekday's PM, and a weekend column's rows.
import { describe, expect, it } from "vitest";
import { aDeployment, aMeeting, aPick, aWeek } from "../test/builders/index.ts";
import { eveningBand, shapeEnd, weekendRows } from "./evening.ts";

const FRI = "2026-11-06";
const SAT = "2026-11-07";

describe("the Evening band", () => {
  it("is hidden on a weekday with nothing after its day shape", () => {
    const w = aWeek();
    const mon = w.days.find((d) => d.date === "2026-11-02")!;
    expect(eveningBand(mon, w, [aPick({ date: "2026-11-02", half: "PM" })])).toBeNull();
  });

  it("holds Friday's 7 PM deployment and evening meeting, in time order, after the shape's end", () => {
    const w = aWeek({ events: [aMeeting({ title: "Late call", start: `${FRI}T20:00`, end: `${FRI}T20:30` })] });
    const fri = w.days.find((d) => d.date === FRI)!;
    expect(shapeEnd(fri, w)).toBe("17:00");
    const late = aDeployment({ date: FRI, window: { start: "21:00", end: "22:00" } });
    const early = aDeployment({ date: FRI, window: { start: "19:00", end: "21:00" } });
    const inside = aDeployment({ date: FRI, half: "PM", window: { start: "14:00", end: "15:00" } });
    const b = eveningBand(fri, w, [late, early, inside])!;
    expect(b.picks.map((p) => p.id)).toEqual([early.id, late.id]);
    expect(b.events.map((e) => e.title)).toEqual(["Late call"]);
  });

  it("holds a to-do put in the evening (half EVE), and leaves out moved and dropped ones", () => {
    const w = aWeek();
    const tue = w.days.find((d) => d.date === "2026-11-03")!;
    const eve = aPick({ date: "2026-11-03", half: "EVE" });
    const b = eveningBand(tue, w, [eve, aPick({ date: "2026-11-03", half: "EVE", status: "moved" }), aPick({ date: "2026-11-03", half: "EVE", status: "dropped" })]);
    expect(b?.picks.map((p) => p.id)).toEqual([eve.id]);
  });

  it("never shows on a weekend day", () => {
    const w = aWeek({ events: [aMeeting({ start: `${SAT}T19:00`, end: `${SAT}T20:00` })] });
    const sat = w.days.find((d) => d.date === SAT)!;
    expect(sat.kind).toBe("weekend");
    expect(eveningBand(sat, w, [aDeployment()])).toBeNull();
  });
});

describe("a weekend column's rows", () => {
  it("lists its events, its to-dos by window and the promises due that day", () => {
    const w = aWeek({ events: [aMeeting({ title: "Cutover call", start: `${SAT}T08:30`, end: `${SAT}T09:00` })] });
    const sat = w.days.find((d) => d.date === SAT)!;
    const dep = aDeployment();
    const todo = aPick({ date: SAT, half: "AM" });
    const r = weekendRows(sat, [todo, dep, aPick({ date: FRI })], [{ due: SAT, id: 1 }, { due: FRI, id: 2 }]);
    expect(r.events.map((e) => e.title)).toEqual(["Cutover call"]);
    expect(r.picks.map((p) => p.id)).toEqual([dep.id, todo.id]);
    expect(r.due.map((f) => f.id)).toEqual([1]);
  });
});
