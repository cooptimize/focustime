// AH-6: Ahead's one toolbar, pure: quick date ranges, the address round trip, where a control doesn't apply and why,
// the summary line and its chips, and every filter narrowing Grid's rows, Readiness's entries and Backlog's rows.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad, anAssignee } from "../test/builders/index.ts";
import { buildRows, DEFAULT_FILTERS, filterRows, fixGroups } from "./ahead-model.ts";
import { cleared, dateWords, fromQuery, notHere, rangeDates, summary, toQuery, withQuery, type AheadModeKey, type Control } from "./ahead-view.ts";
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
    expect(kept(all())).toEqual([100, 110, 111, 120, 121, 200]);
  });
});

describe("AH-6: readiness and Stale narrow every mode", () => {
  it("Not ready only, and a kind implies it", () => {
    // 110: no target, unassigned; 200: no stories.
    expect(kept(all({ gaps: true }))).toEqual([110, 200]);
    expect(kept(all({ kinds: ["needs_stories"] }))).toEqual([200]);
    expect(kept(all({ kinds: ["unsized"] }))).toEqual([]);
    expect(kept(all({ kinds: ["unassigned"] }))).toEqual([110]);
  });
  it("Stale: open and untouched for the person's weeks", () => {
    expect(kept(all({ stale: true }))).toEqual([110]);
  });
  it("Readiness: clients, search and kinds narrow its entries; the total is before filters", () => {
    const fix = (f: AheadFilters) => fixGroups(load, { readOnly: false, f, staleWeeks: 6 });
    const before = fix(all());
    expect(before.map((g) => g.client.clientKey)).toEqual(["Northwind", "Harbor"]);
    expect(before[0]!.group.entries.map((e) => e.itemId)).toContain(110);
    expect(fix(all({ clients: ["Harbor"] })).map((g) => g.client.clientKey)).toEqual(["Harbor"]);
    const searched = fix(all({ q: "loyalty" }))[0]!;
    expect(searched.group.entries.map((e) => e.itemId)).toEqual([110]);
    expect(searched.total).toBe(before[0]!.group.entries.length);
    const none = fix(all({ kinds: ["unsized"] }))[0]!;
    expect(none.group.entries).toEqual([]);
  });
  it("Backlog: the same filters, at the level asked", () => {
    const rows = (f: AheadFilters) => backlogGroups(load, { ...f, tier: "feature" }, { staleWeeks: 6 })[0]!.rows.map((r) => r.item.id);
    expect(rows(all())).toEqual(expect.arrayContaining([110, 120, 200]));
    expect(rows(all({ q: "#200" }))).toEqual([200]);
    expect(rows(all({ range: "next2" }))).toEqual([120]);
    expect(rows(all({ gaps: true })).sort()).toEqual([110, 200]);
    expect(rows(all({ epic: "Northwind:100" }))).toEqual(expect.arrayContaining([110, 120]));
    expect(rows(all({ epic: "Northwind:100" }))).not.toContain(200);
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

describe("AH-6: where a control applies", () => {
  const modes: AheadModeKey[] = ["grid", "gantt", "fix", "backlog"];
  const controls: Control[] = ["clients", "people", "epic", "dates", "readiness", "kinds", "stale", "search", "level", "callouts", "whole"];
  it("every filter applies everywhere except Not ready in Readiness; callouts only on the Gantt; the whole project not in Readiness or Backlog", () => {
    const off = modes.flatMap((m) => controls.filter((c) => notHere(m, c, { scoped: true, whole: false })).map((c) => `${m}:${c}`));
    expect(off).toEqual(["grid:callouts", "fix:readiness", "fix:callouts", "fix:whole", "backlog:callouts", "backlog:whole"]);
    expect(notHere("grid", "whole", { scoped: false, whole: false })).toMatch(/already the whole project/);
    expect(notHere("grid", "whole", { scoped: false, whole: true })).toBeNull();
  });
});

describe("AH-6: the summary line", () => {
  const clients = load.clients.map((c) => ({ clientKey: c.clientKey, clientName: c.clientName, lead: c.lead }));
  it("Showing N of M · clients · people · dates; a chip per non-default filter, each clearing only itself", () => {
    const f = all({ clients: ["Northwind"], range: "next4", kinds: ["needs_stories"] });
    const s = summary(clients, f, { today: TODAY, shown: 3, total: 7 });
    expect(s.text).toBe("Showing 3 of 7 · Northwind Foods · Everyone · Next 4 weeks · Not ready: Needs stories");
    expect(s.chips.map((c) => c.label)).toEqual(["Northwind Foods", "People: Everyone", "Next 4 weeks", "Not ready: Needs stories"]);
    const noDates = s.chips.find((c) => c.id === "dates")!.clear(f);
    expect([noDates.range, noDates.kinds, noDates.clients]).toEqual([undefined, ["needs_stories"], ["Northwind"]]);
  });
  it("defaults read All clients, Mine and Any time, with no chips", () => {
    const s = summary(clients, DEFAULT_FILTERS, { today: TODAY, shown: 7, total: 7 });
    expect(s.text).toBe("Showing all 7 · All clients · Mine · Any time");
    expect(s.chips).toEqual([]);
  });
  it("Clear filters puts back every default and keeps Show the whole project", () => {
    expect(cleared(all({ q: "x", whole: true, stale: true }), DEFAULT_FILTERS)).toEqual({ ...DEFAULT_FILTERS, whole: true });
  });
});
