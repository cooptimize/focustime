// VM-2: start my VM before my day begins, when I opt in, in production only. Pure: the gate, the rule and the "Next:"
// line. No I/O; the tick (actions/vm-autostart.ts) reads the facts and does the start through the write framework.
//
// The rule: on a day I chose that has working hours, isn't whole-day PTO, isn't an observed holiday and that I haven't
// skipped, at the start of my working day less my minutes, in my time zone, when Azure shows the VM stopped. At most
// one automatic start a day. Running late (FocusTime wasn't running at the time): it still starts until my day has
// been under way for 60 minutes, then leaves the VM off. After three of my working days with no use of FocusTime it
// pauses itself until I press Resume. FocusTime never stops a VM on its own and never touches its auto-shutdown.
import type { IsoDate } from "../week/types.ts";
import { hoursOn, weekdayKey, WEEKDAY_KEYS, type TimeModel, type WeekdayKey } from "../week/hours.ts";
import type { VmChip } from "./vm.ts";

/**
 * The production-only gate: true only when the environment is exactly "prod". "dev", "local", "demo", empty, missing,
 * "Prod", "production", "prod " and anything else are false: the safe answer is the default. The tick asks this first,
 * before it reads anyone's settings or asks for a token (actions/vm-autostart.ts).
 */
export function autoStartEnvAllowed(env: unknown): boolean {
  return env === "prod";
}

/** The minutes before my day it may start. */
export const AUTOSTART_MINUTES = [0, 5, 10, 15, 30] as const;
export type AutoStartMinutes = (typeof AUTOSTART_MINUTES)[number];
export const validAutoStartMinutes = (n: unknown): n is AutoStartMinutes => (AUTOSTART_MINUTES as readonly unknown[]).includes(n);
/** How long into my working day a late start is still made. */
export const LATE_LIMIT_MINUTES = 60;
/** Working days with no use of FocusTime before it pauses itself. */
export const PAUSE_AFTER_DAYS = 3;
/** How far ahead the "Next:" line looks. */
const LOOK_DAYS = 14;

/** My setting (Settings › Accounts and calendars › My VM): off by default; every day my hours cover unless switched off. */
export type AutoStartSettings = { on: boolean; minutes: AutoStartMinutes; offDays: WeekdayKey[] };
export const DEFAULT_AUTOSTART: AutoStartSettings = { on: false, minutes: 0, offDays: [] };

/** What FocusTime keeps for it (per person, in the plan store). Dates are local dates in my zone. */
export type AutoStartState = {
  /** Days I skipped (Skip this one, or Not today on Day's morning prompt). */
  skipped: IsoDate[];
  /** The day the tick first saw it on: pausing counts working days from here, not from before I opted in. */
  onSince: IsoDate | null;
  /** The last day I really used FocusTime (HK-3's signal). */
  lastUseOn: IsoDate | null;
  /** Paused itself on this day; until Resume. */
  pausedOn: IsoDate | null;
  /** The "paused" notice was shown once. */
  pauseSeen: boolean;
  /** The day an automatic start was last tried (claimed once a day; a failure counts). */
  attemptedOn: IsoDate | null;
  /** Azure sign-in couldn't be used for the day's start; shown once on the chip and by notification. */
  signInFailedOn: IsoDate | null;
  signInSeen: boolean;
  /**
   * A notification waiting for the notifier, which is quiet before my working hours (when the start happens): sent
   * once it allows VM notifications, that day only.
   */
  notice: PendingNotice | null;
  /** VM-3: today's outcome from the planned time on (null before it, or another day's: cleared the next day). */
  outcome: TodayOutcome | null;
  /** VM-3: the log words already written today, so each is logged once a day. */
  logged: { date: IsoDate; words: string[] } | null;
  /** VM-3: the last PTO read (by the start or the "Next:" line), used for up to PTO_STALE_HOURS when a fresh one fails. */
  ptoRead: PtoRead | null;
};
export type PendingNotice = { kind: "started" | "sign_in" | "failed" | "left_off"; date: IsoDate; at: string; text: string };

/**
 * VM-3: every way today's check ends from the planned time on, one closed list. `log`: the word logged (once a day per
 * reason, never with a name or an id). `tell`: the person is told why, once (the chip and its menu, one notice when
 * notices are allowed, Settings' line); never for the VM being on already or their own choice. `tried`: the day counts
 * as tried (no other start today). `text`: the words, the same on the chip's menu, the notice and Settings (one place;
 * docs/design/wording.md, VM-3 words).
 */
