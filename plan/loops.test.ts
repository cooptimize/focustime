import { describe, expect, it } from "vitest";
import { detectLoops, isBlocked, slipDraft, watchedIds, type DetectInput, type LoopLike, type WorkState } from "./loops.ts";
import type { Pick } from "./types.ts";
import type { WorkItem } from "../week/types.ts";

const T = (hm: string, d = "2026-11-02") => `${d}T${hm}:00-05:00[America/New_York]`;
const pick = (over: Partial<Pick>): Pick => ({
  id: 1, date: "2026-11-02", half: "PM", clientKey: "CSC", kind: "item", itemId: 101, draftId: null, title: "Export report", itemType: "User Story", itemUrl: null,
  size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, position: 1, createdAt: T("08:00"), updatedAt: T("08:00"), ...over,
});
const item = (over: Partial<WorkItem>): WorkItem => ({ id: 101, title: "Export report", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: "2026-11-02T13:00:00Z", url: "https://dev.azure.com/o/p/_workitems/edit/101", ...over });
const work = (items: WorkItem[], over: Partial<WorkState> = {}): WorkState => ({ clientKey: "CSC", status: "ok", fromCache: false, items, ...over });
const loop = (over: Partial<LoopLike>): LoopLike => ({ id: 1, kind: "devops_update", clientKey: "CSC", itemId: 101, ruleKey: "devops_update:1", refAt: T("15:00"), detail: null, openedAt: T("17:15"), closedAt: null, closedBy: null, ...over });

function input(over: Partial<DetectInput> = {}): DetectInput {
  const picks = over.picks ?? [];
  return {
    today: "2026-11-02",
    picks,
    pick: (id) => picks.find((p) => p.id === id) ?? null,
    committedAt: () => T("08:30"),
    movedTo: () => null,
    work: [],
    loops: [],
    internal: new Set(["Cooptimize"]),
    clientName: (k) => (k === "CSC" ? "CSC" : k),
    ...over,
  };
}

