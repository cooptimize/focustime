// SG-1: the board's suggestion rule.
import { describe, expect, it } from "vitest";
import { aClient, aClientWork, aFeature, aFocusBlock, aPick, aPto, aWeek, aWorkItem } from "../test/builders/index.ts";
import { boardSuggestions, byBlock, clearKey, MAX_PER_BLOCK, nextWorkDay, todoKey, validClearKey, type SuggestInput } from "./boardsuggest.ts";
import { DEFAULT_SIZE_SCALE } from "./estimate.ts";
import type { ClientWork, Week } from "../week/types.ts";

const ADATUM = aClient({ name: "Adatum" });
const FABRIKAM = aClient({ name: "Fabrikam" });
const MON = "2026-11-02", TUE = "2026-11-03", WED = "2026-11-04", THU = "2026-11-05", FRI = "2026-11-06";
/** Tuesday 9:30 in New York. */
const TUE_930 = "2026-11-03T14:30:00Z";

/** Adatum every morning Mon to Thu, Fabrikam every afternoon Mon to Thu. */
const patterns = [aFocusBlock({ client: ADATUM, days: { Mon: "AM", Tue: "AM", Wed: "AM", Thu: "AM" } }), aFocusBlock({ client: FABRIKAM, days: { Mon: "PM", Tue: "PM", Wed: "PM", Thu: "PM" } })];

function input(o: Partial<SuggestInput> & { week?: Week; work?: ClientWork[] } = {}): SuggestInput {
  const week = o.week ?? aWeek({ patterns });
  const work = o.work ?? [];
  const { week: _w, work: _k, ...rest } = o;
  return {
    on: true,
    now: TUE_930,
    today: TUE,
    nextWorkDay: nextWorkDay(week.days, rest.today ?? TUE),
    days: week.days,
    weekPicks: [],
    unfinished: [],
    work: (k) => work.find((w) => w.clientKey === k),
    cleared: new Set(),
    sizes: DEFAULT_SIZE_SCALE,
    ...rest,
  };
}
const stories = (n: number, o: Partial<Parameters<typeof aWorkItem>[0]> = {}) => Array.from({ length: n }, (_, i) => aWorkItem({ id: 500 + i, title: `Story ${i + 1}`, order: i + 1, ...o }));
const adatumWork = (items = stories(3)) => aClientWork({ clientKey: "adatum", clientName: "Adatum", items });
const where = (list: ReturnType<typeof boardSuggestions>) => [...byBlock(list)].map(([k, v]) => [k, v.map((s) => s.itemId ?? s.pickId)]);

describe("which blocks", () => {
  it("today's and the next working day's empty blocks, and no others", () => {
    const list = boardSuggestions(input({ work: [adatumWork(stories(10)), aClientWork({ clientKey: "fabrikam", clientName: "Fabrikam", items: stories(10).map((x) => ({ ...x, id: x.id + 400 })) })] }));
    expect([...new Set(list.map((s) => `${s.at.date}:${s.at.half}`))]).toEqual([`${TUE}:AM`, `${TUE}:PM`, `${WED}:AM`, `${WED}:PM`]);
  });
  it("a block that has ended gets none", () => {
    const list = boardSuggestions(input({ now: "2026-11-03T18:00:00Z", work: [adatumWork()] })); // Tue 1:00 PM
    expect(list.some((s) => s.at.date === TUE && s.at.half === "AM")).toBe(false);
    expect(list.some((s) => s.at.date === WED && s.at.half === "AM")).toBe(true);
  });
  it("an Open half-day gets none", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: ADATUM, days: { Wed: "AM" } })] });
    const list = boardSuggestions(input({ week, work: [adatumWork()] }));
    expect(week.days.find((d) => d.date === TUE)!.am.open).toBe(true);
    expect(list.every((s) => s.at.date === WED && s.at.half === "AM")).toBe(true);
  });
  it("a block with a to-do on it gets none; a block with only to-dos kept from suggestions keeps the rest", () => {
    const mine = aPick({ id: 77, date: TUE, half: "AM", clientKey: "adatum", itemId: null, kind: "intention" });
    expect(boardSuggestions(input({ weekPicks: [mine], work: [adatumWork()] })).some((s) => s.at.date === TUE && s.at.half === "AM")).toBe(false);
    const kept = aPick({ id: 78, date: TUE, half: "AM", clientKey: "adatum", itemId: 500, size: "S" });
    const left = boardSuggestions(input({ weekPicks: [kept], kept: new Set([78]), work: [adatumWork()] })).filter((s) => s.at.date === TUE && s.at.half === "AM");
    expect(left.map((s) => s.itemId)).toEqual([501, 502]);
  });
  it("a block busy with a placed feature or a check-in gets none", () => {
    const list = boardSuggestions(input({ busy: (d, h) => d === TUE && h === "AM", work: [adatumWork()] }));
    expect(list.some((s) => s.at.date === TUE && s.at.half === "AM")).toBe(false);
  });
  it("off: nothing at all", () => {
    expect(boardSuggestions(input({ on: false, work: [adatumWork()] }))).toEqual([]);
  });
});

