// AH-6, BL-1: Backlog's one toolbar, pure: quick date ranges, the address round trip, where a control doesn't apply and
// why, the Showing line and its chips (only off the defaults), the Filter button's count, and every filter narrowing the
// Grid's rows, Needs attention's entries and the one-level list.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad, anAssignee } from "../test/builders/index.ts";
import { buildRows, DEFAULT_FILTERS, filterRows, fixGroups } from "./ahead-model.ts";
import { cleared, dateWords, filterCount, fromQuery, notHere, peopleWord, rangeDates, summary, toQuery, withQuery, type AheadModeKey, type Control } from "./ahead-view.ts";
import { backlogGroups } from "./backlog.ts";
import type { AheadFilters } from "./ahead-edit.ts";

const TODAY = "2026-11-02";
const me = { name: "Alex Rivera", email: "you@cooptimize.example" };
const items = [
  anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, assignee: me, target: "2026-12-18", start: "2026-11-02" }),
  // Under my epic: no target, unassigned (two gaps), not changed for 8 weeks.
  anAheadItem({ id: 110, parentId: 100, title: "Loyalty points", changedAt: "2026-09-07T10:00:00Z" }),
  anAheadItem({ id: 111, type: "User Story", level: "child", rung: 2, parentId: 110, assignee: me, size: 3 }),
  // Dated in two weeks, assigned, with a story: ready.
  anAheadItem({ id: 120, parentId: 100, title: "Store locator", assignee: me, start: "2026-11-09", target: "2026-11-13" }),
  anAheadItem({ id: 121, type: "User Story", level: "child", rung: 2, parentId: 120, assignee: me, size: 2 }),
  // Someone else's feature, dated in February.
  anAheadItem({ id: 200, title: "Supplier onboarding", assignee: anAssignee("Lee Park"), start: "2027-02-01", target: "2027-02-26" }),
];
const north = anAheadClient({ items });
const harbor = anAheadClient({ clientKey: "Harbor", clientName: "Harbor Health", items: [anAheadItem({ id: 900, title: "Claims portal", assignee: me })] });
const load = anAheadLoad([{ ...north, editable: items.map((i) => i.id) }, { ...harbor, editable: [900] }], { today: TODAY });
const all = (f: Partial<AheadFilters> = {}): AheadFilters => ({ ...DEFAULT_FILTERS, owner: { Northwind: "all", Harbor: "all" }, ...f });
const kept = (f: AheadFilters) => {
  const c = load.clients[0]!;
  return filterRows(buildRows(load, c), c, f, { stories: true, today: TODAY, staleWeeks: 6 }).filter((r) => !r.context).map((r) => r.item.id);
};

