// CV-3 (Q-CV2-6): promises on Week's Board rail: at their time (amber "was due" once past), and those overdue from an
// earlier day or with no time drawn once at "now" on today's block, never red.
import { describe, expect, it } from "vitest";
import { aDayPromise } from "../test/builders/index.ts";
import { wasDueText } from "./due.ts";
import { homeRail, lateOnCards, railMarks } from "./rail-promises.ts";

const TZ = "America/Chicago";
const TODAY = "2026-11-05";
const AM = { key: "2026-11-05|AM", start: "2026-11-05T14:00:00Z", end: "2026-11-05T18:00:00Z" }; // 8 AM to noon
const PM = { key: "2026-11-05|PM", start: "2026-11-05T18:30:00Z", end: "2026-11-05T23:00:00Z" };
const TUE_PM = { key: "2026-11-03|PM", start: "2026-11-03T18:30:00Z", end: "2026-11-03T23:00:00Z" };

describe("the Board rail's promises", () => {
  const earlier = aDayPromise({ id: 1, dueAt: "2026-11-03T20:00:00Z", dueDate: "2026-11-03", overdue: true });
  const dateOnly = aDayPromise({ id: 2, dueAt: null, dueDate: "2026-11-04", overdue: true });
  const thisMorning = aDayPromise({ id: 3, dueAt: "2026-11-05T15:00:00Z", dueDate: TODAY, overdue: true });
  const later = aDayPromise({ id: 4, dueAt: "2026-11-05T21:00:00Z", dueDate: TODAY, overdue: false });
  const all = [earlier, dateOnly, thisMorning, later];

  it("carries earlier and date-only overdue ones to now on the block under way, once, and keeps today's at their time", () => {
    const now = "2026-11-05T19:15:00Z";
    const home = homeRail([AM, PM], now);
    expect(home?.key).toBe(PM.key);
    // IB-1 slice 4: two carried ones stack a step apart (7% of the 4.5 h rail: 18 min 54 s), so their labels don't overlap.
    expect(railMarks(all, PM, { today: TODAY, now, home }).map((m) => [m.p.id, m.at, m.carried])).toEqual([
      [1, "2026-11-05T19:15:00.000Z", true],
      [2, "2026-11-05T19:33:54.000Z", true],
      [4, later.dueAt, false],
    ]);
    expect(railMarks(all, AM, { today: TODAY, now, home }).map((m) => m.p.id)).toEqual([3]);
    // Not on Tuesday's rail any more: drawn once.
    expect(railMarks(all, TUE_PM, { today: TODAY, now, home })).toEqual([]);
  });

  it("before the day starts, on today's first block (clamped to its top); after it ends, on the last", () => {
    expect(homeRail([PM, AM], "2026-11-05T12:00:00Z")?.key).toBe(AM.key);
    expect(railMarks([earlier], AM, { today: TODAY, now: "2026-11-05T12:00:00Z", home: AM })[0]!.at).toBe(AM.start.replace("Z", ".000Z"));
    expect(homeRail([AM, PM], "2026-11-06T02:00:00Z")?.key).toBe(PM.key);
  });

  it("a stack that would run past the rail's end moves up together, never above its start", () => {
    const many = [1, 2, 3, 4].map((id) => aDayPromise({ id, dueAt: null, dueDate: "2026-11-04", overdue: true }));
    const marks = railMarks(many, PM, { today: TODAY, now: "2026-11-05T22:50:00Z", home: PM });
    const ats = marks.map((m) => Date.parse(m.at));
    expect(ats.at(-1)).toBe(Date.parse(PM.end) - 60_000);
    for (let i = 1; i < ats.length; i++) expect(ats[i]! - ats[i - 1]!).toBe(0.07 * (Date.parse(PM.end) - Date.parse(PM.start)));
    const crowd = Array.from({ length: 20 }, (_, i) => aDayPromise({ id: i + 1, dueAt: null, dueDate: "2026-11-04", overdue: true }));
    const top = railMarks(crowd, PM, { today: TODAY, now: "2026-11-05T22:50:00Z", home: PM })[0]!;
    expect(Date.parse(top.at)).toBe(Date.parse(PM.start));
  });

  it("labels say when it was due, in words", () => {
    expect(wasDueText(earlier, TODAY, TZ)).toBe("Was due Tue, Nov 3");
    expect(wasDueText(thisMorning, TODAY, TZ)).toBe("Was due 9:00 AM");
  });
});

describe("UI-9: late promises counted on a card with no rail", () => {
  const AM_C = { ...AM, date: TODAY, clients: ["contoso"] };
  const PM_F = { ...PM, date: TODAY, clients: ["fabrikam"] };
  const TUE = { ...TUE_PM, date: "2026-11-03", clients: ["contoso"] };
  const rails = [AM_C, PM_F, TUE];
  const now = "2026-11-05T19:15:00Z"; // PM under way
  const keys = (m: Map<string, { id: number }[]>) => Object.fromEntries([...m].map(([k, v]) => [k, v.map((p) => p.id)]));

  it("uses the rail's placement, but only on a card booked for the promise's client", () => {
    const ps = [
      aDayPromise({ id: 1, clientKey: "contoso", dueAt: null, dueDate: "2026-11-04", overdue: true }), // carried: Contoso's block today (AM), not the PM under way
      aDayPromise({ id: 2, clientKey: "fabrikam", dueAt: null, dueDate: "2026-11-04", overdue: true }), // carried: Fabrikam's PM
      aDayPromise({ id: 3, clientKey: "contoso", dueAt: "2026-11-05T15:00:00Z", dueDate: TODAY, overdue: true }), // this morning, Contoso's AM
      aDayPromise({ id: 4, clientKey: "fabrikam", dueAt: "2026-11-05T15:00:00Z", dueDate: TODAY, overdue: true }), // this morning, but AM is Contoso's
      aDayPromise({ id: 5, clientKey: "contoso", dueAt: "2026-11-05T21:00:00Z", dueDate: TODAY, overdue: false }), // not late
      { ...aDayPromise({ id: 6, dueAt: null, dueDate: "2026-11-04", overdue: true }), clientKey: null }, // no client: no card
    ];
    expect(keys(lateOnCards(ps, rails, { today: TODAY, now }))).toEqual({ [AM.key]: [1, 3], [PM.key]: [2] });
  });

  it("a client with no block today has no card for its carried promises", () => {
    const p = aDayPromise({ id: 7, clientKey: "northwind", dueAt: null, dueDate: "2026-11-04", overdue: true });
    expect(lateOnCards([p], rails, { today: TODAY, now }).size).toBe(0);
  });
});