describe("the next working day", () => {
  it("skips a PTO day and a day with no working hours", () => {
    const week = aWeek({ patterns, pto: [aPto({ date: WED })] });
    expect(nextWorkDay(week.days, TUE)).toBe(THU);
  });
  it("skips a holiday (no working hours that day)", () => {
    const base = aWeek({ patterns });
    const days = base.days.map((d) => (d.date === WED ? { ...d, am: { ...d.am, off: true }, pm: { ...d.pm, off: true } } : d));
    expect(nextWorkDay(days, TUE)).toBe(THU);
  });
  it("Friday's catch-up has no focus block, so Thursday's next working day is the next week's", () => {
    const week = aWeek({ patterns });
    expect(nextWorkDay(week.days, THU)).toBeNull();
    const next = aWeek({ patterns, weekStart: "2026-11-09" });
    expect(nextWorkDay([...week.days, ...next.days], THU)).toBe("2026-11-09");
  });
  it("Thursday suggests into Monday when Monday is in the days given", () => {
    const next = aWeek({ patterns, weekStart: "2026-11-09" });
    const list = boardSuggestions(input({ week: next, today: THU, now: "2026-11-05T14:30:00Z", nextWorkDay: "2026-11-09", work: [adatumWork()] }));
    expect(list.every((s) => s.at.date === "2026-11-09")).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("what, in order", () => {
  it("unfinished to-dos first, then the backlog in its order, with target dates in this week lifted", () => {
    const items = [aWorkItem({ id: 501, order: 1 }), aWorkItem({ id: 502, order: 2, targetDate: FRI }), aWorkItem({ id: 503, order: 3 })];
    const unfinished = [aPick({ id: 40, date: MON, half: "AM", clientKey: "adatum", itemId: null, kind: "intention", title: "Call the vendor", size: "S" })];
    const list = boardSuggestions(input({ unfinished, weekPicks: unfinished, work: [adatumWork(items)] })).filter((s) => s.at.date === TUE && s.at.half === "AM");
    expect(list.map((s) => s.pickId ?? s.itemId)).toEqual([40, 502, 501]);
    expect(list.map((s) => s.reason)).toEqual(["Unfinished from Mon", "Target date Fri", "Next in Adatum's backlog"]);
  });
  it("a story's feature's target date lifts it too, and an earlier target date counts", () => {
    const f = aFeature({ id: 10, order: 1, targetDate: "2026-10-30", assignedToMe: false });
    const items = [aWorkItem({ id: 501, order: 1 }), aWorkItem({ id: 502, order: 2, parentId: 10 })];
    const list = boardSuggestions(input({ work: [adatumWork([f, ...items])] })).filter((s) => s.at.date === TUE && s.at.half === "AM");
    expect(list[0]!.itemId).toBe(502);
    expect(list[0]!.reason).toBe("Target date Oct 30");
  });
  it("a feature of mine with no stories is offered once, as itself, marked Needs breakdown", () => {
    const f = aFeature({ id: 10, order: 1, title: "Loyalty points" });
    const list = boardSuggestions(input({ work: [aClientWork({ clientKey: "adatum", clientName: "Adatum", items: [f] })] }));
    const mine = list.filter((s) => s.itemId === 10);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "feature", needsBreakdown: true, reason: "Needs breakdown" });
  });
  it("never: anything placed this week, done or closed, cleared, or another client's", () => {
    const items = [aWorkItem({ id: 501, order: 1 }), aWorkItem({ id: 502, order: 2, stateCategory: "Completed", state: "Closed" }), aWorkItem({ id: 503, order: 3 }), aWorkItem({ id: 504, order: 4 }), aWorkItem({ id: 505, order: 5 })];
    const placed = aPick({ date: THU, half: "AM", clientKey: "adatum", itemId: 501 });
    const unfinishedDone = aPick({ id: 41, date: MON, clientKey: "adatum", itemId: 503 });
    const fabrikamLeft = aPick({ id: 42, date: MON, half: "PM", clientKey: "fabrikam", itemId: null, kind: "intention" });
    const list = boardSuggestions(input({
      weekPicks: [placed, unfinishedDone, fabrikamLeft],
      unfinished: [unfinishedDone, fabrikamLeft],
      resolved: (k, id) => k === "adatum" && id === 503,
      cleared: new Set([clearKey({ scope: "item", date: TUE, key: "iadatum:504" })]),
      work: [adatumWork(items)],
    }));
    const adatum = list.filter((s) => s.at.half === "AM");
    expect(adatum.map((s) => s.itemId)).toEqual([505]);
    expect(list.filter((s) => s.at.half === "PM").map((s) => s.pickId)).toEqual([42]);
    expect(list.every((s) => (s.at.half === "AM" ? s.clientKey === "adatum" : s.clientKey === "fabrikam"))).toBe(true);
  });
  it("one client's item never lands on another client's block (GD-2)", () => {
    const fab = aClientWork({ clientKey: "fabrikam", clientName: "Fabrikam", items: [aWorkItem({ id: 900, order: 1 })] });
    const list = boardSuggestions(input({ work: [adatumWork(), fab] }));
    for (const s of list) expect(s.clientKey).toBe(s.at.half === "AM" ? "adatum" : "fabrikam");
  });
  it("a person with nothing assigned gets nothing", () => {
    expect(boardSuggestions(input())).toEqual([]);
  });
});

describe("how many", () => {
  it("as many as fit the free time, at most four", () => {
    // Tuesday AM 9:30 to 12:30: 3 hours left; unsized counts 1h (SZ-1).
    const list = boardSuggestions(input({ work: [adatumWork(stories(10))] }));
    expect(list.filter((s) => s.at.date === TUE && s.at.half === "AM")).toHaveLength(3);
    // Wednesday AM 9:00 to 12:30: 3h 30m, so 3.
    expect(list.filter((s) => s.at.date === WED && s.at.half === "AM")).toHaveLength(3);
    const lots = boardSuggestions(input({ sizes: { ...DEFAULT_SIZE_SCALE, unsized: 30 }, work: [adatumWork(stories(10))] }));
    expect(lots.filter((s) => s.at.date === WED && s.at.half === "AM")).toHaveLength(MAX_PER_BLOCK);
  });
  it("at least one, even when the first is larger than the block", () => {
    const big = [aPick({ id: 50, date: MON, clientKey: "adatum", itemId: null, kind: "intention", size: "L", remainingMinutes: 600 })];
    const list = boardSuggestions(input({ unfinished: big, weekPicks: big, work: [adatumWork()] })).filter((s) => s.at.date === TUE && s.at.half === "AM");
    expect(list.map((s) => s.pickId)).toEqual([50]);
  });
  it("one, when there is only one", () => {
    const list = boardSuggestions(input({ work: [adatumWork(stories(1))] }));
    expect(where(list)).toEqual([[`${TUE}:AM`, [500]]]);
  });
  it("a block with no free time still gets one", () => {
    const week = aWeek({ patterns, events: [] });
    const days = week.days.map((d) => (d.date === TUE ? { ...d, am: { ...d.am, freeGaps: [] } } : d));
    const list = boardSuggestions(input({ days, work: [adatumWork()] })).filter((s) => s.at.date === TUE && s.at.half === "AM");
    expect(list).toHaveLength(1);
  });
});

describe("no repeats", () => {
  it("the same item is never on two blocks; earlier blocks choose first", () => {
    const list = boardSuggestions(input({ work: [adatumWork(stories(4))] }));
    expect(where(list)).toEqual([
      [`${TUE}:AM`, [500, 501, 502]],
      [`${WED}:AM`, [503]],
    ]);
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length);
  });
  it("300 open stories: still four at most a block, in backlog order", () => {
    const list = boardSuggestions(input({ sizes: { ...DEFAULT_SIZE_SCALE, unsized: 30 }, work: [adatumWork(stories(300))] }));
    expect(list.filter((s) => s.at.half === "AM").map((s) => s.itemId)).toEqual([500, 501, 502, 503, 504, 505, 506, 507]);
  });
});

describe("clearing", () => {
  const work = [adatumWork(stories(10))];
  it("a row: not again that week, on any block", () => {
    const list = boardSuggestions(input({ work, cleared: new Set([clearKey({ scope: "item", date: TUE, key: "iadatum:500" })]) }));
    expect(list.some((s) => s.itemId === 500)).toBe(false);
    // Another week isn't affected.
    expect(clearKey({ scope: "item", date: TUE, key: "iadatum:500" })).not.toBe(clearKey({ scope: "item", date: "2026-11-09", key: "iadatum:500" }));
  });
  it("a block: none there that day; its items move on to the next block", () => {
    const list = boardSuggestions(input({ work, cleared: new Set([clearKey({ scope: "block", date: TUE, half: "AM" })]) }));
    expect(list.some((s) => s.at.date === TUE && s.at.half === "AM")).toBe(false);
    expect(list.filter((s) => s.at.date === WED && s.at.half === "AM")[0]!.itemId).toBe(500);
  });
  it("a day: none of its blocks", () => {
    const list = boardSuggestions(input({ work, cleared: new Set([clearKey({ scope: "day", date: TUE })]) }));
    expect(list.every((s) => s.at.date === WED)).toBe(true);
  });
  it("undo is the key going away: the suggestions come back", () => {
    const cleared = new Set([clearKey({ scope: "day", date: TUE })]);
    expect(boardSuggestions(input({ work, cleared })).some((s) => s.at.date === TUE)).toBe(false);
    cleared.delete(clearKey({ scope: "day", date: TUE }));
    expect(boardSuggestions(input({ work, cleared })).some((s) => s.at.date === TUE)).toBe(true);
  });
  it("the server accepts only these keys", () => {
    expect(validClearKey(clearKey({ scope: "item", date: TUE, key: "iadatum:500" }))).toBe(true);
    expect(validClearKey(clearKey({ scope: "item", date: TUE, key: "p12" }))).toBe(true);
    expect(validClearKey(clearKey({ scope: "block", date: TUE, half: "PM" }))).toBe(true);
    expect(validClearKey(clearKey({ scope: "day", date: TUE }))).toBe(true);
    expect(validClearKey("day:tomorrow")).toBe(false);
    expect(validClearKey("item:2026-11-02:x; DROP")).toBe(false);
  });
});

describe("keys", () => {
  it("a plain to-do is its own key; work has the panel's", () => {
    expect(todoKey(aPick({ id: 9, itemId: null, kind: "intention" }))).toBe("p9");
    expect(todoKey(aPick({ id: 9, itemId: 12, clientKey: "adatum" }))).toBe("iadatum:12");
  });
  it("an unfinished to-do from the week before says its date", () => {
    const old = [aPick({ id: 60, date: "2026-10-29", clientKey: "adatum", itemId: null, kind: "intention" })];
    const list = boardSuggestions(input({ unfinished: old, work: [adatumWork()] }));
    expect(list[0]!.reason).toBe("Unfinished from Oct 29");
  });
});
