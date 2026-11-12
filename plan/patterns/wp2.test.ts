// WP-2: the pure rules that make the DevOps analysis trustworthy (fictional data): a type's level from most of its items
// (both edges of the threshold), one breakdown row per type pair in two processes, the kind guess for a ticket queue and
// for build work, the layout's counts and each scope kind (with and without sub-areas, two projects, a team on another
// field, a deleted area, the default from Admin › Clients, a whole project with several areas needing a choice),
// "can't tell" in place of any unclear type, the agreement sample's size, shapes as sets and chains with the
// two-children rule, coverage adding up, "too few to read" under 20, and the summary's text.
import { describe, expect, it } from "vitest";
import { aProcess, aRawItem } from "../../test/builders/patterns.ts";
import { analysisOf, FEW, shareWords } from "./analysis.ts";
import { inventoryOf, itemOf } from "./inventory.ts";
import { kindFacts } from "./kinds.ts";
import { agreementPick, CANT_TELL, chainOf, cleanList, listFromMerge, parseLabels, shapeOf, STARTING_LIST, suggestionsOf } from "./labels.ts";
import { levelsOf, PARENT_SHARE } from "./levels.ts";
import { summaryMarkdown, type ReportClient } from "./report.ts";
import { resultsOf } from "./results.ts";
import { analysisScopeWords, layoutOf, matcherOf, parseAnalysisScope, scopeChoice, type LayoutRow, type ProjectTree } from "./scope.ts";
import type { Labels, PatternItem } from "./types.ts";

const P = aProcess();
const W = { firstItemAt: null, windowFrom: "2024-12-01T00:00:00Z" };
const L = (o: Partial<Labels> = {}): Labels => ({ requestType: "new report", otherName: null, otherMeaning: null, layers: ["report"], readiness: "needs discovery first", missing: ["grain"], confidence: "high", ...o });
const item = (o: Parameters<typeof aRawItem>[0], inWindow = true): PatternItem => itemOf(aRawItem(o), P, inWindow);

/** `n` items of `type`, the first `withKids` each with one child of `child`. */
function parents(type: string, n: number, withKids: number, child = "Task", base = 1): PatternItem[] {
  const out: PatternItem[] = [];
  for (let k = 0; k < n; k++) {
    out.push(item({ id: base + k, type }));
    if (k < withKids) out.push(item({ id: base + 10_000 + k, type: child, parent: base + k }));
  }
  return out;
}

describe("WP-2: levels from most of a type's items", () => {
  it("one story in a hundred with a task under it: the type is a leaf, not a parent", () => {
    const list = [...parents("Story", 100, 1), ...Array.from({ length: 100 }, (_, k) => item({ id: 50_000 + k, type: "Feature" }))];
    // Give the stories a feature parent each, so stories sit under something.
    const linked = list.map((i) => (i.type === "Story" ? { ...i, parentId: 50_000 + (i.id % 100) } : i));
    expect(levelsOf(linked).get("Story")).toBe("leaf");
    expect(levelsOf(linked).get("Feature")).toBe("top");
  });

  it("most stories with tasks: the type is a parent (middle under features)", () => {
    const list = parents("Story", 100, 80).map((i) => (i.type === "Story" ? { ...i, parentId: 90_000 } : i));
    expect(levelsOf([...list, item({ id: 90_000, type: "Feature" })]).get("Story")).toBe("middle");
  });

  it("the threshold's two edges: 9 in 100 is a leaf, 10 in 100 a parent", () => {
    expect(PARENT_SHARE).toBe(0.1);
    expect(levelsOf(parents("Story", 100, 9)).get("Story")).toBe("other");
    expect(levelsOf(parents("Story", 100, 10)).get("Story")).toBe("top");
  });

  it("one row per pair, by the client's own type names, in two different processes", () => {
    // Process one: Epic > Feature > User Story; most features with no stories.
    const a = [item({ id: 1, type: "Epic" }), ...Array.from({ length: 35 }, (_, k) => item({ id: 10 + k, type: "Feature", parent: 1 })), ...[10, 10, 11, 12].map((p, k) => item({ id: 100 + k, type: "User Story", parent: p }))];
    const sa = inventoryOf(a, W);
    expect(sa.breakdown.pairs!.map((p) => `${p.parent} with no ${p.child}: ${p.without} of ${p.of}`)).toEqual(["Epic with no Feature: 0 of 1", "Feature with no User Story: 32 of 35"]);
    expect(sa.breakdown.pairs![1]!.children).toMatchObject({ n: 35, max: 2, median: 0 });
    // Process two: Theme > Ask, its own names.
    const b = [item({ id: 1, type: "Theme" }), item({ id: 2, type: "Theme" }), item({ id: 3, type: "Ask", parent: 1 }), item({ id: 4, type: "Ask", parent: 1 }), item({ id: 5, type: "Ask" })];
    const sb = inventoryOf(b, W);
    expect(sb.breakdown.pairs!.map((p) => `${p.parent} with no ${p.child}: ${p.without} of ${p.of}`)).toEqual(["Theme with no Ask: 1 of 2"]);
    expect(sb.breakdown.noParent).toEqual([{ type: "Ask", count: 1, of: 3 }]);
  });
});

