// TB-2: the bot's daily rhythm in Teams: when the morning brief, the midday check-in and the close out are due, how
// long each stays worth sending, and which nudges go out (at most one card an hour). Pure: the clock, the person's
// hours and settings and the facts are handed in; nothing here reads a store or sends anything.
//
// A kind is due from its time until its window ends, on a workday (Monday to Thursday, Friday only when the person
// turned it on, never a weekend or a PTO day), inside working hours (unless quiet hours are off), and not while a
// focus session runs: it waits, and goes out after the session if its window is still open. Past the window it is
// skipped, so a late wake (dev asleep at zero replicas) never sends a stale brief.
import { hoursOn, type TimeModel } from "../week/hours.ts";
import type { IsoDate } from "../week/types.ts";

export const RHYTHM_KINDS = ["brief", "checkin", "closeout"] as const;
export type RhythmKind = (typeof RHYTHM_KINDS)[number];
/** Everything Settings › Notifications › In Teams switches: the three rhythm cards and the nudges. */
export type TeamsKind = RhythmKind | "nudges" | "status" | "meetings";
export const TEAMS_KINDS: readonly TeamsKind[] = ["brief", "checkin", "closeout", "nudges", "status", "meetings"];

/**
 * Settings › Notifications › In Teams, under "Let FocusTime message me in Teams" (`teamsMessages`). All off by
 * default. briefAt null: the start of my day. closeoutMinutes: before my day ends.
 */
export type TeamsRhythm = {
  brief: boolean;
  checkin: boolean;
  closeout: boolean;
  nudges: boolean;
  /** SR-1: Monday's status report, Friday afternoon (and Sunday evening with Settings' Sunday option), its own card. */
  status: boolean;
  /** MC-1: a client call I review, once per occurrence: its proposals are ready, or its transcript needs uploading. */
  meetings: boolean;
  briefAt: string | null;
  checkinAt: string;
  closeoutMinutes: number;
  friday: boolean;
};
export const DEFAULT_TEAMS_RHYTHM: TeamsRhythm = { brief: false, checkin: false, closeout: false, nudges: false, status: false, meetings: false, briefAt: null, checkinAt: "12:00", closeoutMinutes: 30, friday: false };
export const CLOSEOUT_MINUTES = { min: 5, max: 120 } as const;
export const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TEAMS_KIND_LABEL: Record<TeamsKind, string> = { brief: "Morning brief", checkin: "Midday check-in", closeout: "Close out", nudges: "Nudges", status: "Status report", meetings: "Client calls to review" };
export const TEAMS_KIND_HINT: Record<TeamsKind, string> = {
  brief: "Today's blocks, meetings, to-dos, promises due and work sent to you.",
  checkin: "This morning's to-dos with Done and Not yet, and Move the rest.",
  closeout: "What got done today: tick to-dos or tell me, then one Confirm closes the day.",
  nudges: "A promise due tonight that's still open, work sent to you waiting over half a day, and someone taking over an item assigned to you. At most one message an hour.",
  status: "Friday afternoon, when some of your features have no update yet for Monday's report, with the list and Open Status. Sunday evening too when you turn it on under Monday's status report.",
  meetings: "After a client call you review, once: Update the plan when its proposals are ready, or Upload its transcript when none came through. Inside your working hours.",
};

const toMin = (hm: string) => (hm === "24:00" ? 1440 : Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)));
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type Window = { at: string; until: string };

