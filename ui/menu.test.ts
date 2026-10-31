import { describe, expect, it } from "vitest";
import { ACTION_NAMES } from "../actions/registry.ts";
import type { Pick } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { commandList, filterCommands, itemMenu, pickMenu, slotMenu, type MenuEnv, type MenuStep } from "./menu.ts";

const week = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config, pto: { "2026-11-05": { date: "2026-11-05", minutes: 480, full: true, titles: ["Watch Kids"] } } });
const item = (id: number, level: WorkItem["level"] = "story"): WorkItem => ({ id, title: `Item ${id}`, type: level === "story" ? "User Story" : "Feature", state: "New", stateCategory: "Proposed", level, order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/org/P/_workitems/edit/${id}` });
const work = new Map<string, ClientWork>([["internal", { clientKey: "internal", clientName: "Internal", status: "ok", fetchedAt: null, fromCache: false, items: [item(1), item(2, "portfolio")], children: [] }]]);
const pick: Pick = { id: 7, date: "2026-11-03", half: "AM", clientKey: "internal", kind: "item", itemId: 1, draftId: null, title: "Item 1", itemType: "User Story", itemUrl: "https://dev.azure.com/org/P/_workitems/edit/1", size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, notes: null, position: 1, createdAt: "", updatedAt: "" };

function env(over: Partial<MenuEnv> = {}) {
  const calls: unknown[][] = [];
  const e: MenuEnv = {
    week,
    selection: { date: "2026-11-02", half: "AM" },
    planWeek: { "2026-11-03": { committedAt: "x", picks: [pick] } },
    planState: null,
    planTarget: { date: "2026-11-03", isToday: true },
    work,
    calendars: { outlook: true, google: false },
    runPlan: async (a, i) => (calls.push([a, i]), true),
    openPlanDay: (d) => calls.push(["openPlanDay", d]),
    commitPlan: () => calls.push(["commit"]),
    openDetails: (d, h) => calls.push(["details", d, h]),
    openLink: (k, u) => calls.push(["link", k, u]),
    changeWeek: (n) => calls.push(["week", n]),
    goToday: () => calls.push(["today"]),
    refresh: () => calls.push(["refresh"]),
    showSourceStatus: () => calls.push(["status"]),
    connect: (c) => calls.push(["connect", c]),
    disconnect: (c) => calls.push(["disconnect", c]),
    setView: (v) => calls.push(["view", v]),
    moveRegion: (d) => calls.push(["region", d]),
    focusedItem: null,
    showKeys: () => calls.push(["keys"]),
    ...over,
  };
  return { e, calls };
}
const items = (s: MenuStep) => ("items" in s ? s.items : []);
const find = (s: MenuStep, label: string) => items(s).find((i) => i.label === label)!;

describe("command menu (built from the action registry)", () => {
  it("lists every dispatcher action, so new actions appear automatically", () => {
    const listed = commandList(env().e).map((c) => c.action);
    for (const name of ACTION_NAMES) expect(listed, name).toContain(name);
  });
  it("shows shortcuts and reserves the future views as coming soon", () => {
    const list = commandList(env().e);
    expect(list.find((c) => c.action === "planday.start")?.hint).toBe("P");
    expect(list.find((c) => c.action === "week.load")?.hint).toBe("R");
    for (const v of ["Plan the week", "Check-in", "Close out"]) expect(list.find((c) => c.label === v)?.disabled).toBe("Coming soon");
  });
  it("searches by words in any order", () => {
    const list = commandList(env().e);
    expect(filterCommands(list, "pick drop").map((c) => c.action)).toEqual(["pick.remove"]);
    expect(filterCommands(list, "EDGE open").map((c) => c.action)).toEqual(["ui.open_focused", "link.open"]);
  });
  it("commit is only available while Plan the day is open", () => {
    expect(commandList(env().e).find((c) => c.action === "planday.commit")?.disabled).toBe("Open Plan the day first");
  });
  it("a pick action asks which pick, then acts on it", async () => {
    const t = env({ selection: { date: "2026-11-03", half: "AM" } });
    const done = commandList(t.e).find((c) => c.action === "pick.mark_done")!;
    await items(done.next!())[0]!.run!();
    expect(t.calls).toEqual([["pick.mark_done", { id: 7, done: true }]]);
  });
});

describe("⋯ menus", () => {
  it("a pick: open in Edge, size, move, done, drop", async () => {
    const t = env();
    const m = pickMenu(t.e, pick);
    expect(items(m).map((i) => i.label)).toEqual(["Open in Edge", "Set size", "Move", "Mark done", "Drop"]);
    await find(m, "Open in Edge").run!();
    await find(find(m, "Set size").next!(), "S").run!();
    expect(t.calls).toEqual([["link", "internal", pick.itemUrl], ["pick.set_size", { id: 7, size: "S" }]]);
  });
  it("moving offers the other half, Friday and every other half-day, with full PTO days disabled", () => {
    const m = find(pickMenu(env().e, pick), "Move").next!();
    expect(items(m)[0]!.label).toBe("To PM the same day");
    expect(items(m)[1]!.label).toBe("To Friday (catch-up)");
    const thu = items(m).filter((i) => i.label.startsWith("To Thu, Nov 5"));
    expect(thu.map((i) => i.disabled)).toEqual(["PTO day (Watch Kids)", "PTO day (Watch Kids)"]);
  });
  it("a work item: open, add to the plan (stories only), draft story for an empty feature", () => {
    const story = itemMenu(env().e, "internal", item(1));
    expect(items(story).map((i) => [i.label, i.disabled ?? ""])).toEqual([["Open in Edge", ""], ["Add to the plan", ""]]);
    const feature = itemMenu(env().e, "internal", item(2, "portfolio"));
    expect(find(feature, "Add to the plan").disabled).toMatch(/above story level/);
    expect(find(feature, "Add a draft story")).toBeTruthy();
  });
  it("adding a work item lists each half-day once, the selected one first", () => {
    const { e, calls } = env();
    const add = items(find(itemMenu(e, "internal", item(1)), "Add to the plan").next!());
    expect(add.map((i) => i.label).slice(0, 2)).toEqual(["Mon, Nov 2 AM (selected)", "Mon, Nov 2 PM"]);
    expect(new Set(add.map((i) => i.id)).size).toBe(add.length);
    void add[0]!.run!();
    expect(calls).toEqual([["pick.add", { date: "2026-11-02", half: "AM", clientKey: "internal", itemId: 1 }]]);
  });
  it("a block card on a full PTO day can't take picks", () => {
    const m = slotMenu(env().e, "2026-11-05", "AM", "internal", "Internal");
    expect(find(m, "Add an intention").disabled).toBe("PTO day (Watch Kids)");
    expect(find(m, "Details").disabled).toBeUndefined();
  });
});