describe("WP-2: kinds", () => {
  const queue = (n: number, base = 1) => Array.from({ length: n }, (_, k) => item({ id: base + k, type: "Ticket", state: "Closed", created: "2026-03-10T09:00:00Z", closed: "2026-03-10T15:00:00Z" }));
  it("a large flat type mostly closed the day it was made is Tickets and support, with the numbers behind it", () => {
    const build = [item({ id: 9000, type: "Feature" }), ...Array.from({ length: 40 }, (_, k) => item({ id: 9100 + k, type: "Story", parent: 9000 }))];
    const f = kindFacts([...queue(200), ...build]);
    const t = f.find((x) => x.type === "Ticket")!;
    expect(t).toMatchObject({ guess: "tickets", items: 200, noParent: 1, sameDay: 1, closed: 200 });
    expect(f.find((x) => x.type === "Story")!.guess).toBe("build");
    expect(f.find((x) => x.type === "Feature")!.guess).toBe("build");
  });

  it("a small queue isn't guessed tickets; a person's choice is kept and applied", () => {
    expect(kindFacts(queue(30)).find((x) => x.type === "Ticket")!.guess).toBe("build");
    const a = analysisOf([...queue(30), item({ id: 500, type: "Story" })], { Ticket: "leave_out" }, W);
    expect(a.kinds.find((k) => k.type === "Ticket")).toMatchObject({ guess: "build", kind: "leave_out", chosen: true });
    expect(a.leftOut).toBe(30);
    expect(a.build.items).toBe(1);
    const t = analysisOf(queue(30), { Ticket: "tickets" }, W);
    expect(t.tickets).toMatchObject({ items: 30, sameDay: { count: 30, of: 30 }, open: 0 });
  });
});

