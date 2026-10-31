// Menus for everything (step 6, D102): the command menu (Ctrl+K), the "⋯" and right-click menus on block cards,
// picks and work items. One model: a menu step is a titled list of items, or a text prompt; an item either runs
// or opens the next step. The command menu is built from the action registry, so every action appears.
import { ACTIONS, type ActionName, type ActionSpec } from "../actions/registry.ts";
import { THEME_NAMES, THEMES, type Theme } from "../config/schema.ts";
import { hoursOn, VIEW_RANGE_NAMES, VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
import { dayRule } from "../plan/days.ts";
import { isPickable } from "../plan/rules.ts";
import { SIZES, type Pick, type PlanDayState, type PlanWeek } from "../plan/types.ts";
import type { ClientWork, Half, IsoDate, Week, WorkItem } from "../week/types.ts";
import type { PlanningSettings, TimerView } from "../actions/types.ts";
import { PRESETS, suggestMinutes } from "../plan/timer.ts";
import { sizeNote } from "./planview.ts";

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
    }
  | {
      title: string;
      /** A small form (step 6b: hours for a day, unavailable time, flex sessions). */
      fields: FormField[];
      button?: string;
      /** Resolves false to keep the form open (the reason is shown as a notice). */
      save: (values: Record<string, string>) => void | Promise<unknown>;
    };

export type FormField = {
  key: string;
  label: string;
  type: "text" | "time" | "select";
  value?: string;
  optional?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

export type View = "week" | "planday" | "settings" | "loops";

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
  /** Today in the configured zone. Earlier days are past: only done and drop. */
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
  /** Settings > Planning (step 6c): size minutes and focus timer defaults. */
  planning: PlanningSettings;
  setTheme: (t: Theme) => void;
  /** The view range (saved in config) and the usual working hours. */
  viewRange: ViewRange;
  setViewRange: (r: ViewRange) => void;
  hours: TimeModel;
  /** Runs a time model action (hours for a day, unavailable time, flex sessions); false with a notice on refusal. */
  runTime: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  /** Opens Settings, at a section when given (step 6b). */
  openSettings: (section?: string) => void;
  exportPlan: () => void;
  /** The focus timer (step 6c) and its actions (timer.*); false with a notice on refusal. */
  timer: TimerView | null;
  runTimer: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  /** The Loops view (step 6c). */
  openLoops: () => void;
  /** Reset local plan, after a typed confirmation. */
  resetPlan: () => void;
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
  const has = hoursOn(env.hours, date).segments.length > 0 || (d?.flexMinutes ?? 0) > 0;
  const r = dayRule(date, env.today, d?.pto ?? null, has);
  if (r.ok) return undefined;
  return r.kind === "pto" ? ptoReason(env, date) : "No working hours: give the day hours or a flex session from its menu";
}

/** "AM", "PM" or "Evening" in labels. */
export const halfLabel = (h: Half) => (h === "EVE" ? "Evening" : h);

/** Half-days (and evening slots) of the week on screen with working time, as places to put a pick. */
function halfDays(env: MenuEnv, skip?: { date: IsoDate; half: Half }): { date: IsoDate; half: Half; label: string; disabled?: string }[] {
  return env.week.days.flatMap((d) =>
    ([d.am, d.pm, ...(d.eve ? [d.eve] : [])] as const)
      .filter((s) => (!s.off || d.kind === "overflow") && !(skip && skip.date === d.date && skip.half === s.half))
      .map(({ half }) => ({ date: d.date, half, label: `${dayName(d.date)} ${halfLabel(half)}${d.kind === "overflow" ? " (Friday catch-up)" : ""}`, ...(closedReason(env, d.date) ? { disabled: closedReason(env, d.date)! } : {}) })),
  );
}

// ---------- picks ----------

