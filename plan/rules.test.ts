import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backlogLevels, levelOf } from "../sources/devops/normalize.ts";
import type { WorkItem } from "../week/types.ts";
import { blockClient, capacityMinutes, carryOver, fitOf, pickableChildren, plannedMinutes, unpickableReason } from "./rules.ts";
import type { Pick } from "./types.ts";

const gap = (start: string, end: string) => ({ start: `2026-11-02T${start}:00-05:00`, end: `2026-11-02T${end}:00-05:00`, minutes: 0 });
const at = (hhmm: string) => `2026-11-02T${hhmm}:00-05:00`;

let nextId = 1;
function pick(over: Partial<Pick> = {}): Pick {
  const id = nextId++;
  return {
    id, date: "2026-11-02", half: "AM", clientKey: "CSC", kind: "intention", itemId: null, draftId: null, title: `pick ${id}`,
    itemType: null, itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null,
    position: id, createdAt: "", updatedAt: "", ...over,
  };
}

describe("capacity", () => {
  // AM 9:00–12:30 with a 10:00–11:00 meeting and a personal 12:00–12:30: free 9–10 and 11–12.
  const slot = { freeGaps: [gap("09:00", "10:00"), gap("11:00", "12:00")] };

  it("is the free time after meetings and personal events", () => {
    expect(capacityMinutes(slot, at("07:30"))).toBe(120);
  });
  it("counts only time from now on", () => {
    expect(capacityMinutes(slot, at("09:40"))).toBe(80);
    expect(capacityMinutes(slot, at("10:30"))).toBe(60);
    expect(capacityMinutes(slot, at("11:45"))).toBe(15);
  });
  it("is zero once the half-day has passed or has no free time", () => {
    expect(capacityMinutes(slot, at("12:30"))).toBe(0);
    expect(capacityMinutes({ freeGaps: [] }, at("07:00"))).toBe(0);
  });
});

describe("size fit", () => {
  it("S, M and L are about 1 h, 2 h and a whole block; only planned picks use capacity", () => {
    expect(plannedMinutes([pick({ size: "S" }), pick({ size: "M" }), pick({ size: "L" })])).toBe(60 + 120 + 210);
    expect(plannedMinutes([pick({ status: "done" }), pick({ status: "moved" }), pick({ status: "dropped" })])).toBe(0);
  });
  it("fits with room to spare, tight under 30 minutes of slack, over by the excess", () => {
    expect(fitOf(0, 120)).toEqual({ kind: "empty" });
    expect(fitOf(120, 210)).toEqual({ kind: "fits", spare: 90 });
    expect(fitOf(180, 200)).toEqual({ kind: "tight", spare: 20 });
    expect(fitOf(210, 210)).toEqual({ kind: "tight", spare: 0 });
    expect(fitOf(240, 195)).toEqual({ kind: "over", by: 45 });
  });
  it("an L fills a clear 3.5 h block exactly", () => {
    expect(fitOf(plannedMinutes([pick({ size: "L" })]), 210).kind).toBe("tight");
  });
});

describe("carry-over", () => {
  it("offers yesterday's unfinished picks, newest day first", () => {
    const thu = pick({ date: "2026-10-29", half: "PM" });
    const fri = pick({ date: "2026-10-30" });
    const out = carryOver([thu, fri, pick({ date: "2026-10-29", status: "done" }), pick({ date: "2026-10-29", status: "dropped" })], "2026-11-02");
    expect(out.map((p) => p.id)).toEqual([fri.id, thu.id]);
  });
  it("a moved pick shows only where it was moved to, so nothing is offered twice", () => {
    const original = pick({ date: "2026-10-29", status: "moved" });
    const moved = pick({ date: "2026-11-02", carriedFrom: original.id });
    expect(carryOver([original, moved], "2026-11-02")).toEqual([]);
    expect(carryOver([original, moved], "2026-11-03").map((p) => p.id)).toEqual([moved.id]);
  });
  it("ignores today's and future picks and anything older than a week", () => {
    expect(carryOver([pick({ date: "2026-11-02" }), pick({ date: "2026-11-05" }), pick({ date: "2026-10-25" })], "2026-11-02")).toEqual([]);
    expect(carryOver([pick({ date: "2026-10-26" })], "2026-11-02")).toHaveLength(1);
  });
});

