import { describe, expect, it } from "vitest";
import type { PortfolioItem, WorkItem } from "../week/types.ts";
import { addPaneRows } from "./weekadd.ts";

const url = (id: number) => `https://dev.azure.com/o/p/_workitems/edit/${id}`;
const pItem = (over: Partial<PortfolioItem>): PortfolioItem => ({
  id: 210, title: "Export", type: "Feature", state: "Active", stateCategory: "InProgress", tier: "feature", order: 1, parentId: null, url: url(over.id ?? 210),
  targetDate: "2026-11-20", assignedTo: null, mine: true, why: ["assigned"], children: [], ...over,
});
const child = (id: number, open = true, type = "User Story") =>
  ({ id, title: `Child ${id}`, type, state: open ? "Active" : "Closed", stateCategory: open ? "InProgress" : "Completed", open, level: "story" as const, order: id, url: url(id), assignedTo: null, mine: true });
const story = (id: number, parentId: number | null, type = "User Story"): WorkItem =>
  ({ id, title: `Story ${id}`, type, state: "New", stateCategory: "Proposed", level: "story", order: id, parentId, changedAt: "", url: url(id) });

// One client: an epic with no features, an epic over feature 210, feature 210 with two open stories and a closed one,
// feature 220 with none; my stories: 211 (under 210), 300 (no parent), 301 (straight under the epic), 302 (a Bug, no parent).
const epicBare = pItem({ id: 100, title: "New platform", type: "Epic", tier: "epic", children: [] });
const epic = pItem({ id: 101, title: "Reporting", type: "Epic", tier: "epic", targetDate: null, children: [{ ...child(210), type: "Feature", level: "portfolio" as const }] });
const f210 = pItem({ id: 210, parentId: 101, children: [child(211), child(212), child(213, false)] });
const f220 = pItem({ id: 220, title: "Audit trail", type: "Feature", targetDate: null, children: [] });
const portfolio = [epicBare, epic, f210, f220];
const work = [story(211, 210), story(300, null), story(301, 101), story(302, null, "Bug")];

describe("Plan the week's Add to <client> rows (D437)", () => {
  const rows = addPaneRows({ portfolio, work, listed: new Set() });

  it("offers no epics and no story that has a parent feature", () => {
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(100);
    expect(ids).not.toContain(101);
    expect(ids).not.toContain(211);
    expect(ids).not.toContain(212);
  });

  it("offers an orphan story (no parent, or straight under an epic)", () => {
    expect(rows.map((r) => r.id)).toEqual([210, 220, 300, 301, 302]);
  });

  it("nests a feature's open stories under it, not as rows", () => {
    const f = rows.find((r) => r.id === 210)!;
    expect(f.nested.map((c) => c.id)).toEqual([211, 212]);
    expect(rows.find((r) => r.id === 220)!.nested).toEqual([]);
    expect(rows.find((r) => r.id === 220)!.flag).toBe("no stories");
  });

  it("gives every row its DevOps type, drawn as an icon (WT-1), never a type word", () => {
    expect(rows.map((r) => r.type)).toEqual(["Feature", "Feature", "User Story", "User Story", "Bug"]);
    expect(rows.flatMap((r) => r.nested.map((c) => c.type))).toEqual(["User Story", "User Story"]);
    expect(rows.find((r) => r.id === 210)!.targetDate).toBe("2026-11-20");
    const scrum = addPaneRows({ portfolio: [pItem({ id: 400, children: [child(401, true, "Product Backlog Item")] })], work: [story(402, null, "Product Backlog Item")], listed: new Set() });
    expect(scrum[0]!.nested[0]!.type).toBe("Product Backlog Item");
  });

  it("a type that doesn't need breakdown never says no stories; a resolved story isn't offered", () => {
    const r = addPaneRows({ portfolio: [pItem({ id: 500, needsBreakdown: false, children: [] })], work: [{ ...story(501, null), stateCategory: "Resolved" }], listed: new Set() });
    expect(r.map((x) => [x.id, x.flag])).toEqual([[500, null]]);
  });

  it("leaves out what is on the list: a listed feature, a listed story, and a listed story nested under a feature", () => {
    const r = addPaneRows({ portfolio, work, listed: new Set([220, 212, 300]) });
    expect(r.map((x) => x.id)).toEqual([210, 301, 302]);
    expect(r[0]!.nested.map((c) => c.id)).toEqual([211]);
  });
});