export function moveStep(env: MenuEnv, p: Pick): MenuStep {
  const other: Half = p.half === "AM" ? "PM" : "AM";
  const fri = env.week.days.find((d) => d.kind === "overflow")?.date ?? env.week.days[4]!.date;
  const quick: MenuItem[] = [
    { id: "to-other", label: `To ${halfLabel(other)} the same day`, action: "pick.move", ...(closedReason(env, p.date) ? { disabled: closedReason(env, p.date)! } : {}), run: () => env.runPlan("pick.move", { id: p.id, date: p.date, half: other }) },
    ...(p.date !== fri && !isPast(env, fri) ? [{ id: "to-fri", label: "To Friday (catch-up)", action: "pick.move", run: () => env.runPlan("pick.move", { id: p.id, date: fri, half: "AM" }) } as MenuItem] : []),
  ];
  const days = halfDays(env, { date: p.date, half: p.half })
    .filter((h) => h.date !== p.date)
    .map<MenuItem>((h) => ({ id: `to-${h.date}-${h.half}`, label: `To ${h.label}`, action: "pick.move", ...(h.disabled ? { disabled: h.disabled } : {}), run: () => env.runPlan("pick.move", { id: p.id, date: h.date, half: h.half }) }));
  return { title: `Move "${p.title}"`, items: [...quick, ...days] };
}

export function sizeStep(env: MenuEnv, p: Pick): MenuStep {
  return { title: `Size of "${p.title}"`, items: SIZES.map((s) => ({ id: `size-${s}`, label: s, hint: sizeNote(env.planning.sizes[s]), checked: p.size === s, action: "pick.set_size", run: () => env.runPlan("pick.set_size", { id: p.id, size: s }) })) };
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
      {
        id: "focus",
        label: env.timer?.pickId === p.id ? "Focus timer running" : "Start focus",
        hint: `${suggestMinutes(p.size, env.planning.sizes)} min`,
        action: "timer.start",
        ...(p.status !== "planned" ? { disabled: "Only a planned pick can be timeboxed" } : p.date !== env.today ? { disabled: "Only today's picks" } : env.timer?.pickId === p.id ? { disabled: "Already timing this pick" } : {}),
        next: () => lengthStep(`Focus on "${p.title}"`, suggestMinutes(p.size, env.planning.sizes), (m) => env.runTimer("timer.start", { pickId: p.id, minutes: m })),
      },
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
  const day = env.week.days.find((d) => d.date === date);
  return {
    title: dayName(date),
    items: [
      { id: "plan", label: isPast(env, date) && !refused ? "Plan this day (past: done and drop only)" : "Plan this day", action: "planday.start", ...(refused ? { disabled: refused } : {}), run: () => env.openPlanDay(date) },
      { id: "am", label: "Details of AM", action: "ui.details", run: () => env.openDetails(date, "AM") },
      { id: "pm", label: "Details of PM", action: "ui.details", run: () => env.openDetails(date, "PM") },
      ...(day?.eve ? [{ id: "eve", label: "Details of the evening", action: "ui.details", run: () => env.openDetails(date, "EVE") } as MenuItem] : []),
      ...timeItems(env, date),
    ],
  };
}

// ---------- time model (step 6b) ----------

const fmtSpan = (s: { start: string; end: string }) => `${s.start}–${s.end}`;
const localHm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });

