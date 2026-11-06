// BH-1: Ahead › Backlog: each client's own backlog order at one tier, stale items, and what a bulk action stages or skips.
import { describe, expect, it } from "vitest";
import { anAheadClient, anAheadItem, anAheadLoad, anAssignee } from "../test/builders/index.ts";
import { DEFAULT_FILTERS } from "./ahead-model.ts";
import { ageText, backlogGroups, bulkDecide, isStale, lastText, nextMonday, type BulkItem } from "./backlog.ts";

const ME = "you@cooptimize.example";
const me = { name: "Alex Rivera", email: ME };
const story = (o: Parameters<typeof anAheadItem>[0]) => anAheadItem({ type: "User Story", level: "child", rung: 2, ...o });
const all = (k: string) => ({ ...DEFAULT_FILTERS, owner: { [k]: "all" as const } });

describe("Backlog order", () => {
  it("follows each client's stored backlog order, two processes with different order fields side by side", () => {
    // StackRank (Agile) and BacklogPriority (Scrum) both arrive as `order`, ascending; ids and changes don't matter.
    const agile = anAheadClient({ clientKey: "Northwind", orderField: "Microsoft.VSTS.Common.StackRank", items: [story({ id: 11, order: 3000 }), story({ id: 12, order: 1000 }), story({ id: 13, order: null }), story({ id: 14, order: 2000 })] });
    const scrum = anAheadClient({ clientKey: "Fabrikam", clientName: "Fabrikam", orderField: "Microsoft.VSTS.Common.BacklogPriority", items: [story({ id: 21, order: 9.5 }), story({ id: 22, order: 1.25 })] });
    const load = anAheadLoad([agile, scrum]);
    const g = backlogGroups(load, { ...DEFAULT_FILTERS, owner: { Northwind: "all", Fabrikam: "all" } }, { staleWeeks: 6 });
    expect(g.map((x) => [x.client.clientKey, x.rankedBy, x.rows.map((r) => [r.rank, r.item.id])])).toEqual([
      ["Northwind", "backlog", [[1, 12], [2, 14], [3, 11], [4, 13]]],
      ["Fabrikam", "backlog", [[1, 22], [2, 21]]],
    ]);
    // No cross-client mixing: every row is its own client's.
    for (const x of g) expect(x.rows.every((r) => r.clientKey === x.client.clientKey)).toBe(true);
  });
  it("a project with no order field is ranked by target date", () => {
    const c = anAheadClient({ orderField: null, items: [story({ id: 1, target: "2026-12-20" }), story({ id: 2, target: "2026-11-20" }), story({ id: 3 })] });
    const [g] = backlogGroups(anAheadLoad([c]), all("Northwind"), { staleWeeks: 6 });
    expect([g!.rankedBy, g!.rows.map((r) => r.item.id)]).toEqual(["target", [2, 1, 3]]);
  });
  it("one tier at a time, open items in scope only; the rank is the backlog's, before the owner filter", () => {
    const items = [
      anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, order: 1 }),
      anAheadItem({ id: 110, parentId: 100, order: 2 }),
      story({ id: 111, parentId: 110, order: 3, assignee: anAssignee("Dana Reyes") }),
      story({ id: 112, parentId: 110, order: 4, assignee: me }),
      story({ id: 113, parentId: 110, order: 5, state: "Closed", stateCategory: "Completed" }),
      story({ id: 114, parentId: 110, order: 6, inScope: false }),
    ];
    const load = anAheadLoad([anAheadClient({ items })]);
    const f = (tier: "epic" | "feature" | "story", owner: "mine" | "all") => backlogGroups(load, { ...DEFAULT_FILTERS, owner: { Northwind: owner }, tier }, { staleWeeks: 6 })[0]!;
    expect(f("story", "all").rows.map((r) => r.item.id)).toEqual([111, 112]);
    expect(f("feature", "all").rows.map((r) => r.item.id)).toEqual([110]);
    expect(f("epic", "all").rows.map((r) => r.item.id)).toEqual([100]);
    // Mine keeps my story with its backlog rank (2), not a rank among mine.
    expect(f("story", "mine").rows.map((r) => [r.rank, r.item.id])).toEqual([[2, 112]]);
  });
  it("the client multi-select keeps only the chosen clients", () => {
    const load = anAheadLoad([anAheadClient({ items: [story({ id: 1 })] }), anAheadClient({ clientKey: "Fabrikam", clientName: "Fabrikam", items: [story({ id: 2 })] }), anAheadClient({ clientKey: "Contoso", clientName: "Contoso", items: [story({ id: 3 })] })]);
    const g = backlogGroups(load, { ...DEFAULT_FILTERS, clients: ["Fabrikam", "Contoso"], owner: { Fabrikam: "all", Contoso: "all" } }, { staleWeeks: 6 });
    expect(g.map((x) => [x.client.clientKey, x.rows.map((r) => r.item.id)])).toEqual([["Fabrikam", [2]], ["Contoso", [3]]]);
  });
});

