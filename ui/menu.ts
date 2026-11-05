// Menus for everything (step 6, D102): the command menu (Ctrl+K), the "⋯" and right-click menus on block cards,
// picks and work items. One model: a menu step is a titled list of items, or a text prompt; an item either runs
// or opens the next step. The command menu is built from the action registry, so every action appears.
import type { CheckinGhost } from "../plan/carry.ts";
import { alreadyPlanned } from "../plan/dup.ts";
import { aboutText, hoursText, parseHours, sizeChipText, storyMinutes, MAX_ESTIMATE_HOURS, MIN_ESTIMATE_HOURS } from "../plan/estimate.ts";
import { addTargets, type AddTarget, type TargetBlock, type TargetGroup } from "../plan/addtargets.ts";
import { freeMinutes } from "../week/free.ts";
import { parseItemRef } from "../plan/lookup.ts";
import { ACTIONS, type ActionName, type ActionSpec } from "../actions/registry.ts";
import { TEXT_SIZES, THEME_NAMES, THEMES, type TextSize, type Theme } from "../config/schema.ts";
import { TEXT_SIZE_NAMES } from "./textsize.ts";
import { hoursOn, VIEW_RANGE_NAMES, VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
import { canAddWork, dayRule } from "../plan/days.ts";
import { pickTime, timeChoices } from "../plan/picktime.ts";
import { DEFAULT_MIN_SIZES, openGaps } from "../plan/agenda.ts";
import { REMOVED_IN_OUTLOOK } from "../plan/outlooksync.ts";
import { formatDuration } from "../week/format.ts";
import { isPickable } from "../plan/rules.ts";
import { typeNeedsBreakdown } from "../plan/process.ts";
import { SIZES, type Pick, type PlanDayState, type PlanWeek } from "../plan/types.ts";
import type { ClientWork, Half, IsoDate, Week, WorkItem } from "../week/types.ts";
import type { PlanningSettings, TimerView, BorrowedView, TimeboxView, InviteView } from "../actions/types.ts";
import { eventEdit, type EditAction, type EditFacts } from "../plan/caltier.ts";
import { minutesOf as minutesOfBox, SHOW_AS_LABEL, SHOW_AS_VALUES, type OutlookShowAs } from "../plan/timebox.ts";
import { overlapHint, RSVP_RESPONSES, RSVP_VERB, type RsvpResponse } from "../plan/rsvp.ts";
import type { CalEvent } from "../week/types.ts";
import { PRESETS, suggestMinutes } from "../plan/timer.ts";
import { userZone } from "../week/zone.ts";
import { openSend, sendLevel } from "./send-event.ts";

export type MenuItem = {
  id: string;
  label: string;
  /** Shown on the right: a key, or a short note. */
  hint?: string;
  /** Older names the search still finds (BD-1). */
  aka?: readonly string[];
  /** WT-1: a work item's type, drawn as its icon before the label (the type name is its tooltip). */
  typeIcon?: { clientKey: string; type: string };
  /** Plain reason when the item can't be used now; the item shows but does nothing. */
  disabled?: string;
  /** U2: a disabled item someone would look for (Move on a done pick): kept in ⋯ menus, its reason as a tooltip. Other disabled items are hidden there. */
  expected?: boolean;
  checked?: boolean;
  danger?: boolean;
  /** The registry action (or UI command id) this item stands for. */
  action?: string;
  group?: string;
  run?: () => void | Promise<unknown>;
  next?: () => MenuStep;
};
/** A row menu's header: a label naming the row it was opened from, never an action (D459). */
export type MenuHead = { text: string; full: string };
export type MenuStep =
  | { title: string; items: MenuItem[]; head?: MenuHead }
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
  /** "item": the shared work item lookup (step 15.2) for the client chosen in the field named by `client`. */
  type: "text" | "time" | "select" | "date" | "item";
  /** For an item field: the key of the select that holds its client. Saved as `<key>` (the id, or "") and `<key>Text`. */
  client?: string;
  value?: string;
  optional?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

/** Step 16.2: the places a command opens, as tab and mode (ui/nav.ts viewNav). */
export type View = import("./nav.ts").ViewName;

/** What the menus can see and do. App provides it. */
export type MenuEnv = {
  /** AS-1: open the assistant panel (with an optional first text). */
  openAssistant?: (text?: string) => void;
  /** Inbox › Requests is open (its keys work there). */
  asksOpen?: boolean;
  week: Week;
  /** The day the selection is on, and its half. */
  selection: { date: IsoDate; half: Half; clientKey?: string | null };
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
  /** G1: the in-app Guide (#/guide). */
  showGuide: () => void;
  /** The active theme and how to change it (saved in config, applied live). */
  theme: Theme;
  /** Settings > Planning (step 6c): size minutes and focus timer defaults. */
  planning: PlanningSettings;
  setTheme: (t: Theme) => void;
  /** The view range (saved in config) and the usual working hours. */
  viewRange: ViewRange;
  setViewRange: (r: ViewRange) => void;
  /** Step 17.5: Settings > Display "Reduce motion" (saved). */
  reduceMotion: boolean;
  saveReduceMotion: (on: boolean) => void;
  textSize: TextSize;
  saveTextSize: (size: TextSize) => void;
  /** U5.1 (D408): personal events shown on Week and Today (G). */
  showPersonal: boolean;
  saveShowPersonal: (show: boolean) => void;
  hours: TimeModel;
  /** Runs a time model action (hours for a day, unavailable time, flex sessions); false with a notice on refusal. */
  runTime: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  /** Opens Settings, at a section when given (step 6b). */
  openSettings: (section?: string) => void;
  /** ADM-1: the signed-in person is a FocusTime admin (Admin shows in ⋯ and the Settings sidebar). */
  admin?: boolean;
  /** P1: ⋯ › Notifications, the in-app list. */
  openNotifications?: () => void;
  /** Step 15.4: the VM chip's menu (Start; D475: nothing else changes the VM). */
  openVm: () => void;
  /** F1: ⋯ › Send feedback. */
  openFeedback: () => void;
  exportPlan: () => void;
  /** Step 15.2: the pick Focus suggests (today's next planned pick), or null. */
  focusNext?: Pick | null;
  /** The focus timer (step 6c) and its actions (timer.*); false with a notice on refusal. */
  timer: TimerView | null;
  runTimer: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  /** The Follow-ups view (step 6c). */
  openFollowUps: () => void;
  /** Reset local plan, after a typed confirmation. */
  resetPlan: () => void;
  /** Close out and Check-in (step 7). */
  openCloseOut: (date?: IsoDate) => void;
  openCheckIn: () => void;
  /** The day Close out is open on, if it is. */
  closeOutDate: IsoDate | null;
  commitCloseOut: () => void;
  /** "I'll make it up": moves the pick and records borrowed time; offers a flex session for tonight or a weekend. */
  makeUp: (pickId: number, input: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => Promise<boolean>;
  /** follow-up.add and borrow.pay; false with a notice on refusal. */
  runFollowUps: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  /** Borrowed time on the week shown plus every unpaid record. */
  borrowed: readonly BorrowedView[];
  /** Plan the week (step 8): open it (next week by default), and the week it is open on. */
  openPlanWeek: (weekStart?: IsoDate) => void;
  /** Quick capture (step 9): the capture box anywhere, and the Capture view (inbox and notes). */
  openCapture: (kind?: import("../plan/capture.ts").BoxKind) => void;
  openCaptures: () => void;
  /** The Plan button (step 10): the ritual for the moment. */
  openRitual: () => void;
  planWeekOpen: IsoDate | null;
  commitWeek: () => void;
  /** Timeboxes (step 12): the Timebox… dialog for a pick or a work item, and Reconnect Outlook with calendar changes. */
  openTimebox: (t: TimeboxTarget) => void;
  connectWrite: () => void;
  /** Step 13: edit facts per Outlook event and whether FocusTime may write; my own event's preview; Outlook on the web. */
  eventEdit: Record<string, EditFacts>;
  canWrite: boolean;
  editEvent: (input: { id: string; start?: string; end?: string; showAs?: OutlookShowAs }) => void;
  /** Step 16 (D283): answer a meeting; opens the write preview. False keeps the form open. */
  rsvp?: (input: { id: string; response: RsvpResponse; comment?: string; proposedStart?: string; proposedEnd?: string }) => void | Promise<unknown>;
  openOutlook: (url: string) => void;
  /** Timebox changes that may need an Outlook preview (the same path as the day strip). */
  timeboxChange: (action: string, input: Record<string, unknown>) => void;
  startTimeboxFocus: (tb: TimeboxView) => void;
  /** "Ask to collaborate" (the collaboration finder) and the help invites sent (cancel = undo of their write). */
  openHelp: (t: HelpTarget) => void;
  invites: readonly InviteView[];
  undoWrite: (id: number) => void;
  tz: string;
  /** Step 13.6: the week's timeboxes and the clock, for a pick's free gaps; "+ Add work" on a block (key A). */
  timeboxes?: readonly TimeboxView[];
  now?: string;
  addWork?: (date: IsoDate, half: Half) => void;
  /** Step 15 (D272): demo mode on or off (the server swaps every source and the plan store). */
  demo?: boolean;
  setDemo?: (on: boolean) => void;
  /** Step 15 (D269): a card's "This week: <feature>": Plan the day on that block, filtered to the feature. */
  planFeature?: (date: IsoDate, half: Half, itemId: number) => void;
};

/** What help is wanted on: a pick, a week list item, a timebox or a work item. `pinned` is its day when it has one. */
export type HelpTarget = { clientKey: string; title: string; url: string | null; itemId: number | null; pickId?: number | null; timeboxId?: number | null; pinned?: IsoDate | null };

/** What a timebox is for: a pick (its client, title and link), or a work item or week list item on a date. */
export type TimeboxTarget = { pickId: number; date: IsoDate } | { clientKey: string; itemId: number | null; title: string; url: string | null; date: IsoDate };

/** "Harbor's", "Northwind Foods'". */
/** The client's name as the screen shows it. */
const clientNameOf = (env: MenuEnv, k: string) => env.week.days.flatMap((d) => [d.am, d.pm]).find((sl) => sl.focus[0]?.clientKey === k)?.focus[0]?.clientName ?? env.work.get(k)?.clientName ?? k;

/** Drops a leading client name from a title ("Northwind - Export" under Northwind reads "Export"). */
export function withoutClient(title: string, client: string | null | undefined): string {
  const t = title.trim();
  if (!client) return t;
  const c = client.trim();
  if (!c || t.length <= c.length || t.slice(0, c.length).toLowerCase() !== c.toLowerCase()) return t;
  const rest = t.slice(c.length);
  const m = /^\s*[-–:·|/]\s*/.exec(rest) ?? /^\s+/.exec(rest);
  if (!m) return t; // "Northwinds" is not "Northwind"
  return rest.slice(m[0].length).trim() || t;
}

/** D459: the header of a row's menu, built from the row it was opened on: "#412 · Work Management App". */
export function rowHead(row: { id?: number | null; title: string; client?: string | null }): MenuHead {
  const title = withoutClient(row.title, row.client);
  const text = row.id != null ? `#${row.id} · ${title}` : title;
  return { text, full: row.id != null ? `#${row.id} ${row.title.trim()}` : row.title.trim() };
}

export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const weekday = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long" });
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

// ---------- PL-1: a Watching row's check-in ----------

/** A check-in's menu: move it to another half-day of its week, or remove it (the Watching row stays). */
export function checkinMenu(env: MenuEnv, c: CheckinGhost): MenuStep {
  const key = { weekStart: c.weekStart, clientKey: c.clientKey, itemId: c.itemId };
  const days = halfDays(env, { date: c.date, half: c.half })
    .filter((h) => h.half !== "EVE" && h.date >= c.weekStart && !isPast(env, h.date))
    .map<MenuItem>((h) => ({ id: `to-${h.date}-${h.half}`, label: `To ${h.label}`, action: "weekplan.watch_checkin", run: () => env.runPlan("weekplan.watch_checkin", { ...key, to: { date: h.date, half: h.half } }) }));
  return {
    title: `Check-in: ${c.title}`,
    items: [
      { id: "move", label: "Move", hint: "another half-day this week", action: "weekplan.watch_checkin", next: () => ({ title: `Move the check-in on "${c.title}"`, items: days }) },
      { id: "remove", label: "Remove check-in", hint: "keeps watching it", danger: true, action: "weekplan.watch_checkin", run: () => env.runPlan("weekplan.watch_checkin", { ...key, to: null }) },
    ],
  };
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
  return {
    title: `Size of "${p.title}"`,
    items: [
      ...SIZES.map<MenuItem>((s) => ({ id: `size-${s}`, label: sizeChipText(s), checked: p.size === s, action: "pick.set_size", run: () => env.runPlan("pick.set_size", { id: p.id, size: s }) })),
      { id: "size-clear", label: "Clear", hint: "counts as 2h", checked: p.size === null, action: "pick.set_size", run: () => env.runPlan("pick.set_size", { id: p.id, size: null }) },
    ],
  };
}

/** The "⋯" menu of a pick. */
export function pickMenu(env: MenuEnv, p: Pick): MenuStep {
  const past = isPast(env, p.date);
  return {
    title: p.title,
    head: rowHead({ id: p.itemId, title: p.title, client: clientNameOf(env, p.clientKey) }),
    items: [
      { id: "open", label: "Open in browser", action: "link.open", ...(p.itemUrl ? {} : { disabled: p.kind === "intention" ? "An intention has no work item" : "A draft story isn't in DevOps yet" }), run: () => { if (p.itemUrl) env.openLink(p.clientKey, p.itemUrl); } },
      { id: "size", label: "Set size", hint: p.size ?? "Size?", action: "pick.set_size", ...(past ? { disabled: PAST } : {}), next: () => sizeStep(env, p) },
      { id: "move", label: "Move", hint: past ? "to today or later" : "AM, PM, another day, Friday", action: "pick.move", ...(p.status !== "planned" ? { disabled: "Only a planned pick can be moved", expected: true } : {}), next: () => moveStep(env, p) },
      {
        id: "focus",
        label: env.timer?.pickId === p.id ? "Focus timer running" : "Start focus",
        hint: `${suggestMinutes(p.size, env.planning.sizes)} min`,
        action: "timer.start",
        ...(p.status !== "planned" ? { disabled: "Only a planned pick can be timeboxed" } : p.date !== env.today ? { disabled: "Only today's picks" } : env.timer?.pickId === p.id ? { disabled: "Already timing this pick" } : {}),
        next: () => lengthStep(`Focus on "${p.title}"`, suggestMinutes(p.size, env.planning.sizes), (m) => env.runTimer("timer.start", { pickId: p.id, minutes: m })),
      },
      { id: "timebox", label: "Timebox", hint: "a free gap in its block", action: "timebox.add", ...(p.status !== "planned" ? { disabled: "Only a planned pick can be timeboxed" } : past ? { disabled: PAST } : {}), next: () => timeboxStep(env, p) },
      { id: "help", label: "Ask to collaborate", hint: "who is free", action: "collab.candidates", ...(past ? { disabled: PAST } : {}), run: () => env.openHelp({ clientKey: p.clientKey, title: p.title, url: p.itemUrl, itemId: p.itemId, pickId: p.id, pinned: p.date }) },
      { id: "done", label: p.status === "done" ? "Mark not done" : "Mark done", action: "pick.mark_done", run: () => env.runPlan("pick.mark_done", { id: p.id, done: p.status !== "done" }) },
      { id: "makeup", label: "I'll make it up…", hint: "tonight, Friday, another day", action: "pick.make_up", ...(p.status !== "planned" ? { disabled: "Only a planned pick can be made up" } : {}), next: () => makeUpStep(env, p) },
      { id: "drop", label: "Drop", danger: true, action: "pick.remove", ...(past && p.status !== "planned" ? { disabled: "Only a planned pick can be dropped on a past day" } : {}), run: () => env.runPlan("pick.remove", { id: p.id }) },
    ],
  };
}

/** "I'll make it up" (step 7): tonight, the coming Friday, or a chosen day and slot. Records borrowed time. */
export function makeUpStep(env: MenuEnv, p: Pick): MenuStep {
  return {
    title: `Make up "${p.title}"`,
    items: [
      { id: "tonight", label: "Tonight", hint: "this evening; offers a flex session", action: "pick.make_up", run: () => env.makeUp(p.id, { when: "tonight" }) },
      { id: "friday", label: "Friday", hint: "the overflow day", action: "pick.make_up", run: () => env.makeUp(p.id, { when: "friday" }) },
      {
        id: "day",
        label: "Another day…",
        action: "pick.make_up",
        next: () => ({
          title: `Make up "${p.title}" on`,
          button: "Make it up",
          fields: [
            { key: "date", label: "Day", type: "date", value: env.today },
            { key: "half", label: "Slot", type: "select", value: "AM", options: [{ value: "AM", label: "Morning" }, { value: "PM", label: "Afternoon" }, { value: "EVE", label: "Evening" }] },
          ],
          save: (v) => env.makeUp(p.id, { when: "day", date: v.date!, half: v.half as Half }),
        }),
      },
    ],
  };
}

/** The borrowed-time chip (step 7): this week's records and anything unpaid; unpaid ones can be marked paid. */
export function borrowStep(env: MenuEnv, list: readonly BorrowedView[]): MenuStep {
  const when = (b: BorrowedView) => (b.payback === "tonight" ? `that evening (${dayName(b.paybackDate)})` : `${dayName(b.paybackDate)} ${b.paybackHalf === "AM" ? "morning" : b.paybackHalf === "PM" ? "afternoon" : "evening"}`);
  const sorted = [...list].sort((a, b) => Number(!!a.paidAt) - Number(!!b.paidAt) || a.date.localeCompare(b.date));
  return {
    title: "Borrowed time",
    items: sorted.length
      ? sorted.map((b) => ({
          id: `b${b.id}`,
          label: `${b.minutes} min · ${b.title}`,
          hint: b.paidAt ? (b.paidBy === "picks" ? "paid: pick done" : "paid") : `make up ${when(b)} · mark paid`,
          action: "borrow.pay",
          ...(b.paidAt ? { disabled: "Already paid" } : {}),
          run: () => env.runFollowUps("borrow.pay", { id: b.id }),
        }))
      : [{ id: "none", label: "No borrowed time", disabled: "Nothing to make up" }],
  };
}

/** "Add a follow-up" (step 7, step 13.5): what, optional who and due date, for the selected block's client. */
export function followUpForm(env: MenuEnv): MenuStep {
  return {
    title: "Add a promise",
    button: "Add",
    fields: [
      { key: "what", label: "What I owe", type: "text", placeholder: "e.g. Send the mapping notes" },
      { key: "who", label: "Who", type: "text", placeholder: "A person (optional)", optional: true },
      { key: "due", label: "Due", type: "date", optional: true },
    ],
    save: (v) => env.runFollowUps("followup.add", { what: v.what, ...(v.who ? { who: v.who } : {}), ...(v.due ? { due: v.due } : {}), ...(env.selection.clientKey ? { clientKey: env.selection.clientKey } : {}) }),
  };
}

// ---------- work items ----------

/** Step 15.1 (D277): a work item already planned (or done) in this block is shown disabled, not added again. */
function plannedHere(env: MenuEnv, date: string, half: Half, clientKey: string, itemId: number): { disabled?: string; expected?: boolean } {
  return alreadyPlanned(env.planWeek?.[date]?.picks ?? [], { clientKey, itemId }, date, half) ? { disabled: "Already planned here", expected: true } : {};
}

/** Step 15.3: the week's blocks that could take this work, in the 15.2 order (shared by "Add to the plan" and the drop strip). */
export function weekTargets(env: MenuEnv, clientKey: string, ref: { itemId?: number; draftId?: number; followUpId?: number }): AddTarget[] {
  const blocks: TargetBlock[] = env.week.days.flatMap((d) =>
    ([d.am, d.pm, ...(d.eve ? [d.eve] : [])] as const).map((sl) => ({
      date: d.date,
      half: sl.half,
      focusClient: d.kind === "overflow" ? null : (sl.focus[0]?.clientKey ?? null),
      flexClients: sl.flex.map((f) => f.clientKey),
      overflow: d.kind === "overflow",
      pto: !!d.pto,
      off: sl.off,
      freeMinutes: freeMinutes(sl),
    })),
  );
  const picks = env.week.days.flatMap((d) => env.planWeek?.[d.date]?.picks ?? []);
  const planDate = env.planState?.date ?? env.selection.date;
  return addTargets({ blocks, clientKey, planDate, selected: env.planState ? { date: env.selection.date, half: env.selection.half } : null, today: env.today, picks, ref: { clientKey, ...ref } });
}

/**
 * Where to add a work item (step 15.2, plan/addtargets.ts): the block selected in Plan the day first, then this client's
 * blocks on the day being planned, its other blocks this week, Open half-days, and other clients' blocks last, labeled
 * "Different client" and confirmed first. A day off, a full block, or one that already has the item says why.
 */
export function addStep(env: MenuEnv, clientKey: string, item: WorkItem | { draftId: number; title: string; size?: string }): MenuStep {
  // Step 15.3: a draft's "Plan it" uses the same targets, keyed by the draft.
  const draftId = "draftId" in item ? item.draftId : null;
  const planDate = env.planState?.date ?? env.selection.date;
  const targets = weekTargets(env, clientKey, draftId !== null ? { draftId } : { itemId: (item as WorkItem).id });
  const clientName = (k: string) => clientNameOf(env, k);
  const own = clientName(clientKey);
  const heading: Record<TargetGroup, string> = { here: `${own} on ${weekday(planDate)}`, client: `Other ${own} blocks`, open: "Open half-days", other: "Different client" };
  const add = (t: AddTarget) => () => env.runPlan("pick.add", { date: t.date, half: t.half, clientKey, ...(draftId !== null ? { draftId, ...("size" in item && item.size ? { size: item.size } : {}) } : { itemId: (item as WorkItem).id }) });
  const items = targets.map<MenuItem>((t) => {
    const fri = env.week.days.find((d) => d.date === t.date)?.kind === "overflow";
    const label = `${dayName(t.date)} ${halfLabel(t.half)}${t.otherClient ? ` · ${clientName(t.otherClient)}` : fri ? " (Friday catch-up)" : ""}`;
    const base: MenuItem = { id: `add-${t.date}-${t.half}`, label, group: t.selected ? "This block" : heading[t.group], action: "pick.add", ...(t.disabled ? { disabled: t.disabled, expected: true } : {}) };
    if (t.disabled) return base;
    if (t.otherClient)
      return {
        ...base,
        next: () => ({
          title: `Add ${own} work to ${possessive(clientName(t.otherClient!))} block?`,
          items: [
            { id: "yes", label: `Add to ${dayName(t.date)} ${halfLabel(t.half)} anyway`, action: "pick.add", run: add(t) },
            { id: "no", label: "Cancel", run: () => undefined },
          ],
        }),
      };
    return { ...base, run: add(t) };
  });
  return { title: `Add "${item.title}" to`, items: items.length ? items : [{ id: "none", label: "No block can take it this week", disabled: "Past days and days without working hours are left out" }] };
}

export function draftPrompt(env: MenuEnv, clientKey: string, item: { id: number; title: string }): MenuStep {
  return { title: `Draft story under "${item.title}"`, prompt: "Story title (stays local until a write step)", placeholder: "First slice of the feature", submit: (title) => env.runPlan("draft.add_story", { clientKey, parentItemId: item.id, title }) };
}

/** The "⋯" menu of a DevOps work item. */
export function itemMenu(env: MenuEnv, clientKey: string, item: WorkItem): MenuStep {
  const kids = env.work.get(clientKey)?.children.some((c) => c.parentId === item.id) ?? false;
  return {
    title: `#${item.id}: ${item.title}`,
    head: rowHead({ id: item.id, title: item.title, client: clientNameOf(env, clientKey) }),
    items: [
      { id: "open", label: "Open in browser", action: "link.open", run: () => env.openLink(clientKey, item.url) },
      {
        id: "add",
        label: "Add to the plan",
        action: "pick.add",
        ...(isPickable(item) ? {} : { disabled: item.level === "portfolio" ? `${item.type} is above story level: pick a child or add a draft story` : `${item.type} is not on a story, task or bug backlog` }),
        next: () => addStep(env, clientKey, item),
      },
      { id: "timebox", label: "Timebox…", hint: "start and length on the planned day", action: "timebox.add", run: () => env.openTimebox({ clientKey, itemId: item.id, title: item.title, url: item.url, date: env.planState?.date ?? env.today }) },
      { id: "help", label: "Ask to collaborate", hint: "who is free", action: "collab.candidates", run: () => env.openHelp({ clientKey, title: `#${item.id} ${item.title}`, url: item.url, itemId: item.id, pinned: env.planState?.date ?? null }) },
      (() => {
        const level = sendLevel(item);
        return { id: "send", label: "Send to…", hint: "a teammate's week", action: "send.create", ...(level ? {} : { disabled: "Send its features instead" }), run: () => level && openSend({ clientKey, clientName: clientNameOf(env, clientKey), itemId: item.id, level, title: item.title, itemType: item.type, url: item.url, parentId: item.parentId }) } as MenuItem;
      })(),
      ...(item.level === "portfolio" && !kids ? [{ id: "draft", label: "Add a draft story", action: "draft.add_story", next: () => draftPrompt(env, clientKey, item) } as MenuItem] : []),
    ],
  };
}

// ---------- calendar events (step 13): the editing rule ----------

const EDIT_LABEL: Record<EditAction, string> = { move: "Move…", resize: "Change end…", retitle: "Retitle…", show_as: "Show as", delete: "Delete", cancel: "Cancel invite…", open: "Open in Outlook", rsvp: "Answer" };

/**
 * Step 16 (D283): Accept, Tentative and Decline for a meeting someone else invited me to, the current answer checked.
 * Each opens a short form: an optional note and, for Tentative and Decline when the meeting allows it, a proposed new
 * time. Saving asks for a preview; nothing is sent before Confirm.
 */
export function rsvpItems(env: { rsvp?: MenuEnv["rsvp"]; tz: string }, e: { id: string; title: string; start: string; end: string }, facts: { response?: string | null; organizer?: string | null; proposals?: boolean }, disabled?: string): MenuItem[] {
  const id = e.id.replace(/^outlook:/, "");
  const date = e.start.slice(0, 10);
  const who = facts.organizer || "the organizer";
  return RSVP_RESPONSES.map((r): MenuItem => {
    const propose = r !== "accepted" && facts.proposals !== false;
    return {
      id: `rsvp-${r}`,
      label: `${RSVP_VERB[r]}…`,
      action: "write.preview",
      checked: facts.response === r,
      ...(disabled ? { disabled } : { hint: facts.response === r ? "your answer now" : `tells ${who}` }),
      next: () => ({
        title: `${RSVP_VERB[r]} "${e.title}"`,
        button: "Preview",
        fields: [
          { key: "comment", label: `Note to ${who}`, type: "text", optional: true },
          ...(propose
            ? ([
                { key: "start", label: "Propose a new start", type: "time", optional: true },
                { key: "end", label: "and end", type: "time", optional: true },
              ] as FormField[])
            : []),
        ],
        save: (v) => {
          if (!env.rsvp) return;
          const both = !!v.start && !!v.end;
          // A proposed time needs both ends: keep the form open.
          if (!!v.start !== !!v.end) return Promise.resolve(false);
          return env.rsvp({ id, response: r, ...(v.comment?.trim() ? { comment: v.comment.trim() } : {}), ...(both ? { proposedStart: atTime(date, v.start!, env.tz), proposedEnd: atTime(date, v.end!, env.tz) } : {}) });
        },
      }),
    };
  });
}

/** The focus blocks of an event's day, for the overlap hint. */
function blocksOn(week: Week, date: IsoDate) {
  const day = week.days.find((d) => d.date === date);
  if (!day) return [];
  return [day.am, day.pm].flatMap((sl) => (sl.focus[0] ? [{ start: sl.start, end: sl.end, clientName: sl.focus[0].clientName }] : []));
}
const hhmm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });
/** A local time on `date` at "HH:MM" in the zone, with offset. */
const atTime = (date: IsoDate, hm: string, tz: string) => Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz, plainTime: Temporal.PlainTime.from(hm) }).toString({ timeZoneName: "never", smallestUnit: "second" });
const outlookDay = (date: IsoDate) => {
  const d = Temporal.PlainDate.from(date);
  return `https://outlook.office.com/calendar/view/day/${d.year}/${d.month}/${d.day}`;
};