/** Day menu items for the time model: this day's hours, unavailable time and flex sessions. */
function timeItems(env: MenuEnv, date: IsoDate): MenuItem[] {
  const day = env.week.days.find((d) => d.date === date);
  const h = hoursOn(env.hours, date);
  const pto = day?.pto ? ptoReason(env, date) : undefined;
  const tz = env.week.timeZone;
  const slots = day ? [day.am, day.pm, ...(day.eve ? [day.eve] : [])] : [];
  const blocked = slots.flatMap((s) => s.events.filter((e) => e.event.unavailable)).filter((e, i, all) => all.findIndex((x) => x.event.id === e.event.id) === i);
  const flex = slots.flatMap((s) => s.flex).filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i);
  const items: MenuItem[] = [
    { id: "hours", label: "Working hours for this day…", hint: h.segments.length ? h.segments.map(fmtSpan).join(" + ") : "none", action: "hours.set_day", ...(pto ? { disabled: pto } : {}), next: () => hoursForm(env, date) },
  ];
  if (h.overridden) items.push({ id: "hours-clear", label: "Use the usual hours", action: "hours.clear_day", run: () => env.runTime("hours.clear_day", { date }) });
  items.push({ id: "unavailable", label: "Block time as unavailable…", action: "unavailable.add", ...(pto ? { disabled: pto } : {}), next: () => unavailableForm(env, date) });
  items.push({ id: "flex", label: "Add a flex session…", hint: "outside working hours", action: "flex.add", ...(pto ? { disabled: pto } : {}), next: () => flexForm(env, date) });
  for (const b of blocked)
    items.push({ id: `u${b.event.unavailable!.id}`, label: `Remove unavailable: ${b.event.title}`, hint: `${localHm(b.event.start, tz)}–${localHm(b.event.end, tz)}`, danger: true, action: "unavailable.remove", run: () => env.runTime("unavailable.remove", { id: b.event.unavailable!.id }) });
  for (const f of flex) {
    const ended = Temporal.Instant.compare(Temporal.Instant.from(f.end), Temporal.Now.instant()) <= 0;
    items.push({ id: `f${f.id}`, label: `Remove flex session: ${f.clientKey}`, hint: `${localHm(f.start, tz)}–${localHm(f.end, tz)}`, danger: true, action: "flex.remove", ...(ended ? { disabled: "It has ended and its update is owed, so it stays on record" } : {}), run: () => env.runTime("flex.remove", { id: f.id }) });
  }
  return items;
}

/** The day's hours: a main span, an optional lunch and an optional evening span (a split day). */
export function hoursForm(env: MenuEnv, date: IsoDate): MenuStep {
  const h = hoursOn(env.hours, date);
  const main = h.main;
  const eve = h.extra[0];
  return {
    title: `Working hours for ${dayName(date)}`,
    button: "Save",
    fields: [
      { key: "start", label: "Start", type: "time", value: main?.start ?? "09:00", optional: true },
      { key: "end", label: "End", type: "time", value: main?.end ?? "17:00", optional: true },
      { key: "lunchStart", label: "Lunch from", type: "time", value: h.lunch?.start ?? "", optional: true },
      { key: "lunchEnd", label: "Lunch to", type: "time", value: h.lunch?.end ?? "", optional: true },
      { key: "eveStart", label: "Evening from", type: "time", value: eve?.start ?? "", optional: true },
      { key: "eveEnd", label: "Evening to", type: "time", value: eve?.end ?? "", optional: true },
    ],
    save: (v) => {
      const segments = [v.start && v.end ? `${v.start}-${v.end}` : null, v.eveStart && v.eveEnd ? `${v.eveStart}-${v.eveEnd}` : null].filter((x): x is string => !!x);
      return env.runTime("hours.set_day", { date, segments, lunch: v.lunchStart && v.lunchEnd ? `${v.lunchStart}-${v.lunchEnd}` : "" });
    },
  };
}

export function unavailableForm(env: MenuEnv, date: IsoDate): MenuStep {
  return {
    title: `Unavailable on ${dayName(date)}`,
    button: "Block",
    fields: [
      { key: "title", label: "What", type: "text", placeholder: "Dentist" },
      { key: "start", label: "From", type: "time" },
      { key: "end", label: "To", type: "time" },
      { key: "note", label: "Note", type: "text", optional: true },
    ],
    save: (v) => env.runTime("unavailable.add", { date, title: v.title, start: v.start, end: v.end, ...(v.note ? { note: v.note } : {}) }),
  };
}

