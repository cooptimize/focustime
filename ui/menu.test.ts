import { legacyHours } from "../config/schema.ts";
import { describe, expect, it } from "vitest";
import { ACTION_NAMES } from "../actions/registry.ts";
import type { Pick } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { eventMenu, timerStep, timeboxStep, timeStep, commandList, dayMenu, filterCommands, itemMenu, pickMenu, planDateStep, slotMenu, type MenuEnv, type MenuStep, flexForm, hoursForm } from "./menu.ts";

const week = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config, pto: { "2026-11-05": { date: "2026-11-05", minutes: 480, full: true, titles: ["Watch Kids"] } } });
const item = (id: number, level: WorkItem["level"] = "story"): WorkItem => ({ id, title: `Item ${id}`, type: level === "story" ? "User Story" : "Feature", state: "New", stateCategory: "Proposed", level, order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/org/P/_workitems/edit/${id}` });
const work = new Map<string, ClientWork>([["internal", { clientKey: "internal", clientName: "Internal", status: "ok", fetchedAt: null, fromCache: false, items: [item(1), item(2, "portfolio")], children: [] }]]);
const pick: Pick = { id: 7, date: "2026-11-03", half: "AM", clientKey: "internal", kind: "item", itemId: 1, draftId: null, title: "Item 1", itemType: "User Story", itemUrl: "https://dev.azure.com/org/P/_workitems/edit/1", size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: 1, createdAt: "", updatedAt: "" };

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
    openTimebox: (t) => calls.push(["timebox", t]),
    connectWrite: () => calls.push(["connectWrite"]),
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
    openFollowUps: () => calls.push(["follow_ups"]),
    resetPlan: () => calls.push(["reset"]),
    openCloseOut: (d) => calls.push(["closeout", d]),
    openCheckIn: () => calls.push(["checkin"]),
    openCapture: () => calls.push(["capture"]),
    openCaptures: () => calls.push(["captures"]),
    openRitual: () => calls.push(["ritual"]),
    openPlanWeek: (w?: string) => calls.push(["planweek", w]),
    planWeekOpen: null,
    commitWeek: () => calls.push(["commitweek"]),
    closeOutDate: null,
    commitCloseOut: () => calls.push(["closeoutCommit"]),
    makeUp: async (id, i) => (calls.push(["pick.make_up", id, i]), true),
    runFollowUps: async (a, i) => (calls.push([a, i]), true),
    borrowed: [],
    eventEdit: {},
    canWrite: true,
    editEvent: (i) => calls.push(["editEvent", i]),
    openOutlook: (u) => calls.push(["outlook", u]),
    timeboxChange: (a, i) => calls.push([a, i]),
    startTimeboxFocus: (t) => calls.push(["tbfocus", t.id]),
    openHelp: (t) => calls.push(["help", t]),
    invites: [],
    undoWrite: (id) => calls.push(["undo", id]),
    tz: "America/New_York",
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
    expect(list.find((c) => c.id === "view.plan")?.hint).toBe("P");
    expect(list.find((c) => c.action === "roadmap.load")?.hint).toBe("3");
    expect(list.find((c) => c.action === "week.load")?.hint).toBe("R");
    for (const id of ["view.checkin", "view.closeout", "view.planweek"]) expect(list.find((c) => c.id === id)?.disabled).toBeUndefined();
    expect(list.find((c) => c.id === "view.planweek")?.hint).toBe("W");
    // Committing the week needs Plan the week open.
    expect(list.find((c) => c.action === "weekplan.commit")?.disabled).toBe("Open Plan the week first");
  });
  it("step 16.2: no place lost: every tab and mode is reachable from the command menu", async () => {
    const t = env();
    const views: string[] = [];
    t.e.setView = (v) => void views.push(v);
    const list = commandList(t.e);
    for (const id of ["view.today", "view.week", "view.roadmap", "view.inbox", "view.ahead", "view.capture"]) await list.find((c) => c.id === id)!.run!();
    expect(views).toEqual(["today", "week", "roadmap", "inbox", "ahead"]);
    for (const id of ["view.plan", "view.planday", "view.planweek", "view.checkin", "view.closeout", "view.planday_date"]) expect(list.find((c) => c.id === id), id).toBeDefined();
    expect(list.find((c) => c.action === "checkin.done")).toBeDefined();
  });
  it("searches by words in any order", () => {
    const list = commandList(env().e);
    expect(filterCommands(list, "pick drop").map((c) => c.action)).toEqual(["pick.remove"]);
    expect(filterCommands(list, "BROWSER open").map((c) => c.action)).toEqual(["ui.open_focused", "link.open"]);
    expect(filterCommands(list, "plan a day")[0]?.label).toBe("Plan a day…");
  });
  it("BD-1: finds Break down by its old name, Draft stories", () => {
    const list = commandList(env().e);
    expect(filterCommands(list, "break down with").map((c) => c.action)).toEqual(["stories.prepare"]);
    expect(filterCommands(list, "draft stories").map((c) => c.action)).toContain("stories.prepare");
    expect(list.find((c) => c.action === "stories.prepare")?.label).toBe("Break down with AI");
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
    expect(items(m).map((i) => i.label)).toEqual(["Open in browser", "Set size", "Move", "Start focus", "Timebox", "Ask to collaborate", "Mark done", "I'll make it up…", "Drop"]);
    await find(m, "Open in browser").run!();
    await find(find(m, "Set size").next!(), "S · 1h").run!();
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
    expect(items(story).map((i) => [i.label, i.disabled ?? ""])).toEqual([["Open in browser", ""], ["Add to the plan", ""], ["Timebox…", ""], ["Ask to collaborate", ""], ["Send to…", ""]]);
    const feature = itemMenu(env().e, "internal", item(2, "portfolio"));
    // SW-1: a feature can be sent; an epic is sent through its features.
    expect(find(feature, "Send to…").disabled).toBeUndefined();
    expect(find(itemMenu(env().e, "internal", { ...item(3, "portfolio"), tier: "epic" }), "Send to…").disabled).toBe("Send its features instead");
    expect(find(feature, "Add to the plan").disabled).toMatch(/above story level/);
    expect(find(feature, "Add a draft story")).toBeTruthy();
  });
  it("adding a work item lists each half-day once, leaves out past days and says why a block can't take it (step 15.2)", () => {
    const { e, calls } = env();
    const add = items(find(itemMenu(e, "internal", item(1)), "Add to the plan").next!());
    expect(add.some((i) => i.id.startsWith("add-2026-11-02"))).toBe(false);
    expect(new Set(add.map((i) => i.id)).size).toBe(add.length);
    expect(add.find((i) => i.id === "add-2026-11-05-AM")!.disabled).toBe("Day off");
    const first = add.find((i) => !i.disabled)!;
    expect(first.label).toBe("Wed, Nov 4 AM");
    void first.run!();
    expect(calls).toEqual([["pick.add", { date: "2026-11-04", half: "AM", clientKey: "internal", itemId: 1 }]]);
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
    expect(items(none).map((i) => i.label)).toEqual(["Focus", "Deep focus", "Break", "Timebox a pick…"]);
    const running = timerStep(env({ timer: { kind: "focus", pickId: 7, label: "Story", plannedMinutes: 25, remainingMs: 60_000, running: true, ended: false, endsAt: null, deep: false } }).e);
    expect(items(running).map((i) => i.label)).toEqual(["Pause", "+15 min", "Deep focus", "Done (tick the pick)", "Next pick", "Stop"]);
    const ended = timerStep(env({ timer: { kind: "focus", pickId: null, label: "Focus", plannedMinutes: 25, remainingMs: 0, running: false, ended: true, endsAt: null, deep: false } }).e);
    expect(items(ended).map((i) => i.label)).toEqual(["+15 min", "Done", "Next pick", "Stop"]);
  });

  it("the Focus button suggests the next pick first, then a plain timer (step 15.2)", async () => {
    const t = env({ focusNext: pick });
    const step = timerStep(t.e);
    expect(items(step).map((i) => i.label)).toEqual([`Start focus: ${pick.title}`, "Plain timer", "Deep focus", "Break", "Another pick…"]);
    await items(step)[0]!.run!();
    expect(t.calls).toEqual([["timer.start", { pickId: pick.id }]]);
  });

  it("step 16.3: Deep focus starts on the next pick with Teams set to Do not disturb; while running it switches", async () => {
    const t = env({ focusNext: pick });
    const deep = items(timerStep(t.e)).find((i) => i.label === "Deep focus")!;
    expect(deep.hint).toBe("Teams: Do not disturb");
    const lengths = deep.next!();
    await items(lengths)[0]!.run!();
    expect(t.calls[0]).toEqual(["timer.start", expect.objectContaining({ deep: true, pickId: pick.id })]);
    const r = env({ timer: { kind: "focus", pickId: 7, label: "Story", plannedMinutes: 25, remainingMs: 60_000, running: true, ended: false, endsAt: null, deep: false } });
    const toggle = items(timerStep(r.e)).find((i) => i.label === "Deep focus")!;
    expect(toggle.checked).toBe(false);
    await toggle.run!();
    expect(r.calls).toEqual([["timer.deep", { on: true }]]);
  });
});

describe("event menus by editing tier (step 13)", () => {
  const ev = (id: string, title = "Dentist"): import("../week/types.ts").CalEvent => ({ id, source: "outlook", title, start: "2026-11-03T14:00:00-05:00", end: "2026-11-03T15:00:00-05:00", allDay: false, showAs: "busy", isPersonal: false });
  const web = "https://outlook.office365.com/owa/?itemid=X";
  const labels = (s: MenuStep) => items(s).map((i) => [i.label, i.disabled ? "off" : "on"]);
  it("my own event with no attendees: move, end and show as with a preview; never retitle or delete", () => {
    const { e, calls } = env({ eventEdit: { "outlook:A": { isOrganizer: true, others: 0, recurring: false, allDay: false, marker: null, webLink: web } } });
    const m = eventMenu(e, ev("outlook:A"));
    const on = labels(m).filter(([, s]) => s === "on").map(([l]) => l);
    expect(on.length).toBeGreaterThanOrEqual(3);
    expect(items(m).find((i) => i.id === "retitle")?.disabled).toBeTruthy();
    expect(items(m).find((i) => i.id === "delete")?.disabled).toBeTruthy();
    const show = items(m).find((i) => i.id === "show_as")!.next!();
    if (!("items" in show)) throw new Error("expected items");
    show.items.find((i) => i.id === "free")!.run!();
    expect(calls).toContainEqual(["editEvent", { id: "A", showAs: "free" }]);
  });
  it("a meeting with other attendees: only Open in Outlook; every edit off with a reason", () => {
    const { e, calls } = env({ eventEdit: { "outlook:B": { isOrganizer: true, others: 3, recurring: false, allDay: false, marker: null, webLink: web } } });
    const m = eventMenu(e, ev("outlook:B", "Sprint review"));
    for (const i of items(m)) if (i.id !== "open") expect(typeof i.disabled === "string" && i.disabled.length > 0).toBe(true);
    items(m).find((i) => i.id === "open")!.run!();
    expect(calls).toContainEqual(["outlook", web]);
  });
  it("a meeting someone else invited me to: Accept, Tentative and Decline with a note and a proposed time; still no edits (step 16)", async () => {
    const calls: unknown[][] = [];
    const { e } = env({ rsvp: (i) => void calls.push(["rsvp", i]), eventEdit: { "outlook:B": { isOrganizer: false, others: 3, recurring: false, allDay: false, marker: null, webLink: web, response: "tentativelyAccepted", organizer: "Dana Morales", proposals: true } } });
    const m = eventMenu(e, ev("outlook:B", "Sprint review"));
    const on = labels(m).filter(([, s]) => s === "on").map(([l]) => l);
    expect(on).toEqual(["Accept…", "Tentative…", "Decline…", "Open in Outlook"]);
    expect(items(m).some((i) => i.id === "move")).toBe(false);
    expect(items(m).find((i) => i.id === "rsvp-tentativelyAccepted")).toMatchObject({ checked: true, hint: "your answer now" });
    const accept = items(m).find((i) => i.id === "rsvp-accepted")!.next!();
    if (!("fields" in accept)) throw new Error("expected a form");
    expect(accept.fields.map((f) => f.key)).toEqual(["comment"]);
    const decline = items(m).find((i) => i.id === "rsvp-declined")!.next!();
    if (!("fields" in decline)) throw new Error("expected a form");
    expect(decline.fields.map((f) => f.label)).toEqual(["Note to Dana Morales", "Propose a new start", "and end"]);
    expect(await decline.save({ comment: "", start: "15:00", end: "" })).toBe(false);
    await decline.save({ comment: " Out that afternoon ", start: "15:00", end: "15:30" });
    expect(calls).toEqual([["rsvp", { id: "B", response: "declined", comment: "Out that afternoon", proposedStart: "2026-11-03T15:00:00-05:00", proposedEnd: "2026-11-03T15:30:00-05:00" }]]);
  });
  it("without write access, my own event offers no edits", () => {
    const { e } = env({ canWrite: false, eventEdit: { "outlook:A": { isOrganizer: true, others: 0, recurring: false, allDay: false, marker: null, webLink: web } } });
    const m = eventMenu(e, ev("outlook:A"));
    expect(items(m).filter((i) => i.id !== "open").every((i) => !!i.disabled)).toBe(true);
  });
});

describe("Timebox a pick into a free gap (step 13.6, D245)", () => {
  // Tue Nov 3 AM is 9:00 to 12:30 with no meetings; a timebox 9:00 to 10:00 is already there.
  const tbx = { id: 1, uid: "u", date: "2026-11-03", clientKey: "internal", pickId: null, itemId: null, title: "x", url: null, start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T10:00:00-05:00", outlook: false, removedAt: null } as never;
  it("lists the block's free gaps after timeboxes, then Custom time", () => {
    const { e } = env({ timeboxes: [tbx], now: "2026-11-03T13:00:00Z" });
    const s = timeboxStep(e, pick);
    expect(items(s).map((i) => [i.label, i.hint])).toEqual([
      ["Free 10:00–12:30 · 2h 30m", "2h from 10:00"],
      ["Custom time…", "start and length"],
    ]);
  });
  it("one click adds the timebox at the gap start for the pick's size, trimmed to the gap", async () => {
    const { e, calls } = env({ timeboxes: [tbx], planning: { sizes: { S: 60, M: 240, L: 300 }, carryDays: 7, reminderOffsetMinutes: 0, focusMinutes: 50, breakMinutes: 10, endSound: false } });
    const gap = items(timeboxStep(e, pick))[0]!;
    expect(gap.hint).toBe("trimmed to 2h 30m");
    await gap.run?.();
    expect(calls.at(-1)).toEqual(["timebox.add", { pickId: 7, date: "2026-11-03", start: "2026-11-03T10:00:00-05:00", end: "2026-11-03T12:30:00-05:00" }]);
  });
  it("says so when the block has no free time left", () => {
    const full = { ...(tbx as object), start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T12:30:00-05:00" } as never;
    expect(items(timeboxStep(env({ timeboxes: [full] }).e, pick))[0]).toMatchObject({ label: "No free time left in this block", disabled: expect.any(String) });
  });
  it("+ time says when only gaps shorter than the pick's shortest useful time are left (step 16, D285)", () => {
    // 9:00–12:30 with a timebox 9:00–12:00 leaves 30 minutes: too short for an M pick (60 minutes at least).
    const most = { ...(tbx as object), start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T12:00:00-05:00" } as never;
    const m = timeStep(env({ timeboxes: [most] }).e, { ...pick, size: "M" });
    expect(items(m)[0]).toMatchObject({ label: expect.stringMatching(/^No free stretch of 1h or more$/), disabled: expect.any(String) });
  });
  it("the pick menu's Timebox opens this step", () => {
    const m = pickMenu(env().e, pick);
    expect(find(m, "Timebox").next).toBeDefined();
  });
});

describe("+ Add work entry points (step 13.6, D241)", () => {
  it("the block menu and the command menu add work to a block with working time (key A)", async () => {
    const { e, calls } = env({ addWork: (d, h) => calls.push(["addWork", d, h]), selection: { date: "2026-11-04", half: "PM" } });
    await find(slotMenu(e, "2026-11-04", "AM", "internal", "Internal"), "Add work…").run?.();
    expect(calls.at(-1)).toEqual(["addWork", "2026-11-04", "AM"]);
    const cmd = commandList(e).find((c) => c.action === "ui.add_work")!;
    expect(cmd.hint).toBe("A");
    await cmd.run?.();
    expect(calls.at(-1)).toEqual(["addWork", "2026-11-04", "PM"]);
  });
  it("is disabled on a past day, a PTO day and a block without working hours", () => {
    const { e } = env();
    expect(find(slotMenu(e, "2026-11-02", "AM", "internal", "Internal"), "Add work…").disabled).toMatch(/Past day/);
    expect(find(slotMenu(e, "2026-11-05", "AM", "internal", "Internal"), "Add work…").disabled).toMatch(/PTO/);
    expect(find(slotMenu(e, "2026-11-07", "AM", null, null), "Add work…").disabled).toBe("No working hours in this block");
  });
});

describe("one row per pick: + time and the time editor (step 14.5, D259)", () => {
  const own = (extra: Record<string, unknown> = {}) => ({ id: 5, uid: "u5", date: "2026-11-03", clientKey: "internal", pickId: 7, itemId: null, title: "x", url: null, start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T12:30:00-05:00", outlook: false, onOutlook: false, showAs: "busy", removedAt: null, conflict: null, outlookNote: null, sync: null, ...extra }) as never;
  it("a timed pick that fills its block: Keep current first, never 'no free time'", () => {
    const s = timeStep(env({ timeboxes: [own()] }).e, pick);
    expect(items(s)[0]).toMatchObject({ id: "keep", checked: true });
    expect(items(s).some((i) => /No free time/.test(i.label))).toBe(false);
    expect(items(s).map((i) => i.id)).toEqual(expect.arrayContaining(["edit", "outlook", "remove"]));
  });
  it("Start and length saves through timebox.update", async () => {
    const { e, calls } = env({ timeboxes: [own()] });
    const step = find(timeStep(e, pick), "Start and length…").next!();
    expect("fields" in step && step.fields.map((f) => f.key)).toEqual(["start", "length"]);
    if ("fields" in step) await step.save({ start: "10:00", length: "90" });
    expect(calls.at(-1)).toEqual(["timebox.update", { id: 5, start: "2026-11-03T10:00:00-05:00", end: "2026-11-03T11:30:00-05:00" }]);
  });
  it("Put on Outlook toggles through timebox.set_outlook (the preview follows); checked when on", async () => {
    const { e, calls } = env({ timeboxes: [own()] });
    const off = items(timeStep(e, pick)).find((i) => i.id === "outlook")!;
    expect(off.checked).toBe(false);
    await off.run!();
    expect(calls.at(-1)).toEqual(["timebox.set_outlook", { id: 5, on: true }]);
    const on = items(timeStep(env({ timeboxes: [own({ outlook: true, onOutlook: true })] }).e, pick)).find((i) => i.id === "outlook")!;
    expect(on.checked).toBe(true);
  });
  it("Remove time removes the timebox; the pick stays planned", async () => {
    const { e, calls } = env({ timeboxes: [own()] });
    const r = find(timeStep(e, pick), "Remove time");
    expect(r.hint).toBe("the pick stays planned");
    await r.run!();
    expect(calls.at(-1)).toEqual(["timebox.remove", { id: 5 }]);
  });
  it("moving to another free place keeps the length", async () => {
    const { e, calls } = env({ timeboxes: [own({ end: "2026-11-03T10:00:00-05:00" })] });
    const m = items(timeStep(e, pick)).find((i) => i.id.startsWith("move"))!;
    expect(m.label).toBe("Move to 10:00–11:00");
    await m.run!();
    expect(calls.at(-1)).toEqual(["timebox.update", { id: 5, start: "2026-11-03T10:00:00-05:00", end: "2026-11-03T11:00:00-05:00" }]);
  });
});

describe("duplicate picks in menus (step 15.1, D277)", () => {
  it("shows a block that already has the item as 'Already planned here' instead of adding it again", () => {
    const { e } = env();
    const add = items(find(itemMenu(e, "internal", item(1)), "Add to the plan").next!());
    expect(add.find((i) => i.id === "add-2026-11-03-AM")!.disabled).toBe("Already planned here");
    expect(add.find((i) => i.id === "add-2026-11-03-PM")!.disabled).toBe("Already planned for the morning that day");
    const inSlot = items(find(slotMenu(e, "2026-11-03", "AM", "internal", "Internal"), "Add a work item").next!());
    expect(inSlot.find((i) => i.id === "i1")!.disabled).toBe("Already planned here");
  });
});