describe("Stale", () => {
  const today = "2026-11-06";
  it("an open item untouched for the setting's weeks is stale; done items never are; unknown dates never are", () => {
    expect(isStale({ stateCategory: "InProgress", changedAt: "2026-09-25T10:00:00Z" }, today, 6)).toBe(true); // 42 days
    expect(isStale({ stateCategory: "InProgress", changedAt: "2026-09-26T10:00:00Z" }, today, 6)).toBe(false); // 41 days
    expect(isStale({ stateCategory: "Completed", changedAt: "2026-01-01T10:00:00Z" }, today, 6)).toBe(false);
    expect(isStale({ stateCategory: "Resolved", changedAt: "2026-01-01T10:00:00Z" }, today, 6)).toBe(false);
    expect(isStale({ stateCategory: "Proposed", changedAt: "" }, today, 6)).toBe(false);
  });
  it("changing the setting changes the count; the Stale filter keeps only stale rows", () => {
    const items = [story({ id: 1, changedAt: "2026-10-01T10:00:00Z" }), story({ id: 2, changedAt: "2026-09-01T10:00:00Z" }), story({ id: 3, changedAt: "2026-11-05T10:00:00Z" }), story({ id: 4, changedAt: "2026-08-01T10:00:00Z", state: "Closed", stateCategory: "Completed" })];
    const load = anAheadLoad([anAheadClient({ items })], { today });
    const at = (weeks: number, stale = false) => backlogGroups(load, { ...all("Northwind"), stale }, { staleWeeks: weeks })[0]!;
    expect(at(6).stale).toBe(1);
    expect(at(4).stale).toBe(2);
    expect(at(1).stale).toBe(2);
    expect(at(26).stale).toBe(0);
    expect(at(4, true).rows.map((r) => r.item.id)).toEqual([1, 2]);
  });
  it("the last change in words, with what changed while the change log has it", () => {
    expect([0, 1, 5, 20, 45, 120, null].map(ageText)).toEqual(["today", "yesterday", "5 days ago", "2 weeks ago", "6 weeks ago", "4 months ago", "not known"]);
    expect(lastText(3, { kind: "state", at: "x" })).toBe("3 days ago · state");
    expect(lastText(45, { kind: "state", at: "x" })).toBe("6 weeks ago");
  });
});

describe("Bulk actions", () => {
  const base: BulkItem = { id: 1, type: "Feature", editable: true, note: "Only Northwind Foods's leads and the owner can change this.", hasTarget: true, target: "2026-11-20", mine: false };
  it("push, a chosen date, set where there's none, assign to me", () => {
    expect(bulkDecide(base, { kind: "push", weeks: 2 }, "Portal")).toEqual({ ok: true, step: { field: "target", value: "2026-12-04" } });
    expect(bulkDecide(base, { kind: "push", weeks: 4 }, "Portal")).toEqual({ ok: true, step: { field: "target", value: "2026-12-18" } });
    expect(bulkDecide(base, { kind: "move", date: "2027-01-08" }, "Portal")).toEqual({ ok: true, step: { field: "target", value: "2027-01-08" } });
    expect(bulkDecide({ ...base, target: null }, { kind: "set_missing", date: "2027-01-08" }, "Portal")).toEqual({ ok: true, step: { field: "target", value: "2027-01-08" } });
    expect(bulkDecide(base, { kind: "assign_me" }, "Portal")).toEqual({ ok: true, step: { field: "assignee", value: "me" } });
  });
  it("skips with a reason: not mine to change, no field, nothing to push, already set, already mine", () => {
    const why = (i: Partial<BulkItem>, op: Parameters<typeof bulkDecide>[1]) => {
      const d = bulkDecide({ ...base, ...i }, op, "Portal");
      return d.ok ? null : d.reason;
    };
    expect(why({ editable: false }, { kind: "push", weeks: 2 })).toBe("Only Northwind Foods's leads and the owner can change this.");
    expect(why({ hasTarget: false, type: "User Story" }, { kind: "push", weeks: 2 })).toBe("User Story has no target date in Portal's process");
    expect(why({ target: null }, { kind: "push", weeks: 2 })).toBe("No target date to push. Use Set a target date");
    expect(why({}, { kind: "set_missing", date: "2027-01-08" })).toBe("Already has a target date (Nov 20)");
    expect(why({ mine: true }, { kind: "assign_me" })).toBe("Already yours");
  });
  it("Plan it goes to next week", () => {
    expect([nextMonday("2026-11-06"), nextMonday("2026-11-02"), nextMonday("2026-11-08")]).toEqual(["2026-11-09", "2026-11-09", "2026-11-09"]);
  });
});