export function flexForm(env: MenuEnv, date: IsoDate): MenuStep {
  const clients = [...env.work.values()].map((c) => ({ value: c.clientKey, label: c.clientName }));
  const day = env.week.days.find((d) => d.date === date);
  const block = day ? [...day.am.focus, ...day.pm.focus][0] : undefined;
  const h = hoursOn(env.hours, date);
  return {
    title: `Flex session on ${dayName(date)}`,
    button: "Add",
    fields: [
      { key: "clientKey", label: "Client", type: "select", options: clients, value: block?.clientKey ?? clients[0]?.value ?? "" },
      { key: "start", label: "From", type: "time", value: h.segments.at(-1)?.end ?? "" },
      { key: "end", label: "To", type: "time" },
      { key: "itemId", label: "DevOps item number", type: "text", optional: true, placeholder: "e.g. 1234" },
      { key: "note", label: "Note", type: "text", optional: true },
    ],
    save: (v) =>
      env.runTime("flex.add", { date, clientKey: v.clientKey, start: v.start, end: v.end, ...(v.itemId ? { itemId: Number(v.itemId) } : {}), ...(v.note ? { note: v.note } : {}) }),
  };
}

export function viewRangeStep(env: MenuEnv): MenuStep {
  return { title: "View range", items: VIEW_RANGES.map((r) => ({ id: r, label: VIEW_RANGE_NAMES[r], checked: env.viewRange === r, action: "ui.set_view_range", run: () => env.setViewRange(r) })) };
}

