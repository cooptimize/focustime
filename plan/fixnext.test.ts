import { describe, expect, it } from "vitest";
import { entryKey, fixClient, fixRows, gapsOf, inWindow, type FixClient, type FixItem, type GapItem } from "./fixnext.ts";

const TODAY = "2026-11-05";
const item = (o: Partial<GapItem> & { id: number }): GapItem => ({ clientKey: "k", open: true, needsBreakdown: false, openChildren: 1, startField: "S", targetField: "T", sizeField: "Z", child: false, start: "2026-11-09", target: "2026-11-20", size: null, assigneeEmail: "a@example.com", canEdit: true, ...o });
/** A story by default: no dates (out of the window), sized, assigned; low in the backlog unless `order` says. */
const fx = (o: Partial<FixItem> & { id: number }): FixItem => ({ ...item({ id: o.id }), tier: "story", child: true, parentId: null, order: 10_000 + o.id, inScope: true, mine: false, start: null, target: null, size: 3, ...o });
const client = (items: FixItem[], o: Partial<FixClient> = {}): FixClient => ({ clientKey: "k", orderField: "Microsoft.VSTS.Common.StackRank", gaps: ["needs_stories", "no_dates", "unassigned", "unsized"], items, ...o });

describe("Fix next's gaps (D662, AH-3)", () => {
  it("finds the gaps an item has, only where the process has the field and I may edit", () => {
    expect(gapsOf(item({ id: 1, needsBreakdown: true, openChildren: 0, target: null, assigneeEmail: null }))).toEqual(["needs_stories", "no_dates", "unassigned"]);
    // AH-3: a missing start alone isn't a gap; No target date is.
    expect(gapsOf(item({ id: 7, start: null }))).toEqual([]);
    expect(gapsOf(item({ id: 2, child: true, start: null, target: null }))).toEqual(["unsized"]);
    expect(gapsOf(item({ id: 3, child: true, sizeField: null }))).toEqual([]);
    expect(gapsOf(item({ id: 4, assigneeEmail: null, canEdit: false }))).toEqual([]);
  });
  it("a pending change fills its gap", () => {
    const i = item({ id: 5, assigneeEmail: null });
    expect(gapsOf(i, [{ clientKey: "k", itemId: 5, field: "assignee", value: { email: "b@example.com", name: "B" } }])).toEqual([]);
    expect(gapsOf(item({ id: 6 }), [{ clientKey: "k", itemId: 6, field: "assignee", value: null }])).toEqual(["unassigned"]);
  });
  it("counts only the gaps the client's Rule keeps (Unsized off for a client that doesn't size)", () => {
    expect(gapsOf(item({ id: 8, child: true, assigneeEmail: null }), [], ["needs_stories", "no_dates", "unassigned"])).toEqual(["unassigned"]);
    const c = client([fx({ id: 1, order: 1, size: null }), fx({ id: 2, order: 2, assigneeEmail: null })], { gaps: ["needs_stories", "no_dates", "unassigned"] });
    expect(fixClient(c, { today: TODAY }).entries.map((e) => e.itemId)).toEqual([2]);
  });
});

