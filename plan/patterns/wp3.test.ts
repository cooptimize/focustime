// WP-3: trust the DevOps analysis, the pure parts (fictional data): agreement per missing fact and per layer from known
// pairs, "too few to read" under 20 pairs, the "not reliable yet" line at both edges, the request type disagreements,
// whole-item figures unchanged, the sample line; the list a person owns (each change a version with who, when and why;
// "can't tell" and "other" fixed; unclear and client names refused; what each change costs); carrying labels without AI
// (a rename follows, a type with no counterpart becomes "other" with its name, a list that can't be carried is left on
// its own); the per-client tables; the downloads' headings, the shapes line and the summary's text.
import { describe, expect, it } from "vitest";
import { aProcess, aRawItem } from "../../test/builders/patterns.ts";
import { analysisOf } from "./analysis.ts";
import { itemOf } from "./inventory.ts";
import { agreementOf, disagreements, factReading, RELIABLE, STARTING_LIST } from "./labels.ts";
import { applyEdit, carryMapOf, clientNamer, editCost, failuresOf, fromWords, inUseOf, OWN_START, resolveLabels, withOwnStart, type ListEdit, type Resolved, type VersionRow } from "./owned.ts";
import { factNote, NO_COMMON_SHAPE, summaryMarkdown, typesMarkdown, type ReportClient } from "./report.ts";
import { cellWords, clientTable, readinessByType, resultsOf, sampleWords, sumResults, type Results } from "./results.ts";
import type { Labels, PatternItem, TypeList } from "./types.ts";

const P = aProcess();
const W = { firstItemAt: null, windowFrom: "2024-12-01T00:00:00Z" };
const L = (o: Partial<Labels> = {}): Labels => ({ requestType: "new report", otherName: null, otherMeaning: null, layers: ["report"], readiness: "needs discovery first", missing: ["grain"], confidence: "high", ...o });
const item = (o: Parameters<typeof aRawItem>[0], inWindow = true): PatternItem => itemOf(aRawItem(o), P, inWindow);
const AT = "2026-11-12T10:00:00Z";
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const noClient = () => false;
const edit = (list: TypeList, e: ListEdit, why = "Seen in the backlog") => {
  const r = applyEdit(list, e, { why, by: ME, at: AT, namesClient: noClient });
  if (typeof r === "string") throw new Error(r);
  return r;
};
const row = (itemId: number, version: string, labels: Labels | null, o: Partial<VersionRow> = {}): VersionRow => ({ version, itemId, rev: 1, labels, labelsB: null, failedA: !labels, failedB: false, ...o });