describe("WP-2: the scope", () => {
  const rows: LayoutRow[] = [
    { id: 1, project: "Alpha", area: "Alpha", type: "Bug", createdAt: null },
    { id: 2, project: "Alpha", area: "Alpha\\BI", type: "Story", createdAt: null },
    { id: 3, project: "Alpha", area: "Alpha\\BI\\Reports", type: "Story", createdAt: null },
    { id: 4, project: "Alpha", area: "Alpha\\ERP", type: "Ticket", createdAt: null },
    { id: 5, project: "Alpha", area: "Alpha\\ERP", type: "Ticket", createdAt: null },
    { id: 6, project: "Beta", area: "Beta", type: "Story", createdAt: null },
  ];
  const trees: ProjectTree[] = [
    { project: "Alpha", root: "Alpha", paths: ["Alpha", "Alpha\\BI", "Alpha\\BI\\Reports", "Alpha\\ERP"], areasProblem: null, teams: [{ name: "Data Team", otherField: false, areas: [{ path: "Alpha\\BI", sub: true }] }, { name: "Ops", otherField: true, areas: [] }], teamsProblem: null },
    { project: "Beta", root: "Beta", paths: ["Beta"], areasProblem: null, teams: [], teamsProblem: null },
  ];
  const ids = (s: Parameters<typeof matcherOf>[0]) => rows.filter((r) => matcherOf(s, trees).match(r)).map((r) => r.id);

  it("the layout: counts and types per project, area (on its own and with what's under it) and team", () => {
    const l = layoutOf(rows, trees);
    expect(l.items).toBe(6);
    const a = l.projects.find((p) => p.project === "Alpha")!;
    expect(a).toMatchObject({ items: 5, oneArea: false });
    expect(a.areas.map((x) => [x.path, x.items, x.under.items])).toEqual([["Alpha", 1, 5], ["Alpha\\BI", 1, 2], ["Alpha\\BI\\Reports", 1, 1], ["Alpha\\ERP", 2, 2]]);
    expect(a.areas.find((x) => x.path === "Alpha\\ERP")!.types).toEqual({ Ticket: 2 });
    expect(a.teams!.map((t) => [t.name, t.items])).toEqual([["Data Team", 2], ["Ops", 0]]);
    expect(l.projects.find((p) => p.project === "Beta")!.oneArea).toBe(true);
  });

  it("each scope kind: whole projects, teams, areas with and without sub-areas, across two projects", () => {
    expect(ids({ kind: "whole", projects: ["Alpha"] })).toEqual([1, 2, 3, 4, 5]);
    expect(ids({ kind: "whole", projects: ["Alpha", "beta"] })).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids({ kind: "teams", teams: [{ project: "Alpha", name: "data team" }] })).toEqual([2, 3]);
    expect(ids({ kind: "areas", areas: [{ path: "Alpha\\BI", sub: false }] })).toEqual([2]);
    expect(ids({ kind: "areas", areas: [{ path: "alpha\\bi", sub: true }, { path: "Beta", sub: false }] })).toEqual([2, 3, 6]);
  });

  it("a team on its own field, a team or area gone since the scope was saved: problems in plain words, nothing matched", () => {
    expect(matcherOf({ kind: "teams", teams: [{ project: "Alpha", name: "Ops" }] }, trees).problems).toEqual(["Team Ops uses its own field, not area paths, so it can't be matched here"]);
    expect(ids({ kind: "teams", teams: [{ project: "Alpha", name: "Ops" }] })).toEqual([]);
    expect(matcherOf({ kind: "teams", teams: [{ project: "Alpha", name: "Gone" }] }, trees).problems).toEqual(["Team Gone isn't in Alpha any more"]);
    expect(matcherOf({ kind: "areas", areas: [{ path: "Alpha\\Old", sub: true }] }, trees).problems).toEqual(["Area Alpha\\Old isn't in the project any more"]);
  });

  it("the default: Admin › Clients' teams or areas; automatic or whole project with several areas asks for a choice; one area is the whole project", () => {
    const layout = layoutOf(rows.filter((r) => r.project === "Alpha"), trees.slice(0, 1));
    expect(scopeChoice({ page: null, admin: { kind: "teams", teams: ["Data Team"] }, mainProject: "Alpha", layout })).toMatchObject({ source: "admin", scope: { kind: "teams", teams: [{ project: "Alpha", name: "Data Team" }] } });
    expect(scopeChoice({ page: null, admin: { kind: "areas", areas: [{ path: "Alpha\\BI", sub: true }] }, mainProject: "Alpha", layout }).source).toBe("admin");
    for (const admin of [null, { kind: "whole" } as const]) {
      const c = scopeChoice({ page: null, admin, mainProject: "Alpha", layout });
      expect(c.scope).toBeNull();
      expect(c.words).toMatch(/Admin › Clients says (Automatic|Whole project)\. The project has more than one area: choose/);
    }
    const one = layoutOf(rows.filter((r) => r.project === "Beta"), trees.slice(1));
    expect(scopeChoice({ page: null, admin: null, mainProject: "Beta", layout: one })).toMatchObject({ source: "one area", scope: { kind: "whole", projects: ["Beta"] } });
    // The page's own wins over Admin › Clients'.
    expect(scopeChoice({ page: { kind: "areas", areas: [{ path: "Alpha\\ERP", sub: false }] }, admin: { kind: "teams", teams: ["Data Team"] }, mainProject: "Alpha", layout }).source).toBe("page");
  });

  it("words, AH-2's way; without names for a download of a client the person isn't on; input checked", () => {
    expect(analysisScopeWords({ kind: "areas", areas: [{ path: "Alpha\\BI", sub: true }] })).toBe("Area Alpha\\BI and sub-areas");
    expect(analysisScopeWords({ kind: "teams", teams: [{ project: "Alpha", name: "Data Team" }] }, { names: false })).toBe("1 team");
    expect(analysisScopeWords({ kind: "areas", areas: [{ path: "Alpha\\BI", sub: true }, { path: "Beta", sub: false }] }, { names: false })).toBe("2 area paths");
    expect(analysisScopeWords({ kind: "whole", projects: ["Alpha"] }, { names: false })).toBe("Whole project");
    expect(() => parseAnalysisScope({ kind: "areas", areas: [{ path: "Alpha" }] })).toThrow(/sub-areas/);
    expect(() => parseAnalysisScope({ kind: "teams", teams: [] })).toThrow(/Choose 1/);
    expect(() => parseAnalysisScope({ kind: "whole", projects: ["Alpha"], extra: 1 })).toThrow(/Unknown field/);
    expect(parseAnalysisScope({ kind: "areas", areas: [{ path: " Alpha\\BI ", sub: true }, { path: "alpha\\bi", sub: false }] })).toEqual({ kind: "areas", areas: [{ path: "alpha\\bi", sub: false }] });
  });
});

