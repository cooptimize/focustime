// IB-1: the Inbox as one list of items that need a decision, with one lifecycle and one count rule. Pure: the server
// gathers conversations, promises (chat commitments and former follow-ups), sends to me, captures and drafts, and this
// decides each item's lifecycle, the views it shows in, and the Needs you count that the nav badge, the rail and every
// view header share.
//
// Item keys are stable across both promise stores (no rows moved): `c<id>` a promise found in a chat (commitments),
// `f<id>` a promise I added or a rule opened (follow_ups, called follow-ups before IB-1), `v<id>` a conversation,
// `s<id>` a send to me, `k<id>` a capture, `d<id>` a draft story or feature to add in DevOps.
import type { UrgentAsk } from "../actions/types.ts";
import type { IsoDate } from "../week/types.ts";
import { hoursOn, type TimeModel } from "../week/hours.ts";

/**
 * Slice 3 adds what I wait on, as their own kinds so nothing reads them as mine to answer: `commitment` someone else's
 * open commitment made to me or in a conversation I own (`c<id>`, the shared commitments table), `sent` a send of mine
 * still waiting for its answer (`s<id>`), `ask` my Ask to look that no lead has answered (`a<id>`).
 */
export const INBOX_KINDS = ["conversation", "promise", "send", "capture", "draft", "commitment", "sent", "ask"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_VIEWS = ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done", "chatter"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** The one lifecycle: New, Needs you, In progress (an item linked or on my week), Waiting on someone, Done. */
export type Lifecycle = "new" | "needs_you" | "in_progress" | "waiting" | "teammates" | "open" | "done";

const PREFIX = { conversation: "v", chatPromise: "c", followUp: "f", send: "s", capture: "k", draft: "d", look: "a" } as const;
export type KeySource = keyof typeof PREFIX;
export const itemKey = (source: KeySource, id: number) => `${PREFIX[source]}${id}`;

/** A key back to its source and id; null for anything that isn't one. */
export function parseKey(key: string): { source: KeySource; id: number } | null {
  const m = /^([vcfskda])([1-9]\d{0,9})$/.exec(key);
  if (!m) return null;
  const source = (Object.keys(PREFIX) as KeySource[]).find((s) => PREFIX[s] === m[1])!;
  return { source, id: Number(m[2]) };
}

/** My marks on an item (inbox_marks): seen, snoozed until an instant, hidden. Absent: none. */
export type Mark = { seenAt: string | null; snoozedUntil: string | null; hiddenAt: string | null };

/** What the rules need to know about one item; the server fills it from each source. */
export type InboxFacts = {
  key: string;
  kind: InboxKind;
  clientKey: string | null;
  /** When it last changed, for the order inside a group (newest first). */
  at: string;
  /** Closed for good: resolved, done, not needed, answered, sorted. */
  done: boolean;
  /** Conversation: the view CV-1's rules put it in. */
  conversationView?: "needs" | "progress" | "teammates" | "closed";
  /** Promise: due date (my zone), linked to a DevOps item, on my week (Today or a pick). */
  due?: IsoDate | null;
  linked?: boolean;
  onWeek?: boolean;
  /** Promise: I added it myself (never "new" to me). */
  byMe?: boolean;
  /** Send to me: waiting for my answer (Needs you) or accepted or scheduled (In progress). */
  sendState?: "waiting" | "accepted" | "done";
  /** Waiting on someone else (IB-1 slice 3: commitments to me, my sends, my Ask to look). */
  waitingOn?: boolean;
  /** Slice 2: what a row shows. The title; the person (to whom a promise is, who sent it, who's asking); where it came from. */
  title?: string;
  who?: string | null;
  where?: string | null;
  /** A promise's due instant when a time was stated (else `due` is the day). */
  dueAt?: string | null;
  /** The linked or created DevOps item. */
  itemId?: number | null;
  /** Conversation: it names me; a work request with no item yet. Send: a Must. */
  mentionsMe?: boolean;
  workRequest?: boolean;
  must?: boolean;
  /** Send: the week it's for. */
  weekStart?: IsoDate;
  /** Slice 3, for the Needs you reason: a conversation's own why (CV-1's facts), and whether a promise came from a chat. */
  needsWhy?: "mention" | "work" | "committed" | "owner" | "unclaimed" | "suggestion" | "wrapped" | "new" | null;
  fromChat?: boolean;
  /**
   * Slice 4: a conversation holding a request the AI sorted as needing someone now (AP-2's urgency "now"), with that
   * request for Today's Start focus. Before slice 4 Today read these on their own (week.load's `requests.urgent`).
   */
  urgent?: UrgentAsk | null;
};

/** Late: a promise past its due (the instant when one was stated, else the day before today). */
export function isLate(f: Pick<InboxFacts, "kind" | "done" | "due" | "dueAt">, today: IsoDate, now: string): boolean {
  if ((f.kind !== "promise" && f.kind !== "commitment") || f.done) return false;
  if (f.dueAt) return Date.parse(f.dueAt) < Date.parse(now);
  return !!f.due && f.due < today;
}

/** Seen, or already acted on (a due, a link, on my week): not New any more. */
const triaged = (f: InboxFacts, m: Mark | undefined) => !!m?.seenAt || !!f.byMe || !!f.linked || !!f.onWeek;

/** Snoozed until a later instant, or hidden for me: in no view and in no count until it's back. */
export function asleep(m: Mark | undefined, now: string): boolean {
  if (!m) return false;
  if (m.hiddenAt) return true;
  return !!m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.parse(now);
}

/** An item's place in the lifecycle. */
export function lifecycleOf(f: InboxFacts, m: Mark | undefined, today: IsoDate): Lifecycle {
  if (f.done) return "done";
  switch (f.kind) {
    case "conversation":
      if (f.conversationView === "closed") return "done";
      if (f.conversationView === "progress") return "in_progress";
      if (f.conversationView === "teammates") return f.waitingOn ? "waiting" : "teammates";
      return "needs_you";
    case "promise": {
      if (!triaged(f, m)) return "new";
      if (f.due && f.due <= today) return "needs_you";
      if (f.linked || f.onWeek) return "in_progress";
      return "open";
    }
    case "send":
      return f.sendState === "waiting" ? "needs_you" : f.sendState === "accepted" ? "in_progress" : "done";
    case "capture":
    case "draft":
      return "open";
    case "commitment":
    case "sent":
    case "ask":
      return "waiting";
  }
}

/**
 * The one Needs you rule (IB-1): conversations CV-1's rules say need me, sends waiting for my answer, and promises that
 * are new (not seen or acted on) or due today or overdue. Later promises live only in Promises. Captures, drafts and
 * chatter never count. Snoozed and hidden items never count.
 */
export function needsYou(f: InboxFacts, m: Mark | undefined, today: IsoDate, now: string): boolean {
  if (asleep(m, now) || f.done) return false;
  if (f.kind === "promise") {
    if (!triaged(f, m)) return true;
    return !!f.due && f.due <= today;
  }
  const l = lifecycleOf(f, m, today);
  return l === "needs_you" || l === "new";
}

/** Every view an item shows in (Chatter holds messages, not items, so never here). */
export function viewsOf(f: InboxFacts, m: Mark | undefined, today: IsoDate, now: string): InboxView[] {
  const l = lifecycleOf(f, m, today);
  if (l === "done") return ["done"];
  if (asleep(m, now)) return [];
  const out: InboxView[] = [];
  if (needsYou(f, m, today, now)) out.push("needs_you");
  if (f.kind === "promise") out.push("promises");
  if (l === "in_progress" || (f.kind === "promise" && (f.linked || f.onWeek))) out.push("in_progress");
  if (l === "waiting" || f.waitingOn) out.push("waiting");
  if (l === "teammates") out.push("teammates");
  if (f.kind === "capture" || f.kind === "draft") out.push("captures");
  return [...new Set(out)];
}

/** Items per view, for the rail; `needs_you` is the badge's and the header's number too. */
export function viewCounts(items: readonly { facts: InboxFacts; mark?: Mark | undefined }[], today: IsoDate, now: string): Record<InboxView, number> {
  const out = Object.fromEntries(INBOX_VIEWS.map((v) => [v, 0])) as Record<InboxView, number>;
  for (const i of items) for (const v of viewsOf(i.facts, i.mark, today, now)) out[v]++;
  return out;
}

/** The Needs you count alone (the nav badge): the same rule as the view, nothing else added. */
export function needsYouCount(items: readonly { facts: InboxFacts; mark?: Mark | undefined }[], today: IsoDate, now: string): number {
  return items.filter((i) => needsYou(i.facts, i.mark, today, now)).length;
}

/** One row of the Inbox: what the list shows, the views it's in, and whether it's late. Never message text. */
export type InboxItemView = {
  key: string;
  /** Slice 3: why it needs me, in a few plain words (Needs you only; null elsewhere). */
  reason?: string | null;
  kind: InboxFacts["kind"];
  clientKey: string | null;
  at: string;
  views: InboxView[];
  title: string;
  who: string | null;
  where: string | null;
  due: IsoDate | null;
  dueAt: string | null;
  itemId: number | null;
  late: boolean;
  done: boolean;
  sendState?: InboxFacts["sendState"];
  conversationView?: InboxFacts["conversationView"];
  mentionsMe?: boolean;
  workRequest?: boolean;
  must?: boolean;
  weekStart?: IsoDate;
  snoozedUntil: string | null;
  /** Slice 4: a conversation's urgent request (Today's "Needs you now" and its Start focus). */
  urgent?: UrgentAsk;
};
export type InboxListData = {
  today: IsoDate;
  items: InboxItemView[];
  counts: Record<InboxView, number>;
  needsYou: number;
  /** Slice 3: the Snooze choices to offer now (Later today only with an hour or more of my day left). */
  snoozeChoices?: ("later" | "tomorrow" | "next_week")[];
};

// ---- Slice 3: why it needs me ----

const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || null;
const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A due day in words from today: today, tomorrow, the weekday within a week, else "Nov 20". */
export function dueDay(due: IsoDate, today: IsoDate): string {
  const d = Temporal.PlainDate.from(due);
  const days = Temporal.PlainDate.from(today).until(d).days;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return WEEKDAY[d.dayOfWeek]!;
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
const lateWords = (due: IsoDate, today: IsoDate) => {
  const n = Temporal.PlainDate.from(due).until(Temporal.PlainDate.from(today)).days;
  return n <= 0 ? "late" : `${n} ${n === 1 ? "day" : "days"} late`;
};

/**
 * Why an item is in Needs you, from fields it already has, never from message text: "Joel asked you by name",
 * "You promised it, due Fri", "Josh sent it as a Must", "Work request, no item yet". Null when it isn't in Needs you.
 */
export function reasonOf(f: InboxFacts, m: Mark | undefined, today: IsoDate, now: string): string | null {
  if (!needsYou(f, m, today, now)) return null;
  const who = first(f.who);
  switch (f.kind) {
    case "conversation":
      switch (f.needsWhy ?? (f.mentionsMe ? "mention" : f.workRequest ? "work" : null)) {
        case "mention": return who ? `${who} asked you by name` : "You were asked by name";
        case "work": return "Work request, no item yet";
        case "committed": return "You committed to something in it";
        case "owner": return "It's yours: you own it";
        case "unclaimed": return "Nobody has claimed it, and you lead the client";
        case "suggestion": return "A suggested change waits for you";
        case "wrapped": return "Looks wrapped up. Resolve?";
        case "new": return "New, and nobody has picked it up";
        default: return "It needs you";
      }
    case "promise": {
      const said = f.byMe ? "You added it" : "You promised it";
      if (isLate(f, today, now)) return `${said}, ${f.due ? lateWords(f.due, today) : "late"}`;
      if (f.due) return `${said}, due ${dueDay(f.due, today)}`;
      return f.fromChat ? "You promised it in a chat, with no due day" : `${said}, with no due day`;
    }
    case "send":
      return f.must ? `${who ?? "A lead"} sent it as a Must` : `${who ?? "Someone"} suggested it for ${f.where ?? "your week"}`;
    default:
      return null;
  }
}

// ---- Slice 4: Today's urgent strip and Week's rail, from the same rows ----

/** How far ahead a promise with a time joins Today's strip; also how close to the day's end an untimed one does. */
export const TODAY_SOON_MS = 2 * 3600_000;

const msOf = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/** A promise in Today's strip now: late; due at a time within 2 hours; or due today with no time once the day's end (`dayEnd`) is 2 hours away or less. */
export function promiseSoon(r: Pick<InboxItemView, "late" | "due" | "dueAt">, o: { today: IsoDate; now: string; dayEnd: string | null }): boolean {
  if (r.late) return true;
  if (r.dueAt) return msOf(r.dueAt) - msOf(o.now) <= TODAY_SOON_MS;
  return !!r.due && r.due <= o.today && !!o.dayEnd && msOf(o.dayEnd) - msOf(o.now) <= TODAY_SOON_MS;
}

/**
 * Today's urgent strip: Inbox rows that are in Needs you and urgent now, in this order: conversations with a request
 * the AI sorted as needed now ("Needs you now"), my promises that are late or due soon (late first, then by time), and
 * sends to me waiting for my answer (Musts first). Every line is a Needs you item, so the strip never shows something
 * the badge doesn't count, and each opens its own item in the Inbox.
 */
export function todayLines(rows: readonly InboxItemView[], o: { today: IsoDate; now: string; dayEnd: string | null }): InboxItemView[] {
  const needs = rows.filter((r) => r.views.includes("needs_you"));
  const convs = needs.filter((r) => r.kind === "conversation" && !!r.urgent);
  const promises = needs
    .filter((r) => r.kind === "promise" && promiseSoon(r, o))
    .sort((a, b) => Number(b.late) - Number(a.late) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9") || (a.due ?? "9").localeCompare(b.due ?? "9"));
  const sends = needs.filter((r) => r.kind === "send" && r.sendState === "waiting").sort((a, b) => Number(!!b.must) - Number(!!a.must) || b.at.localeCompare(a.at));
  return [...convs, ...promises, ...sends];
}

/** One promise on Week's rail (plan/rail-promises.ts places it): the Inbox row's key, what, to whom and when. */
export type RailItem = { key: string; what: string; toName: string | null; dueAt: string | null; dueDate: string; overdue: boolean };

/** Week's rail: my open promises that have a time or are late, awake (not snoozed or hidden), as the Inbox has them. */
export function railItems(rows: readonly InboxItemView[]): RailItem[] {
  return rows
    .filter((r) => r.kind === "promise" && !r.done && r.views.length > 0 && (!!r.dueAt || r.late))
    .map((r) => ({ key: r.key, what: r.title, toName: r.who, dueAt: r.dueAt, dueDate: r.due ?? "", overdue: r.late }));
}

/** What `inbox.today` returns: the badge's number and the rows Today's strip and Week's rail read. */
export type InboxTodayData = { today: IsoDate; needsYou: number; items: InboxItemView[] };

/** The rows `inbox.today` sends: those in Needs you, and the promises the rail can show. */
export const forToday = (r: InboxItemView) => r.views.includes("needs_you") || (r.kind === "promise" && !r.done && r.views.length > 0 && (!!r.dueAt || r.late));

// ---- Slice 3: snooze ----

export type SnoozeChoice = "later" | "tomorrow" | "next_week";
/** My days for snoozing, in my zone: a date's working span (null on a day off) and whether it's a PTO day. */
export type SnoozeDay = {
  zone: string;
  hours: (d: IsoDate) => { start: string; end: string } | null;
  pto: (d: IsoDate) => boolean;
};
/** A SnoozeDay from my working hours (week/hours.ts) and my PTO dates. */
export function snoozeDayOf(model: TimeModel, ptoDays: ReadonlySet<string>): SnoozeDay {
  return {
    zone: model.timeZone,
    hours: (d) => {
      const h = hoursOn(model, d);
      const last = h.segments[h.segments.length - 1];
      return h.main && last ? { start: h.main.start, end: last.end } : null;
    },
    pto: (d) => ptoDays.has(d),
  };
}
const workday = (day: SnoozeDay, d: IsoDate) => !!day.hours(d) && !day.pto(d);
const DEFAULT_START = "09:00";
const at = (d: IsoDate, hhmm: string, zone: string) => Temporal.PlainDate.from(d).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(hhmm) }).toInstant();
const startOf = (day: SnoozeDay, d: IsoDate) => at(d, day.hours(d)?.start ?? DEFAULT_START, day.zone);
const LATER_MS = 3 * 3600_000;
const LATER_MIN_LEFT_MS = 3600_000;

/** The choices to offer now: Later today only on a workday with an hour or more of my day left. */
export function snoozeChoices(now: string, day: SnoozeDay): SnoozeChoice[] {
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(day.zone).toPlainDate().toString();
  const h = workday(day, today) ? day.hours(today) : null;
  const left = h ? at(today, h.end, day.zone).epochMilliseconds - Date.parse(now) : 0;
  return [...(left >= LATER_MIN_LEFT_MS ? (["later"] as const) : []), "tomorrow", "next_week"];
}

/**
 * When a snooze ends: Later today is 3 hours, never past my end of day; Tomorrow is the start of my next workday
 * (skipping days off and PTO); Next week is Monday's start; a date is that day's start. Never changes a due date.
 * Null when Later today isn't offered now.
 */
export function snoozeUntil(choice: SnoozeChoice | IsoDate, now: string, day: SnoozeDay): string | null {
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(day.zone).toPlainDate();
  if (choice === "later") {
    if (!snoozeChoices(now, day).includes("later")) return null;
    const end = at(today.toString(), day.hours(today.toString())!.end, day.zone).epochMilliseconds;
    return new Date(Math.min(Date.parse(now) + LATER_MS, end)).toISOString();
  }
  if (choice === "tomorrow") {
    let d = today.add({ days: 1 });
    for (let i = 0; i < 60 && !workday(day, d.toString()); i++) d = d.add({ days: 1 });
    return startOf(day, d.toString()).toString();
  }
  if (choice === "next_week") return startOf(day, today.add({ days: 8 - today.dayOfWeek }).toString()).toString();
  return startOf(day, choice).toString();
}