/** Each kind's time and the end of its window on a date, from the person's hours; null on a day without hours. */
export function rhythmTimes(model: TimeModel, date: IsoDate, s: TeamsRhythm): Record<RhythmKind, Window | null> {
  const h = hoursOn(model, date);
  const first = h.segments[0];
  const last = h.segments.at(-1);
  if (!first || !last) return { brief: null, checkin: null, closeout: null };
  const start = toMin(first.start);
  const end = toMin(last.end);
  const win = (at: number, until: number): Window | null => {
    const a = Math.max(start, at);
    const u = Math.min(end, until);
    return a < u ? { at: toHm(a), until: toHm(u) } : null;
  };
  const brief = s.briefAt ? toMin(s.briefAt) : start;
  // The brief is about the morning: worth sending until the morning ends (at least an hour after its time).
  const amEnd = h.am ? toMin(h.am.end) : end;
  const checkin = toMin(s.checkinAt);
  const closeout = end - s.closeoutMinutes;
  return {
    brief: win(brief, Math.max(amEnd, brief + 60)),
    checkin: win(checkin, Math.max(end - 120, checkin + 60)),
    closeout: win(closeout, end),
  };
}

/** Monday to Thursday; Friday (catch-up) only when turned on; never a weekend or a PTO day. */
export function rhythmDay(date: IsoDate, s: TeamsRhythm, pto: boolean): boolean {
  if (pto) return false;
  const dow = Temporal.PlainDate.from(date).dayOfWeek;
  if (dow >= 6) return false;
  return dow < 5 || s.friday;
}

export type RhythmFacts = {
  /** Now, in the person's zone. */
  now: Temporal.ZonedDateTime;
  model: TimeModel;
  /** The master switch, "Let FocusTime message me in Teams". */
  master: boolean;
  settings: TeamsRhythm;
  /** Quiet hours are "outside working hours" (the default) and now is outside them. */
  quietNow: boolean;
  pto: boolean;
  focusRunning: boolean;
};

export type Due = { kind: RhythmKind; date: IsoDate; occasion: string };
export const occasionOf = (kind: RhythmKind, date: IsoDate) => `${kind}:${date}`;

export type DueResult = { due: Due[]; waiting: { kind: RhythmKind; why: "focus" | "quiet" }[] };

/** What is due now and what waits (focus, quiet hours). `sent`: occasions already claimed. */
export function rhythmDue(f: RhythmFacts, sent: ReadonlySet<string>): DueResult {
  const out: DueResult = { due: [], waiting: [] };
  if (!f.master) return out;
  const date = f.now.toPlainDate().toString();
  if (!rhythmDay(date, f.settings, f.pto)) return out;
  const t = f.now.toPlainTime().toString({ smallestUnit: "minute" });
  const times = rhythmTimes(f.model, date, f.settings);
  for (const kind of RHYTHM_KINDS) {
    const w = times[kind];
    if (!f.settings[kind] || !w || t < w.at || t >= w.until) continue;
    const occasion = occasionOf(kind, date);
    if (sent.has(occasion)) continue;
    if (f.focusRunning) out.waiting.push({ kind, why: "focus" });
    else if (f.quietNow) out.waiting.push({ kind, why: "quiet" });
    else out.due.push({ kind, date, occasion });
  }
  return out;
}

/**
 * The next moment a rhythm kind could be due (A3's idle rule): the earliest time ahead in the next 8 days, or in 5
 * minutes while one is inside its window but waiting. Null when nothing is switched on.
 */
export function nextRhythmWake(f: Omit<RhythmFacts, "pto" | "focusRunning" | "quietNow">, sent: ReadonlySet<string>, nudgeEveryMinutes: number | null): Temporal.Instant | null {
  if (!f.master) return null;
  const nowI = f.now.toInstant();
  let best: Temporal.Instant | null = nudgeEveryMinutes !== null && f.settings.nudges ? nowI.add({ minutes: nudgeEveryMinutes }) : null;
  const take = (i: Temporal.Instant) => (best = !best || Temporal.Instant.compare(i, best) < 0 ? i : best);
  const today = f.now.toPlainDate();
  for (let d = 0; d < 8; d++) {
    const date = today.add({ days: d }).toString();
    // PTO isn't known for later days here; a wake on a PTO day finds nothing due and plans the next.
    if (!rhythmDay(date, f.settings, false)) continue;
    const times = rhythmTimes(f.model, date, f.settings);
    for (const kind of RHYTHM_KINDS) {
      const w = times[kind];
      if (!f.settings[kind] || !w || sent.has(occasionOf(kind, date))) continue;
      const at = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: f.now.timeZoneId, plainTime: w.at }).toInstant();
      const until = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: f.now.timeZoneId, plainTime: w.until === "24:00" ? "23:59" : w.until }).toInstant();
      if (Temporal.Instant.compare(until, nowI) <= 0) continue;
      take(Temporal.Instant.compare(at, nowI) > 0 ? at : nowI.add({ minutes: 5 }));
    }
    if (best && d > 0) break;
  }
  return best;
}