describe("WP-2: classification rules", () => {
  const ans = (request_type: string, other_name: string | null = null) => ({ items: [{ ref: "i1", request_type, other_name, other_meaning: other_name ? "Something" : null, layers: ["none"], readiness: "too thin to tell", missing: ["acceptance"], confidence: "low" }] });

  it("no answer can make 'needs clarification' a type: an unclear name, as a type or as 'other', is 'can't tell'", () => {
    for (const a of [ans("needs clarification"), ans("Needs Clarification"), ans("other", "needs more detail"), ans("other", "unclear request"), ans("can't tell")]) expect(parseLabels(a, ["i1"], STARTING_LIST).labels.get("i1")!.requestType).toBe(CANT_TELL);
    // A list carrying one (a WP-1 second list) loses it.
    const old = { ...STARTING_LIST, types: [{ name: "needs clarification", meaning: "x", example: "" }, ...STARTING_LIST.types] };
    expect(cleanList(old).types.map((t) => t.name)).not.toContain("needs clarification");
    expect(cleanList(old).types.slice(-2).map((t) => t.name)).toEqual([CANT_TELL, "other"]);
  });

  it("the second list never adds a name about how unclear an item is, and suggestions drop them", () => {
    const s = suggestionsOf([L({ requestType: "other", otherName: "needs clarification", otherMeaning: "x" }), L({ requestType: "other", otherName: "housekeeping", otherMeaning: "Tidy" })]);
    expect(s.map((x) => x.name)).toEqual(["housekeeping"]);
    const list = listFromMerge({ types: [{ name: "new report", meaning: "m", example: "e" }, { name: "small change", meaning: "m", example: "e" }, { name: "housekeeping", meaning: "m", example: "e" }, { name: "Needs clarification", meaning: "m", example: "e" }, { name: "Too thin to tell", meaning: "m", example: "e" }], changes: [{ kind: "add", from: ["x"], to: ["Needs clarification"], reason: "r" }] }, STARTING_LIST, s, new Map(), "2026-11-11T00:00:00Z", "v2-r1", "w2f1");
    expect(list!.types.map((t) => t.name)).toEqual(["new report", "small change", "housekeeping", CANT_TELL, "other"]);
    expect(list!.changes).toEqual([]);
  });

  it("agreement: at least 100 items or all of them, the same items every time, across clients", () => {
    const few = agreementPick([{ key: "a", ids: [1, 2, 3] }, { key: "b", ids: [4] }]);
    expect(few.size).toBe(4);
    const many = [{ key: "a", ids: Array.from({ length: 1500 }, (_, k) => k + 1) }, { key: "b", ids: Array.from({ length: 500 }, (_, k) => k + 1) }];
    const p = agreementPick(many);
    expect(p.size).toBe(100);
    expect([...p].some((k) => k.startsWith("a\u0000")) && [...p].some((k) => k.startsWith("b\u0000"))).toBe(true);
    expect([...agreementPick([...many].reverse())].sort()).toEqual([...p].sort());
    expect(agreementPick([{ key: "a", ids: Array.from({ length: 4000 }, (_, k) => k + 1) }]).size).toBe(200);
  });

  it("shapes as a set and as a chain; only parents with at least two classified children count", () => {
    const kids = [{ id: 2, createdAt: "2026-03-02", labels: L({ layers: ["report"] }) }, { id: 1, createdAt: "2026-03-01", labels: L({ layers: ["ingestion", "fact"] }) }];
    expect(shapeOf(kids.map((k) => k.labels))).toEqual(["ingestion", "fact", "report"]);
    expect(chainOf(kids)).toEqual(["ingestion", "fact", "report"]);
    expect(chainOf([{ ...kids[0]!, createdAt: "2026-02-01" }, kids[1]!])).toEqual(["report", "ingestion", "fact"]);
    const items = [item({ id: 1, type: "Feature" }), item({ id: 2, type: "Story", parent: 1 }), item({ id: 3, type: "Story", parent: 1 }), item({ id: 4, type: "Feature" }), item({ id: 5, type: "Story", parent: 4 })];
    const labels = new Map(items.map((i) => [i.id, { labels: L({ layers: i.id === 3 ? ["fact"] : ["report"] }), labelsB: null }]));
    const r = resultsOf(items, labels, {}, { read: null, outside: null, skippedForAi: false, failed: new Set() }).build;
    expect(r.shapes.parents).toBe(1);
    expect(r.shapes.sets).toEqual([{ requestType: "new report", shape: ["fact", "report"], count: 1 }]);
  });

  it("coverage adds up: read = outside + in scope; in scope = left out + to classify; to classify = labeled + each reason", () => {
    const items = Array.from({ length: 12 }, (_, k) => item({ id: k + 1, type: k < 2 ? "Chore" : "Story" }));
    const labels = new Map([3, 4, 5].map((id) => [id, { labels: L(), labelsB: null }]));
    const c = resultsOf(items, labels, { Chore: "leave_out" }, { read: 20, outside: 8, skippedForAi: false, failed: new Set([6, 7]), movedOut: new Set([12]) }).coverage;
    expect(c).toEqual({ read: 20, outside: 9, inScope: 11, leftOut: 2, toClassify: 9, labeled: 3, aiOff: 0, failed: 2, notReached: 4 });
    expect(c.outside! + c.inScope).toBe(c.read);
    expect(c.leftOut + c.toClassify).toBe(c.inScope);
    expect(c.labeled + c.aiOff + c.failed + c.notReached).toBe(c.toClassify);
    const off = resultsOf(items, new Map(), {}, { read: 12, outside: 0, skippedForAi: true, failed: new Set([1]) }).coverage;
    expect(off).toMatchObject({ toClassify: 12, labeled: 0, aiOff: 12, failed: 0, notReached: 0 });
  });

  it("too few to read: any share built on fewer than 20 items", () => {
    expect(FEW).toBe(20);
    expect(shareWords(0.5, 19)).toBe("too few to read (19)");
    expect(shareWords(0.5, 20)).toBe("50% of 20");
  });
});