describe("WP-3: agreement per fact", () => {
  it("per missing fact and per layer: pairs with it in either answer and in both; 'none' left out", () => {
    const a = agreementOf([
      [L({ missing: ["grain", "business rule"], layers: ["fact", "report"] }), L({ missing: ["grain"], layers: ["fact"] })],
      [L({ missing: ["grain"] }), L({ missing: ["business rule"] })],
      [L({ missing: ["none"], layers: ["none"] }), L({ missing: ["none"], layers: ["none"] })],
    ]);
    expect(a.facts.missing).toEqual({ grain: { either: 2, both: 1 }, "business rule": { either: 2, both: 0 } });
    expect(a.facts.layers).toEqual({ fact: { either: 1, both: 1 }, report: { either: 2, both: 1 } });
    // Whole-item figures are as before.
    expect(a).toMatchObject({ pairs: 3, requestType: 1, readiness: 1, confidence: 1, missing: 0.333, layers: 0.667 });
  });

  it("too few to read under 20 'either' pairs; not reliable yet under 70%, at both edges", () => {
    expect(factReading({ either: 19, both: 19 })).toMatchObject({ few: true, reliable: false });
    expect(factReading({ either: 20, both: 14 })).toMatchObject({ few: false, reliable: true, share: 0.7 });
    expect(factReading({ either: 20, both: 13 })).toMatchObject({ few: false, reliable: false });
    expect(RELIABLE).toBe(0.7);
    const a = agreementOf([
      ...Array.from({ length: 14 }, () => [L({ missing: ["grain"] }), L({ missing: ["grain"] })] as [Labels, Labels]),
      ...Array.from({ length: 6 }, () => [L({ missing: ["grain"] }), L({ missing: ["acceptance"] })] as [Labels, Labels]),
    ]);
    expect(factNote(a, "missing", "grain")).toBe("agreement 70%");
    expect(factNote(a, "missing", "acceptance")).toBe("agreement too few to read (6)");
    const b = agreementOf([
      ...Array.from({ length: 13 }, () => [L({ missing: ["grain"] }), L({ missing: ["grain"] })] as [Labels, Labels]),
      ...Array.from({ length: 7 }, () => [L({ missing: ["grain"] }), L({ missing: ["acceptance"] })] as [Labels, Labels]),
    ]);
    expect(factNote(b, "missing", "grain")).toBe("agreement 65%, not reliable yet");
  });

  it("the most common request type disagreements, as pairs of names with counts", () => {
    const a = agreementOf([
      [L({ requestType: "small change" }), L({ requestType: "new report" })],
      [L({ requestType: "new report" }), L({ requestType: "small change" })],
      [L({ requestType: "exploration" }), L({ requestType: "data anomaly" })],
      [L(), L()],
    ]);
    expect(disagreements(a)).toEqual([["new report", "small change", 2], ["data anomaly", "exploration", 1]]);
  });

  it("clients add up exactly; the sample line says what failed and what wasn't asked", () => {
    const one = (pairs: [Labels, Labels][]): Results => ({ ...sumResults([]), labeled: 720, agreement: agreementOf(pairs) });
    const s = sumResults([one([[L(), L()]]), one([[L({ missing: ["grain"] }), L({ missing: ["acceptance"] })]])]);
    expect(s.agreement.facts.missing.grain).toEqual({ either: 2, both: 1 });
    expect(s.agreement.same.requestType).toBe(2);
    expect(sampleWords({ agreement: { ...s.agreement, pairs: 99 }, agreeFailed: 1, labeled: 1440 })).toBe("99 of 100 (1 answer failed its check)");
    expect(sampleWords({ agreement: { ...s.agreement, pairs: 96 }, agreeFailed: 1, labeled: 1440 })).toBe("96 of 100 (1 answer failed its check, 3 not asked yet)");
    expect(sampleWords({ agreement: agreementOf([]), agreeFailed: 0, labeled: 0 })).toBe("No item has been classified twice yet.");
  });
});

