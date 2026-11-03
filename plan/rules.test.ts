import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backlogLevels, levelOf } from "../sources/devops/normalize.ts";
import type { WorkItem } from "../week/types.ts";
import { blockClient, capacityMinutes, carryOver, committedFirst, draftOffer, weekFirst, fitOf, pickableChildren, plannedMinutes, sessionEnd, unpickableReason } from "./rules.ts";
import type { Pick } from "./types.ts";

const gap = (start: string, end: string) => ({ start: `2026-11-02T${start}:00-05:00`, end: `2026-11-02T${end}:00-05:00`, minutes: 0 });
const at = (hhmm: string) => `2026-11-02T${hhmm}:00-05:00`;

let nextId = 1;
function pick(over: Partial<Pick> = {}): Pick {
  const id = nextId++;
  return {
    id, date: "2026-11-02", half: "AM", clientKey: "Adatum", kind: "intention", itemId: null, draftId: null, title: `pick ${id}`,
    itemType: null, itemUrl: null, size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null,
    position: id, createdAt: "", updatedAt: "", ...over,
  };
}

describe("capacity", () => {
  // AM 9:00–12:30 with a 10:00–11:00 meeting and a personal 12:00–12:30: free 9–10 and 11–12.
  const frame = { start: at("09:00"), end: at("12:30"), longestFreeMinutes: 60 };
  const slot = { ...frame, freeGaps: [gap("09:00", "10:00"), gap("11:00", "12:00")] };

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
    expect(capacityMinutes({ ...frame, freeGaps: [] }, at("07:00"))).toBe(0);
  });
  it("is zero on a PTO day", () => {
    expect(capacityMinutes({ ...slot, pto: true }, at("07:30"))).toBe(0);
  });
});