export const OUTCOMES = {
  started: { log: "started", tell: false, tried: true, text: "Started today" },
  started_late: { log: "started_late", tell: false, tried: true, text: "Started today, after your day began" },
  already_on: { log: "already_on", tell: false, tried: true, text: "Already on today" },
  not_chosen: { log: "not_chosen", tell: false, tried: false, text: "Not a day you chose" },
  skipped: { log: "skipped", tell: false, tried: false, text: "Skipped today" },
  paused: { log: "paused", tell: false, tried: false, text: "Paused" },
  pto: { log: "pto", tell: true, tried: false, text: "Left off today: it is PTO" },
  holiday: { log: "holiday", tell: true, tried: false, text: "Left off today: it is a holiday" },
  pto_unreadable: { log: "pto_unreadable", tell: true, tried: false, text: "Left off today: FocusTime couldn't read your PTO" },
  sign_in: { log: "sign_in", tell: true, tried: true, text: "Left off today: your Azure sign-in needs renewing" },
  no_vm: { log: "no_vm", tell: true, tried: true, text: "Left off today: FocusTime couldn't find your VM" },
  refused: { log: "refused", tell: true, tried: true, text: "Left off today: Azure refused the start" },
  not_running: { log: "not_running", tell: true, tried: false, text: "Left off today: FocusTime wasn't running at the time" },
} as const satisfies Record<string, { log: string; tell: boolean; tried: boolean; text: string }>;
export type OutcomeReason = keyof typeof OUTCOMES;
export const isOutcomeReason = (x: unknown): x is OutcomeReason => typeof x === "string" && Object.hasOwn(OUTCOMES, x);

/** What to do about it, after the reason, where there is something to do (the chip's menu and the notice). */
export const OUTCOME_NEXT: Partial<Record<OutcomeReason, string>> = {
  pto_unreadable: "Start it from the VM menu if you need it today.",
  sign_in: "Choose Allow Azure access in the VM menu, then start it if you need it.",
  no_vm: "Choose your VM again in Settings › Accounts and calendars › My VM.",
  refused: "Start it from the VM menu; if Azure refuses again, Settings › Activity has what it said.",
  not_running: "Start it from the VM menu if you need it.",
};

/** A note that goes with a start: what couldn't be checked, and what was used instead. */
export type OutcomeNote = "holidays_unchecked" | "pto_earlier";
export const NOTE_TEXT: Record<OutcomeNote, string> = {
  holidays_unchecked: "Holidays couldn't be checked.",
  pto_earlier: "Your PTO couldn't be read just now, so FocusTime used what it read earlier.",
};
/** How old a PTO read may be and still be used when PTO can't be read at the planned time. */
export const PTO_STALE_HOURS = 24;

/** Today's outcome, kept with the state (VM-3); a new day starts with none. */
export type TodayOutcome = { date: IsoDate; reason: OutcomeReason; at: string; notes: OutcomeNote[]; seen: boolean };
/** The last PTO read the start can fall back on: when, the range it covered, and the PTO days in it. */
export type PtoRead = { at: string; from: IsoDate; to: IsoDate; days: IsoDate[] };

/** The line for an outcome, with what to do and its notes: "Left off today: it is PTO." */
export function outcomeText(o: Pick<TodayOutcome, "reason" | "notes">, withNext = true): string {
  const parts = [`${OUTCOMES[o.reason].text}.`, ...(withNext && OUTCOME_NEXT[o.reason] ? [OUTCOME_NEXT[o.reason]!] : []), ...o.notes.map((n) => NOTE_TEXT[n])];
  return parts.join(" ");
}

export const EMPTY_AUTOSTART_STATE: AutoStartState = { skipped: [], onSince: null, lastUseOn: null, pausedOn: null, pauseSeen: false, attemptedOn: null, signInFailedOn: null, signInSeen: false, notice: null, outcome: null, logged: null, ptoRead: null };

/** A state read from storage, with anything missing or malformed set to its empty value. */
export function autoStartStateOf(v: unknown): AutoStartState {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const date = (x: unknown): IsoDate | null => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const n = o.notice as { kind?: unknown; date?: unknown; at?: unknown; text?: unknown } | null | undefined;
  return {
    skipped: Array.isArray(o.skipped) ? o.skipped.map(date).filter((d): d is IsoDate => !!d).slice(-30) : [],
    onSince: date(o.onSince),
    lastUseOn: date(o.lastUseOn),
    pausedOn: date(o.pausedOn),
    pauseSeen: o.pauseSeen === true,
    attemptedOn: date(o.attemptedOn),
    signInFailedOn: date(o.signInFailedOn),
    signInSeen: o.signInSeen === true,
    outcome: outcomeOf(o.outcome, date),
    logged: loggedOf(o.logged, date),
    ptoRead: ptoReadOf(o.ptoRead, date),
    notice: n && (n.kind === "started" || n.kind === "sign_in" || n.kind === "failed" || n.kind === "left_off") && date(n.date) && typeof n.at === "string" && typeof n.text === "string" ? { kind: n.kind, date: date(n.date)!, at: n.at, text: n.text.slice(0, 200) } : null,
  };
}

