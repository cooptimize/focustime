import { legacyHours } from "../config/schema.ts";
import { describe, expect, it } from "vitest";
import { ACTION_NAMES } from "../actions/registry.ts";
import type { Pick } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { timerStep, commandList, dayMenu, filterCommands, itemMenu, pickMenu, planDateStep, slotMenu, type MenuEnv, type MenuStep, flexForm, hoursForm } from "./menu.ts";

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
    today: "2026-11-03",
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
    theme: "cooptimize-dark",
    planning: { sizes: { S: 60, M: 120, L: 210 }, carryDays: 7, reminderOffsetMinutes: 0, focusMinutes: 50, breakMinutes: 10, endSound: false },
    setTheme: (t) => calls.push(["theme", t]),
    viewRange: "business",
    setViewRange: (r) => calls.push(["range", r]),
    hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" }),
    runTime: async (a, i) => (calls.push([a, i]), true),
    openSettings: (x) => calls.push(["settings", x]),
    exportPlan: () => calls.push(["export"]),
    timer: null,
    runTimer: async (a, i) => (calls.push([a, i ?? {}]), true),
    openLoops: () => calls.push(["loops"]),
    resetPlan: () => calls.push(["reset"]),
    openCloseOut: (d) => calls.push(["closeout", d]),
    openCheckIn: () => calls.push(["checkin"]),
    openCapture: () => calls.push(["capture"]),
    openCaptures: () => calls.push(["captures"]),
    openPlanWeek: (w?: string) => calls.push(["planweek", w]),
    planWeekOpen: null,
    commitWeek: () => calls.push(["commitweek"]),
    closeOutDate: null,
    commitCloseOut: () => calls.push(["closeoutCommit"]),
    makeUp: async (id, i) => (calls.push(["pick.make_up", id, i]), true),
    runLoops: async (a, i) => (calls.push([a, i]), true),
    borrowed: [],
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
  it("shows shortcuts; every view is built (Plan the week since step 8)", () => {
    const list = commandList(env().e);
    expect(list.find((c) => c.action === "planday.start")?.hint).toBe("P");
    expect(list.find((c) => c.action === "week.load")?.hint).toBe("R");
    for (const id of ["view.checkin", "view.closeout", "view.planweek"]) expect(list.find((c) => c.id === id)?.disabled).toBeUndefined();
    expect(list.find((c) => c.id === "view.planweek")?.hint).toBe("W");
    // Committing the week needs Plan the week open.
    expect(list.find((c) => c.action === "weekplan.commit")?.disabled).toBe("Open Plan the week first");
  });
  it("searches by words in any order", () => {
    const list = commandList(env().e);
    expect(filterCommands(list, "pick drop").map((c) => c.action)).toEqual(["pick.remove"]);
    expect(filterCommands(list, "EDGE open").map((c) => c.action)).toEqual(["ui.open_focused", "link.open"]);
    expect(filterCommands(list, "plan a day")[0]?.label).toBe("Plan a day…");
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
  it("a pick: open in Edge, size, move, start focus, done, drop", async () => {
    const t = env();
    const m = pickMenu(t.e, pick);
    expect(items(m).map((i) => i.label)).toEqual(["Open in Edge", "Set size", "Move", "Start focus", "Mark done", "I'll make it up…", "Drop"]);
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

describe("Plan any day (menus)", () => {
  it("every day header's ⋯ has Plan this day; PTO and no-hours days say why it can't open", () => {
    const t = env();
    const plan = (d: string) => find(dayMenu(t.e, d), "Plan this day");
    void plan("2026-11-04").run!();
    expect(t.calls).toEqual([["openPlanDay", "2026-11-04"]]);
    expect(find(dayMenu(t.e, "2026-11-05"), "Plan this day").disabled).toBe("PTO day (Watch Kids)");
    expect(find(dayMenu(t.e, "2026-11-06"), "Plan this day").disabled).toBe("No working hours: give the day hours or a flex session from its menu");
    expect(items(dayMenu(t.e, "2026-11-02"))[0]!.label).toBe("Plan this day (past: done and drop only)");
  });

  it("Plan a day… is a date picker that opens the chosen date", async () => {
    const t = env();
    const cmd = commandList(t.e).find((c) => c.label === "Plan a day…")!;
    const step = cmd.next!();
    expect(step).toMatchObject({ input: "date", value: "2026-11-03", button: "Plan" });
    if ("submit" in step) await step.submit("2026-12-01");
    expect(t.calls).toEqual([["openPlanDay", "2026-12-01"]]);
  });

  it("a past pick: done and drop only; moving goes to today or later", () => {
    const old: Pick = { ...pick, id: 9, date: "2026-11-02" };
    const m = pickMenu(env().e, old);
    expect(find(m, "Set size").disabled).toMatch(/^Past day/);
    expect(find(m, "Mark done").disabled).toBeUndefined();
    expect(find(m, "Drop").disabled).toBeUndefined();
    const move = items(find(m, "Move").next!());
    expect(move.find((i) => i.id === "to-other")!.disabled).toMatch(/^Past day/);
    expect(move.filter((i) => i.label.startsWith("To Mon, Nov 2")).every((i) => i.disabled?.startsWith("Past day"))).toBe(true);
    expect(move.find((i) => i.label === "To Tue, Nov 3 AM")!.disabled).toBeUndefined();
  });
});

describe("time model menus (step 6b)", () => {
  it("a day header offers hours for the day, unavailable time and a flex session; PTO days say why not", () => {
    const t = env();
    const m = dayMenu(t.e, "2026-11-03");
    expect(items(m).map((i) => i.action)).toEqual(expect.arrayContaining(["hours.set_day", "unavailable.add", "flex.add"]));
    expect(find(m, "Working hours for this day…").hint).toBe("09:00–17:00");
    expect(find(dayMenu(t.e, "2026-11-05"), "Block time as unavailable…").disabled).toBe("PTO day (Watch Kids)");
  });
  it("the hours form sends a split day (main span, lunch, evening) as one hours.set_day", async () => {
    const t = env();
    const f = hoursForm(t.e, "2026-11-03");
    if (!("fields" in f)) throw new Error("expected a form");
    await f.save({ start: "09:00", end: "16:00", lunchStart: "12:00", lunchEnd: "12:30", eveStart: "20:00", eveEnd: "22:00" });
    expect(t.calls).toEqual([["hours.set_day", { date: "2026-11-03", segments: ["09:00-16:00", "20:00-22:00"], lunch: "12:00-12:30" }]]);
  });
  it("the flex form defaults to the client of the day's block and starts at the end of the day", () => {
    const f = flexForm(env().e, "2026-11-02");
    if (!("fields" in f)) throw new Error("expected a form");
    expect(f.fields.find((x) => x.key === "clientKey")!.value).toBe("internal");
    expect(f.fields.find((x) => x.key === "start")!.value).toBe("17:00");
  });
});

describe("focus timer menus (step 6c)", () => {
  it("timeboxes a pick with its size suggested first, presets in 5-minute steps and Custom", async () => {
    const t = env();
    const focus = find(pickMenu(t.e, { ...pick, date: t.e.today }), "Start focus");
    expect(focus.disabled).toBeUndefined();
    const lengths = focus.next!();
    expect(items(lengths).map((i) => i.label).slice(0, 4)).toEqual(["120 min (suggested)", "5 min", "10 min", "15 min"]);
    expect(items(lengths).at(-1)!.label).toBe("Custom…");
    await items(lengths)[0]!.run!();
    expect(t.calls).toEqual([["timer.start", { pickId: 7, minutes: 120 }]]);
    // Not today: not offered.
    expect(find(pickMenu(t.e, { ...pick, date: "2026-11-05" }), "Start focus").disabled).toBe("Only today's picks");
  });

  it("F offers focus, break and a pick with no timer; controls when one runs; Done/+15/Next when it ended", () => {
    const none = timerStep(env().e);
    expect(items(none).map((i) => i.label)).toEqual(["Focus", "Break", "Timebox a pick…"]);
    const running = timerStep(env({ timer: { kind: "focus", pickId: 7, label: "Story", plannedMinutes: 25, remainingMs: 60_000, running: true, ended: false, endsAt: null } }).e);
    expect(items(running).map((i) => i.label)).toEqual(["Pause", "+15 min", "Done (tick the pick)", "Next pick", "Stop"]);
    const ended = timerStep(env({ timer: { kind: "focus", pickId: null, label: "Focus", plannedMinutes: 25, remainingMs: 0, running: false, ended: true, endsAt: null } }).e);
    expect(items(ended).map((i) => i.label)).toEqual(["+15 min", "Done", "Next pick", "Stop"]);
  });
});
