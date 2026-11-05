// AH-2: Cooptimize's scope in a client's DevOps project.
import { describe, expect, it } from "vitest";
import { inArea, parseScope, scopeCounts, scopeOf, ScopeInputError, type ProjectAreas, type ScopeItem } from "./devops-scope.ts";

const coop = (e: string) => e.endsWith("@cooptimize.example");
const item = (id: number, area: string, who: string | null, o: Partial<ScopeItem> = {}): ScopeItem => ({ id, parentId: null, area, assigneeEmail: who, portfolio: false, ...o });
const areas = (paths: string[], teams: ProjectAreas["teams"] = null): ProjectAreas => ({ root: paths[0] ?? null, paths, areasProblem: null, teams, teamsProblem: teams ? null : "Not readable", readAt: "2026-11-05T12:00:00Z" });

// A client's project: its own ERP program at the root and in Finance, our BI work in BI (and BI\Reports).
const P = "Contoso ERP";
const TREE = areas([P, `${P}\\BI`, `${P}\\BI\\Reports`, `${P}\\Finance`], [
  { name: "BI", otherField: false, areas: [{ path: `${P}\\BI`, sub: true }] },
  { name: "BI only", otherField: false, areas: [{ path: `${P}\\BI`, sub: false }] },
  { name: "Finance", otherField: false, areas: [{ path: `${P}\\Finance`, sub: true }] },
]);
const ITEMS: ScopeItem[] = [
  item(1, P, "pat@contoso.example", { portfolio: true }), // the client's epic at the root
  item(2, P, "kim@cooptimize.example"), // one of ours sits at the root
  item(3, P, "pat@contoso.example"), // the client's own work at the root
  item(10, `${P}\\BI`, "kim@cooptimize.example", { portfolio: true }), // our feature
  item(11, `${P}\\Finance`, "pat@contoso.example", { parentId: 10 }), // under our feature, in another area
  item(12, `${P}\\BI\\Reports`, null),
  item(13, `${P}\\BI`, null),
  item(20, `${P}\\Finance`, "pat@contoso.example"),
  item(21, `${P}\\Finance`, "me@cooptimize.example"), // mine, wherever it is
];
const ids = (r: { ids: Set<number> }) => [...r.ids].sort((a, b) => a - b);

describe("scopeOf", () => {
  it("automatic: Cooptimizers' items, everything under an epic or feature one owns, and the exact areas with our items; never the root while there are other areas", () => {
    const r = scopeOf(ITEMS, null, { areas: TREE, isCooptimizer: coop, me: null });
    expect(r.kind).toBe("automatic");
    expect(r.all).toBe(false);
    // 2 (ours, at the root), 10 and 11 (our feature and what's under it), 13 (BI exactly), 21 (a Cooptimizer's) and
    // so 20 (Finance exactly, where 21 is). Not 1 or 3 (the root's own work), not 12 (BI\Reports: the area rule is exact).
    expect(ids(r)).toEqual([2, 10, 11, 13, 20, 21]);
    expect(r.areas.map((a) => a.path)).toEqual([`${P}\\BI`, `${P}\\Finance`]);
  });

  it("automatic on a project with only its root area is the whole project", () => {
    const only = [item(1, "Solo", "pat@contoso.example"), item(2, "Solo", "kim@cooptimize.example")];
    for (const a of [areas(["Solo"]), null]) {
      const r = scopeOf(only, null, { areas: a, isCooptimizer: coop, me: null });
      expect(r.all).toBe(true);
      expect(ids(r)).toEqual([1, 2]);
    }
  });

  it("without the area tree, the items' own paths decide whether there are other areas", () => {
    const r = scopeOf(ITEMS, null, { areas: null, isCooptimizer: coop, me: null });
    expect(r.all).toBe(false);
    expect(r.ids.has(3)).toBe(false);
  });

  it("by team: the team's areas with sub-areas, or exactly, as its settings say; my items always", () => {
    expect(ids(scopeOf(ITEMS, { kind: "teams", teams: ["bi"] }, { areas: TREE, isCooptimizer: coop, me: "ME@cooptimize.example" }))).toEqual([10, 12, 13, 21]);
    expect(ids(scopeOf(ITEMS, { kind: "teams", teams: ["BI only"] }, { areas: TREE, isCooptimizer: coop, me: null }))).toEqual([10, 13]);
  });

  it("by team when the teams can't be read: the automatic scope, saying why", () => {
    const r = scopeOf(ITEMS, { kind: "teams", teams: ["BI"] }, { areas: { ...TREE, teams: null, teamsProblem: "Teams couldn't be read" }, isCooptimizer: coop, me: null });
    expect(r.kind).toBe("automatic");
    expect(r.problem).toBe("Teams couldn't be read");
    expect(scopeOf(ITEMS, { kind: "teams", teams: ["Gone"] }, { areas: TREE, isCooptimizer: coop, me: null }).problem).toMatch(/None of the chosen teams/);
  });

  it("by area path, with and without sub-areas, without case", () => {
    expect(ids(scopeOf(ITEMS, { kind: "areas", areas: [{ path: `${P.toLowerCase()}\\bi`, sub: true }] }, { areas: TREE, isCooptimizer: coop, me: null }))).toEqual([10, 12, 13]);
    expect(ids(scopeOf(ITEMS, { kind: "areas", areas: [{ path: `${P}\\BI`, sub: false }] }, { areas: TREE, isCooptimizer: coop, me: null }))).toEqual([10, 13]);
    // A path that only starts the same isn't under it.
    expect(inArea(`${P}\\BIG`, [{ path: `${P}\\BI`, sub: true }])).toBe(false);
  });

  it("whole project: everything", () => {
    const r = scopeOf(ITEMS, { kind: "whole" }, { areas: TREE, isCooptimizer: coop, me: null });
    expect(r.all).toBe(true);
    expect(r.ids.size).toBe(ITEMS.length);
  });
});

describe("scopeCounts", () => {
  it("per area path and team: open items and Cooptimize's (assigned to a Cooptimizer or under an epic or feature one owns), and the automatic count", () => {
    const c = scopeCounts(ITEMS, { areas: TREE, isCooptimizer: coop });
    expect(c.total).toBe(9);
    expect(c.automatic).toBe(6);
    expect(c.areas).toEqual([
      { path: P, items: 3, coop: 1 },
      { path: `${P}\\BI`, items: 2, coop: 1 },
      { path: `${P}\\BI\\Reports`, items: 1, coop: 0 },
      { path: `${P}\\Finance`, items: 3, coop: 2 },
    ]);
    expect(c.teams?.find((t) => t.name === "BI")).toMatchObject({ items: 3, coop: 1 });
  });
});

describe("parseScope", () => {
  it("takes the three kinds and refuses anything else", () => {
    expect(parseScope({ kind: "whole" })).toEqual({ kind: "whole" });
    expect(parseScope({ kind: "teams", teams: [" BI ", "bi", "Finance"] })).toEqual({ kind: "teams", teams: ["BI", "Finance"] });
    expect(parseScope({ kind: "areas", areas: [{ path: "A\\B", sub: false }] })).toEqual({ kind: "areas", areas: [{ path: "A\\B", sub: false }] });
    for (const bad of [null, [], { kind: "teams", teams: [] }, { kind: "areas", areas: [{ path: "A" }] }, { kind: "whole", extra: 1 }, { kind: "everything" }, { kind: "teams", teams: ["x\u0007"] }]) expect(() => parseScope(bad)).toThrow(ScopeInputError);
  });
});