describe("AH-6: dates", () => {
  it("quick picks read against today; This quarter is the calendar quarter; a pick wins over from and to", () => {
    expect(rangeDates({ range: "next2", from: null, to: null }, TODAY)).toEqual({ from: TODAY, to: "2026-11-15" });
    expect(rangeDates({ range: "next4", from: "2026-01-01", to: null }, TODAY)).toEqual({ from: TODAY, to: "2026-11-29" });
    expect(rangeDates({ range: "quarter", from: null, to: null }, TODAY)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(rangeDates({ from: null, to: null }, TODAY)).toBeNull();
    expect(dateWords({ from: "2026-11-09", to: "2027-01-08" }, TODAY)).toBe("Nov 9 to Jan 8, 2027");
    expect(dateWords({ from: null, to: null }, TODAY)).toBe("Any time");
  });
  it("Next 2 weeks keeps what overlaps it; Any time keeps everything", () => {
    expect(kept(all({ range: "next2" }))).toEqual([100, 120]);
    // BL-1: siblings in the backlog's order (with no order field, by target date, the undated last).
    expect(kept(all())).toEqual([100, 120, 121, 110, 111, 200]);
  });
});

describe("BL-1: Needs attention, the kinds and Stale", () => {
  const fix = (f: AheadFilters) => fixGroups(load, { readOnly: false, f, staleWeeks: 6 });
  const ids = (f: AheadFilters) => fix(f)[0]!.group.entries.map((e) => e.itemId).sort();
  it("Needs attention isn't a row rule: the tree keeps every row, and Needs attention is the fix list", () => {
    expect(kept(all({ gaps: true }))).toEqual(kept(all()));
    // 110 (no target, unassigned, stale) is a feature under my epic. 200 needs stories but is out: no backlog order
    // to be near the top of, dated in February and not mine (Needs attention shows less, AH-3's candidates).
    expect(ids(all({ gaps: true }))).toEqual([110]);
  });
  it("a kind narrows to entries with that gap; Stale to stale entries; together either one", () => {
    expect(ids(all({ gaps: true, kinds: ["needs_stories"] }))).toEqual([]);
    expect(ids(all({ gaps: true, kinds: ["no_dates"] }))).toEqual([110]);
    expect(ids(all({ gaps: true, kinds: ["unsized"] }))).toEqual([]);
    expect(ids(all({ gaps: true, kinds: ["unassigned"] }))).toEqual([110]);
    expect(ids(all({ gaps: true, stale: true }))).toEqual([110]);
    expect(ids(all({ gaps: true, stale: true, kinds: ["needs_stories"] }))).toEqual([110]);
    expect(fix(all({ gaps: true, kinds: ["unassigned"] }))[0]!.group.entries[0]!.action).toBe("no_dates");
  });
  it("Stale is a reason of its own: open, editable and untouched for the person's weeks", () => {
    const e = fix(all({ gaps: true }))[0]!.group.entries.find((x) => x.itemId === 110)!;
    expect(e.stale).toBeTruthy();
    // With a longer window it isn't stale.
    const later = fixGroups(load, { readOnly: false, f: all({ gaps: true, stale: true }), staleWeeks: 20 })[0]!.group.entries;
    expect(later).toEqual([]);
  });
  it("the count by kind is counted before the kinds narrow it; clients and search narrow it; the total is before filters", () => {
    const before = fix(all());
    expect(before.map((g) => g.client.clientKey)).toEqual(["Northwind", "Harbor"]);
    const narrowed = fix(all({ gaps: true, kinds: ["unsized"] }))[0]!;
    expect(narrowed.unkinded.length).toBe(before[0]!.unkinded.length);
    expect(fix(all({ clients: ["Harbor"] })).map((g) => g.client.clientKey)).toEqual(["Harbor"]);
    const searched = fix(all({ q: "loyalty" }))[0]!;
    expect(searched.group.entries.map((e) => e.itemId)).toEqual([110]);
    expect(searched.total).toBe(before[0]!.group.entries.length);
  });
});

describe("BL-1: one level as a list (was Ahead's Backlog mode)", () => {
  const rows = (f: AheadFilters) => backlogGroups(load, { ...f, tier: f.flat ?? "feature" }, { staleWeeks: 6 })[0]!.rows;
  it("one level only, flat, each row with its rank in the client's own backlog", () => {
    const r = rows(all({ flat: "feature" }));
    expect(r.every((x) => x.tier === "feature")).toBe(true);
    expect(r.map((x) => x.item.id)).toEqual(expect.arrayContaining([110, 120, 200]));
    expect(r.map((x) => x.rank)).toEqual([...r.map((x) => x.rank)].sort((a, b) => a - b));
    expect(rows(all({ flat: "story" })).map((x) => x.item.id).sort()).toEqual([111, 121]);
  });
  it("every other filter narrows it: search, dates, epic", () => {
    const ids = (f: AheadFilters) => rows(f).map((x) => x.item.id);
    expect(ids(all({ flat: "feature", q: "#200" }))).toEqual([200]);
    expect(ids(all({ flat: "feature", range: "next2" }))).toEqual([120]);
    expect(ids(all({ flat: "feature", epic: "Northwind:100" }))).toEqual(expect.arrayContaining([110, 120]));
    expect(ids(all({ flat: "feature", epic: "Northwind:100" }))).not.toContain(200);
  });
  it("the address carries it as fl and leaves out a level it doesn't know", () => {
    expect(toQuery({ f: all({ flat: "story" }), level: "story", callouts: true })).toContain("fl=story");
    expect(fromQuery("fl=story")!.f.flat).toBe("story");
    expect(fromQuery("fl=task")!.f.flat).toBeUndefined();
  });
});

describe("AH-6: the address", () => {
  it("round-trips every filter, the level and Show callouts, naming only what isn't a default", () => {
    const f = all({ clients: ["Northwind"], epic: "Northwind:100", range: "next4", gaps: true, kinds: ["needs_stories", "unsized"], stale: true, q: "loyalty points", whole: true });
    const q = toQuery({ f, level: "epic", callouts: false });
    const back = fromQuery(q)!;
    expect(withQuery(DEFAULT_FILTERS, DEFAULT_FILTERS, back)).toEqual({ ...DEFAULT_FILTERS, ...f });
    expect([back.level, back.callouts]).toEqual(["epic", false]);
    expect(toQuery({ f: DEFAULT_FILTERS, level: "story", callouts: true })).toBe("");
    expect(fromQuery("")).toBeNull();
    // Custom dates instead of a quick pick.
    expect(fromQuery(toQuery({ f: all({ from: "2026-11-09", to: "2026-12-04" }), level: "story", callouts: true }))!.f).toMatchObject({ from: "2026-11-09", to: "2026-12-04" });
  });
  it("leaves out what it can't read, never failing", () => {
    expect(fromQuery("r=soon&from=2026-02-30&l=task&k=bogus,unsized&o=Northwind~nobody&c=a%20b")).toEqual({ f: { kinds: ["unsized"], owner: {}, clients: [] } });
  });
  it("a link with no filters keeps mine", () => {
    const mine = all({ q: "x" });
    expect(withQuery(mine, DEFAULT_FILTERS, fromQuery("l=epic"))).toBe(mine);
  });
});

describe("AH-6, BL-1: where a control applies", () => {
  const modes: AheadModeKey[] = ["grid", "gantt"];
  const controls: Control[] = ["clients", "people", "epic", "dates", "attention", "search", "level", "callouts", "whole"];
  it("every filter applies in both views; callouts only on the Gantt; the whole project only when something is out of scope", () => {
    const off = modes.flatMap((m) => controls.filter((c) => notHere(m, c, { scoped: true, whole: false })).map((c) => `${m}:${c}`));
    expect(off).toEqual(["grid:callouts"]);
    expect(notHere("grid", "whole", { scoped: false, whole: false })).toMatch(/already the whole project/);
    expect(notHere("grid", "whole", { scoped: false, whole: true })).toBeNull();
  });
});

describe("BL-1: the Showing line and the Filter button", () => {
  const clients = load.clients.map((c) => ({ clientKey: c.clientKey, clientName: c.clientName, lead: c.lead }));
  it("nothing at the defaults: no line at all", () => {
    expect(summary(clients, DEFAULT_FILTERS, { today: TODAY, shown: 7, total: 7 })).toBeNull();
  });
  it("Showing N of M with a chip per filter off its default, each clearing only itself", () => {
    const f = all({ clients: ["Northwind"], range: "next4", gaps: true, kinds: ["needs_stories"] });
    const s = summary(clients, f, { today: TODAY, shown: 3, total: 7 })!;
    expect(s.text).toBe("Showing 3 of 7");
    expect(s.chips.map((c) => c.label)).toEqual(["Northwind Foods", "People: Everyone", "Needs attention", "Needs stories", "Next 4 weeks"]);
    const noDates = s.chips.find((c) => c.id === "dates")!.clear(f);
    expect([noDates.range, noDates.kinds, noDates.clients, noDates.gaps]).toEqual([undefined, ["needs_stories"], ["Northwind"], true]);
    // Clearing Needs attention clears its kinds too.
    const noAttention = s.chips.find((c) => c.id === "attention")!.clear(f);
    expect([noAttention.gaps, noAttention.kinds]).toEqual([false, undefined]);
  });
  it("one chip per meaning: Stale and the one-level list read once, and the line says all when nothing is hidden", () => {
    const s = summary(clients, all({ stale: true, flat: "story", q: "pay" }), { today: TODAY, shown: 7, total: 7 })!;
    expect(s.text).toBe("Showing all 7");
    const labels = s.chips.map((c) => c.label);
    expect(labels).toEqual(["People: Everyone", "Stale", "Stories only, in rank order", "“pay”"]);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("the Filter button counts what's off its default inside it: Epic, Dates, the level, one level as a list", () => {
    expect(filterCount(DEFAULT_FILTERS, "story")).toBe(0);
    expect(filterCount({ ...DEFAULT_FILTERS, epic: "Northwind:100" }, "story")).toBe(1);
    expect(filterCount({ ...DEFAULT_FILTERS, range: "next2" }, "feature")).toBe(2);
    expect(filterCount({ ...DEFAULT_FILTERS, from: "2026-11-09", flat: "story" }, "epic")).toBe(3);
  });
  it("People never reads Mixed: it names who gets what", () => {
    const f = all({ owner: { Northwind: "all", Harbor: "mine" } });
    const p = peopleWord(f, clients);
    expect(p.owner).toBeNull();
    expect(p.word).not.toMatch(/mixed/i);
    expect(p.word).toMatch(/Harbor Health|Northwind Foods/);
    expect(peopleWord(all(), clients)).toEqual({ word: "Everyone", owner: "all" });
  });
  it("Clear filters puts back every default and keeps Show the whole project", () => {
    expect(cleared(all({ q: "x", whole: true, stale: true, flat: "story" }), DEFAULT_FILTERS)).toEqual({ ...DEFAULT_FILTERS, whole: true });
  });
});