describe("block client", () => {
  it("a focus block keeps its client; another client's pick is allowed but flagged", () => {
    expect(blockClient("CSC", [pick({ clientKey: "CSC" })])).toEqual({ clientKey: "CSC", mixed: false, clients: ["CSC"] });
    expect(blockClient("CSC", [pick({ clientKey: "CSC" }), pick({ clientKey: "Cooptimize" })])).toMatchObject({ clientKey: "CSC", mixed: true });
    expect(blockClient("CSC", [pick({ clientKey: "Quiddity" })])).toMatchObject({ clientKey: "CSC", mixed: true });
  });
  it("an Open half-day takes the client of its first pick", () => {
    expect(blockClient(null, [])).toEqual({ clientKey: null, mixed: false, clients: [] });
    const second = pick({ clientKey: "CSC", position: 2 });
    const first = pick({ clientKey: "Cooptimize", position: 1 });
    expect(blockClient(null, [second, first])).toEqual({ clientKey: "Cooptimize", mixed: true, clients: ["Cooptimize", "CSC"] });
    expect(blockClient(null, [first])).toMatchObject({ clientKey: "Cooptimize", mixed: false });
  });
  it("dropped and moved picks don't set or mix the client", () => {
    expect(blockClient(null, [pick({ clientKey: "CSC", status: "moved", position: 0 }), pick({ clientKey: "W&C", position: 1 })])).toMatchObject({ clientKey: "W&C", mixed: false });
  });
});

const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "sources", "devops", "fixtures", `${name}-processconfiguration.json`), "utf8"));

describe("pickable types come from backlog categories, not type names", () => {
  it("Agile: User Story, Task and Bug pickable; Feature and Epic not", () => {
    const l = backlogLevels(fx("agile"));
    expect(["User Story", "Task", "Bug"].map((t) => levelOf(t, l))).toEqual(["story", "story", "story"]);
    expect(["Feature", "Epic"].map((t) => levelOf(t, l))).toEqual(["portfolio", "portfolio"]);
  });
  it("Scrum: Product Backlog Item is the requirement level", () => {
    const l = backlogLevels(fx("scrum"));
    expect(levelOf("Product Backlog Item", l)).toBe("story");
    expect(levelOf("Feature", l)).toBe("portfolio");
  });
  it("custom process: a type named Issue is the requirement level; a type on no backlog is not pickable", () => {
    const l = backlogLevels(fx("custom"));
    expect(levelOf("Issue", l)).toBe("story");
    expect(levelOf("Epic", l)).toBe("portfolio");
    expect(levelOf("Review", l)).toBe("other");
  });
  it("recorded client process: Risk sits on the task backlog, so it is pickable", () => {
    const l = backlogLevels(fx("recorded"));
    expect(levelOf("Risk", l)).toBe("story");
    expect(levelOf("Feature", l)).toBe("portfolio");
  });
  it("no backlog metadata at all: nothing becomes unpickable by accident", () => {
    expect(levelOf("Feature", backlogLevels({}))).toBe("story");
  });
});

describe("story-level enforcement", () => {
  const item = (id: number, type: string, level: WorkItem["level"], parentId: number | null = null): WorkItem => ({
    id, title: `${type} ${id}`, type, state: "New", stateCategory: "Proposed", level, order: null, parentId, changedAt: "", url: "",
  });
  it("explains why epics, features and off-backlog types can't be picked", () => {
    expect(unpickableReason(item(1, "User Story", "story"))).toBeNull();
    expect(unpickableReason(item(2, "Feature", "portfolio"))).toMatch(/Pick one of its child items, or add a draft story/);
    expect(unpickableReason(item(3, "Review", "other"))).toMatch(/can't be picked/);
  });
  it("offers story-level children, down two levels; none means Needs breakdown", () => {
    const children = [item(11, "User Story", "story", 10), item(12, "Feature", "portfolio", 10), item(13, "Bug", "story", 12), item(14, "Task", "story", 99)];
    expect(pickableChildren(10, children).map((c) => c.id)).toEqual([11, 13]);
    expect(pickableChildren(20, children)).toEqual([]);
  });
});