/**
 * The menu of any calendar event: every action, those its tier doesn't allow disabled with a one-line reason
 * ("FocusTime only edits what it created or what only I can see"). My own events: move, change end and show as,
 * each previewed. Meetings with others: Open in Outlook only.
 */
export function eventMenu(env: MenuEnv, e: CalEvent): MenuStep {
  const facts = env.eventEdit[e.id] ?? null;
  const x = eventEdit(e, facts, env.canWrite);
  const id = e.id.replace(/^outlook:/, "");
  const date = e.start.slice(0, 10);
  const tz = env.tz;
  const dur = Temporal.Instant.from(e.start).until(Temporal.Instant.from(e.end)).total("minutes");
  const invite = facts?.marker ? env.invites.find((i) => i.uid === facts.marker) ?? null : null;
  // Step 16: a meeting I'm invited to leads with Accept, Tentative and Decline, then Open in Outlook. Its edits, all off
  // for the same reason, are left out: the menu title already says to change anything else in Outlook.
  const invited = x.tier === "meeting" && !!facts && !facts.isOrganizer && facts.others > 0;
  const rsvp = x.actions.find((a) => a.id === "rsvp");
  const items: MenuItem[] = invited && rsvp
    ? [...rsvpItems(env, e, facts, rsvp.allowed ? undefined : rsvp.reason ?? "Not for this event"), ...x.actions.filter((a) => a.id === "open").map(item)]
    : x.actions.filter((a) => a.id !== "rsvp").map(item);
  const hint = x.tier === "meeting" ? overlapHint(e, blocksOn(env.week, date)) : null;
  return { title: `${e.title} · ${hint ? `${hint} · ` : ""}${x.why}`, items };

  function item(a: (typeof x.actions)[number]): MenuItem {
    const base: MenuItem = { id: a.id, label: EDIT_LABEL[a.id], ...(a.allowed ? {} : { disabled: a.reason ?? "Not for this event" }) };
    if (!a.allowed) return base;
    switch (a.id) {
      case "move":
        return { ...base, hint: "keeps its length; preview first", next: () => ({ title: `Move "${e.title}"`, button: "Preview", fields: [{ key: "start", label: "Starts at", type: "time", value: hhmm(e.start, tz) }], save: (v) => { const s = atTime(date, v.start!, tz); const end = Temporal.Instant.from(s).add({ minutes: dur }).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" }); env.editEvent({ id, start: s, end }); } }) };
      case "resize":
        return { ...base, hint: "preview first", next: () => ({ title: `End of "${e.title}"`, button: "Preview", fields: [{ key: "end", label: "Ends at", type: "time", value: hhmm(e.end, tz) }], save: (v) => env.editEvent({ id, end: atTime(date, v.end!, tz) }) }) };
      case "show_as":
        return { ...base, hint: SHOW_AS_LABEL[(e.showAs ?? "busy") as OutlookShowAs] ?? e.showAs, next: () => ({ title: `Show "${e.title}" as`, items: SHOW_AS_VALUES.map((v) => ({ id: v, label: SHOW_AS_LABEL[v], checked: (e.showAs ?? "busy") === v, run: () => env.editEvent({ id, showAs: v }) })) }) };
      case "cancel":
        return invite?.writeId ? { ...base, hint: `${invite.names.join(", ")} get a cancellation; preview first`, danger: true, run: () => env.undoWrite(invite.writeId!) } : { ...base, disabled: "Cancel it from Settings > Data (Undo)" };
      case "open":
        return { ...base, run: () => env.openOutlook(x.webLink ?? outlookDay(date)) };
      default:
        // FocusTime's own events show as timeboxes, where these live.
        return { ...base, disabled: "Edit it as a timebox (its band in the block)" };
    }
  }
}

/** The menu of a timebox (a FocusTime event: the event and its timebox are one thing). */
export function timeboxMenu(env: MenuEnv, t: TimeboxView): MenuStep {
  const tz = env.tz;
  const dur = Temporal.Instant.from(t.start).until(Temporal.Instant.from(t.end)).total("minutes");
  const ev = Object.entries(env.eventEdit).find(([, f]) => f.marker === t.uid);
  const blocked = t.conflict ? "Changed in FocusTime and in Outlook: choose a version first" : undefined;
  const change = (input: Record<string, unknown>) => env.timeboxChange("timebox.update", { id: t.id, ...input });
  const conflict: MenuItem[] = t.conflict
    ? [
        { id: "keep", label: "Keep FocusTime's version", hint: t.conflict.changed.join(", "), action: "timebox.resolve", run: () => env.timeboxChange("timebox.resolve", { id: t.id, keep: "focustime" }) },
        { id: "theirs", label: t.conflict.outlook ? "Use Outlook's version" : "Remove (deleted in Outlook)", action: "timebox.resolve", run: () => env.timeboxChange("timebox.resolve", { id: t.id, keep: "outlook" }) },
      ]
    : [];
  return {
    title: `Timebox: ${t.title}${t.onOutlook ? " · on Outlook" : ""}${t.outlookNote ? ` · ${t.outlookNote}` : ""}`,
    items: [
      ...conflict,
      { id: "move", label: "Move…", hint: "keeps its length", action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), next: () => ({ title: `Move "${t.title}"`, button: "Move", fields: [{ key: "start", label: "Starts at", type: "time", value: hhmm(t.start, tz) }], save: (v) => { const s = atTime(t.date, v.start!, tz); change({ start: s, end: Temporal.Instant.from(s).add({ minutes: dur }).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" }) }); } }) },
      { id: "resize", label: "Change end…", action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), next: () => ({ title: `End of "${t.title}"`, button: "Save", fields: [{ key: "end", label: "Ends at", type: "time", value: hhmm(t.end, tz) }], save: (v) => change({ end: atTime(t.date, v.end!, tz) }) }) },
      { id: "retitle", label: "Retitle…", action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), next: () => ({ title: `Retitle "${t.title}"`, prompt: "Title (the client name stays in front on Outlook)", value: t.title, button: "Save", submit: (title) => change({ title }) }) },
      { id: "show", label: "Show as", hint: SHOW_AS_LABEL[t.showAs], action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), next: () => ({ title: `Show "${t.title}" as`, items: SHOW_AS_VALUES.map((v) => ({ id: v, label: SHOW_AS_LABEL[v], checked: t.showAs === v, run: () => change({ showAs: v }) })) }) },
      { id: "outlook", label: t.outlook ? "Take off Outlook" : "Put on Outlook", action: "timebox.set_outlook", ...(blocked ? { disabled: blocked } : {}), run: () => env.timeboxChange("timebox.set_outlook", { id: t.id, on: !t.outlook }) },
      { id: "focus", label: "Start focus", action: "timer.start", ...(t.date !== env.today ? { disabled: "Only today's timeboxes" } : {}), run: () => env.startTimeboxFocus(t) },
      { id: "help", label: "Ask to collaborate", action: "collab.candidates", run: () => env.openHelp({ clientKey: t.clientKey, title: t.title, url: t.url, itemId: t.itemId, pickId: t.pickId, timeboxId: t.id, pinned: t.date }) },
      { id: "open", label: "Open in Outlook", action: "outlook.open", ...(t.onOutlook ? {} : { disabled: "Not on Outlook" }), run: () => env.openOutlook(ev?.[1].webLink ?? outlookDay(t.date)) },
      { id: "remove", label: "Remove", danger: true, action: "timebox.remove", ...(t.onOutlook ? { hint: "and its Outlook event, after a preview" } : {}), run: () => env.timeboxChange("timebox.remove", { id: t.id }) },
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
      { id: "addwork", label: "Add work…", hint: "A", action: "ui.add_work", ...(addWorkRefusal(env, date, half) ? { disabled: addWorkRefusal(env, date, half)! } : {}), run: () => env.addWork?.(date, half) },
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
        next: () => ({ title: `Add to ${dayName(date)} ${half}`, items: pickable.map((i) => ({ id: `i${i.id}`, label: i.title, hint: `#${i.id}`, ...(clientKey ? { typeIcon: { clientKey, type: i.type } } : {}), action: "pick.add", ...(clientKey ? plannedHere(env, date, half, clientKey, i.id) : {}), run: () => env.runPlan("pick.add", { date, half, clientKey, itemId: i.id }) })) }),
      },
    ],
  };
}

/** "9:00–11:00" in the configured zone, no AM or PM (the agenda's short form). */
export function spanText(start: string, end: string, tz: string): string {
  const t = (x: string) => {
    const z = Temporal.Instant.from(x).toZonedDateTimeISO(tz);
    return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}`;
  };
  return `${t(start)}–${t(end)}`;
}

/**
 * A pick's Timebox (step 13.6, D245): its block's free gaps, one click places it at the gap start for its size
 * (trimmed to the gap), then "Custom time…" for the dialog.
 */
export function timeboxStep(env: MenuEnv, p: Pick): MenuStep {
  return timeStep(env, p);
}

/**
 * A pick's time (step 14.5, D259): "+ time" on an untimed pick lists its block's free gaps (one click sets it) and
 * Custom time. On a timed pick it is the time editor: Keep current, other free places (its own time counts as free,
 * so it never says "no free time" because of itself), start and length, Put on Outlook (previewed), show as, Remove.
 */
export function timeStep(env: MenuEnv, p: Pick): MenuStep {
  const tz = env.tz;
  const day = env.week.days.find((d) => d.date === p.date);
  const slot = day ? (p.half === "AM" ? day.am : p.half === "PM" ? day.pm : day.eve) : undefined;
  const all = env.timeboxes ?? [];
  const { timebox: t } = pickTime(p.id, all);
  const choices = slot ? timeChoices(slot, all, p, env.planning.sizes, p.date === env.today ? env.now : undefined, env.planning.minSizes ?? DEFAULT_MIN_SIZES) : [];
  const custom: MenuItem = { id: "custom", label: "Custom time…", hint: "start and length", action: "timebox.add", run: () => env.openTimebox({ pickId: p.id, date: p.date }) };
  if (!t) {
    const gaps: MenuItem[] = choices.map((c, i) => ({ id: `gap${i}`, label: `Free ${spanText(c.gapStart, c.gapEnd, tz)} · ${formatDuration(c.gapMinutes)}`, hint: c.trimmed ? `trimmed to ${formatDuration(c.minutes)}` : `${formatDuration(c.minutes)} from ${spanText(c.start, c.end, tz).split("–")[0]}`, action: "timebox.add", run: () => env.timeboxChange("timebox.add", { pickId: p.id, date: p.date, start: c.start, end: c.end }) }));
    return {
      title: `Time for "${p.title}"`,
      items: [...(gaps.length ? gaps : [{ id: "none", label: !slot ? "This day isn't in the week shown" : openGaps(slot, all, p.date === env.today ? env.now : undefined).length ? `No free stretch of ${formatDuration(Math.min((env.planning.minSizes ?? DEFAULT_MIN_SIZES)[p.size ?? "M"], storyMinutes(p.size)))} or more` : "No free time left in this block", action: "timebox.add", disabled: "Use Custom time, or free up the block" } satisfies MenuItem]), custom],
    };
  }
  const len = minutesOfBox(t);
  const blocked = t.conflict ? "Changed in FocusTime and in Outlook: choose a version first" : undefined;
  const change = (input: Record<string, unknown>) => env.timeboxChange("timebox.update", { id: t.id, ...input });
  const conflict: MenuItem[] = t.conflict
    ? [
        { id: "keepmine", label: "Keep FocusTime's version", hint: t.conflict.changed.join(", "), action: "timebox.resolve", run: () => env.timeboxChange("timebox.resolve", { id: t.id, keep: "focustime" }) },
        { id: "theirs", label: t.conflict.outlook ? "Use Outlook's version" : "Remove (deleted in Outlook)", action: "timebox.resolve", run: () => env.timeboxChange("timebox.resolve", { id: t.id, keep: "outlook" }) },
      ]
    : [];
  const removed: MenuItem[] = t.outlookNote === REMOVED_IN_OUTLOOK && !t.conflict
    ? [
        { id: "keeplocal", label: "Removed in Outlook: keep it here", action: "timebox.resolve", run: () => env.timeboxChange("timebox.resolve", { id: t.id, keep: "local" }) },
      ]
    : [];
  const moves: MenuItem[] = choices.map((c, i) =>
    c.kind === "keep"
      ? { id: "keep", label: `Keep ${spanText(c.start, c.end, tz)}`, hint: formatDuration(c.minutes), checked: true, run: () => undefined }
      : { id: `move${i}`, label: `Move to ${spanText(c.start, c.end, tz)}`, hint: c.trimmed ? `trimmed to ${formatDuration(c.minutes)}` : `free ${formatDuration(c.gapMinutes)}`, action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), run: () => change({ start: c.start, end: c.end }) },
  );
  const lengths = [15, 30, 45, 60, 90, 120, 150, 180, 240];
  return {
    title: `"${p.title}" · ${spanText(t.start, t.end, tz)}${t.onOutlook ? " · on Outlook" : ""}${t.outlookNote && t.outlookNote !== REMOVED_IN_OUTLOOK ? ` · ${t.outlookNote}` : ""}`,
    items: [
      ...conflict,
      ...removed,
      ...moves,
      {
        id: "edit",
        label: "Start and length…",
        action: "timebox.update",
        ...(blocked ? { disabled: blocked } : {}),
        next: () => ({
          title: `Time for "${p.title}"`,
          button: "Save",
          fields: [
            { key: "start", label: "Starts at", type: "time", value: hhmm(t.start, tz) },
            { key: "length", label: "Length", type: "select", value: String(lengths.includes(len) ? len : 60), options: [...new Set([...lengths, len])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: formatDuration(m) })) },
          ],
          save: (v) => {
            const s = atTime(t.date, v.start!, tz);
            change({ start: s, end: Temporal.Instant.from(s).add({ minutes: Number(v.length) }).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" }) });
          },
        }),
      },
      { id: "outlook", label: "Put on Outlook", checked: t.outlook, hint: t.outlook ? "on: a Busy event only you are on" : "after a preview", action: "timebox.set_outlook", ...(blocked ? { disabled: blocked } : {}), run: () => env.timeboxChange("timebox.set_outlook", { id: t.id, on: !t.outlook }) },
      ...(t.outlook ? [{ id: "show", label: "Show as", hint: SHOW_AS_LABEL[t.showAs], action: "timebox.update", ...(blocked ? { disabled: blocked } : {}), next: () => ({ title: `Show "${p.title}" as`, items: SHOW_AS_VALUES.map((v) => ({ id: v, label: SHOW_AS_LABEL[v], checked: t.showAs === v, run: () => change({ showAs: v }) })) }) } satisfies MenuItem] : []),
      { id: "focus", label: "Start focus", action: "timer.start", ...(t.date !== env.today ? { disabled: "Only today's timeboxes" } : {}), run: () => env.startTimeboxFocus(t) },
      { id: "remove", label: "Remove time", danger: true, action: "timebox.remove", hint: t.onOutlook ? "and its Outlook event, after a preview" : "the pick stays planned", run: () => env.timeboxChange("timebox.remove", { id: t.id }) },
    ],
  };
}

/** Why a block can't take "+ Add work" (step 13.6, D241), or undefined. */
export function addWorkRefusal(env: MenuEnv, date: IsoDate, half: Half): string | undefined {
  const day = env.week.days.find((d) => d.date === date);
  const slot = day ? (half === "AM" ? day.am : half === "PM" ? day.pm : day.eve) : undefined;
  if (canAddWork({ date, today: env.today, pto: !!day?.pto, off: !slot || slot.off })) return undefined;
  return date < env.today ? PAST : day?.pto ? `PTO day (${day.pto.titles.join(", ")})` : "No working hours in this block";
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
  const tz = userZone(env.week);
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
      { key: "itemId", label: "DevOps item", type: "item", client: "clientKey", optional: true },
      { key: "note", label: "Note", type: "text", optional: true },
    ],
    save: (v) => {
      // A linked item, or "#123" typed; any other text goes into the note.
      const typed = v.itemIdText ? parseItemRef(v.itemIdText) : null;
      const itemId = v.itemId ? Number(v.itemId) : typed;
      const note = [itemId === null ? v.itemIdText : "", v.note].filter(Boolean).join(" · ");
      return env.runTime("flex.add", { date, clientKey: v.clientKey, start: v.start, end: v.end, ...(itemId ? { itemId } : {}), ...(note ? { note } : {}) });
    },
  };
}

export function viewRangeStep(env: MenuEnv): MenuStep {
  return { title: "Timelines", items: VIEW_RANGES.map((r) => ({ id: r, label: VIEW_RANGE_NAMES[r], checked: env.viewRange === r, action: "ui.set_view_range", run: () => env.setViewRange(r) })) };
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

function chooseItem(env: MenuEnv, title: string, filter: (i: WorkItem, clientKey: string) => boolean, then: (clientKey: string, i: WorkItem) => MenuItem["run"] | MenuStep): MenuStep {
  const all = itemsInScope(env).filter((x) => filter(x.item, x.clientKey));
  if (!all.length) return { title, items: [{ id: "none", label: "No matching work items loaded", disabled: "Select a block with DevOps items" }] };
  return {
    title,
    items: all.map(({ clientKey, item }) => {
      const t = then(clientKey, item);
      const base = { id: `${clientKey}:${item.id}`, label: item.title, hint: `${clientKey} · #${item.id}`, typeIcon: { clientKey, type: item.type } };
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
  if (!t) {
    // Step 15.2: the Focus button suggests the next planned pick first, then a plain timer.
    const nx = env.focusNext ?? null;
    return {
      title: "Start focus",
      items: [
        ...(nx ? [{ id: "next", label: `Start focus: ${nx.title}`, hint: `${suggestMinutes(nx.size, p.sizes)} min`, action: "timer.start", run: () => env.runTimer("timer.start", { pickId: nx.id }) } as MenuItem] : []),
        { id: "focus", label: nx ? "Plain timer" : "Focus", hint: `${p.focusMinutes} min`, action: "timer.start", next: () => lengthStep("Focus for", p.focusMinutes, (m) => env.runTimer("timer.start", { minutes: m })) },
        // Step 16.3: deep focus sets Teams to Do not disturb (plain focus: Busy). On the next pick when there is one.
        { id: "deep", label: "Deep focus", hint: "Teams: Do not disturb", action: "timer.start", next: () => lengthStep("Deep focus for", nx ? suggestMinutes(nx.size, p.sizes) : p.focusMinutes, (m) => env.runTimer("timer.start", { minutes: m, deep: true, ...(nx ? { pickId: nx.id } : {}) })) },
        { id: "break", label: "Break", hint: p.breakMinutes ? `${p.breakMinutes} min` : "off", action: "timer.start", ...(p.breakMinutes ? {} : { disabled: "Breaks are set to 0 minutes in Settings > Planning" }), run: () => env.runTimer("timer.start", { kind: "break" }) },
        { id: "pick", label: nx ? "Another pick…" : "Timebox a pick…", action: "timer.start", next: () => choosePick(env, "Focus on which pick?", (pk) => () => env.runTimer("timer.start", { pickId: pk.id })) },
      ],
    };
  }
  return {
    title: t.pickId ? `Focus: ${t.label}` : t.kind === "break" ? "Break timer" : "Focus timer",
    items: [
      ...(t.ended ? [] : [t.running ? { id: "pause", label: "Pause", action: "timer.pause", run: () => env.runTimer("timer.pause") } : { id: "resume", label: "Resume", action: "timer.resume", run: () => env.runTimer("timer.resume") }]),
      { id: "extend", label: "+15 min", action: "timer.extend", run: () => env.runTimer("timer.extend") },
      ...(t.kind === "focus" && !t.ended ? [{ id: "deep", label: "Deep focus", hint: "Teams: Do not disturb", checked: t.deep, action: "timer.deep", run: () => env.runTimer("timer.deep", { on: !t.deep }) } as MenuItem] : []),
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
    case "planday.carry": return { run: () => env.setView("week") };
    case "planday.commit": return env.planState ? { run: env.commitPlan } : { disabled: "Open Plan the day first" };
    case "pick.add": return { next: () => chooseItem(env, "Add which work item?", isPickable, (k, i) => addStep(env, k, i)) };
    case "pick.set_size": return { next: () => choosePick(env, "Set the size of which pick?", (p) => sizeStep(env, p)) };
    case "pick.move": return { next: () => choosePick(env, "Move which pick?", (p) => moveStep(env, p)) };
    case "pick.mark_done": return { next: () => choosePick(env, "Mark which pick done or not done?", (p) => () => env.runPlan("pick.mark_done", { id: p.id, done: p.status !== "done" })) };
    case "pick.remove": return { next: () => choosePick(env, "Drop which pick?", (p) => () => env.runPlan("pick.remove", { id: p.id })) };
    case "pick.uncarry":
    case "pick.undrop": return { disabled: "Use Undo right after Keep, Move or Drop on a suggested pick" };
    case "planday.carry_hint": return { run: () => env.setView("week") };
    case "draft.add_story": return { next: () => chooseItem(env, "Draft a story under which epic or feature?", (i) => i.level === "portfolio", (k, i) => draftPrompt(env, k, i)) };
    case "draft.set_parent": return { run: () => env.setView("capture") };
    case "draft.remove": return { run: () => env.setView("capture") };
    case "draft.update": return { run: () => env.setView("capture") };
    case "ui.set_theme": return { next: () => themeStep(env) };
    case "ui.set_view_range": return { next: () => viewRangeStep(env) };
    case "ui.set_text_size": return { next: () => ({ title: "Text size", items: TEXT_SIZES.map((s) => ({ id: s, label: TEXT_SIZE_NAMES[s], checked: env.textSize === s, action: "ui.set_text_size", run: () => env.saveTextSize(s) })) }) };
    case "ui.set_inbox":
    case "inbox.hide":
      return { run: () => env.setView("inbox") };
    case "ui.set_show_personal": return { run: () => env.saveShowPersonal(!env.showPersonal) };
    case "ui.first_launch": return { disabled: "Runs on its own the first time FocusTime opens" };
    case "ui.tour_offer": return { run: () => env.showGuide() };
    case "setup.load":
    case "setup.prefill":
    case "setup.mark":
    case "setup.reset": return { run: () => env.openSettings("setup") };
    case "notices.list":
    case "notices.read": return env.openNotifications ? { run: () => env.openNotifications!() } : { disabled: "Not available here" };
    case "push.status":
    case "push.subscribe":
    case "push.remove": return { run: () => env.openSettings("notifications") };
    case "ui.set_reduce_motion": return { next: () => ({ title: "Reduce motion", items: [true, false].map((on) => ({ id: on ? "on" : "off", label: on ? "On" : "Off", checked: env.reduceMotion === on, action: "ui.set_reduce_motion", run: () => env.saveReduceMotion(on) })) }) };
    case "demo.reset": return env.demo ? { run: () => env.openSettings("demo") } : { disabled: "Reset demo is only in the demo" };
    case "demo.status": return env.demo ? { run: () => env.openSettings("demo") } : { disabled: "Only in the demo" };
    case "demo.set": return env.setDemo ? { run: () => env.setDemo!(!env.demo) } : { disabled: "Demo mode isn't available here" };
    case "settings.load": return { run: () => env.openSettings() };
    case "settings.save": return { run: () => env.openSettings() };
    case "secret.set": return { run: () => env.openSettings("connections") };
    case "media.status": return { run: () => env.openSettings("focus") };
    // Step 16.3: deep focus switches the running session; Teams status lives in Settings > Focus; presence shows where Cooptimizers are listed.
    case "timer.deep": return env.timer?.kind === "focus" ? { run: () => env.runTimer("timer.deep", { on: !env.timer!.deep }) } : { next: () => ({ title: "Start deep focus", items: [{ id: "deep", label: "Deep focus", hint: `${env.planning.focusMinutes} min · Teams: Do not disturb`, action: "timer.start", run: () => env.runTimer("timer.start", { deep: true }) }] }) };
    case "presence.status": return { run: () => env.openSettings("focus") };
    case "chats.registered":
    case "chats.list":
    case "chats.add":
    case "chats.remove":
    case "chats.kind":
    case "chats.reading":
    case "chats.refresh": return { run: () => env.openSettings("clients") };
    // Requests are worked in Inbox › Requests; registering chats and deleting stored messages in Settings > Clients.
    case "requests.list":
    case "requests.context":
    case "requests.resolve":
    case "requests.reopen":
    case "requests.search":
    case "requests.sort_again":
    case "requests.show":
      return { run: () => env.setView("conversations") };
    case "inbox.list":
    case "inbox.count":
    case "inbox.seen":
    case "conversations.list":
    case "conversations.count":
    case "conversations.messages":
    case "conversations.seen":
    case "conversations.resolve":
    case "conversations.not_request":
    case "conversations.reopen":
    case "conversations.hide":
    case "conversations.move":
    case "conversations.this_is_work":
    case "conversations.link":
    case "conversations.take_over":
    case "conversations.search":
    case "conversations.draft":
    case "suggestions.skip":
    case "conversations.merge":
    case "conversations.unmerge":
      return { run: () => env.setView("conversations") };
    case "conversations.refresh": return { run: () => (env.setView("conversations"), void env.runPlan("conversations.refresh", {})) };
    case "conversations.sort_unsorted": return { run: () => (env.setView("conversations"), void env.runPlan("conversations.sort_unsorted", {})) };
    case "my_promises.followup":
    case "promises.followup":
      return { disabled: "A promise does this itself now" };
    case "my_promises.list":
    case "my_promises.today":
    case "my_promises.start_draft":
    case "my_promises.link":
    case "my_promises.search":
    case "my_promises.done":
    case "my_promises.not_needed":
    case "my_promises.reopen":
    case "my_promises.due":
    case "my_promises.who":
    case "my_promises.close":
      return { run: () => env.setView("my_promises") };
    case "promises.list":
    case "promises.resolve":
    case "promises.reopen":
    case "promises.link":
      return { run: () => env.setView("my_promises") };
    case "requests.refresh": return { run: () => (env.setView("requests"), void env.runPlan("requests.refresh", {})) };
    case "requests.purge":
      return { run: () => env.openSettings("clients") };
    case "ai.status":
    case "ai.test":
      return { run: () => env.openSettings("ai") };
    // ADM-1: the admin console is a part of Settings, only for admins (the server checks every action again).
    case "admin.status": return { run: () => env.openSettings(env.admin ? "admin-people" : "you") };
    case "admin.load":
    case "admin.set": return env.admin ? { run: () => env.openSettings("admin-clients") } : { disabled: "Only for FocusTime admins" };
    case "admin.override":
    case "admin.identity":
    case "admin.refresh_people":
    case "admin.remove_person": return env.admin ? { run: () => env.openSettings("admin-people") } : { disabled: "Only for FocusTime admins" };
    case "admin.audit": return env.admin ? { run: () => env.openSettings("admin-audit") } : { disabled: "Only for FocusTime admins" };
    case "admin.status_action": return env.admin ? { run: () => env.openSettings("admin-status") } : { disabled: "Only for FocusTime admins" };
    // BD-1: Break down opens its panel on any item whose type needs breaking down (the process model); the rest
    // happens in the panel.
    case "stories.prepare": return { next: () => chooseItem(env, "Break down which item?", (i, k) => i.level === "portfolio" && typeNeedsBreakdown(env.work.get(k)?.types, i.type), (k, i) => () => void openBreakDown(k, { id: i.id, title: i.title, type: i.type })) };
    case "stories.status":
    case "stories.run":
    case "stories.regenerate":
    case "stories.save":
    case "stories.publish_preview":
    case "stories.publish":
    case "stories.retry":
      return { disabled: "In the Break down panel, from a Needs stories row" };
    case "stories.house_style":
    case "stories.house_style_save":
      return { run: () => env.openSettings("clients") };
    case "permissions.status": return { run: () => env.openSettings("connections") };
    case "people.photos": return { disabled: "Shown wherever you and Cooptimizers appear" };
    case "presence.people": return { disabled: "Shown next to Cooptimizers in Ask to collaborate, Who and Roadmap" };
    case "presence.log": return { run: () => env.openSettings("data") };
    case "playlist.open": return { run: () => env.openSettings("focus") };
    case "data.export": return { run: env.exportPlan };
    case "data.export_mine": return { run: () => env.openSettings("data") };
    case "data.delete_mine": return { run: () => env.openSettings("data") };
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
    case "closeout.load": return { run: () => env.openCloseOut() };
    case "checkin.done": return { run: env.openCheckIn };
    case "closeout.commit": return env.closeOutDate ? { run: env.commitCloseOut } : { disabled: "Open Close out first" };
    case "pick.make_up": return { next: () => choosePick(env, "Make up which pick?", (p) => makeUpStep(env, p)) };
    case "note.set": return { run: () => env.openCloseOut() };
    // Step 15.3: the capture box is the one way to add something new; this opens it with Follow-up chosen.
    case "followup.add": return { run: () => env.openCapture("follow_up") };
    case "borrow.pay": {
      const unpaid = env.borrowed.filter((b) => !b.paidAt);
      if (!unpaid.length) return { disabled: "No unpaid borrowed time" };
      return { next: () => ({ title: "Mark which borrowed time paid?", items: unpaid.map((b) => ({ id: `b${b.id}`, label: b.title, hint: `${b.minutes} min from ${dayName(b.date)}`, run: () => env.runFollowUps("borrow.pay", { id: b.id }) })) }) };
    }
    case "followups.list": return { run: env.openFollowUps };
    // Closing, not needed, snooze, edit, delete, who suggestions and the heads-up review are on each row in the Inbox.
    case "followup.close":
    case "followup.edit":
    case "followup.not_needed":
    case "followup.snooze":
    case "followup.delete":
    case "followup.people":
    case "people.picker":
    case "followups.review":
      return { run: env.openFollowUps };
    case "plan.reset": return { run: env.resetPlan };
    case "link.open": return { next: () => chooseItem(env, "Open which work item?", () => true, (k, i) => () => env.openLink(k, i.url)) };
    case "weekplan.load": return { run: () => env.openPlanWeek() };
    case "roadmap.load": return { run: () => env.setView("roadmap") };
    case "roadmap.ahead":
    case "roadmap.set_dates":
      return { run: () => env.setView("ahead") };
    // AH-1: Ahead's grid, its change set and filters live on Ahead itself.
    case "ahead.load":
    case "ahead.filters":
    case "ahead.set_filters":
    case "ahead.stage":
    case "ahead.unstage":
    case "ahead.resolve":
      return { run: () => env.setView("roadmap") };
    case "ahead.discard":
      return { run: () => env.setView("roadmap") };
    case "weekplan.commit": return env.planWeekOpen ? { run: env.commitWeek } : { disabled: "Open Plan the week first" };
    // Features are chosen in Plan the week itself.
    case "weekplan.set_feature":
    case "weekplan.place":
    case "weekplan.add":
    case "weekplan.set_tier":
    case "weekplan.set_estimate":
    case "weekplan.set_size":
    case "weekplan.reorder":
    case "weekplan.remove":
    case "weekplan.mark_done":
    case "weekplan.headsup":
    case "weekplan.add_draft":
    case "weekplan.draft_tier":
    case "weekplan.nothing":
    // SW-1: sends, priorities and asks start from a row's ⋯ (Send to…) or Commit; the command menu opens the place.
    case "send.people":
    case "send.create":
    case "priority.flag":
    case "priority.unflag":
    case "priority.add_to_week":
    case "send.cancel":
    case "send.accept":
    case "send.pass":
    case "send.cant":
    case "send.withdraw":
    case "send.today":
    case "team.commit":
    case "look.ask":
      return { run: () => env.setView("commit") };
    case "team.view":
    case "look.reply":
      return { run: () => env.setView("team") };
    // AS-1: everything the assistant does starts in its panel.
    case "assistant.ask":
    case "assistant.confirm":
    case "assistant.cancel":
    case "assistant.history":
    case "assistant.today":
    case "lookup.day":
    case "items.get":
      return env.openAssistant ? { run: () => env.openAssistant!() } : { disabled: "The assistant isn't available here" };
    case "assistant.clear": return { run: () => env.openSettings("data") };
    case "weekplan.proposal":
    case "weekplan.carry_decide":
    case "weekplan.carry_accept_all":
    case "weekplan.watch_checkin":
    case "weekplan.watch_remove":
    case "feature.brief":
    case "feature.mark_breakdown":
    case "followup.ask_priorities":
    case "draft.add_feature":
      return { run: () => env.openPlanWeek(env.planWeekOpen ?? undefined) };
    case "auth.connect_outlook_write": return { run: env.connectWrite };
    case "timebox.resolve": return { run: () => env.openPlanDay() };
    case "outlook.open": return { run: () => env.openOutlook(outlookDay(env.selection.date)) };
    case "collab.candidates":
    case "collab.suggest":
    case "collab.preview_invite":
      return { next: () => choosePick(env, "Help on which pick?", (p) => () => env.openHelp({ clientKey: p.clientKey, title: p.title, url: p.itemUrl, itemId: p.itemId, pickId: p.id, pinned: p.date })) };
    case "timebox.add": return { next: () => choosePick(env, "Timebox which pick?", (p) => () => env.openTimebox({ pickId: p.id, date: p.date })) };
    // Step 13.6: Timebox my day is in Plan the day once it is committed.
    case "timebox.add_many": return { run: () => env.openPlanDay() };
    // Moving, resizing, removing and Outlook previews happen on the day's timeline in Plan the day.
    case "timebox.update":
    case "timebox.remove":
    case "timebox.set_outlook":
    case "write.preview":
      return { run: () => env.openPlanDay() };
    // Write access, the log, confirm and retry live in Settings > Data.
    case "write.status":
    case "write.confirm":
    case "write.retry":
    case "write.log":
      return { run: () => env.openSettings("data") };
    // Step 14: DevOps write access is per client in Settings; changes start from follow-ups, drafts and Close out.
    case "devops.set_write_pat":
    case "devops.clear_write_pat":
    case "devops.write_status":
      return { run: () => env.openSettings("clients") };
    case "devops.states":
    case "devops.preview":
      return { run: env.openCaptures };
    case "devops.confirm":
    case "devops.retry":
    case "devops.log":
      return { run: () => env.openSettings("data") };
    // Step 15.4: who's signed in and my VM live in Settings > You; the VM chip has the changes.
    case "auth.status":
    case "auth.sign_in":
    case "auth.sign_out":
    case "vm.find":
    case "vm.choose":
      return { run: () => env.openSettings("you") };
    case "vm.status":
    case "vm.preview":
    case "vm.confirm":
    case "vm.dismiss_prompt":
    case "vm.start_now":
      return { run: env.openVm };
    // Step 15.5: Settings > Notifications has the test button; samples are for the live check.
    case "notify.test":
    case "notify.sample":
    // TB-2: Settings > Notifications > In Teams has the switches and each kind's test.
    case "teams.status":
    case "teams.test":
      return { run: () => env.openSettings("notifications") };
    case "vm.log": return { run: () => env.openSettings("data") };
    // F1: Send feedback opens its dialog; the send is from its preview; the setup check is in Settings > Connections.
    case "feedback.preview": return { run: env.openFeedback };
    case "feedback.send": return { disabled: "Send it from the feedback preview" };
    case "feedback.status": return { run: () => env.openSettings("connections") };
    case "capture.add": return { run: () => env.openCapture() };
    // Sorting and a client's features and epics are handled in the Inbox.
    case "capture.load":
    case "capture.route":
    case "capture.features":
      return { run: env.openCaptures };
    // CP-1: Undo is the toast's, right after a save; a draft's AI version is prepared and shown from the Inbox.
    case "capture.undo": return { disabled: "Undo from the Saved toast, right after a capture" };
    case "draft.prepare":
    case "draft.get":
      return { run: env.openCaptures };
  }
}

/** The Inbox's keys as commands; the Inbox listens for ASK_KEY_EVENT (detail: the act). */
export const ASK_KEY_EVENT = "focustime:ask-key";

/** BD-1: opens the Break down panel (ui/BreakDownPanel.tsx listens) for one client's item. */
export const BREAK_DOWN_EVENT = "focustime:break-down";
/** PV-1's event (the Week block panel): { clientKey, itemId }; opens Break down for that item. */
export const PV_BREAKDOWN_EVENT = "focustime:breakdown";
/** DS-1's event name, still heard so anything that sends it opens Break down. */
export const DRAFT_STORIES_EVENT = "focustime:draft-stories";
/** AH-1 (D665): `actions` is the panel's action list for the item, given by the caller (Ahead adds Send to…); more go here. */
export type PanelAction = { id: string; label: string; hint?: string; run: () => void };
export type BreakDownTarget = { id: number; title: string; type?: string; actions?: PanelAction[] };
export const openBreakDown = (clientKey: string, item: BreakDownTarget) => window.dispatchEvent(new CustomEvent(BREAK_DOWN_EVENT, { detail: { clientKey, item } }));
/** NV-1: the Coop brief opens Break down's side panel, from every entry point; it copies at once. `weekStart` is the week whose plan the feature is on (default next week, as before). */
export const COOP_BRIEF_EVENT = "focustime:coop-brief";
export const openCoopBrief = (clientKey: string, item: BreakDownTarget, weekStart?: string | null) => window.dispatchEvent(new CustomEvent(COOP_BRIEF_EVENT, { detail: { clientKey, item, weekStart: weekStart ?? null } }));
/** IB-1: the Inbox's keys as commands (the same list as ui/inbox/ItemActions.tsx's ITEM_KEYS; a test keeps them equal). */
export const ASK_KEYS = [
  { id: "inbox.key.next", act: "next", label: "Inbox: next item", hint: "J" },
  { id: "inbox.key.prev", act: "prev", label: "Inbox: previous item", hint: "K" },
  { id: "inbox.key.open", act: "open", label: "Inbox: open the item", hint: "Enter" },
  { id: "inbox.key.create", act: "create", label: "Inbox: create DevOps item", hint: "C" },
  { id: "inbox.key.close", act: "close", label: "Inbox: close the loop", hint: "L" },
  { id: "inbox.key.due", act: "due", label: "Inbox: change the due day", hint: "F" },
  { id: "inbox.key.week", act: "week", label: "Inbox: put it on my week", hint: "W" },
  { id: "inbox.key.hide", act: "hide", label: "Inbox: hide it for me", hint: "H" },
  { id: "inbox.key.not_needed", act: "not_needed", label: "Inbox: not needed", hint: "N" },
  { id: "inbox.key.done", act: "done", label: "Inbox: done", hint: "E" },
] as const;
export type AskKeyId = (typeof ASK_KEYS)[number]["id"];
const askKey = (id: AskKeyId): void => void window.dispatchEvent(new CustomEvent(ASK_KEY_EVENT, { detail: ASK_KEYS.find((k) => k.id === id)!.act }));

/** Window commands that aren't server actions: views, week navigation, details. */
function uiCommands(env: MenuEnv): MenuItem[] {
  const soon = "Coming soon";
  return [
    { id: "view.today", action: "view.today", group: "Views", label: "Today", hint: "1", run: () => env.setView("today") },
    { id: "view.week", action: "view.week", group: "Views", label: "Week › Board", hint: "2", run: () => env.setView("week") },
    { id: "view.roadmap", action: "view.roadmap", group: "Views", label: "Ahead: features and epics ahead (Roadmap)", hint: "3", run: () => env.setView("roadmap") },
    { id: "view.inbox", action: "view.inbox", group: "Views", label: "Inbox: what needs you, promises, waiting on, captures and drafts", hint: "4", run: () => env.setView("inbox") },
    { id: "view.requests", action: "view.requests", group: "Views", label: "Inbox › Needs you: what your clients' chats and your promises need from you", run: () => env.setView("requests") },
    ...ASK_KEYS.map((k): MenuItem => ({ id: k.id, action: k.id, group: "Inbox", label: k.label, hint: k.hint, ...(env.asksOpen ? { run: () => askKey(k.id) } : { disabled: "Open the Inbox first" }) })),
    { id: "view.plan", action: "view.plan", aka: ["commit"], group: "Views", label: "Week: Board or Plan; Ahead: Roadmap or Plan ahead; Today: Plan today", hint: "P", run: env.openRitual },
    { id: "view.planday", action: "view.planday", group: "Views", label: "Week › Plan today (the Board on today)", run: () => env.openPlanDay() },
    { id: "view.planday_date", action: "view.planday_date", group: "Views", label: "Plan a day…", next: () => planDateStep(env) },
    { id: "view.planweek", action: "view.planweek", aka: ["commit"], group: "Views", label: "Week › Plan: plan the week (each client's features)", hint: "W", run: () => env.openPlanWeek() },
    { id: "view.ahead", action: "view.ahead", group: "Views", label: "Ahead › Plan ahead", run: () => env.setView("ahead") },
    { id: "view.capture", action: "view.capture", group: "Views", label: "Captures to sort (Inbox)", run: env.openCaptures },
    { id: "view.checkin", action: "view.checkin", group: "Views", label: "Today › Midday check-in", hint: "M", run: env.openCheckIn },
    { id: "view.closeout", action: "view.closeout", group: "Views", label: "Today › Close out", hint: "E", run: () => env.openCloseOut() },
    { id: "week.prev", action: "week.prev", group: "Week", label: "Previous week", hint: "[", run: () => env.changeWeek(-1) },
    { id: "week.next", action: "week.next", group: "Week", label: "Next week", hint: "]", run: () => env.changeWeek(1) },
    { id: "week.today", action: "week.today", group: "Week", label: "Back to this week", run: env.goToday },
    { id: "ui.details", action: "ui.details", group: "Week", label: "Details of the selected half-day", hint: "Enter", run: () => env.openDetails(env.selection.date, env.selection.half) },
    { id: "ui.add_work", action: "ui.add_work", group: "Week", label: "Add work to the selected block", hint: "A", ...(addWorkRefusal(env, env.selection.date, env.selection.half) ? { disabled: addWorkRefusal(env, env.selection.date, env.selection.half)! } : { run: () => env.addWork?.(env.selection.date, env.selection.half) }) },
    { id: "ui.settings", action: "ui.settings", group: "Week", label: "Settings", disabled: soon },
    { id: "ui.region_next", action: "ui.region_next", group: "Keyboard", label: "Next region (top bar, week, panel, status bar)", hint: "F6", run: () => env.moveRegion(1) },
    { id: "ui.region_prev", action: "ui.region_prev", group: "Keyboard", label: "Previous region", hint: "Shift F6", run: () => env.moveRegion(-1) },
    {
      id: "ui.open_focused",
      action: "ui.open_focused",
      group: "Keyboard",
      label: "Open the focused work item in your browser",
      hint: "O",
      ...(env.focusedItem ? { run: () => env.openLink(env.focusedItem!.clientKey, env.focusedItem!.url) } : { disabled: "Focus a work item first (Tab to it)" }),
    },
    { id: "ui.guide", action: "ui.guide", group: "Help", label: "Guide: the basics, the rhythm, sizing and shortcuts", hint: "?", run: () => env.showGuide() },
    { id: "ui.keys", action: "ui.keys", group: "Keyboard", label: "Keyboard shortcuts (every key in one list)", run: env.showKeys },
  ];
}

/** Every command: window commands, then one per registered action (built from the registry). */
export function commandList(env: MenuEnv): MenuItem[] {
  // IB-1: Make it a follow-up is gone from the UI (a promise does everything a follow-up did); the old actions stay for now.
  const NOT_IN_MENU = new Set(["my_promises.followup", "promises.followup"]);
  const fromRegistry = (ACTIONS as readonly ActionSpec[]).filter((a) => !NOT_IN_MENU.has(a.name)).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}), ...(a.shortcut ? { hint: a.shortcut } : {}), ...runnerFor(env, a.name as ActionName) }));
  return [...uiCommands(env), ...fromRegistry];
}

/** Search: every word must appear in the label, group or hint, any order, any case. */
export function filterCommands(items: MenuItem[], query: string): MenuItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const found = items.filter((i) => {
    const text = `${i.label} ${i.group ?? ""} ${i.hint ?? ""} ${i.action ?? ""} ${i.aka?.join(" ") ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  // A label that starts with what was typed comes first ("plan a day" finds "Plan a day…" before "Plan the day").
  const typed = words.join(" ");
  const starts = (i: MenuItem) => i.label.toLowerCase().startsWith(typed);
  return [...found.filter(starts), ...found.filter((i) => !starts(i))];
}

// ---------- step 15: a Plan the week row's ⋯ menu (D267) ----------

/** What a week list row's menu needs to know. */
export type WeekItemFacts = {
  itemId: number;
  title: string;
  /** The row's client, so the header doesn't repeat it. */
  clientName?: string | null;
  tier: "must" | "nice";
  level: "feature" | "story";
  /** First or last in its list (no Move up / Move down). */
  first: boolean;
  last: boolean;
  /** A past week is a review: nothing changes. */
  past: boolean;
  /** How it is done: "local" (my own mark) can be undone; DevOps or a done pick can't from here. */
  done: "local" | "other" | null;
  /** E2: a feature's load in minutes (its estimate, or what its stories add up to). */
  minutes: number;
  /** The load comes from its sized stories, so there is no estimate to set. */
  derived?: boolean;
  size?: "S" | "M" | "L" | null;
  /** A story under a listed feature: it takes the feature's tier (no tier choice of its own). */
  nested?: boolean;
  /** Where it can be pinned, and where it is. */
  places: { date: IsoDate; half: "AM" | "PM"; label: string }[];
  pinned: { date: IsoDate; half: "AM" | "PM" }[];
  /** A feature with open stories (no Coop brief needed). */
  openStories: number;
  targetDate: IsoDate | null;
  /** Local drafts under it, not yet in DevOps. */
  drafts: number;
  /** DevOps writes are enabled for the client (else Set target date and Create say so). */
  canWrite: boolean;
};
export type WeekItemOps = {
  move: (by: -1 | 1) => void;
  tier: (to: "must" | "nice") => void;
  pin: (date: IsoDate, half: "AM" | "PM", on: boolean) => void;
  /** A feature's estimate in whole hours. */
  hours: (n: number) => void;
  size?: (s: "S" | "M" | "L" | null) => void;
  done: (on: boolean) => void;
  help: () => void;
  /** SW-1: Send to… a teammate's week. */
  send?: () => void;
  targetDate: () => void;
  brief: () => void;
  createDrafts: () => void;
  enableWrites: () => void;
  remove: () => void;
};

export function storySizeStep(f: WeekItemFacts, ops: WeekItemOps): MenuStep {
  return {
    title: `Size of "${f.title}"`,
    items: [
      ...(["S", "M", "L"] as const).map<MenuItem>((z) => ({ id: `s${z}`, label: sizeChipText(z), checked: f.size === z, action: "weekplan.set_size", run: () => ops.size?.(z) })),
      { id: "sclear", label: "Clear", hint: "counts as 2h", checked: !f.size, action: "weekplan.set_size", run: () => ops.size?.(null) },
    ],
  };
}

/** E2: a feature's estimate, typed in whole hours (the row's stepper does the same). */
export function estimateStep(f: WeekItemFacts, ops: WeekItemOps): MenuStep {
  return {
    title: `Estimate for "${f.title}"`,
    prompt: `Hours, ${MIN_ESTIMATE_HOURS} to ${MAX_ESTIMATE_HOURS}`,
    value: String(Math.round(f.minutes / 60)),
    button: "Save",
    submit: (t) => {
      const h = parseHours(t);
      if (h !== null) ops.hours(h);
    },
  };
}

/** Everything a week row does besides its title, state, story count, blocks and pin (D267). */
export function weekItemMenu(f: WeekItemFacts, ops: WeekItemOps): MenuStep {
  const closed = f.past ? { disabled: "A past week is a review" } : {};
  const isPinned = (p: { date: IsoDate; half: string }) => f.pinned.some((x) => x.date === p.date && x.half === p.half);
  const writes = (_why: string) => (f.canWrite ? {} : { hint: "Enable DevOps writes first" });
  const other = f.tier === "must" ? "nice" : "must";
  return {
    title: f.title,
    head: rowHead({ id: f.itemId, title: f.title, client: f.clientName ?? null }),
    items: [
      { id: "up", label: "Move up", action: "weekplan.reorder", ...(f.past ? closed : f.first ? { disabled: "Already first" } : {}), run: () => ops.move(-1) },
      { id: "down", label: "Move down", action: "weekplan.reorder", ...(f.past ? closed : f.last ? { disabled: "Already last" } : {}), run: () => ops.move(1) },
      { id: "tier", label: other === "nice" ? "Make it a nice to have" : "Make it a must", action: "weekplan.set_tier", ...(f.past ? closed : f.nested ? { disabled: "Stories take their feature's tier" } : {}), run: () => ops.tier(other) },
      f.level === "story"
        ? { id: "size", label: "Size", hint: f.size ?? "not sized", action: "weekplan.set_size", ...closed, next: () => storySizeStep(f, ops) }
        : { id: "estimate", label: "Estimate", hint: f.derived ? hoursText(f.minutes) : aboutText(f.minutes), action: "weekplan.set_estimate", ...(f.derived ? { disabled: "From its stories: size them to change it" } : closed), next: () => estimateStep(f, ops) },
      {
        id: "pin",
        label: "Pin to a block",
        hint: f.pinned.length ? `${f.pinned.length} pinned` : "optional",
        action: "weekplan.place",
        ...(f.past ? closed : !f.places.length ? { disabled: "No blocks for this client this week" } : {}),
        next: () => ({ title: `Pin "${f.title}"`, items: f.places.map((p) => ({ id: `pin-${p.date}-${p.half}`, label: p.label, checked: isPinned(p), action: "weekplan.place", run: () => ops.pin(p.date, p.half, !isPinned(p)) })) }),
      },
      { id: "done", label: f.done ? "Mark not done" : "Mark done", action: "weekplan.mark_done", ...(f.past ? closed : f.done === "other" ? { disabled: "Done in DevOps or by a done pick" } : {}), run: () => ops.done(!f.done) },
      { id: "help", label: "Ask to collaborate", hint: "who is free", action: "collab.candidates", ...(f.past || f.done ? { disabled: f.past ? "A past week is a review" : "Already done" } : {}), run: ops.help },
      ...(ops.send ? [{ id: "send", label: "Send to…", hint: "a teammate's week", action: "send.create", ...(f.done ? { disabled: "Already done" } : {}), run: ops.send } as MenuItem] : []),
      ...(f.level === "feature"
        ? ([
            { id: "target", label: f.targetDate ? "Change target date" : "Set target date", ...writes("target"), action: "devops.preview", ...closed, run: f.canWrite ? ops.targetDate : ops.enableWrites },
            { id: "brief", label: "Copy Coop brief", hint: f.openStories ? `${f.openStories} open stories already` : "ask Coop for stories", action: "feature.brief", run: ops.brief },
          ] as MenuItem[])
        : []),
      ...(f.drafts > 0 ? [{ id: "create", label: `Create ${f.drafts === 1 ? "the draft" : `${f.drafts} drafts`} in DevOps`, ...writes("create"), action: "devops.preview", ...closed, run: f.canWrite ? ops.createDrafts : ops.enableWrites } as MenuItem] : []),
      { id: "remove", label: "Take off the week", danger: true, action: "weekplan.remove", ...closed, run: ops.remove },
    ],
  };
}

/** Step 16 (D282): what a Roadmap row's ⋯ menu needs to know. */
export type RoadmapRowFacts = { id?: number; clientName?: string | null; title: string; tier: "feature" | "epic"; targetDate: string | null; open: number; onWeek: boolean; canWrite: boolean; hasLink: boolean; /** Step 17: assigned to me (a contributing row can't have its dates set). */ owned?: boolean };
export type RoadmapRowOps = { open: () => void; brief: () => void; help: () => void; addToWeek: () => void; targetDate: () => void; enableWrites: () => void };

/** A Roadmap row's ⋯ menu (D282). Only Set target date writes, through the DevOps write flow. */
export function roadmapRowMenu(f: RoadmapRowFacts, ops: RoadmapRowOps): MenuStep {
  const epic = f.tier === "epic";
  return {
    title: f.title,
    head: rowHead({ id: f.id ?? null, title: f.title, client: f.clientName ?? null }),
    items: [
      { id: "open", label: "Open in browser", hint: "O", ...(f.hasLink ? {} : { disabled: "No link for this item" }), run: ops.open },
      { id: "brief", label: "Copy Coop brief", action: "feature.brief", ...(epic ? { disabled: "Briefs are for features" } : { hint: f.open ? `${f.open} open ${f.open === 1 ? "story" : "stories"} already` : "ask Coop for stories" }), run: ops.brief },
      { id: "help", label: "Ask to collaborate", hint: "who is free", action: "collab.candidates", run: ops.help },
      { id: "week", label: "Add to this week's plan", action: "weekplan.add", ...(epic ? { disabled: "Add its features instead" } : f.onWeek ? { disabled: "Already on this week's plan" } : { hint: "as a nice to have" }), run: ops.addToWeek },
      { id: "target", label: f.targetDate ? "Change target date" : "Set target date", action: "devops.preview", ...(f.owned === false ? { disabled: "Only on features and epics assigned to you" } : f.canWrite ? {} : { hint: "Enable DevOps writes first" }), run: f.canWrite ? ops.targetDate : ops.enableWrites },
    ],
  };
}
