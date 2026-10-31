// Menus for everything (step 6, D102): the command menu (Ctrl+K), the "⋯" and right-click menus on block cards,
// picks and work items. One model: a menu step is a titled list of items, or a text prompt; an item either runs
// or opens the next step. The command menu is built from the action registry, so every action appears.
import { ACTIONS, type ActionName, type ActionSpec } from "../actions/registry.ts";
import { THEME_NAMES, THEMES, type Theme } from "../config/schema.ts";
import { dayRule } from "../plan/days.ts";
import { isPickable } from "../plan/rules.ts";
import { SIZES, type Pick, type PlanDayState, type PlanWeek } from "../plan/types.ts";
import type { ClientWork, Half, IsoDate, Week, WorkItem } from "../week/types.ts";

export type MenuItem = {
  id: string;
  label: string;
  /** Shown on the right: a key, or a short note. */
  hint?: string;
  /** Plain reason when the item can't be used now; the item shows but does nothing. */
  disabled?: string;
  checked?: boolean;
  danger?: boolean;
  /** The registry action (or UI command id) this item stands for. */
  action?: string;
  group?: string;
  run?: () => void | Promise<unknown>;
  next?: () => MenuStep;
};
export type MenuStep =
  | { title: string; items: MenuItem[] }
  | {
      title: string;
      prompt: string;
      placeholder?: string;
      /** A date picker instead of a text box (value YYYY-MM-DD). */
      input?: "date";
      value?: string;
      /** The submit button's label (default "Add"). */
      button?: string;
      submit: (text: string) => void | Promise<unknown>;
    };

export type View = "week" | "planday";