// ---- Nudges ----

export type NudgeKind = "promise_tonight" | "send_waiting" | "taken_over";
export type Nudge = { key: string; kind: NudgeKind; title: string; clientName: string | null; line: string; route: string };

export type NudgeFacts = {
  now: Temporal.Instant;
  today: IsoDate;
  /** When my day ends today (null: no hours today). */
  dayEnd: Temporal.Instant | null;
  promises: readonly { key: string; title: string; clientName: string | null; due: IsoDate | null; done: boolean }[];
  /** Sends to me, with when they were sent. */
  sends: readonly { key: string; title: string; clientName: string | null; waiting: boolean; at: string; from: string | null }[];
  /** DV-1's change log: an item assigned to me given to someone else by someone else. */
  takeovers: readonly { key: string; itemId: number; title: string | null; clientName: string | null; byName: string; at: string }[];
};

/** "More than half a day" for a send waiting for my answer. */
export const SEND_WAIT_HOURS = 4;
/** A promise due today is nudged about this long before my day ends. */
export const PROMISE_BEFORE_END_HOURS = 2;
/** At most one nudge card in this many minutes. */
export const NUDGE_EVERY_MINUTES = 60;
/** How often the nudge facts are read while nudges are on (they are cheap, but not every 30 s). */
export const NUDGE_CHECK_MINUTES = 10;

/** Every nudge worth sending now (each key goes out once; the caller drops keys already sent). */
export function nudges(f: NudgeFacts): Nudge[] {
  const out: Nudge[] = [];
  if (f.dayEnd) {
    const from = f.dayEnd.subtract({ hours: PROMISE_BEFORE_END_HOURS });
    if (Temporal.Instant.compare(f.now, from) >= 0 && Temporal.Instant.compare(f.now, f.dayEnd) < 0)
      for (const p of f.promises) if (!p.done && p.due === f.today) out.push({ key: `promise:${p.key}`, kind: "promise_tonight", title: p.title, clientName: p.clientName, line: "Due tonight, still open", route: "#/inbox/my-promises" });
  }
  for (const s of f.sends) {
    if (!s.waiting) continue;
    if (f.now.since(Temporal.Instant.from(s.at)).total("hours") < SEND_WAIT_HOURS) continue;
    out.push({ key: `send:${s.key}`, kind: "send_waiting", title: s.title, clientName: s.clientName, line: `${s.from ? `From ${s.from}, w` : "W"}aiting for your answer`, route: "#/week/add" });
  }
  for (const t of f.takeovers) out.push({ key: `taken:${t.key}`, kind: "taken_over", title: t.title ? `#${t.itemId} ${t.title}` : `#${t.itemId}`, clientName: t.clientName, line: `${t.byName} assigned it to someone else`, route: `#/ahead?item=${t.itemId}` });
  return out;
}

/** Whether a nudge card may go out now: none in the last hour. */
export function nudgeAllowed(lastSentAt: string | null, now: Temporal.Instant): boolean {
  return !lastSentAt || now.since(Temporal.Instant.from(lastSentAt)).total("minutes") >= NUDGE_EVERY_MINUTES;
}

/** The hour bucket a nudge card claims (two replicas in the same hour claim the same one). */
export const nudgeOccasion = (now: Temporal.Instant) => `nudges:${now.toString().slice(0, 13)}`;

/** The most a nudge card lists. */
export const NUDGE_MAX = 6;