function outcomeOf(v: unknown, date: (x: unknown) => IsoDate | null): TodayOutcome | null {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  if (!o || !date(o.date) || !isOutcomeReason(o.reason) || typeof o.at !== "string") return null;
  const notes = Array.isArray(o.notes) ? o.notes.filter((n): n is OutcomeNote => n === "holidays_unchecked" || n === "pto_earlier") : [];
  return { date: date(o.date)!, reason: o.reason, at: o.at, notes: [...new Set(notes)], seen: o.seen === true };
}
function loggedOf(v: unknown, date: (x: unknown) => IsoDate | null): { date: IsoDate; words: string[] } | null {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  if (!o || !date(o.date) || !Array.isArray(o.words)) return null;
  return { date: date(o.date)!, words: o.words.filter((w): w is string => typeof w === "string").slice(0, 40) };
}
function ptoReadOf(v: unknown, date: (x: unknown) => IsoDate | null): PtoRead | null {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.at !== "string" || !date(o.from) || !date(o.to) || !Array.isArray(o.days)) return null;
  return { at: o.at, from: date(o.from)!, to: date(o.to)!, days: o.days.map(date).filter((d): d is IsoDate => !!d).slice(0, 60) };
}

/** Today's outcome, or null when the stored one is from another day. */
export const outcomeToday = (s: Pick<AutoStartState, "outcome">, today: IsoDate): TodayOutcome | null => (s.outcome?.date === today ? s.outcome : null);

/**
 * The last PTO read, if it covers the date and is at most PTO_STALE_HOURS old at `now`: whether that date is PTO, and
 * when it was read. Null: nothing recent enough.
 */
export function ptoFromEarlier(r: PtoRead | null, date: IsoDate, now: Temporal.Instant): { off: boolean; at: string } | null {
  if (!r || date < r.from || date > r.to) return null;
  const age = now.since(Temporal.Instant.from(r.at)).total("hours");
  if (age < 0 || age > PTO_STALE_HOURS) return null;
  return { off: r.days.includes(date), at: r.at };
}

const instantAt = (date: IsoDate, hm: string, zone: string): Temporal.Instant =>
  Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(hm) }).toInstant();

/** My working day's start on a date (its first segment), or null: no working hours that day. */
export function workStart(hours: TimeModel, date: IsoDate, zone: string): Temporal.Instant | null {
  const s = hoursOn(hours, date).segments[0]?.start;
  return s ? instantAt(date, s, zone) : null;
}

/** When the automatic start is planned on a date: my day's start less my minutes (in real minutes, across a clock change). */
export function plannedAt(hours: TimeModel, date: IsoDate, zone: string, minutes: number): Temporal.Instant | null {
  return workStart(hours, date, zone)?.subtract({ minutes }) ?? null;
}

/** The weekdays my working hours cover (the form offers these, each switchable off). */
export function workingWeekdays(hours: TimeModel): WeekdayKey[] {
  return WEEKDAY_KEYS.filter((k) => (hours.weekdays[k] ?? []).length > 0);
}

/** Why a day gets no automatic start, or null: it's a start day. */
export type DayReason = "not_chosen" | "no_hours" | "pto" | "holiday" | "skipped";
export function dayReason(o: { date: IsoDate; settings: AutoStartSettings; hours: TimeModel; skipped: readonly IsoDate[]; pto: boolean; holiday: boolean }): DayReason | null {
  if (o.settings.offDays.includes(weekdayKey(o.date))) return "not_chosen";
  if (!hoursOn(o.hours, o.date).segments.length) return "no_hours";
  if (o.pto) return "pto";
  if (o.holiday) return "holiday";
  if (o.skipped.includes(o.date)) return "skipped";
  return null;
}

/**
 * Whether it pauses itself: three of my working days (days with working hours) went by, whole, with no use of
 * FocusTime since the later of my last use and the day it was turned on. Days are counted strictly between that day
 * and today. With neither known it doesn't pause (the tick records the day it was turned on first).
 */
/** The first day the pause counts from (the day after my last use or turning it on), or null. */
export function pauseBase(lastUseOn: IsoDate | null, onSince: IsoDate | null): IsoDate | null {
  return [lastUseOn, onSince].filter((d): d is IsoDate => !!d).sort().at(-1) ?? null;
}