/** What the menus can see and do. App provides it. */
export type MenuEnv = {
  week: Week;
  /** The day the selection is on, and its half. */
  selection: { date: IsoDate; half: Half };
  planWeek: PlanWeek | null;
  /** The Plan the day panel's state when it's open. */
  planState: PlanDayState | null;
  /** Default day for Plan the day (today, or the next workday). */
  planTarget: { date: IsoDate; isToday: boolean };
  /** Today in the day shape's zone. Earlier days are past: only done and drop. */
  today: IsoDate;
  work: ReadonlyMap<string, ClientWork>;
  calendars: { outlook: boolean; google: boolean };
  runPlan: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  openPlanDay: (date?: IsoDate) => void;
  commitPlan: () => void;
  openDetails: (date: IsoDate, half: Half) => void;
  openLink: (clientKey: string, url: string) => void;
  changeWeek: (n: number) => void;
  goToday: () => void;
  refresh: () => void;
  showSourceStatus: () => void;
  connect: (c: "outlook" | "google") => void;
  disconnect: (c: "outlook" | "google") => void;
  setView: (v: View) => void;
  /** F6 / Shift+F6: the next or previous region of the window. */
  moveRegion: (dir: 1 | -1) => void;
  /** The work item that had focus when the menu opened (O opens it), if any. */
  focusedItem: { clientKey: string; url: string } | null;
  showKeys: () => void;
  /** The active theme and how to change it (saved in config, applied live). */
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const dayName = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** Full PTO days take no picks. */
function ptoReason(env: MenuEnv, date: IsoDate): string | undefined {
  const d = env.week.days.find((x) => x.date === date);
  return d?.pto ? `PTO day (${d.pto.titles.join(", ")})` : undefined;
}

const PAST = "Past day: its picks can only be ticked done or dropped";
const isPast = (env: MenuEnv, date: IsoDate) => date < env.today;
/** Why a day can't take new picks or changes: PTO, or past. */
const closedReason = (env: MenuEnv, date: IsoDate) => ptoReason(env, date) ?? (isPast(env, date) ? PAST : undefined);

/** Why Plan the day can't open a date (PTO, no working hours), or undefined when it can. */
export function planDayRefusal(env: MenuEnv, date: IsoDate): string | undefined {
  const d = env.week.days.find((x) => x.date === date);
  const r = dayRule(date, env.today, d?.pto ?? null);
  if (r.ok) return undefined;
  return r.kind === "pto" ? ptoReason(env, date) : "No working hours: Fridays and weekends can't be planned yet";
}

/** Half-days of the week on screen, as places to put a pick. */
function halfDays(env: MenuEnv, skip?: { date: IsoDate; half: Half }): { date: IsoDate; half: Half; label: string; disabled?: string }[] {
  return env.week.days.flatMap((d) =>
    (["AM", "PM"] as const)
      .filter((h) => !(skip && skip.date === d.date && skip.half === h))
      .map((half) => ({ date: d.date, half, label: `${dayName(d.date)} ${half}${d.kind === "overflow" ? " (Friday catch-up)" : ""}`, ...(closedReason(env, d.date) ? { disabled: closedReason(env, d.date)! } : {}) })),
  );
}

// ---------- picks ----------

export function moveStep(env: MenuEnv, p: Pick): MenuStep {
  const other: Half = p.half === "AM" ? "PM" : "AM";
  const fri = env.week.days[4]!.date;
  const quick: MenuItem[] = [
    { id: "to-other", label: `To ${other} the same day`, action: "pick.move", ...(closedReason(env, p.date) ? { disabled: closedReason(env, p.date)! } : {}), run: () => env.runPlan("pick.move", { id: p.id, date: p.date, half: other }) },
    ...(p.date !== fri && !isPast(env, fri) ? [{ id: "to-fri", label: "To Friday (catch-up)", action: "pick.move", run: () => env.runPlan("pick.move", { id: p.id, date: fri, half: "AM" }) } as MenuItem] : []),
  ];
  const days = halfDays(env, { date: p.date, half: p.half })
    .filter((h) => h.date !== p.date)
    .map<MenuItem>((h) => ({ id: `to-${h.date}-${h.half}`, label: `To ${h.label}`, action: "pick.move", ...(h.disabled ? { disabled: h.disabled } : {}), run: () => env.runPlan("pick.move", { id: p.id, date: h.date, half: h.half }) }));
  return { title: `Move "${p.title}"`, items: [...quick, ...days] };
}

export function sizeStep(env: MenuEnv, p: Pick): MenuStep {
  const note = { S: "about 1 h", M: "about 2 h", L: "a whole block" } as const;
  return { title: `Size of "${p.title}"`, items: SIZES.map((s) => ({ id: `size-${s}`, label: s, hint: note[s], checked: p.size === s, action: "pick.set_size", run: () => env.runPlan("pick.set_size", { id: p.id, size: s }) })) };
}

/** The "⋯" menu of a pick. */
export function pickMenu(env: MenuEnv, p: Pick): MenuStep {
  const past = isPast(env, p.date);
  return {
    title: p.title,
    items: [
      { id: "open", label: "Open in Edge", action: "link.open", ...(p.itemUrl ? {} : { disabled: p.kind === "intention" ? "An intention has no work item" : "A draft story isn't in DevOps yet" }), run: () => { if (p.itemUrl) env.openLink(p.clientKey, p.itemUrl); } },
      { id: "size", label: "Set size", hint: p.size, action: "pick.set_size", ...(past ? { disabled: PAST } : {}), next: () => sizeStep(env, p) },
      { id: "move", label: "Move", hint: past ? "to today or later" : "AM, PM, another day, Friday", action: "pick.move", ...(p.status !== "planned" ? { disabled: "Only a planned pick can be moved" } : {}), next: () => moveStep(env, p) },
      { id: "done", label: p.status === "done" ? "Mark not done" : "Mark done", action: "pick.mark_done", run: () => env.runPlan("pick.mark_done", { id: p.id, done: p.status !== "done" }) },
      { id: "drop", label: "Drop", danger: true, action: "pick.remove", ...(past && p.status !== "planned" ? { disabled: "Only a planned pick can be dropped on a past day" } : {}), run: () => env.runPlan("pick.remove", { id: p.id }) },
    ],
  };
}

// ---------- work items ----------

/** Where to add a work item: the selected half-day first, then every half-day of the week. */
function addStep(env: MenuEnv, clientKey: string, item: WorkItem): MenuStep {
  const sel = env.selection;
  const all = halfDays(env);
  const first = all.find((h) => h.date === sel.date && h.half === sel.half);
  const rest = all.filter((h) => h !== first);
  const items = [first, ...rest].filter((h): h is NonNullable<typeof h> => !!h).map<MenuItem>((h) => ({
    id: `add-${h.date}-${h.half}`,
    label: h === first ? `${h.label} (selected)` : h.label,
    action: "pick.add",
    ...(h.disabled ? { disabled: h.disabled } : {}),
    run: () => env.runPlan("pick.add", { date: h.date, half: h.half, clientKey, itemId: item.id }),
  }));
  return { title: `Add "${item.title}" to`, items };
}

function draftPrompt(env: MenuEnv, clientKey: string, item: WorkItem): MenuStep {
  return { title: `Draft story under "${item.title}"`, prompt: "Story title (stays local until a write step)", placeholder: "First slice of the feature", submit: (title) => env.runPlan("draft.add_story", { clientKey, parentItemId: item.id, title }) };
}

/** The "⋯" menu of a DevOps work item. */
export function itemMenu(env: MenuEnv, clientKey: string, item: WorkItem): MenuStep {
  const kids = env.work.get(clientKey)?.children.some((c) => c.parentId === item.id) ?? false;
  return {
    title: `${item.type} ${item.id}: ${item.title}`,
    items: [
      { id: "open", label: "Open in Edge", action: "link.open", run: () => env.openLink(clientKey, item.url) },
      {
        id: "add",
        label: "Add to the plan",
        action: "pick.add",
        ...(isPickable(item) ? {} : { disabled: item.level === "portfolio" ? `${item.type} is above story level: pick a child or add a draft story` : `${item.type} is not on a story, task or bug backlog` }),
        next: () => addStep(env, clientKey, item),
      },
      ...(item.level === "portfolio" && !kids ? [{ id: "draft", label: "Add a draft story", action: "draft.add_story", next: () => draftPrompt(env, clientKey, item) } as MenuItem] : []),
    ],
  };
}

// ---------- block cards ----------

/** The "⋯" menu of a half-day card. */
export function slotMenu(env: MenuEnv, date: IsoDate, half: Half, clientKey: string | null, clientName: string | null): MenuStep {
  const off = closedReason(env, date);
  const refused = planDayRefusal(env, date);
  const work = clientKey ? env.work.get(clientKey) : undefined;
  const pickable = (work?.items ?? []).filter(isPickable);
  return {
    title: `${dayName(date)} ${half}${clientName ? ` · ${clientName}` : ""}`,
    items: [
      { id: "details", label: "Details", hint: "Enter", action: "ui.details", run: () => env.openDetails(date, half) },
      { id: "plan", label: "Plan this day", action: "planday.start", ...(refused ? { disabled: refused } : {}), run: () => env.openPlanDay(date) },
      {
        id: "intention",
        label: "Add an intention",
        action: "pick.add",
        ...(off ? { disabled: off } : !clientKey ? { disabled: "Open half-day: plan it in Plan the day to choose a client" } : {}),
        next: () => ({ title: `Intention for ${dayName(date)} ${half}`, prompt: `What you mean to do for ${clientName}`, submit: (text) => env.runPlan("pick.add", { date, half, clientKey, intention: text }) }),
      },
      {
        id: "add-item",
        label: "Add a work item",
        action: "pick.add",
        ...(off ? { disabled: off } : !pickable.length ? { disabled: clientKey ? `No story-level items loaded for ${clientName}` : "Open half-day: plan it in Plan the day to choose a client" } : {}),
        next: () => ({ title: `Add to ${dayName(date)} ${half}`, items: pickable.map((i) => ({ id: `i${i.id}`, label: i.title, hint: `${i.type} ${i.id}`, action: "pick.add", run: () => env.runPlan("pick.add", { date, half, clientKey, itemId: i.id }) })) }),
      },
    ],
  };
}

// ---------- day headers ----------

/** The "⋯" menu of a day header. */
export function dayMenu(env: MenuEnv, date: IsoDate): MenuStep {
  const refused = planDayRefusal(env, date);
  return {
    title: dayName(date),
    items: [
      { id: "plan", label: isPast(env, date) && !refused ? "Plan this day (past: done and drop only)" : "Plan this day", action: "planday.start", ...(refused ? { disabled: refused } : {}), run: () => env.openPlanDay(date) },
      { id: "am", label: "Details of AM", action: "ui.details", run: () => env.openDetails(date, "AM") },
      { id: "pm", label: "Details of PM", action: "ui.details", run: () => env.openDetails(date, "PM") },
    ],
  };
}

/** "Plan a day…": a date picker. A refused date says why (PTO, no working hours) instead of opening. */
export function planDateStep(env: MenuEnv): MenuStep {
  return { title: "Plan a day", prompt: "Date to plan", input: "date", value: env.planState?.date ?? env.planTarget.date, button: "Plan", submit: (d) => env.openPlanDay(d) };
}

// ---------- the command menu ----------

/** Picks the command menu can act on: the panel's day when Plan the day is open, else the selected day. */
function picksInScope(env: MenuEnv): Pick[] {
  if (env.planState) return env.planState.picks.filter(live);
  return (env.planWeek?.[env.selection.date]?.picks ?? []).filter(live);
}

function choosePick(env: MenuEnv, title: string, then: (p: Pick) => MenuItem["run"] | MenuStep): MenuStep {
  const picks = picksInScope(env);
  const day = env.planState?.date ?? env.selection.date;
  if (!picks.length) return { title, items: [{ id: "none", label: `No picks on ${dayName(day)}`, disabled: "Plan the day first, or select a day with picks" }] };
  return {
    title,
    items: picks.map((p) => {
      const t = then(p);
      return typeof t === "function" ? { id: `p${p.id}`, label: p.title, hint: `${p.half} · ${p.size}`, run: t } : { id: `p${p.id}`, label: p.title, hint: `${p.half} · ${p.size}`, next: () => t as MenuStep };
    }),
  };
}

/** Work items of the selected block's client, or of every loaded client when the block has none. */
function itemsInScope(env: MenuEnv): { clientKey: string; item: WorkItem }[] {
  const d = env.week.days.find((x) => x.date === env.selection.date);
  const slot = d ? (env.selection.half === "AM" ? d.am : d.pm) : undefined;
  const key = slot?.focus[0]?.clientKey;
  const clients = key && env.work.has(key) ? [env.work.get(key)!] : [...env.work.values()];
  return clients.flatMap((c) => c.items.map((item) => ({ clientKey: c.clientKey, item })));
}

function chooseItem(env: MenuEnv, title: string, filter: (i: WorkItem) => boolean, then: (clientKey: string, i: WorkItem) => MenuItem["run"] | MenuStep): MenuStep {
  const all = itemsInScope(env).filter((x) => filter(x.item));
  if (!all.length) return { title, items: [{ id: "none", label: "No matching work items loaded", disabled: "Select a block with DevOps items" }] };
  return {
    title,
    items: all.map(({ clientKey, item }) => {
      const t = then(clientKey, item);
      const base = { id: `${clientKey}:${item.id}`, label: item.title, hint: `${clientKey} · ${item.type} ${item.id}` };
      return typeof t === "function" ? { ...base, run: t } : { ...base, next: () => t as MenuStep };
    }),
  };
}

function planDayStep(env: MenuEnv): MenuStep {
  const t = env.planTarget;
  const seen = new Set<string>([t.date]);
  const items: MenuItem[] = [{ id: "target", label: `${dayName(t.date)} (${t.isToday ? "today" : "next workday"})`, run: () => env.openPlanDay(t.date) }];
  for (const d of env.week.days) {
    if (seen.has(d.date)) continue;
    const refused = planDayRefusal(env, d.date);
    items.push({ id: d.date, label: `${dayName(d.date)}${isPast(env, d.date) ? " (past)" : ""}`, ...(refused ? { disabled: refused } : {}), run: () => env.openPlanDay(d.date) });
  }
  items.push({ id: "date", label: "Another date…", hint: "date picker", next: () => planDateStep(env) });
  return { title: "Plan which day?", items };
}

export function themeStep(env: MenuEnv): MenuStep {
  return { title: "Theme", items: THEMES.map((t) => ({ id: t, label: THEME_NAMES[t], checked: env.theme === t, action: "ui.set_theme", run: () => env.setTheme(t) })) };
}

/** How each registered action runs from the command menu. Every name must be here (checked by type and test). */
type Runner = { run?: () => void | Promise<unknown>; next?: () => MenuStep; disabled?: string };
function runnerFor(env: MenuEnv, name: ActionName): Runner {
  switch (name) {
    case "week.load": return { run: env.refresh };
    case "source.status": return { run: env.showSourceStatus };
    case "auth.connect_microsoft": return { run: () => env.connect("outlook") };
    case "auth.connect_google": return { run: () => env.connect("google") };
    case "auth.disconnect": {
      const on = (["outlook", "google"] as const).filter((c) => env.calendars[c]);
      if (!on.length) return { disabled: "No calendar is connected" };
      return { next: () => ({ title: "Disconnect which calendar?", items: on.map((c) => ({ id: c, label: c === "outlook" ? "Outlook" : "Google", danger: true, run: () => env.disconnect(c) })) }) };
    }
    case "planday.start": return { next: () => planDayStep(env) };
    case "planday.commit": return env.planState ? { run: env.commitPlan } : { disabled: "Open Plan the day first" };
    case "pick.add": return { next: () => chooseItem(env, "Add which work item?", isPickable, (k, i) => addStep(env, k, i)) };
    case "pick.set_size": return { next: () => choosePick(env, "Set the size of which pick?", (p) => sizeStep(env, p)) };
    case "pick.move": return { next: () => choosePick(env, "Move which pick?", (p) => moveStep(env, p)) };
    case "pick.mark_done": return { next: () => choosePick(env, "Mark which pick done or not done?", (p) => () => env.runPlan("pick.mark_done", { id: p.id, done: p.status !== "done" })) };
    case "pick.remove": return { next: () => choosePick(env, "Drop which pick?", (p) => () => env.runPlan("pick.remove", { id: p.id })) };
    case "draft.add_story": return { next: () => chooseItem(env, "Draft a story under which epic or feature?", (i) => i.level === "portfolio", (k, i) => draftPrompt(env, k, i)) };
    case "ui.set_theme": return { next: () => themeStep(env) };
    case "link.open": return { next: () => chooseItem(env, "Open which work item?", () => true, (k, i) => () => env.openLink(k, i.url)) };
  }
}

/** Window commands that aren't server actions: views, week navigation, details. */
function uiCommands(env: MenuEnv): MenuItem[] {
  const soon = "Coming soon";
  return [
    { id: "view.week", action: "view.week", group: "Views", label: "Week", ...(env.planState ? { hint: "Esc" } : {}), run: () => env.setView("week") },
    { id: "view.planday", action: "view.planday", group: "Views", label: "Plan the day", hint: "P", run: () => env.openPlanDay() },
    { id: "view.planday_date", action: "view.planday_date", group: "Views", label: "Plan a day…", next: () => planDateStep(env) },
    { id: "view.planweek", action: "view.planweek", group: "Views", label: "Plan the week", disabled: soon },
    { id: "view.checkin", action: "view.checkin", group: "Views", label: "Check-in", disabled: soon },
    { id: "view.closeout", action: "view.closeout", group: "Views", label: "Close out", disabled: soon },
    { id: "week.prev", action: "week.prev", group: "Week", label: "Previous week", hint: "[", run: () => env.changeWeek(-1) },
    { id: "week.next", action: "week.next", group: "Week", label: "Next week", hint: "]", run: () => env.changeWeek(1) },
    { id: "week.today", action: "week.today", group: "Week", label: "Go to today", hint: "T", run: env.goToday },
    { id: "ui.details", action: "ui.details", group: "Week", label: "Details of the selected half-day", hint: "Enter", run: () => env.openDetails(env.selection.date, env.selection.half) },
    { id: "ui.settings", action: "ui.settings", group: "Week", label: "Settings", disabled: soon },
    { id: "ui.region_next", action: "ui.region_next", group: "Keyboard", label: "Next region (top bar, week, panel, status bar)", hint: "F6", run: () => env.moveRegion(1) },
    { id: "ui.region_prev", action: "ui.region_prev", group: "Keyboard", label: "Previous region", hint: "Shift F6", run: () => env.moveRegion(-1) },
    {
      id: "ui.open_focused",
      action: "ui.open_focused",
      group: "Keyboard",
      label: "Open the focused work item in Edge",
      hint: "O",
      ...(env.focusedItem ? { run: () => env.openLink(env.focusedItem!.clientKey, env.focusedItem!.url) } : { disabled: "Focus a work item first (Tab to it)" }),
    },
    { id: "ui.keys", action: "ui.keys", group: "Keyboard", label: "Keyboard shortcuts", hint: "?", run: env.showKeys },
  ];
}

/** Every command: window commands, then one per registered action (built from the registry). */
export function commandList(env: MenuEnv): MenuItem[] {
  const fromRegistry = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.shortcut ? { hint: a.shortcut } : {}), ...runnerFor(env, a.name as ActionName) }));
  return [...uiCommands(env), ...fromRegistry];
}

/** Search: every word must appear in the label, group or hint, any order, any case. */
export function filterCommands(items: MenuItem[], query: string): MenuItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const found = items.filter((i) => {
    const text = `${i.label} ${i.group ?? ""} ${i.hint ?? ""} ${i.action ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  // A label that starts with what was typed comes first ("plan a day" finds "Plan a day…" before "Plan the day").
  const typed = words.join(" ");
  const starts = (i: MenuItem) => i.label.toLowerCase().startsWith(typed);
  return [...found.filter(starts), ...found.filter((i) => !starts(i))];
}