describe("WP-3: the list a person owns", () => {
  it("the first list in use: the names asked for, can't tell and other last, meanings and made-up examples for all", () => {
    expect(OWN_START.types.map((t) => t.name)).toEqual(["foundation build", "new measure", "new report", "small change", "new data source", "exploration", "data anomaly", "rerun or data fix", "deployment", "pipeline failure", "access or admin", "performance", "meeting or ongoing", "data migration", "can't tell", "other"]);
    for (const t of OWN_START.types.slice(0, -2)) expect(t.meaning && t.example, t.name).toBeTruthy();
    expect(inUseOf([])).toBe(OWN_START);
  });

  it("add, rename, merge, remove and edit each make a new version with who, when, the base and why", () => {
    const kinds: ListEdit[] = [
      { kind: "add", name: "data quality rule", meaning: "A check that data meets a rule", example: "Flag orders with no customer", relabel: "other" },
      { kind: "rename", from: "new report", to: "report build" },
      { kind: "merge", from: "rerun or data fix", into: "data anomaly" },
      { kind: "remove", name: "performance" },
      { kind: "edit", name: "deployment", meaning: "Releasing work to another environment", example: "Release the model to test" },
    ];
    for (const e of kinds) {
      const v = edit(OWN_START, e, `Because of ${e.kind}`);
      expect(v).toMatchObject({ version: "own-2", by: ME, createdAt: AT, base: "own-1", why: `Because of ${e.kind}` });
      expect(v.changes).toHaveLength(1);
      expect(v.types.slice(-2).map((t) => t.name)).toEqual(["can't tell", "other"]);
    }
    expect(edit(edit(OWN_START, kinds[0]!), kinds[1]!).version).toBe("own-3");
  });

  it("refuses: changing can't tell or other, an unclear name, a client's name, an email, no why", () => {
    const refuse = (e: ListEdit, why = "a reason", namesClient: (t: string) => boolean = noClient) => applyEdit(OWN_START, e, { why, by: ME, at: AT, namesClient });
    for (const e of [{ kind: "rename", from: "other", to: "misc" }, { kind: "remove", name: "can't tell" }, { kind: "merge", from: "other", into: "new report" }, { kind: "edit", name: "can't tell", meaning: "x", example: "" }, { kind: "add", name: "Other", meaning: "x", example: "", relabel: "other" }] as ListEdit[]) expect(refuse(e)).toMatch(/fixed/);
    for (const n of ["needs clarification", "Unclear request", "too thin"]) {
      expect(refuse({ kind: "add", name: n, meaning: "x", example: "", relabel: "other" })).toMatch(/readiness/);
      expect(refuse({ kind: "rename", from: "small change", to: n })).toMatch(/readiness/);
    }
    const namesClient = clientNamer([{ key: "adatum", names: ["Adatum Corp"] }]);
    expect(refuse({ kind: "add", name: "Adatum cleanup", meaning: "x", example: "", relabel: "other" }, "a reason", namesClient)).toMatch(/client/);
    expect(refuse({ kind: "add", name: "cleanup", meaning: "Work for Adatum Corp", example: "", relabel: "other" }, "a reason", namesClient)).toMatch(/client/);
    expect(refuse({ kind: "add", name: "ask jo@outside.example", meaning: "x", example: "", relabel: "other" })).toMatch(/email/);
    expect(refuse({ kind: "rename", from: "small change", to: "x" }, "")).toMatch(/why/);
    expect(refuse({ kind: "add", name: "new report", meaning: "x", example: "", relabel: "other" })).toMatch(/already/);
  });

  it("a rename keeps every label; a merge carries them; a removal and an add say which need labeling again", () => {
    const rows = [row(1, "own-1", L({ requestType: "new report" })), row(2, "own-1", L({ requestType: "other", otherName: "housekeeping", otherMeaning: "Tidy" })), row(3, "own-1", L({ requestType: "can't tell" })), row(4, "own-1", L({ requestType: "performance" }))];
    const renamed = edit(OWN_START, { kind: "rename", from: "new report", to: "report build" });
    const r1 = resolveLabels(rows, [OWN_START, renamed], renamed);
    expect(r1.carried.get(1)).toMatchObject({ labels: { requestType: "report build" }, stale: null, from: "own-1" });
    expect([...r1.carried.values()].every((x) => !x.stale)).toBe(true);
    expect(r1.carried.size).toBe(4);
    const merged = edit(renamed, { kind: "merge", from: "performance", into: "report build" });
    expect(resolveLabels(rows, [OWN_START, renamed, merged], merged).carried.get(4)).toMatchObject({ labels: { requestType: "report build" }, stale: null });
    const removed = edit(OWN_START, { kind: "remove", name: "performance" });
    expect(resolveLabels(rows, [OWN_START, removed], removed).carried.get(4)).toMatchObject({ labels: { requestType: "performance (removed)" }, stale: "removed" });
    const added = edit(OWN_START, { kind: "add", name: "data quality rule", meaning: "A rule check", example: "Flag empty customers", relabel: "other" });
    const r2 = resolveLabels(rows, [OWN_START, added], added);
    expect([1, 2, 3, 4].map((id) => r2.carried.get(id)!.stale)).toEqual([null, "added", "added", null]);
    const all = edit(OWN_START, { kind: "add", name: "data quality rule", meaning: "A rule check", example: "Flag empty customers", relabel: "all" });
    expect([...resolveLabels(rows, [OWN_START, all], all).carried.values()].every((x) => x.stale === "added")).toBe(true);
  });

  it("what a change costs: a rename nothing; an add offers only other and can't tell, counted right; a removal its items", () => {
    const labels = [L({ requestType: "new report" }), L({ requestType: "other" }), L({ requestType: "other" }), L({ requestType: "can't tell" }), L({ requestType: "performance" })].map((l): Resolved => ({ rev: 1, labels: l, labelsB: null, from: "own-1", stale: null, failedB: false }));
    expect(editCost({ kind: "rename", from: "new report", to: "report build" }, labels)).toMatchObject({ relabel: 0, words: expect.stringMatching(/costs nothing/) });
    expect(editCost({ kind: "add", name: "x y", meaning: "m", example: "", relabel: "other" }, labels)).toMatchObject({ relabel: 3, relabelSmall: 3, words: expect.stringMatching(/Only the items now labeled other or can't tell \(3 items\).*Estimate/) });
    expect(editCost({ kind: "add", name: "x y", meaning: "m", example: "", relabel: "all" }, labels)).toMatchObject({ relabel: 5, relabelSmall: 3 });
    expect(editCost({ kind: "remove", name: "performance" }, labels)).toMatchObject({ relabel: 1, words: expect.stringMatching(/1 item labeled "performance".*Estimate will price/) });
    expect(editCost({ kind: "merge", from: "performance", into: "new report" }, labels)).toMatchObject({ relabel: 0 });
  });
});

describe("WP-3: carrying labels without AI", () => {
  const ai = (o: Partial<TypeList> = {}): TypeList => ({
    version: "v2-r7",
    createdAt: "2026-11-12T03:00:00Z",
    types: [
      { name: "platform foundation setup", meaning: "m", example: "e" },
      { name: "calculation added to a model", meaning: "m", example: "e" },
      { name: "new report", meaning: "m", example: "e" },
      { name: "migration between platforms", meaning: "Moving data across", example: "e" },
      { name: "tiny", meaning: "Four items", example: "e" },
      { name: "data or report correction", meaning: "m", example: "e" },
      { name: "can't tell", meaning: "", example: "" },
      { name: "other", meaning: "", example: "" },
    ],
    changes: [
      { kind: "rename", from: ["foundation build"], to: ["platform foundation setup"], reason: "r", count: 3 },
      { kind: "rename", from: ["new KPI or measure on an existing model"], to: ["calculation added to a model"], reason: "r", count: 3 },
      { kind: "add", from: ["moving data"], to: ["migration between platforms"], reason: "r", count: 2 },
      { kind: "add", from: [], to: ["tiny"], reason: "r", count: 1 },
      { kind: "merge", from: ["data anomaly", "rerun or data fix"], to: ["data or report correction"], reason: "r", count: 5 },
    ],
    fingerprint: "w2fabc",
    ...o,
  });

  it("a renamed type's labels follow it; a type with no counterpart becomes other with its name as the suggestion", () => {
    const rows = [row(1, "v2-r7", L({ requestType: "platform foundation setup" })), row(2, "v2-r7", L({ requestType: "calculation added to a model" }), { labelsB: L({ requestType: "new report" }) }), row(3, "v2-r7", L({ requestType: "migration between platforms" })), row(4, "v2-r7", L({ requestType: "data or report correction" })), row(5, "v2-r7", L({ requestType: "new report" })), row(6, "v2-r7", L({ requestType: "other", otherName: "housekeeping", otherMeaning: "Tidy" }))];
    const r = resolveLabels(rows, [ai()], OWN_START);
    expect(r.carried.get(1)!.labels.requestType).toBe("foundation build");
    expect(r.carried.get(2)).toMatchObject({ labels: { requestType: "new measure" }, labelsB: { requestType: "new report" }, stale: null, from: "v2-r7" });
    expect(r.carried.get(3)).toMatchObject({ labels: { requestType: "other", otherName: "migration between platforms", otherMeaning: "Moving data across" }, stale: "no counterpart" });
    // A merge of two starting types has no one counterpart.
    expect(r.carried.get(4)).toMatchObject({ labels: { requestType: "other", otherName: "data or report correction" }, stale: "no counterpart" });
    expect(r.carried.get(5)).toMatchObject({ labels: { requestType: "new report" }, stale: null });
    expect(r.carried.get(6)).toMatchObject({ labels: { requestType: "other", otherName: "housekeeping" }, stale: null });
    expect(r.earlier.size).toBe(0);
  });

  it("a list whose changes don't explain a type can't be carried: its labels stay on it, and no older label stands in", () => {
    const odd = ai({ types: [...ai().types, { name: "unexplained", meaning: "m", example: "e" }] });
    expect(carryMapOf(odd, OWN_START, [odd])).toBeNull();
    const rows = [row(1, "start-2", L({ requestType: "new data with no home yet" })), row(1, "v2-r7", L({ requestType: "new report" })), row(2, "start-2", L({ requestType: "new data with no home yet" }))];
    const r = resolveLabels(rows, [STARTING_LIST, odd], OWN_START);
    expect(r.earlier.get(1)).toBe("v2-r7");
    expect(r.carried.has(1)).toBe(false);
    // The starting list carries (own-1's renames).
    expect(r.carried.get(2)!.labels.requestType).toBe("new data source");
    // WP-1's list never carries.
    expect(resolveLabels([row(3, "v1", L())], [{ ...STARTING_LIST, version: "v1" }], OWN_START).earlier.get(3)).toBe("v1");
  });

  it("the newest label wins: a person's version over an AI list over the starting list", () => {
    const rows = [row(1, "start-2", L({ requestType: "small change" })), row(1, "v2-r7", L({ requestType: "new report" })), row(1, "own-1", L({ requestType: "exploration" }))];
    expect(resolveLabels(rows, withOwnStart([STARTING_LIST, ai()]), OWN_START).carried.get(1)!.labels.requestType).toBe("exploration");
  });
});

describe("WP-3: numbers per client", () => {
  const r = (labeled: number, types: Record<string, number>): Results => ({ ...sumResults([]), labeled, requestTypes: types });

  it("a column per client beside all clients and without the largest, as counts and shares; under 20 'too few to read'", () => {
    const t = clientTable([{ key: "adatum", r: r(40, { "new report": 30, other: 10 }) }, { key: "fabrikam", r: r(10, { "new report": 2, other: 8 }) }], (x) => x.requestTypes);
    expect(t.columns).toEqual(["adatum", "fabrikam", "All clients", "Without adatum"]);
    expect(t.rows.map((x) => x.value)).toEqual(["new report", "other"]);
    expect(t.rows[0]!.cells.map(cellWords)).toEqual(["30 (75%)", "2 (too few to read)", "32 (64%)", "2 (too few to read)"]);
    expect(clientTable([{ key: "adatum", r: r(40, { a: 1 }) }], (x) => x.requestTypes).columns).toEqual(["adatum", "All clients"]);
  });

  it("readiness by request type: how many a builder could act on, need discovery, or are too thin", () => {
    const items = Array.from({ length: 30 }, (_, k) => item({ id: k + 1, type: "Story" }));
    const labels = new Map(items.map((i) => [i.id, { labels: L({ requestType: i.id <= 25 ? "new report" : "exploration", readiness: i.id <= 20 ? "a builder could act on it" : i.id <= 25 ? "too thin to tell" : "needs discovery first" }), labelsB: null }]));
    const res = resultsOf(items, labels, {}, { read: null, outside: null, skippedForAi: false, failed: new Set() }).build;
    const rows = readinessByType(res, ["a builder could act on it", "needs discovery first", "too thin to tell"]);
    expect(rows[0]).toMatchObject({ type: "new report", items: 25 });
    expect(rows[0]!.cells.map(cellWords)).toEqual(["20 (80%)", "0 (0%)", "5 (20%)"]);
    expect(rows[1]!.cells.map(cellWords)[1]).toBe("5 (too few to read)");
  });
});

describe("WP-3: downloads", () => {
  it("the request types download: the list in use first and marked, earlier lists newest first, no two headings alike", () => {
    const own2 = edit(OWN_START, { kind: "rename", from: "small change", to: "minor change" });
    const aiList: TypeList = { ...STARTING_LIST, version: "v2-r7", createdAt: "2026-11-12T03:00:00Z", fingerprint: "w2f" };
    const aiList2: TypeList = { ...aiList, version: "v2-r9" };
    const md = typesMarkdown([STARTING_LIST, aiList, aiList2, OWN_START, own2], "own-2");
    const heads = md.split("\n").filter((l) => l.startsWith("## "));
    expect(new Set(heads).size).toBe(heads.length);
    expect(heads[0]).toMatch(/^## In use: version 2/);
    expect(heads.slice(1)).toEqual([expect.stringMatching(/^## Version 1 .*no longer in use/), expect.stringMatching(/^## Written by AI, not in use \(v2-r9/), expect.stringMatching(/^## Written by AI, not in use \(v2-r7/), expect.stringMatching(/^## WP-2's starting list/)]);
    expect(md).toMatch(/Why: Seen in the backlog/);
  });

  const TITLE = "Rebuild the invoices page for Morgan";
  const items = [item({ id: 1, type: "Feature", title: TITLE, desc: "<p>Pasted text from the request: call me</p>" }), ...Array.from({ length: 30 }, (_, k) => item({ id: 10 + k, type: "Story", parent: 1, title: `Load table ${k} for Morgan Lee` }))];
  const client = (key: string, labels: Map<number, { labels: Labels; labelsB: Labels | null; from?: string }>): ReportClient => {
    const analysis = analysisOf(items, {}, W);
    return { key, mine: true, platform: null, scope: null, analysis, snapshot: analysis.build, results: resultsOf(items, labels, analysis.kindsMap, { read: 40, outside: 9, skippedForAi: false, failed: new Set() }) };
  };

  it("the summary: which list the labels are on, labels from two lists said, the sample as it is, no chain, no common shape in one line, no titles, people or pasted text", () => {
    const labels = new Map(items.map((i) => [i.id, { labels: L({ requestType: i.id === 1 ? "foundation build" : "new report", missing: ["grain", "business rule"] }), labelsB: i.id % 3 ? null : L({ missing: ["grain"] }), from: i.id < 20 ? "own-1" : "v2-r7" }]));
    const md = summaryMarkdown([client("adatum", labels), client("fabrikam", labels)], "2026-11-12T17:00:00Z", { listVersion: "own-1", labelsOn: "in use" });
    expect(md).toMatch(/Labels are on the request type list in use, version 1 \(in use\)\./);
    expect(md).toMatch(/Carried to it without AI: \d+ made on the list written by AI\./);
    expect(md).toMatch(/Agreement sample: 20 of 62 \(42 not asked yet\)\./);
    expect(md).not.toMatch(/chain|in the order the children were created/i);
    expect(md).toContain(NO_COMMON_SHAPE);
    expect(md).toMatch(/\| business rule \| 20 \| 0 \| 0%, not reliable yet \|/);
    expect(md).toMatch(/\| grain \| 20 \| 20 \| 100% \|/);
    expect(md).toMatch(/#### Request types\n\n\| \| adatum \| fabrikam \| All clients \| Without adatum \|/);
    expect(md).not.toMatch(/Rebuild the invoices|Morgan|Pasted text|call me|Load table/);
  });
});

describe("WP-3: review fixes", () => {
  it("a curly apostrophe can't make a second can't tell, and an unclear name typed on a phone is refused", () => {
    expect(typeof applyEdit(OWN_START, { kind: "add", name: "can’t tell", meaning: "x", example: "", relabel: "other" }, { why: "w", by: ME, at: AT, namesClient: noClient })).toBe("string");
    expect(typeof applyEdit(OWN_START, { kind: "rename", from: "can’t tell", to: "thin" }, { why: "w", by: ME, at: AT, namesClient: noClient })).toBe("string");
    expect(typeof applyEdit(OWN_START, { kind: "add", name: "we can’t tell yet", meaning: "x", example: "", relabel: "other" }, { why: "w", by: ME, at: AT, namesClient: noClient })).toBe("string");
  });

  it("a client's project name counts as naming the client", () => {
    const named = clientNamer([{ key: "adatum", names: [], projects: ["Northwind Reporting"] }]);
    expect(named("northwind reporting fixes")).toBe(true);
    expect(typeof applyEdit(OWN_START, { kind: "add", name: "Northwind Reporting work", meaning: "x", example: "", relabel: "other" }, { why: "w", by: ME, at: AT, namesClient: named })).toBe("string");
  });

  it("a merge, like a remove, keeps at least two real types", () => {
    let l = OWN_START;
    const real = () => l.types.filter((t) => t.name !== "can't tell" && t.name !== "other");
    while (real().length > 2) l = edit(l, { kind: "remove", name: real()[0]!.name });
    expect(typeof applyEdit(l, { kind: "merge", from: real()[0]!.name, into: real()[1]!.name }, { why: "w", by: ME, at: AT, namesClient: noClient })).toBe("string");
  });

  it("a removed type's labels stay removed when a later type reuses its name and is renamed or merged", () => {
    const v2 = edit(OWN_START, { kind: "remove", name: "exploration" });
    const v3 = edit(v2, { kind: "add", name: "exploration", meaning: "A new meaning", example: "", relabel: "other" });
    const v4 = edit(v3, { kind: "rename", from: "exploration", to: "discovery work" });
    const { carried } = resolveLabels([row(1, "own-1", L({ requestType: "exploration" }))], [OWN_START, v2, v3, v4], v4);
    expect(carried.get(1)).toMatchObject({ labels: { requestType: "exploration (removed)" }, stale: "removed" });
    // A label marked for an add still follows a rename of its type.
    const v5 = edit(v4, { kind: "add", name: "spreadsheet", meaning: "Spreadsheets", example: "", relabel: "all" });
    const v6 = edit(v5, { kind: "rename", from: "new report", to: "report build" });
    expect(resolveLabels([row(2, "own-4", L({ requestType: "new report" }))], [OWN_START, v2, v3, v4, v5, v6], v6).carried.get(2)).toMatchObject({ labels: { requestType: "report build" }, stale: "added" });
  });

  it("a failure on an earlier list that carries counts on the list in use; one on a list that can't carry doesn't", () => {
    const v2 = edit(OWN_START, { kind: "rename", from: "new report", to: "report build" });
    const v1: TypeList = { ...STARTING_LIST, version: "v1" };
    const f = failuresOf([row(1, "own-1", null, { rev: 3 }), row(2, "own-1", L(), { failedB: true, rev: 2 }), row(3, "v1", null)], [OWN_START, v2, v1], v2);
    expect([...f.a]).toEqual([[1, 3]]);
    expect([...f.b]).toEqual([[2, 2]]);
  });

  it("says which list the labels were made on, and how many were carried from where", () => {
    expect(fromWords({ "own-2": 40 }, "own-2")).toBe("Every label was made on the list in use (version 2).");
    const w = fromWords({ "own-2": 40, "own-1": 10, "v2-r7": 300 }, "own-2");
    expect(w).toMatch(/^Labels made on the list in use: 40\. Carried to it from earlier lists/);
    expect(w).toMatch(/300 from the list written by AI, 10 from version 1/);
  });

  it("a per-client table ignores a named largest client that has no column (no 'Without' equal to All clients)", () => {
    const r = (n: number): Results => ({ ...sumResults([]), labeled: n, requestTypes: { "new report": n } });
    const t = clientTable([{ key: "adatum", r: r(30) }, { key: "fabrikam", r: r(25) }], (x) => x.requestTypes, { largest: "contoso" });
    expect(t.columns).toEqual(["adatum", "fabrikam", "All clients", "Without adatum"]);
    expect(clientTable([{ key: "adatum", r: r(30) }], (x) => x.requestTypes, { largest: null }).columns).toEqual(["adatum", "All clients"]);
  });
});
