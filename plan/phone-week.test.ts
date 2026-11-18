// PH-2: the tile's line on the phone's Week, one test per state and for the order when two apply.
import { describe, expect, it } from "vitest";
import { firstThing, promisesLine, tileLine, TILE_ORDER, type TileFacts } from "./phone-week.ts";

const block = (o: Partial<TileFacts> = {}): TileFacts => ({
  start: "2026-11-03T14:00:00Z",
  end: "2026-11-03T17:30:00Z",
  now: "2026-11-03T12:00:00Z",
  past: false,
  atRisk: null,
  done: 0,
  notDone: 0,
  ...o,
});
const during = "2026-11-03T15:00:00Z";
const after = "2026-11-03T18:00:00Z";

describe("tileLine: each state", () => {
  it("under way: Now, then what follows", () => {
    expect(tileLine(block({ now: during, notDone: 2 }))).toEqual({ state: "now", text: "Now · 2 to-dos" });
    expect(tileLine(block({ now: during }))).toEqual({ state: "now", text: "Now · Nothing planned" });
  });
  it("at risk, with the card's short reason", () => {
    expect(tileLine(block({ atRisk: { short: "Dentist 12:00" }, notDone: 1 }))).toEqual({ state: "at_risk", text: "At risk · Dentist 12:00" });
    expect(tileLine(block({ atRisk: { short: null } })).text).toBe("At risk");
  });
  it("ended with to-dos not done", () => {
    expect(tileLine(block({ now: after, done: 1, notDone: 2 }))).toEqual({ state: "not_done", text: "1 done · 2 not done" });
    expect(tileLine(block({ now: after, notDone: 1 })).text).toBe("1 not done");
  });
  it("how many to do or done", () => {
    expect(tileLine(block({ notDone: 3 }))).toEqual({ state: "counts", text: "3 to-dos" });
    expect(tileLine(block({ notDone: 1 })).text).toBe("1 to-do");
    expect(tileLine(block({ done: 1, notDone: 2 })).text).toBe("1 of 3 to-dos done");
    expect(tileLine(block({ now: after, done: 3 }))).toEqual({ state: "counts", text: "3 done" });
  });
  it("nothing planned on a block still to come", () => {
    expect(tileLine(block())).toEqual({ state: "nothing", text: "Nothing planned" });
  });
});

describe("tileLine: the order when two apply", () => {
  it("lists the states in the decided order", () => expect(TILE_ORDER).toEqual(["now", "at_risk", "not_done", "counts", "nothing"]));
  it("under way and at risk: Now first, then the risk", () => {
    expect(tileLine(block({ now: during, atRisk: { short: "Standup 3:00" }, notDone: 2 })).text).toBe("Now · At risk · Standup 3:00");
  });
  it("at risk and ended with to-dos not done: at risk wins", () => {
    expect(tileLine(block({ now: after, atRisk: { short: "Dentist 12:00" }, notDone: 2 })).state).toBe("at_risk");
  });
  it("a day before today never says At risk or Now, as its card doesn't", () => {
    expect(tileLine(block({ past: true, now: after, atRisk: { short: "Dentist 12:00" }, notDone: 2 })).state).toBe("not_done");
    expect(tileLine(block({ past: true, now: during })).state).toBe("nothing");
  });
  it("ended with to-dos not done beats the counts", () => {
    expect(tileLine(block({ now: after, done: 2, notDone: 1 })).state).toBe("not_done");
  });
});

describe("firstThing and promisesLine", () => {
  const clock = (iso: string) => iso.slice(11, 16);
  it("says the first thing with its time, then how many more", () => {
    expect(firstThing([], clock)).toBeNull();
    expect(firstThing([{ title: "Deploy", start: "2026-11-04T19:00:00Z" }], clock)).toBe("19:00 Deploy");
    expect(firstThing([{ title: "Notes", start: null }, { title: "Deploy", start: "2026-11-04T19:00:00Z" }, { title: "Call", start: "2026-11-04T20:00:00Z" }], clock)).toBe("19:00 Deploy · 2 more");
    expect(firstThing([{ title: "Notes", start: null }], clock)).toBe("Notes");
  });
  it("uses the due badge's words, with a count past one", () => {
    expect(promisesLine(0, "Due today")).toBeNull();
    expect(promisesLine(1, "Due today")).toBe("Due today");
    expect(promisesLine(2, "Due Fri")).toBe("Due Fri · 2");
  });
});