export function shouldPause(o: { today: IsoDate; lastUseOn: IsoDate | null; onSince: IsoDate | null; hours: TimeModel; /** PTO days and holidays, never counted. */ off?: ReadonlySet<IsoDate> }): boolean {
  const base = [o.lastUseOn, o.onSince].filter((d): d is IsoDate => !!d).sort().at(-1);
  if (!base || base >= o.today) return false;
  let n = 0;
  for (let d = Temporal.PlainDate.from(base).add({ days: 1 }); Temporal.PlainDate.compare(d, Temporal.PlainDate.from(o.today)) < 0; d = d.add({ days: 1 })) {
    if (hoursOn(o.hours, d.toString()).segments.length && !o.off?.has(d.toString())) n++;
    if (n >= PAUSE_AFTER_DAYS) return true;
  }
  return false;
}

export type DueFacts = {
  now: Temporal.Instant;
  zone: string;
  hours: TimeModel;
  settings: AutoStartSettings;
  state: AutoStartState;
  /** Today's facts. */
  pto: boolean;
  holiday: boolean;
  /** The chip from Azure's state now (null: not read yet). */
  chip: VmChip | null;
};
export type NotDue = "off" | "paused" | "attempted" | DayReason | "early" | "too_late" | "not_stopped";
/** `late`: past the planned time by more than a minute; `afterStart`: at or past the day's start (VM-3: what "after your day began" says). */
export type Due = { due: true; date: IsoDate; at: Temporal.Instant; late: boolean; afterStart: boolean } | { due: false; why: NotDue };

/**
 * Whether the automatic start runs now. Checked in this order, so the cheap and settled answers come first and Azure
 * is read last (the tick passes chip null until it needs it, then asks again with the chip).
 */
export function autoStartDue(f: DueFacts): Due {
  if (!f.settings.on) return { due: false, why: "off" };
  const today = f.now.toZonedDateTimeISO(f.zone).toPlainDate().toString();
  // Pausing is decided by the tick (it knows the PTO and holidays since); here only whether it is paused.
  if (f.state.pausedOn) return { due: false, why: "paused" };
  if (f.state.attemptedOn === today) return { due: false, why: "attempted" };
  const reason = dayReason({ date: today, settings: f.settings, hours: f.hours, skipped: f.state.skipped, pto: f.pto, holiday: f.holiday });
  if (reason) return { due: false, why: reason };
  const at = plannedAt(f.hours, today, f.zone, f.settings.minutes)!;
  const start = workStart(f.hours, today, f.zone)!;
  if (Temporal.Instant.compare(f.now, at) < 0) return { due: false, why: "early" };
  if (Temporal.Instant.compare(f.now, start.add({ minutes: LATE_LIMIT_MINUTES })) >= 0) return { due: false, why: "too_late" };
  if (f.chip !== null && f.chip !== "deallocated" && f.chip !== "billing") return { due: false, why: "not_stopped" };
  // A minute's grace: a pass that runs a few seconds after the planned time isn't "late".
  return { due: true, date: today, at, late: f.now.since(at).total("minutes") > 1, afterStart: Temporal.Instant.compare(f.now, start) >= 0 };
}