describe("size fit", () => {
  it("S, M and L are about 1 h, 2 h and a whole block; only planned picks use capacity", () => {
    expect(plannedMinutes([pick({ size: "S" }), pick({ size: "M" }), pick({ size: "L" })])).toBe(60 + 120 + 210);
    expect(plannedMinutes([pick({ status: "done" }), pick({ status: "moved" }), pick({ status: "dropped" })])).toBe(0);
    // Sizes from Settings > Planning (step 6c).
    expect(plannedMinutes([pick({ size: "S" }), pick({ size: "L" })], { S: 45, M: 90, L: 180 })).toBe(225);
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
  it("uses the carry-over days from Settings > Planning; 0 turns it off (step 6c)", () => {
    const thu = pick({ date: "2026-10-29" });
    const fri = pick({ date: "2026-10-30" });
    expect(carryOver([thu, fri], "2026-11-02", 3).map((p) => p.id)).toEqual([fri.id]);
    expect(carryOver([thu, fri], "2026-11-02", 0)).toEqual([]);
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
    expect(blockClient("Adatum", [pick({ clientKey: "Adatum" })])).toEqual({ clientKey: "Adatum", mixed: false, clients: ["Adatum"] });
    expect(blockClient("Adatum", [pick({ clientKey: "Adatum" }), pick({ clientKey: "Cooptimize" })])).toMatchObject({ clientKey: "Adatum", mixed: true });
    expect(blockClient("Adatum", [pick({ clientKey: "Proseware" })])).toMatchObject({ clientKey: "Adatum", mixed: true });
  });
  it("an Open half-day takes the client of its first pick", () => {
    expect(blockClient(null, [])).toEqual({ clientKey: null, mixed: false, clients: [] });
    const second = pick({ clientKey: "Adatum", position: 2 });
    const first = pick({ clientKey: "Cooptimize", position: 1 });
    expect(blockClient(null, [second, first])).toEqual({ clientKey: "Cooptimize", mixed: true, clients: ["Cooptimize", "Adatum"] });
    expect(blockClient(null, [first])).toMatchObject({ clientKey: "Cooptimize", mixed: false });
  });
  it("dropped and moved picks don't set or mix the client", () => {
    expect(blockClient(null, [pick({ clientKey: "Adatum", status: "moved", position: 0 }), pick({ clientKey: "T&W", position: 1 })])).toMatchObject({ clientKey: "T&W", mixed: false });
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

describe("Plan the day offers committed features first (step 8)", () => {
  const item = (id: number, type: string, level: WorkItem["level"], parentId: number | null = null): WorkItem => ({
    id, title: `${type} ${id}`, type, state: "New", stateCategory: "Proposed", level, order: null, parentId, changedAt: "", url: "",
  });
  const f = (itemId: number, slots: { date: string; half: "AM" | "PM" }[] = [], clientKey = "T&W") => ({ clientKey, itemId, title: `F ${itemId}`, url: null, slots });
  const work = {
    // Board: my story 1 under feature 10, my story 2 with no committed parent, my feature 30.
    items: [item(1, "User Story", "story", 10), item(2, "User Story", "story", 99), item(30, "Feature", "portfolio")],
    children: [item(1, "User Story", "story", 10), item(11, "User Story", "story", 10)],
    // Feature 10 isn't mine: read by id because it is committed.
    committed: [item(10, "Feature", "portfolio")],
  };
  it("lists the client's committed features, placed-here first, with anyone's open stories; the rest of the board follows", () => {
    const r = committedFirst(work, [f(30), f(10, [{ date: "2026-11-09", half: "PM" }]), f(50, [], "Adatum")], "T&W", "2026-11-09", "PM");
    expect(r.committed.map((c) => [c.feature.itemId, c.placedHere, c.item?.id ?? null, c.kids.map((k) => k.id)])).toEqual([
      [10, true, 10, [1, 11]],
      [30, false, 30, []],
    ]);
    // Story 1 is under a committed feature, so it shows there, not again in the board.
    expect(r.rest.map((i) => i.id)).toEqual([2]);
  });
  it("my own stories under a committed feature (in the board list, not its children list) show under it", () => {
    const w = { items: [item(5, "User Story", "story", 10), item(6, "Bug", "story", 7)], children: [item(11, "User Story", "story", 10)], committed: [item(10, "Feature", "portfolio")] };
    const r = committedFirst(w, [f(10)], "T&W", "2026-11-09", "AM");
    expect(r.committed[0]!.kids.map((k) => k.id)).toEqual([5, 11]);
    expect(r.rest.map((i) => i.id)).toEqual([6]);
  });
  it("a committed feature DevOps can't show right now still comes first, with no stories", () => {
    const r = committedFirst(undefined, [f(10)], "T&W", "2026-11-09", "AM");
    expect(r.committed).toEqual([{ feature: f(10), tier: "must", level: "feature", placedHere: false, pinnedToday: false, item: null, kids: [] }]);
    expect(r.rest).toEqual([]);
  });
  it("step 11: unfinished musts, then nice-to-haves, then the rest; pinned here, then pinned today, then list order", () => {
    const D = "2026-11-10";
    const refs = [
      { ...f(30), tier: "must" as const },
      { ...f(2, [], "T&W"), level: "story" as const, tier: "nice" as const },
      { ...f(10, [{ date: D, half: "AM" }]), tier: "must" as const }, // pinned to another half today
      { ...f(40), tier: "must" as const, done: true }, // done: not offered
      { ...f(50, [{ date: D, half: "PM" }]), tier: "nice" as const }, // pinned here
    ];
    const r = weekFirst(work, refs, "T&W", D, "PM");
    expect(r.musts.map((e) => [e.feature.itemId, e.pinnedToday, e.placedHere])).toEqual([[10, true, false], [30, false, false]]);
    expect(r.nice.map((e) => [e.feature.itemId, e.level, e.item?.id ?? null, e.kids.length])).toEqual([[50, "feature", null, 0], [2, "story", 2, 0]]);
    // Story 2 is on the list (as a story), story 1 is under feature 10: neither repeats in the rest.
    expect(r.rest.map((i) => i.id)).toEqual([]);
    // A done must's own item stays out of the rest too.
    expect(weekFirst({ items: [item(40, "Feature", "portfolio"), item(7, "User Story", "story")], children: [] }, [{ ...f(40), done: true }], "T&W", D, "AM").rest.map((i) => i.id)).toEqual([7]);
  });
});

describe("carry-over waits for an evening or weekend session (Q45)", () => {
  const weekday = { segments: [{ start: "09:00", end: "17:00" }], main: { start: "09:00", end: "17:00" } };
  const split = { segments: [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }], main: { start: "09:00", end: "16:00" } };
  const weekend = { segments: [], main: null };
  it("an evening pick's session ends at the later of the evening span and that day's flex sessions", () => {
    expect(sessionEnd(pick({ half: "EVE" }), weekday, ["22:00"])).toBe("22:00");
    expect(sessionEnd(pick({ half: "EVE" }), split, ["21:00"])).toBe("22:00");
    expect(sessionEnd(pick({ half: "EVE" }), weekday, [])).toBe("24:00");
  });
  it("a pick on a day without regular hours (a weekend) ends with that day's flex sessions, else midnight", () => {
    expect(sessionEnd(pick({ half: "AM", date: "2026-11-07" }), weekend, ["13:00", "11:00"])).toBe("13:00");
    expect(sessionEnd(pick({ half: "AM", date: "2026-11-07" }), weekend, [])).toBe("24:00");
  });
  it("regular morning and afternoon picks aren't waited for", () => {
    expect(sessionEnd(pick({ half: "PM" }), weekday, ["22:00"])).toBeNull();
  });
  it("carry-over leaves out picks whose session is still to come or under way", () => {
    const eve = pick({ date: "2026-11-02", half: "EVE" });
    const am = pick({ date: "2026-11-02", half: "AM" });
    expect(carryOver([eve, am], "2026-11-03", 7, (p) => p.id === eve.id).map((p) => p.id)).toEqual([am.id]);
    expect(carryOver([eve, am], "2026-11-03", 7, () => false).map((p) => p.id).sort()).toEqual([eve.id, am.id].sort());
  });
});


describe("what a portfolio item with nothing to pick offers (step 13.6, D243)", () => {
  it("an epic offers a draft feature, a feature a draft story", () => {
    expect(draftOffer({ level: "portfolio", tier: "epic" })).toEqual({ kind: "feature", action: "draft.add_feature", label: "Draft feature" });
    expect(draftOffer({ level: "portfolio", tier: "feature" })).toEqual({ kind: "story", action: "draft.add_story", label: "Draft story" });
  });
  it("an item cached before tiers counts as a feature", () => {
    expect(draftOffer({ level: "portfolio" })).toMatchObject({ kind: "story" });
  });
});
