// WP-1: the pure parts of DevOps patterns: levels from links (two processes with their own type names), every inventory
// number on a small known set, the window, title patterns, the history rule, label validation (malformed and partly
// valid answers), the merge, agreement and shapes. Fictional data from test/builders/patterns.ts.
import { describe, expect, it } from "vitest";
import { aProcess, aRawItem, aSmallProject } from "../../test/builders/patterns.ts";
import { historyOf, inventoryOf, itemOf, monthRanges, titlePattern, windowFrom } from "./inventory.ts";
import { agreementOf, commonShapes, eligible, listFromMerge, parseLabels, pass1Sample, shapeOf, STARTING_LIST, suggestionsOf } from "./labels.ts";
import { levelsOf, typeEdges } from "./levels.ts";
import { handCheck, resultsOf } from "./results.ts";
import type { Labels } from "./types.ts";

const P = aProcess();
const items = (raw: ReturnType<typeof aRawItem>[], inWindow = true) => raw.map((r) => itemOf(r, P, inWindow));
const L = (o: Partial<Labels> = {}): Labels => ({ requestType: "new report", otherName: null, otherMeaning: null, layers: ["report"], readiness: "needs discovery first", missing: ["grain"], confidence: "high", ...o });

describe("levels from links", () => {
  it("a four-level process with its own names: top, two middles, a leaf, and a flat type", () => {
    const list = items([
      aRawItem({ id: 1, type: "Theme" }),
      aRawItem({ id: 2, type: "Capability", parent: 1 }),
      aRawItem({ id: 3, type: "Ask", parent: 2 }),
      aRawItem({ id: 4, type: "Chore", parent: 3 }),
      aRawItem({ id: 5, type: "Chore", parent: 3 }),
      aRawItem({ id: 6, type: "Note" }),
    ]);
    expect(Object.fromEntries(levelsOf(list))).toEqual({ Ask: "middle", Capability: "middle", Chore: "leaf", Note: "other", Theme: "top" });
    expect(typeEdges(list).map((e) => `${e.parent}>${e.child}:${e.count}`)).toEqual(["Ask>Chore:2", "Capability>Ask:1", "Theme>Capability:1"]);
  });

  it("a two-level process: the direction seen more often wins, and nesting under one's own type says nothing", () => {
    const list = items([
      aRawItem({ id: 10, type: "Issue" }),
      aRawItem({ id: 11, type: "Task", parent: 10 }),
      aRawItem({ id: 12, type: "Task", parent: 10 }),
      aRawItem({ id: 13, type: "Issue", parent: 12 }), // once the other way round
      aRawItem({ id: 14, type: "Task", parent: 11 }), // a task under a task
    ]);
    expect(Object.fromEntries(levelsOf(list))).toEqual({ Issue: "top", Task: "leaf" });
  });
});