/** "7:55 AM" in my zone. */
export function clock(t: Temporal.Instant, zone: string): string {
  const z = t.toZonedDateTimeISO(zone);
  const h = z.hour % 12 === 0 ? 12 : z.hour % 12;
  return `${h}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
}
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu, Nov 12 at 7:55 AM". */
export function whenText(t: Temporal.Instant, zone: string): string {
  const z = t.toZonedDateTimeISO(zone);
  return `${DOW[z.dayOfWeek - 1]}, ${MON[z.month - 1]} ${z.day} at ${clock(t, zone)}`;
}
/** "Thu 7:55 AM" (the chip's menu). */
export const shortWhen = (t: Temporal.Instant, zone: string, now?: Temporal.Instant) => {
  const z = t.toZonedDateTimeISO(zone);
  // VM-3 review: a weekday alone reads as this week; past six days away (or today's weekday a week on) it gets the date.
  const far = now && Temporal.PlainDate.compare(z.toPlainDate(), now.toZonedDateTimeISO(zone).toPlainDate().add({ days: 6 })) > 0;
  return far ? `${DOW[z.dayOfWeek - 1]}, ${MON[z.month - 1]} ${z.day} ${clock(t, zone)}` : `${DOW[z.dayOfWeek - 1]} ${clock(t, zone)}`;
};

const WHY_WORD: Partial<Record<DayReason, string>> = { pto: "is PTO", holiday: "is a holiday", skipped: "is skipped" };

/** The "Next:" line and the chip's next start. */
export type NextAutoStart =
  | { kind: "off" }
  /** Outside production: the form says so instead of a time; the chip shows no auto-start. */
  | { kind: "prod_only"; text: string }
  | { kind: "paused"; text: string }
  | { kind: "none"; text: string }
  | { kind: "next"; date: IsoDate; at: string; text: string; short: string };

export const PROD_ONLY_TEXT = "Auto-start runs only on the production FocusTime. Here it never starts your VM.";

/**
 * What will happen next, in one line: "Next: Thu, Nov 12 at 7:55 AM", with the reason first when a day before it is
 * left out ("Thu is PTO. Next: Fri, Nov 13 at 7:55 AM"), or why not ("Paused…", production only).
 */
export function nextAutoStart(o: {
  env: unknown;
  now: Temporal.Instant;
  zone: string;
  hours: TimeModel;
  settings: AutoStartSettings;
  state: AutoStartState;
  pto: (d: IsoDate) => boolean;
  holiday: (d: IsoDate) => boolean;
  /** Whether the VM is on now (running or starting): today's start isn't needed. */
  on: boolean;
  /** VM-3: whether PTO and holidays could be read for the days shown (absent: they were). */
  ptoRead?: boolean;
  holidaysRead?: boolean;
}): NextAutoStart {
  if (!o.settings.on) return { kind: "off" };
  if (!autoStartEnvAllowed(o.env)) return { kind: "prod_only", text: PROD_ONLY_TEXT };
  const today = o.now.toZonedDateTimeISO(o.zone).toPlainDate();
  if (o.state.pausedOn)
    return { kind: "paused", text: "Paused: you haven't used FocusTime for 3 working days. Resume to start it again." };
  let note: string | null = null;
  // VM-3: once today's planned time is behind, the line first says what happened today, never that time as still to come.
  let todayText: string | null = null;
  const unread = [o.ptoRead === false ? "Your PTO couldn't be read, so a day off may still show a time." : null, o.holidaysRead === false ? "Holidays couldn't be checked." : null].filter(Boolean).join(" ");
  for (let i = 0; i < LOOK_DAYS; i++) {
    const date = today.add({ days: i }).toString();
    if (i === 0) {
      const start = workStart(o.hours, date, o.zone);
      const at = plannedAt(o.hours, date, o.zone, o.settings.minutes);
      const done = outcomeToday(o.state, date);
      const chosen = !o.settings.offDays.includes(weekdayKey(date)) && !!start;
      if (done) todayText = done.reason === "started" || done.reason === "started_late" ? [`Started today at ${clock(Temporal.Instant.from(done.at), o.zone)}.`, ...done.notes.map((n) => NOTE_TEXT[n])].join(" ") : outcomeText(done, false);
      else if (at && chosen && Temporal.Instant.compare(o.now, at) >= 0 && !o.state.skipped.includes(date) && !o.on && o.state.attemptedOn !== date) {
        // Past the late limit with nothing recorded, the start's next pass records why (FocusTime wasn't running).
        todayText = Temporal.Instant.compare(o.now, start!.add({ minutes: LATE_LIMIT_MINUTES })) < 0 ? `Today's start (${clock(at, o.zone)}) hasn't run yet.` : null;
      } else if (at && chosen && Temporal.Instant.compare(o.now, at) >= 0 && o.on && o.state.attemptedOn !== date) todayText = "Your VM was already on today.";
      if (todayText || o.state.attemptedOn === date || o.on || !start || !at || Temporal.Instant.compare(o.now, at) >= 0) continue;
    }
    const why = dayReason({ date, settings: o.settings, hours: o.hours, skipped: o.state.skipped, pto: o.pto(date), holiday: o.holiday(date) });
    if (why === "not_chosen" || why === "no_hours") continue;
    const at = plannedAt(o.hours, date, o.zone, o.settings.minutes)!;
    if (why) {
      note ??= `${DOW[Temporal.PlainDate.from(date).dayOfWeek - 1]} ${WHY_WORD[why]}.`;
      continue;
    }
    const next = `Next: ${whenText(at, o.zone)}`;
    const text = [todayText, note, next, unread].filter(Boolean).join(" ");
    return { kind: "next", date, at: at.toString(), text, short: shortWhen(at, o.zone, o.now) };
  }
  return { kind: "none", text: [todayText, note ? `${note} No start in the next two weeks.` : "No working days chosen, so it never starts.", unread].filter(Boolean).join(" ") };
}