describe("WP-2: the summary", () => {
  const TITLE = "Rebuild the invoices page for Morgan";
  const items = [item({ id: 1, type: "Feature", title: TITLE, desc: "<p>Pasted text from the request: call me</p>" }), ...Array.from({ length: 30 }, (_, k) => item({ id: 10 + k, type: "Story", parent: 1, title: `Load table ${k} for Morgan Lee` }))];
  const labels = new Map(items.map((i) => [i.id, { labels: L({ requestType: i.id === 1 ? "foundation build" : "new report", layers: ["fact", "report"] }), labelsB: i.id % 3 ? null : L() }]));
  const client = (key: string, mine: boolean): ReportClient => {
    const analysis = analysisOf(items, {}, W);
    return { key, mine, platform: null, scope: { kind: "teams", teams: [{ project: "Alpha", name: "Secret Team Name" }] }, analysis, snapshot: analysis.build, results: resultsOf(items, labels, analysis.kindsMap, { read: 40, outside: 9, skippedForAi: false, failed: new Set() }) };
  };

  it("opens with what it covered, then Build work, then Tickets and support; no titles, names or pasted text", () => {
    const md = summaryMarkdown([client("adatum", true), client("fabrikam", false)], "2026-11-11T17:00:00Z", { listVersion: "v2-r4" });
    const heads = md.split("\n").filter((l) => /^## /.test(l));
    expect(heads).toEqual(["## What this covers", "## Build work", "## Tickets and support"]);
    expect(md).toMatch(/\| adatum \| 40 \| 9 \| 31 \| 0 \| 31 \| 31 \| 0 \| 0 \| 0 \|/);
    expect(md).toMatch(/Agreement sample: 20 items classified twice/);
    // The team's name only in the scope line of the client the person is on.
    expect(md.match(/Secret Team Name/g)).toHaveLength(1);
    expect(md).toMatch(/\| fabrikam \| Not set \| 1 team \|/);
    // With and without the largest client.
    expect(md).toMatch(/Without adatum|Without fabrikam/);
    expect(md).not.toMatch(/Rebuild the invoices|Morgan|Pasted text|call me|Load table/);
    expect(md).toMatch(/Feature with no Story: 0 of 1, too few to read/);
  });
});

describe("review: levels count only items in the window", () => {
  it("parents read for structure don't make a type a parent", () => {
    const features = Array.from({ length: 20 }, (_, k) => ({ id: k + 1, type: "Feature", parentId: null, inWindow: true }));
    const older = Array.from({ length: 5 }, (_, k) => ({ id: 100 + k, type: "Feature", parentId: null, inWindow: false }));
    const stories = [{ id: 200, type: "Story", parentId: 1, inWindow: true }, ...older.map((o, k) => ({ id: 300 + k, type: "Story", parentId: o.id, inWindow: true }))];
    // 1 of 20 features in the window has a child (5%); with the 5 older parents it would be 6 of 25 (24%).
    const levels = levelsOf([...features, ...older, ...stories]);
    expect(levels.get("Feature")).toBe("other");
    expect(levels.get("Story")).toBe("leaf");
    // A type seen only as an older parent still gets a level, from its own items.
    expect(levelsOf([{ id: 1, type: "Epic", parentId: null, inWindow: false }, { id: 2, type: "Story", parentId: 1, inWindow: true }]).get("Epic")).toBe("top");
  });
});