describe("loop rule: pick done, DevOps not updated (step 7)", () => {
  const done = pick({ status: "done", updatedAt: T("15:00") });
  it("opens when the item is still in an open state and hasn't changed since the tick", () => {
    const r = detectLoops(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T18:00:00Z" })])] }));
    expect(r.open).toEqual([expect.objectContaining({ kind: "devops_update", ruleKey: "devops_update:1", who: "CSC", what: "Update DevOps #101: Export report", itemId: 101, refAt: T("15:00") })]);
  });
  it("doesn't open when the item was already updated after the tick, is resolved, or isn't known", () => {
    expect(detectLoops(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T20:30:00Z" })])] })).open).toEqual([]);
    expect(detectLoops(input({ picks: [done], work: [work([item({ stateCategory: "Resolved", state: "Resolved" })])] })).open).toEqual([]);
    expect(detectLoops(input({ picks: [done], work: null })).open).toEqual([]);
    expect(detectLoops(input({ picks: [done], work: [work([])] })).open).toEqual([]);
    // Intentions and future days have no DevOps item to update.
    expect(detectLoops(input({ picks: [pick({ status: "done", kind: "intention", itemId: null })], work: [work([item({})])] })).open).toEqual([]);
  });
  it("opens once: a loop already there (open or closed) for that pick, or open for that item, stops another", () => {
    const w = [work([item({ changedAt: "2026-11-02T18:00:00Z" })])];
    expect(detectLoops(input({ picks: [done], work: w, loops: [loop({ closedAt: T("17:30"), closedBy: "me" })] })).open).toEqual([]);
    const again = pick({ id: 2, date: "2026-11-02", status: "done", updatedAt: T("16:00") });
    expect(detectLoops(input({ picks: [again], work: w, loops: [loop({})] })).open).toEqual([]);
  });
  it("closes when a later fetch shows the item completed or changed after the tick", () => {
    const open = [loop({})];
    const completed = work([], { watched: [item({ state: "Closed", stateCategory: "Completed", changedAt: "2026-11-02T22:00:00Z" })] });
    expect(detectLoops(input({ picks: [done], work: [completed], loops: open })).close).toEqual([{ id: 1, note: "DevOps #101 is Closed" }]);
    const changed = work([item({ changedAt: "2026-11-02T21:00:00Z" })]);
    expect(detectLoops(input({ picks: [done], work: [changed], loops: open })).close).toEqual([{ id: 1, note: "DevOps #101 was updated" }]);
  });
  it("stays open on a cached or failed fetch, or while nothing changed", () => {
    const open = [loop({})];
    const completed = item({ state: "Closed", stateCategory: "Completed" });
    expect(detectLoops(input({ picks: [done], work: [work([], { watched: [completed], fromCache: true })], loops: open })).close).toEqual([]);
    expect(detectLoops(input({ picks: [done], work: [work([], { status: "auth_failed", watched: [completed] })], loops: open })).close).toEqual([]);
    expect(detectLoops(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T19:00:00Z" })])], loops: open })).close).toEqual([]);
  });
  it("closes when the pick is no longer ticked done", () => {
    expect(detectLoops(input({ picks: [pick({ status: "planned" })], loops: [loop({})] })).close).toEqual([{ id: 1, note: "The pick is no longer marked done" }]);
  });
});

describe("loop rule: slipped work owes the client a heads-up", () => {
  const moved = pick({ id: 5, status: "moved", updatedAt: T("17:10") });
  const dropped = pick({ id: 6, itemId: null, kind: "intention", title: "Review the mapping", status: "dropped", updatedAt: T("17:12") });
  const target = pick({ id: 9, date: "2026-11-04", half: "PM", carriedFrom: 5 });
  const movedTo = (id: number) => (id === 5 ? target : null);

  it("opens one loop per client and day with a copyable plain-text draft naming each item and its new plan", () => {
    const r = detectLoops(input({ picks: [moved, dropped], movedTo }));
    expect(r.open).toHaveLength(1);
    expect(r.open[0]).toMatchObject({ kind: "slip", clientKey: "CSC", who: "CSC", what: "Heads-up to CSC about the slip (2 items)", detail: { picks: [5, 6], date: "2026-11-02" } });
    expect(r.open[0]!.draft).toBe(
      ["Hi CSC, a quick heads-up on my plan for Mon, Nov 2:", "- #101 Export report: moving to Wed, Nov 4 (afternoon)", "- Review the mapping: off my plan for now; I'll come back with a new date", "I'll keep you posted."].join("\n"),
    );
  });
  it("only for committed days, changes after the commit, and clients other than Cooptimize", () => {
    expect(detectLoops(input({ picks: [moved], committedAt: () => null })).open).toEqual([]);
    expect(detectLoops(input({ picks: [pick({ id: 5, status: "moved", updatedAt: T("08:10") })] })).open).toEqual([]);
    expect(detectLoops(input({ picks: [pick({ id: 5, status: "moved", clientKey: "Cooptimize", updatedAt: T("17:10") })] })).open).toEqual([]);
  });
  it("adds later slips to the open loop for that client and day; once told, a new slip opens a new one", () => {
    const told = loop({ id: 3, kind: "slip", itemId: null, ruleKey: "slip:2026-11-02:CSC:5", detail: { picks: [5], date: "2026-11-02" } });
    const r = detectLoops(input({ picks: [moved, dropped], movedTo, loops: [told] }));
    expect(r.open).toEqual([]);
    expect(r.update).toEqual([expect.objectContaining({ id: 3, what: "Heads-up to CSC about the slip (2 items)", detail: { picks: [5, 6], date: "2026-11-02" } })]);
    const closed = { ...told, closedAt: T("17:20"), closedBy: "me" as const };
    const r2 = detectLoops(input({ picks: [moved, dropped], movedTo, loops: [closed] }));
    expect(r2.update).toEqual([]);
    expect(r2.open).toEqual([expect.objectContaining({ ruleKey: "slip:2026-11-02:CSC:6", detail: { picks: [6], date: "2026-11-02" } })]);
  });
  it("keeps each client's draft to its own items", () => {
    const other = pick({ id: 7, clientKey: "W&C", itemId: 7001, title: "Pump curve", status: "dropped", updatedAt: T("17:12") });
    const r = detectLoops(input({ picks: [moved, other], movedTo }));
    expect(r.open.map((l) => [l.clientKey, l.draft!.includes("Pump curve"), l.draft!.includes("Export report")])).toEqual([
      ["CSC", false, true],
      ["W&C", true, false],
    ]);
  });
  it("names the slip in the draft template", () => {
    expect(slipDraft("W&C", "2026-11-03", [pick({ itemId: 7, title: "X", status: "dropped" })], () => null)).toContain("- #7 X: off my plan for now");
  });
});

describe("loop rule: a blocked item assigned to me", () => {
  it("is blocked by its state or a tag", () => {
    expect(isBlocked("10-Blocked", [])).toBe(true);
    expect(isBlocked("Active", ["Blocked by vendor"])).toBe(true);
    expect(isBlocked("Active", ["Unblocker"])).toBe(false);
  });
  it("opens 'Nudge on blocker' from a fresh fetch, once while blocked", () => {
    const w = [work([item({ id: 202, title: "Waiting on API keys", blocked: true })])];
    const items = [...w[0]!.items];
    const r = detectLoops(input({ work: w }));
    expect(r.open).toEqual([expect.objectContaining({ kind: "blocked", ruleKey: "blocked:CSC:202:1", what: "Nudge on blocker for #202: Waiting on API keys", itemId: 202 })]);
    expect(detectLoops(input({ work: [work(items, { fromCache: true })] })).open).toEqual([]);
    const nudged = loop({ id: 4, kind: "blocked", itemId: 202, ruleKey: "blocked:CSC:202:1", closedAt: T("17:20"), closedBy: "me" });
    expect(detectLoops(input({ work: w, loops: [nudged] })).open).toEqual([]);
    // Unblocked (closed by the signal) and blocked again: a new loop.
    expect(detectLoops(input({ work: w, loops: [{ ...nudged, closedBy: "signal" }] })).open.map((l) => l.ruleKey)).toEqual(["blocked:CSC:202:2"]);
  });
  it("closes when a later fetch shows it no longer blocked or completed", () => {
    const open = [loop({ id: 4, kind: "blocked", itemId: 202, ruleKey: "blocked:CSC:202:1" })];
    expect(detectLoops(input({ work: [work([item({ id: 202, blocked: false })])], loops: open })).close).toEqual([{ id: 4, note: "DevOps #202 is no longer blocked" }]);
    expect(detectLoops(input({ work: [work([], { watched: [item({ id: 202, state: "Done", stateCategory: "Completed" })] })], loops: open })).close).toEqual([{ id: 4, note: "DevOps #202 is Done" }]);
    expect(detectLoops(input({ work: [work([item({ id: 202, blocked: true })])], loops: open })).close).toEqual([]);
  });
});

describe("watched items", () => {
  it("lists the items of open DevOps loops per client, so a fetch can read them by id", () => {
    const loops = [loop({}), loop({ id: 2, kind: "blocked", itemId: 202 }), loop({ id: 3, kind: "blocked", itemId: 303, closedAt: T("18:00") }), loop({ id: 4, kind: "slip", itemId: null }), loop({ id: 5, clientKey: "W&C", itemId: 7 })];
    expect(watchedIds(loops)).toEqual({ CSC: [101, 202], "W&C": [7] });
  });
});