describe("the inventory", () => {
  it("every number on a small known set", () => {
    const raw = aSmallProject(100);
    const s = inventoryOf(raw.map((r) => itemOf(r, P, true)).map((i) => (i.id === 103 ? { ...i, facts: { ...i.facts, history: historyOf(raw[3]!.updates!, i.type, P) } } : i.id === 104 ? { ...i, facts: { ...i.facts, history: historyOf(raw[4]!.updates!, i.type, P) } } : i)), { firstItemAt: "2025-01-02T00:00:00Z", windowFrom: "2024-12-01T00:00:00Z" });
    expect(s.items).toBe(6);
    expect(s.firstItemAt).toBe("2025-01-02T00:00:00Z");
    expect(s.types.map((t) => [t.type, t.level, t.count])).toEqual([["Initiative", "top", 1], ["Piece", "middle", 2], ["Step", "leaf", 3]]);
    expect(s.types.find((t) => t.type === "Step")!.states).toEqual({ Done: 2, New: 1 });
    expect(s.months).toEqual({ "2026-03": 6 });
    expect(s.breakdown.children.top).toMatchObject({ n: 1, median: 2, bands: { "0": 0, "1": 0, "2-3": 1, "4-7": 0, "8+": 0 } });
    expect(s.breakdown.children.middle).toMatchObject({ n: 2, min: 0, max: 2 });
    expect(s.breakdown.middleNoChildren).toEqual({ count: 1, of: 2 });
    expect(s.breakdown.leafNoParent).toEqual({ count: 1, of: 3 });
    expect(s.breakdown.depth).toEqual({ "1": 2, "2": 2, "3": 2 });
    expect(s.writing.all).toMatchObject({ n: 6, description: 0.333, acceptance: 0.167, tags: 0.167, estimate: 0.167 });
    expect(s.writing.byLevel.middle).toMatchObject({ n: 2, description: 0.5, acceptance: 0.5 });
    expect(s.writing.all.descBands).toEqual({ empty: 4, "under 100": 2, "100-499": 0, "500-1999": 0, "2000+": 0 });
    expect(s.titles.patterns).toEqual({ verb: 3, as_a: 0, question: 1, bare_noun: 2, other: 0 });
    expect(s.timing.createdToStarted).toEqual({ n: 2, median: 1, p90: 1 });
    expect(s.timing.sameDay).toEqual({ count: 1, of: 2 });
    expect(s.afterFact).toEqual({ sampled: 2, changedAfterStart: 1, emptyAtClose: 1 });
    expect(s.headline).toEqual({ items: 6, description: 0.333, acceptance: 0.167, typicalChildren: 2, parentsNoChildren: 0.333, changedAfterStart: 0.5 });
  });

  it("parents from before the window count for the structure, not the windowed numbers", () => {
    const old = itemOf(aRawItem({ id: 1, type: "Initiative", created: "2023-01-01T00:00:00Z" }), P, false);
    const kids = items([aRawItem({ id: 2, type: "Piece", parent: 1 }), aRawItem({ id: 3, type: "Piece", parent: 1 })]);
    const s = inventoryOf([old, ...kids], { firstItemAt: null, windowFrom: "2024-12-01T00:00:00Z" });
    expect(s.items).toBe(2);
    expect(s.olderParents).toBe(1);
    expect(s.types.map((t) => [t.type, t.level])).toEqual([["Piece", "leaf"]]);
    expect(s.breakdown.leafNoParent).toEqual({ count: 0, of: 2 });
  });

  it("the window is 24 calendar months up to now, queried a month at a time", () => {
    const now = Temporal.Instant.from("2026-11-11T17:00:00Z");
    expect(windowFrom(now)).toBe("2024-12-01T00:00:00Z");
    const m = monthRanges(now);
    expect(m).toHaveLength(24);
    expect(m[0]).toEqual({ from: "2024-12-01T00:00:00Z", to: "2025-01-01T00:00:00Z" });
    expect(m.at(-1)).toEqual({ from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" });
  });

  it("title patterns", () => {
    expect(titlePattern("Add the region filter")).toBe("verb");
    expect(titlePattern("As a planner I want totals")).toBe("as_a");
    expect(titlePattern("Why is the total off?")).toBe("question");
    expect(titlePattern("Orders fact")).toBe("bare_noun");
    expect(titlePattern("The orders fact needs the new region column")).toBe("other");
  });

  it("history: a text change in the update that starts the work counts as before; empty at close", () => {
    const u = [
      { rev: 1, fields: { "System.State": { newValue: "New" } } },
      { rev: 2, fields: { "System.State": { oldValue: "New", newValue: "Active" }, "System.Description": { newValue: "<p>x</p>" } } },
      { rev: 3, fields: { "System.State": { oldValue: "Active", newValue: "Done" } } },
    ];
    expect(historyOf(u, "Step", P)).toEqual({ changedAfterStart: false, emptyAtClose: false });
    expect(historyOf([{ rev: 1, fields: { "System.State": { newValue: "Done" } } }], "Step", P)).toEqual({ changedAfterStart: false, emptyAtClose: true });
  });

  it("an item keeps lengths and counts, never the text", () => {
    const i = itemOf(aRawItem({ desc: "<p>The secret plan for the orders table</p>", ac: "<b>All rows</b>", tags: "a; b" }), P, true);
    expect(JSON.stringify(i)).not.toMatch(/secret plan|All rows/);
    expect(i.facts).toMatchObject({ descLen: 36, acLen: 8, tags: 2 });
  });
});

describe("labels", () => {
  const refs = ["i1", "i2", "i3", "i4"];
  it("a partly valid answer keeps the valid items and drops the rest", () => {
    const ans = {
      items: [
        { ref: "i1", request_type: "New Report", other_name: null, other_meaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["none"], confidence: "High" },
        { ref: "i2", request_type: "made up", other_name: null, other_meaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["none"], confidence: "high" },
        { ref: "i3", request_type: "other", other_name: null, other_meaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["none"], confidence: "high" },
        { ref: "i4", request_type: "exploration", other_name: null, other_meaning: null, layers: ["none", "report"], readiness: "a builder could act on it", missing: ["grain"], confidence: "low" },
        { ref: "i1", request_type: "exploration", other_name: null, other_meaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["grain"], confidence: "low" },
        { ref: "i9", request_type: "exploration", other_name: null, other_meaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["grain"], confidence: "low" },
      ],
    };
    const r = parseLabels(ans, refs, STARTING_LIST);
    expect([...r.labels.keys()]).toEqual(["i1"]);
    expect(r.labels.get("i1")).toEqual({ requestType: "new report", otherName: null, otherMeaning: null, layers: ["report"], readiness: "a builder could act on it", missing: ["none"], confidence: "high" });
    expect(r.dropped).toBe(3);
  });

  it("a malformed answer labels nothing", () => {
    for (const bad of [null, "x", { items: "no" }, { nope: [] }]) expect(parseLabels(bad, refs, STARTING_LIST)).toEqual({ labels: new Map(), dropped: 4 });
  });

  it("other needs a short name and meaning", () => {
    const r = parseLabels({ items: [{ ref: "i1", request_type: "other", other_name: "housekeeping", other_meaning: "Tidying folders", layers: ["none"], readiness: "too thin to tell", missing: ["none"], confidence: "low" }] }, ["i1"], STARTING_LIST);
    expect(r.labels.get("i1")).toMatchObject({ requestType: "other", otherName: "housekeeping" });
  });

  it("which items: tops, middles, loose leaves, leaves under a classified parent, flat items; in the window only", () => {
    const list = items([aRawItem({ id: 1, type: "A" }), aRawItem({ id: 2, type: "B", parent: 1 }), aRawItem({ id: 3, type: "C", parent: 2 }), aRawItem({ id: 4, type: "C" }), aRawItem({ id: 5, type: "Flat" })]);
    const lv = levelsOf(list);
    expect(eligible(list, (t) => lv.get(t) ?? "other").map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
    expect(eligible([{ ...list[0]!, inWindow: false }, ...list.slice(1)], (t) => lv.get(t) ?? "other").map((i) => i.id)).toEqual([2, 3, 4, 5]);
  });

  it("pass 1's sample is stable and capped", () => {
    const many = Array.from({ length: 400 }, (_, k) => ({ id: k + 1, type: "A" }));
    expect(pass1Sample(many)).toHaveLength(150);
    expect(pass1Sample(many).map((x) => x.id)).toEqual(pass1Sample([...many].reverse()).map((x) => x.id));
  });

  it("the merge: suggestions carry names, meanings and counts only; the second list keeps other last and counts changes", () => {
    const s = suggestionsOf([L({ requestType: "other", otherName: "housekeeping", otherMeaning: "Tidying" }), L({ requestType: "other", otherName: "Housekeeping", otherMeaning: "Tidying" }), L()]);
    expect(s).toEqual([{ name: "housekeeping", meaning: "Tidying", count: 2 }]);
    const list = listFromMerge({ types: [{ name: "new report", meaning: "m", example: "e" }, { name: "small change", meaning: "m", example: "e" }, { name: "housekeeping", meaning: "Tidying", example: "Tidy folders" }, { name: "other", meaning: "x", example: "" }], changes: [{ kind: "add", from: ["housekeeping"], to: ["housekeeping"], reason: "Seen twice" }, { kind: "weird", from: [], to: ["x"], reason: "" }] }, STARTING_LIST, s, new Map([["housekeeping", 2]]), "2026-11-11T00:00:00Z", "v2-r1", "f1");
    expect(list!.types.map((t) => t.name)).toEqual(["new report", "small change", "housekeeping", "other"]);
    expect(list!.changes).toEqual([{ kind: "add", from: ["housekeeping"], to: ["housekeeping"], reason: "Seen twice", count: 2 }]);
    expect(listFromMerge({ types: [], changes: [] }, STARTING_LIST, s, new Map(), "x", "v", "f")).toBeNull();
  });

  it("agreement per label, shapes in the layers' order", () => {
    expect(agreementOf([[L(), L()], [L(), L({ requestType: "exploration", missing: ["none"] })]])).toEqual({ pairs: 2, requestType: 0.5, layers: 1, readiness: 1, missing: 0.5, confidence: 1 });
    expect(shapeOf([L({ layers: ["report"] }), L({ layers: ["ingestion", "fact"] }), L({ layers: ["none"] })])).toEqual(["ingestion", "fact", "report"]);
    expect(commonShapes([{ type: "a", shape: ["fact"] }, { type: "a", shape: ["fact"] }, { type: "a", shape: ["report"] }, { type: "b", shape: [] }])).toEqual([{ requestType: "a", shape: ["fact"], count: 2 }, { requestType: "a", shape: ["report"], count: 1 }]);
  });

  it("results and the hand check: counts per label, shapes from classified children, 30 across type and confidence", () => {
    const list = items([aRawItem({ id: 1, type: "A" }), aRawItem({ id: 2, type: "B", parent: 1 }), aRawItem({ id: 3, type: "B", parent: 1 })]);
    const labels = new Map([[1, { labels: L({ requestType: "foundation build" }), labelsB: null }], [2, { labels: L({ layers: ["ingestion"] }), labelsB: L({ layers: ["ingestion"] }) }], [3, { labels: L({ layers: ["fact"], confidence: "low" }), labelsB: null }]]);
    const r = resultsOf(list, labels);
    expect(r).toMatchObject({ eligible: 3, labeled: 3, requestTypes: { "foundation build": 1, "new report": 2 }, confidence: { high: 2, low: 1 } });
    expect(r.shapes).toEqual([{ requestType: "foundation build", shape: ["ingestion", "fact"], count: 1 }]);
    expect(r.agreement.pairs).toBe(1);
    expect(handCheck(list, labels).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});