/** Days of the week on screen, for actions that ask for a day (selected day first). */
function chooseDay(env: MenuEnv, title: string, then: (date: IsoDate) => MenuStep | (() => unknown)): MenuStep {
  const sel = env.selection.date;
  const days = [...env.week.days].sort((a, b) => (a.date === sel ? -1 : b.date === sel ? 1 : 0));
  return {
    title,
    items: days.map((d) => {
      const r = then(d.date);
      return { id: d.date, label: `${dayName(d.date)}${d.date === sel ? " (selected)" : ""}`, ...(typeof r === "function" ? { run: r as () => void } : { next: () => r }) };
    }),
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

// ---------- focus timer (step 6c) ----------

/** Lengths in 5-minute steps, the suggested one first, then Custom. */
export function lengthStep(title: string, suggested: number, start: (minutes: number) => Promise<boolean>): MenuStep {
  const all = [suggested, ...PRESETS.filter((m) => m !== suggested)];
  return {
    title,
    items: [
      ...all.map<MenuItem>((m, i) => ({ id: `len-${m}`, label: `${m} min${i === 0 ? " (suggested)" : ""}`, action: "timer.start", run: () => start(m) })),
      {
        id: "len-custom",
        label: "Custom…",
        action: "timer.start",
        next: () => ({ title, prompt: "Minutes (1 to 240)", placeholder: String(suggested), button: "Start", submit: (t) => start(Number(t.trim())) }),
      },
    ],
  };
}

/** F: start a plain timer or a break, or control the one running. */
export function timerStep(env: MenuEnv): MenuStep {
  const t = env.timer;
  const p = env.planning;
  if (!t)
    return {
      title: "Focus timer",
      items: [
        { id: "focus", label: "Focus", hint: `${p.focusMinutes} min`, action: "timer.start", next: () => lengthStep("Focus for", p.focusMinutes, (m) => env.runTimer("timer.start", { minutes: m })) },
        { id: "break", label: "Break", hint: p.breakMinutes ? `${p.breakMinutes} min` : "off", action: "timer.start", ...(p.breakMinutes ? {} : { disabled: "Breaks are set to 0 minutes in Settings > Planning" }), run: () => env.runTimer("timer.start", { kind: "break" }) },
        { id: "pick", label: "Timebox a pick…", action: "timer.start", next: () => choosePick(env, "Focus on which pick?", (pk) => () => env.runTimer("timer.start", { pickId: pk.id })) },
      ],
    };
  return {
    title: t.pickId ? `Focus: ${t.label}` : t.kind === "break" ? "Break timer" : "Focus timer",
    items: [
      ...(t.ended ? [] : [t.running ? { id: "pause", label: "Pause", action: "timer.pause", run: () => env.runTimer("timer.pause") } : { id: "resume", label: "Resume", action: "timer.resume", run: () => env.runTimer("timer.resume") }]),
      { id: "extend", label: "+15 min", action: "timer.extend", run: () => env.runTimer("timer.extend") },
      { id: "done", label: t.pickId ? "Done (tick the pick)" : "Done", action: "timer.done", run: () => env.runTimer("timer.done") },
      { id: "next", label: "Next pick", action: "timer.next", run: () => env.runTimer("timer.next") },
      { id: "stop", label: "Stop", danger: true, action: "timer.stop", run: () => env.runTimer("timer.stop") },
    ],
  };
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
    case "ui.set_view_range": return { next: () => viewRangeStep(env) };
    case "settings.load": return { run: () => env.openSettings() };
    case "settings.save": return { run: () => env.openSettings() };
    case "secret.set": return { run: () => env.openSettings("connections") };
    case "data.export": return { run: env.exportPlan };
    case "hours.set_day": return { next: () => chooseDay(env, "Working hours for which day?", (d) => hoursForm(env, d)) };
    case "hours.clear_day": {
      const days = env.week.days.filter((d) => d.hours.overridden);
      if (!days.length) return { disabled: "No day this week has its own hours" };
      return { next: () => ({ title: "Use the usual hours on which day?", items: days.map((d) => ({ id: d.date, label: dayName(d.date), run: () => env.runTime("hours.clear_day", { date: d.date }) })) }) };
    }
    case "unavailable.add": return { next: () => chooseDay(env, "Block time on which day?", (d) => unavailableForm(env, d)) };
    case "flex.add": return { next: () => chooseDay(env, "Flex session on which day?", (d) => flexForm(env, d)) };
    case "unavailable.remove": {
      const all = env.week.days.flatMap((d) => [d.am, d.pm, ...(d.eve ? [d.eve] : [])].flatMap((s) => s.events.filter((e) => e.event.unavailable).map((e) => ({ d, e }))));
      const uniq = all.filter((x, i) => all.findIndex((y) => y.e.event.id === x.e.event.id) === i);
      if (!uniq.length) return { disabled: "No unavailable time this week" };
      return { next: () => ({ title: "Remove which unavailable time?", items: uniq.map(({ d, e }) => ({ id: e.event.id, label: `${dayName(d.date)}: ${e.event.title}`, danger: true, run: () => env.runTime("unavailable.remove", { id: e.event.unavailable!.id }) })) }) };
    }
    case "flex.remove": {
      const all = env.week.days.flatMap((d) => [d.am, d.pm, ...(d.eve ? [d.eve] : [])].flatMap((s) => s.flex.map((f) => ({ d, f }))));
      const uniq = all.filter((x, i) => all.findIndex((y) => y.f.id === x.f.id) === i);
      if (!uniq.length) return { disabled: "No flex session this week" };
      return { next: () => ({ title: "Remove which flex session?", items: uniq.map(({ d, f }) => ({ id: `f${f.id}`, label: `${dayName(d.date)}: ${f.clientKey}${f.itemTitle ? ` · ${f.itemTitle}` : ""}`, danger: true, run: () => env.runTime("flex.remove", { id: f.id }) })) }) };
    }
    case "timer.start": return { next: () => timerStep(env) };
    case "timer.pause": return env.timer?.running ? { run: () => env.runTimer("timer.pause") } : { disabled: "No timer is running" };
    case "timer.resume": return env.timer && !env.timer.running && !env.timer.ended ? { run: () => env.runTimer("timer.resume") } : { disabled: "No paused timer" };
    case "timer.stop": return env.timer ? { run: () => env.runTimer("timer.stop") } : { disabled: "No timer" };
    case "timer.extend": return env.timer ? { run: () => env.runTimer("timer.extend") } : { disabled: "No timer" };
    case "timer.done": return env.timer ? { run: () => env.runTimer("timer.done") } : { disabled: "No timer" };
    case "timer.next": return env.timer ? { run: () => env.runTimer("timer.next") } : { disabled: "No timer" };
    case "loops.list": return { run: env.openLoops };
    case "loop.close": return { run: env.openLoops };
    case "plan.reset": return { run: env.resetPlan };
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