// ---- Capture by message ----

/** "capture: …" or "c: …" (any case, spaces around the colon): the text to save as typed, or null. */
export function captureText(text: string): string | null {
  const m = /^\s*(?:capture|c)\s*:\s*([\s\S]*)$/i.exec(text);
  if (!m) return null;
  return m[1]!.trim();
}

// ---- Close out in my own words ----

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "done", "did", "finished", "got", "today", "also", "have", "has", "was", "were", "about", "just", "some", "them", "then", "all", "not", "but", "only", "both"]);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");

/**
 * TB-2: which of the day's picks a close-out reply says are done, worked out here with no AI (one request may span
 * clients, so nothing of it goes to a model). "all", "everything" → all; "nothing", "none" → none; numbers are the
 * card's order (1 is the first pick listed); otherwise a pick counts when the reply shares two of its words, or its one
 * word when the title has no more than two. The proposal shows the result before anything is written.
 */
export function doneFromWords(reply: string, picks: readonly { id: number; title: string }[]): number[] {
  const t = reply.toLowerCase().trim();
  if (!t) return [];
  if (/^(none|nothing|no|nope|nothing done|none of (it|them))[.!]?$/.test(t)) return [];
  const all = /\b(all( of (it|them))?( done)?|everything|every one)\b/.test(t);
  const but = /\b(but|except)\b(.*)$/.exec(t);
  if (all && !but) return picks.map((p) => p.id);
  // "everything but the export": all of them except the ones the rest names.
  if (all && but) {
    const except = new Set(doneFromWords(but[2]!, picks.map((p) => ({ ...p }))));
    return picks.map((p) => p.id).filter((id) => !except.has(id));
  }
  const out = new Set<number>();
  for (const m of t.matchAll(/(?<![\w#])(\d{1,2})(?![\w%])/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= picks.length) out.add(picks[n - 1]!.id);
  }
  const said = new Set(words(t).map(stem));
  for (const p of picks) {
    const own = [...new Set(words(p.title).map(stem))];
    const shared = own.filter((w) => said.has(w)).length;
    // Two shared words, or one that only this pick has (so "the export" finds the one export pick).
    const unique = own.filter((w) => said.has(w) && !picks.some((q) => q.id !== p.id && words(q.title).map(stem).includes(w))).length;
    if (shared >= 2 || (shared >= 1 && own.length <= 2) || unique >= 1) out.add(p.id);
  }
  return picks.map((p) => p.id).filter((id) => out.has(id));
}

// ---- Takeovers from DV-1's change log ----

export type AssigneeChange = { id: number; itemId: number; kind: string; oldValue: string | null; newValue: string | null; byName: string | null; byUnique: string | null; changedAt: string; rev: number };

/**
 * An item assigned to me that someone else gave to another person: the change log's assignee rows whose old value is
 * one of my names (DV-1 keeps the assignee's display name only), whose new value isn't, and whose changer isn't me (by
 * uniqueName, D591's one use of it). Unassigning ("" or none) counts too.
 */
export function takeoversOf(changes: readonly AssigneeChange[], me: { names: readonly string[]; emails: readonly string[] }): { key: string; itemId: number; byName: string; at: string }[] {
  const names = new Set(me.names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const emails = new Set(me.emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!names.size) return [];
  const out: { key: string; itemId: number; byName: string; at: string }[] = [];
  for (const c of changes) {
    if (c.kind !== "assignee" || !c.oldValue || !names.has(c.oldValue.trim().toLowerCase())) continue;
    if (c.newValue && names.has(c.newValue.trim().toLowerCase())) continue;
    if (c.byUnique && emails.has(c.byUnique.trim().toLowerCase())) continue;
    if (c.byName && names.has(c.byName.trim().toLowerCase())) continue;
    out.push({ key: `${c.itemId}-${c.rev}`, itemId: c.itemId, byName: (c.byName ?? "Someone").split(/\s+/)[0] || "Someone", at: c.changedAt });
  }
  return out;
}
