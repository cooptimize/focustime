import { SIZE_MINUTES } from "../plan/types.ts";
import { describe, expect, it } from "vitest";
import type { Pick, PlanWeek, Size } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { WorkItem } from "../week/types.ts";
import { cardPlan, resumeSlots, featuresOn } from "./planview.ts";
import { noStanding, pattern } from "../week/test-helpers.ts";
import { fitLabel } from "./planday.ts";

// Mon Nov 2 AM, 9:00–12:30 with no meetings: 3h 30m free. The clock is before the block starts.
const slot = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config }).days[0]!.am;
const NOW = "2026-11-02T13:00:00Z"; // 8:00 New York
const item = (id: number): WorkItem => ({ id, title: `Item ${id}`, type: "User Story", state: "New", stateCategory: "Proposed", level: "story", order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/org/P/_workitems/edit/${id}` });
const ITEMS = [1, 2, 3, 4, 5].map(item);
let nextId = 1;
const pick = (over: Partial<Pick> & { size?: Size } = {}): Pick => ({ id: nextId++, date: "2026-11-02", half: "AM", clientKey: "Adatum", kind: "item", itemId: 1, draftId: null, title: "Item 1", itemType: "User Story", itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: 1, createdAt: "", updatedAt: "", ...over });
const plan = (picks: Pick[], committed = true): PlanWeek => ({ "2026-11-02": { committedAt: committed ? "2026-11-02T08:10:00-05:00[America/New_York]" : null, picks } });

describe("a card's plan (step 6.1)", () => {
  it("PV-1: before commit the card shows its picks and their fit too (stories are dragged onto Week first)", () => {
    const cp = cardPlan(plan([pick({ itemId: 2, size: "M" })], false), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES);
    expect(cp.picks.map((p) => p.itemId)).toEqual([2]);
    expect(cp.fit).toEqual({ kind: "fits", spare: 90 });
    expect(cardPlan(plan([], false), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES)).toEqual({ picks: [], fit: null, items: ITEMS, collapsed: false });
    expect(cardPlan(null, slot, "Adatum", ITEMS, NOW, SIZE_MINUTES).collapsed).toBe(false);
  });

  it("committed: the picks, their fit against the block's free time, and the list collapsed", () => {
    const cp = cardPlan(plan([pick({ itemId: 2, size: "M" }), pick({ kind: "intention", itemId: null, size: "S" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES);
    expect(cp.picks).toHaveLength(2);
    expect(cp.fit).toEqual({ kind: "fits", spare: 30 }); // 210 free − (120 + 60)
    expect(fitLabel(cp.fit!)).toBe("fits, 30m to spare");
    expect(cp.collapsed).toBe(true);
  });

  it("over by the excess; an unsized pick counts as 1h by default (SZ-1; L is 4h)", () => {
    expect(fitLabel(cardPlan(plan([pick({ size: "L" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES).fit!)).toBe("too much: 30m more than the free time"); // 240 of 210
    expect(cardPlan(plan([pick({ size: null }), pick({ itemId: 3, size: "S" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES).fit).toEqual({ kind: "fits", spare: 90 });
  });

  it("an item picked here is not listed again; another client's pick with the same id is", () => {
    const cp = cardPlan(plan([pick({ itemId: 2 }), pick({ itemId: 4, clientKey: "T&W" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES);
    expect(cp.items.map((i) => i.id)).toEqual([1, 3, 4, 5]);
  });

  it("done picks still count as picked; dropped and moved ones do not show", () => {
    const cp = cardPlan(plan([pick({ itemId: 2, status: "done" }), pick({ itemId: 3, status: "dropped" }), pick({ itemId: 5, status: "moved" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES);
    expect(cp.picks.map((p) => p.itemId)).toEqual([2]);
    expect(cp.items.map((i) => i.id)).toEqual([1, 3, 4, 5]);
    expect(cp.fit).toBeNull(); // nothing left to do, so no fit to show
  });

  it("a block that has ended shows no fit (a past day)", () => {
    expect(cardPlan(plan([pick({ size: "L" }), pick({ itemId: 3, size: "S" })]), slot, "Adatum", ITEMS, "2026-11-03T13:00:00Z", SIZE_MINUTES).fit).toBeNull();
  });

  it("committed with no picks in this half: no fit, the list still collapses", () => {
    const cp = cardPlan(plan([pick({ half: "PM" })]), slot, "Adatum", ITEMS, NOW, SIZE_MINUTES);
    expect(cp).toMatchObject({ picks: [], fit: null, collapsed: true, items: ITEMS });
  });
});

describe("resume notes on the week (step 7)", () => {
  // Adatum on Mon PM and Wed PM; T&W on Tue AM.
  const days = buildWeek({
    weekStart: "2026-11-02",
    patterns: [pattern({ clientKey: "Adatum", clientName: "Adatum", days: { Mon: "PM", Wed: "PM" } }), pattern({ id: "p2", clientKey: "T&W", clientName: "T&W", days: { Tue: "AM" } })],
    events: [],
    config: noStanding,
  }).days;
  it("shows each client's latest note on its next block after the note's day, from today on", () => {
    const notes = { Adatum: { clientKey: "Adatum", date: "2026-11-02", note: "Mapping half done" }, "T&W": { clientKey: "T&W", date: "2026-10-29", note: "Pump curves next" } };
    expect(Object.keys(resumeSlots(days, notes, "2026-11-02")).sort()).toEqual(["2026-11-03:AM", "2026-11-04:PM"]);
    // Later in the week the T&W block has passed: nothing shown for it.
    expect(Object.keys(resumeSlots(days, notes, "2026-11-04"))).toEqual(["2026-11-04:PM"]);
  });
});

describe("week items on a block (step 11)", () => {
  type F = { clientKey: string; itemId: number; title: string; blocks: number; slots: { date: string; half: "AM" | "PM" }[]; tier?: "must" | "nice"; doneAt?: string | null };
  const f = (over: Partial<F>): F => ({ clientKey: "T&W", itemId: 1, title: "Export", blocks: 2, slots: [], ...over });
  it("shows what is pinned to this block, then the client's unpinned musts that aren't done", () => {
    const placed = f({ itemId: 1, title: "Pinned here", slots: [{ date: "2026-11-09", half: "PM" }] });
    const floating = f({ itemId: 2, title: "Unpinned must" });
    const elsewhere = f({ itemId: 3, title: "Pinned elsewhere", slots: [{ date: "2026-11-10", half: "AM" }] });
    const nice = f({ itemId: 5, title: "Nice", tier: "nice" });
    const done = f({ itemId: 6, title: "Done", doneAt: "x" });
    const other = f({ clientKey: "Adatum", itemId: 4, title: "Adatum's" });
    const all = [elsewhere, floating, placed, nice, done, other];
    expect(featuresOn(all, "2026-11-09", "PM", "T&W").map((x) => x.title)).toEqual(["Pinned here", "Unpinned must"]);
    // An Open half-day shows only what is pinned to it.
    expect(featuresOn(all, "2026-11-09", "PM", null).map((x) => x.title)).toEqual(["Pinned here"]);
    expect(featuresOn(all, "2026-11-11", "AM", "Adatum").map((x) => x.title)).toEqual(["Adatum's"]);
  });
});