describe("Fix next's candidates and rank (AH-3)", () => {
  it("only items near the top of each tier's backlog, dated in the next 4 weeks, or mine; lower backlog items never show", () => {
    const stories = Array.from({ length: 40 }, (_, n) => fx({ id: 100 + n, order: n + 1, size: null }));
    const lowDated = fx({ id: 300, order: 9999, size: null, target: "2026-11-20" });
    const lowMine = fx({ id: 301, order: null, tier: "feature", child: false, needsBreakdown: true, openChildren: 0, target: "2027-06-01", mine: true });
    const lowFar = fx({ id: 302, order: 9997, size: null, target: "2027-06-01" });
    const g = fixClient(client([...stories, lowDated, lowMine, lowFar]), { today: TODAY, topN: 30 });
    const ids = g.entries.map((e) => e.itemId);
    expect(ids.slice(0, 30)).toEqual(stories.slice(0, 30).map((s) => s.id));
    expect(ids).toContain(300);
    expect(ids).toContain(301);
    expect(ids).not.toContain(302);
    expect(ids).not.toContain(130);
    expect(g.entries.find((e) => e.itemId === 300)!.why).toEqual(["window"]);
    expect(g.entries.find((e) => e.itemId === 301)!.why).toEqual(["mine"]);
  });
  it("ranks each tier on its own, so the top features count even when stories rank higher in number", () => {
    const features = Array.from({ length: 12 }, (_, n) => fx({ id: 500 + n, tier: "feature", child: false, order: 1_000_000 + n, target: null }));
    const g = fixClient(client(features), { today: TODAY, topN: 10 });
    expect(g.entries.map((e) => e.itemId)).toEqual(features.slice(0, 10).map((f) => f.id));
  });
  it("a feature directly under an epic of mine counts as mine", () => {
    const epic = fx({ id: 1, tier: "epic", child: false, mine: true, order: 9999, target: "2027-01-01" });
    const f = fx({ id: 2, tier: "feature", child: false, parentId: 1, order: null, target: null });
    expect(fixClient(client([epic, f]), { today: TODAY, topN: 10 }).entries.map((e) => [e.itemId, e.why])).toEqual([[2, ["mine"]]]);
  });
  it("ranks by backlog order, ties by target date, then id; one entry per item with its first gap as the action", () => {
    const a = fx({ id: 3, order: 2, size: null, assigneeEmail: null, target: "2026-11-30" });
    const b = fx({ id: 2, order: 2, size: null, target: "2026-11-10" });
    const c = fx({ id: 1, order: 5, size: null });
    const g = fixClient(client([c, a, b]), { today: TODAY });
    expect(g.rankedBy).toBe("backlog");
    expect(g.entries.map((e) => e.itemId)).toEqual([2, 3, 1]);
    expect(g.entries[1]).toMatchObject({ gaps: ["unassigned", "unsized"], action: "unassigned" });
  });
  it("a project with no backlog order field ranks by target date (and only dated or mine items qualify)", () => {
    const g = fixClient(client([fx({ id: 1, size: null, target: "2026-11-25" }), fx({ id: 2, size: null, target: "2026-11-08" }), fx({ id: 3, size: null })], { orderField: null }), { today: TODAY });
    expect(g.rankedBy).toBe("target");
    expect(g.entries.map((e) => e.itemId)).toEqual([2, 1]);
  });
  it("never offers an item outside Cooptimize's scope, and Skip puts one aside", () => {
    const items = [fx({ id: 1, order: 1, size: null, inScope: false }), fx({ id: 2, order: 2, size: null }), fx({ id: 3, order: 3, size: null })];
    expect(fixClient(client(items), { today: TODAY, skipped: new Set([entryKey("k", 2)]) }).entries.map((e) => e.itemId)).toEqual([3]);
  });
  it("the window: a start or target in the next 4 weeks, or a span across it", () => {
    expect(inWindow({ start: null, target: "2026-12-03" }, TODAY)).toBe(true);
    expect(inWindow({ start: null, target: "2026-12-04" }, TODAY)).toBe(false);
    expect(inWindow({ start: "2026-10-01", target: "2027-01-01" }, TODAY)).toBe(true);
    expect(inWindow({ start: null, target: "2026-11-04" }, TODAY)).toBe(false);
    expect(inWindow({ start: null, target: null }, TODAY)).toBe(false);
  });
});

describe("Fix next's rows: client › epic › feature (AH-3)", () => {
  it("puts each entry under its ancestors, headers where they aren't entries, siblings by their best entry, top N only", () => {
    const items = [
      fx({ id: 1, tier: "epic", child: false, target: "2027-06-01" }),
      fx({ id: 10, tier: "feature", child: false, parentId: 1, target: "2027-06-01" }),
      fx({ id: 11, tier: "feature", child: false, parentId: 1, target: "2027-06-01" }),
      fx({ id: 100, parentId: 10, order: 3, size: null }),
      fx({ id: 101, parentId: 11, order: 1, size: null }),
      fx({ id: 102, parentId: 10, order: 2, size: null }),
      fx({ id: 103, parentId: null, order: 4, size: null }),
    ];
    const g = fixClient(client(items), { today: TODAY });
    expect(g.entries.map((e) => e.itemId)).toEqual([101, 102, 100, 103]);
    const rows = fixRows(g, items);
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.itemId}${r.entry ? "" : " (header)"}`)).toEqual(["1 (header)", "  11 (header)", "    101", "  10 (header)", "    102", "    100", "103"]);
    expect(fixRows(g, items, 2).map((r) => r.itemId)).toEqual([1, 11, 101, 10, 102]);
  });
});
