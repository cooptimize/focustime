// Timeboxes (step 12): a stretch of a day's timeline given to a client and (usually) a pick or week list item. Stored
// locally; optionally put on Outlook as a Busy event FocusTime owns. Pure: validation, the event's fields, planned time
// with timeboxes, whether Outlook needs a change, which Outlook events are FocusTime's own, and how a write is undone.
import type { SizeScale } from "./estimate.ts";
import type { CalEvent, IsoDate } from "../week/types.ts";
import { pickNeed } from "./types.ts";

/** The three answers to a meeting (step 16), as Graph's responseStatus names them. */
export const RSVP_RESPONSES = ["accepted", "tentativelyAccepted", "declined"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

export type Timebox = {
  id: number;
  /** The stable id that becomes the Outlook marker value. */
  uid: string;
  date: IsoDate;
  clientKey: string;
  pickId: number | null;
  itemId: number | null;
  title: string;
  url: string | null;
  /** Local times with offset ("2026-11-03T09:00:00-06:00"). */
  start: string;
  end: string;
  /** "Put on Outlook". */
  outlook: boolean;
  /** Outlook show as for its event (step 13); busy by default. */
  showAs: OutlookShowAs;
  /** Set when a sync followed a change made in Outlook (step 13): "Changed in Outlook: time". */
  outlookNote: string | null;
  /** Both sides changed since the last sync (step 13): Outlook's version (null: deleted there), until I choose. */
  conflict: { outlook: Fields | null; changed: string[]; at: string } | null;
  removedAt: string | null;
  /** TX-1: the check-in answer that covered it. "partly" and "none" read back with pickId null: a past work session, the to-do is free for another. */
  settled?: "done" | "partly" | "none" | null;
  /** TX-1: the to-do a settled timebox was for (pickId is null then). */
  sessionPickId?: number | null;
  createdAt: string;
  updatedAt: string;
};

/** Outlook's show as values FocusTime can set. */
export type OutlookShowAs = "free" | "tentative" | "busy" | "oof" | "workingElsewhere";
export const SHOW_AS_VALUES: readonly OutlookShowAs[] = ["busy", "tentative", "free", "oof", "workingElsewhere"];
export const SHOW_AS_LABEL: Record<OutlookShowAs, string> = { busy: "Busy", tentative: "Tentative", free: "Free", oof: "Away", workingElsewhere: "Working elsewhere" };
export const isShowAs = (v: unknown): v is OutlookShowAs => typeof v === "string" && (SHOW_AS_VALUES as readonly string[]).includes(v);

export const TIMEBOX_MIN = 15;
export const TIMEBOX_MAX = 8 * 60;
export const TIMEBOX_STEP = 5;
/** The grid drag snaps to. */
export const TIMEBOX_SNAP = 15;

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
export const minutesOf = (t: { start: string; end: string }) => Math.round((ms(t.end) - ms(t.start)) / 60_000);

/** A timebox's times: on its date (local), start before end, 15 minutes to 8 hours, whole 5 minutes. Null when valid. */
export function timeboxProblem(date: IsoDate, start: string, end: string): string | null {
  let a: number, b: number;
  try {
    a = ms(start);
    b = ms(end);
  } catch {
    return "Times aren't valid";
  }
  if (start.slice(0, 10) !== date) return "A timebox starts on its own day";
  if (b <= a) return "A timebox ends after it starts";
  const m = (b - a) / 60_000;
  if (m < TIMEBOX_MIN) return `A timebox is at least ${TIMEBOX_MIN} minutes`;
  if (m > TIMEBOX_MAX) return "A timebox is at most 8 hours";
  const startMin = Temporal.PlainDateTime.from(start.slice(0, 19)).minute;
  if (startMin % TIMEBOX_STEP || m % TIMEBOX_STEP) return `Timebox times are in ${TIMEBOX_STEP} minute steps`;
  if (end.slice(0, 10) !== date && !/T00:00:00/.test(end)) return "A timebox ends on its own day";
  return null;
}

/** Snap minutes past midnight to the drag grid. */
export const snap = (minutes: number, step = TIMEBOX_SNAP) => Math.round(minutes / step) * step;

/** One attendee of a help invite (step 13): Cooptimize staff only. */
export type Attendee = { name: string; email: string };
/**
 * The fields FocusTime writes. Timeboxes: subject, body, start, end, show as, no reminder. Invites (step 13) add the
 * attendees and whether it is a Teams meeting.
 */
export type Fields = {
  subject: string; body: string; start: string; end: string; showAs: OutlookShowAs; reminder: false; attendees?: Attendee[]; teams?: boolean;
  /** Step 16 (D284), RSVP only: my response, the note sent with it, a proposed new time, and the organizer's name. */
  response?: string; comment?: string; proposed?: { start: string; end: string }; organizer?: string;
};
/** The last line of a timebox event's body. */
export const BODY_TAG = "Timebox planned in FocusTime.";
/**
 * The same line as written before the rename (R1). Kept on purpose: events created before Nov 2 carry it, and a body
 * that only differs by this line counts as the same, so the rename never rewrites existing Outlook events.
 */
const LEGACY_BODY_TAG = "Timebox planned in Coopilot.";
const sameBody = (a: string, b: string) => a.replace(LEGACY_BODY_TAG, BODY_TAG) === b.replace(LEGACY_BODY_TAG, BODY_TAG);
/** The fields FocusTime writes to Outlook: "<client>: <title>", its show as (Busy by default), no reminder, the DevOps link in the body. */
export function outlookFields(tb: Pick<Timebox, "title" | "url" | "start" | "end"> & { showAs?: OutlookShowAs }, clientName: string): Fields {
  return {
    subject: `${clientName}: ${tb.title}`.slice(0, 255),
    body: [tb.url ?? "", BODY_TAG].filter(Boolean).join("\n\n"),
    start: Temporal.Instant.from(tb.start).toString(),
    end: Temporal.Instant.from(tb.end).toString(),
    showAs: tb.showAs ?? "busy",
    reminder: false as const,
  };
}

/** What FocusTime last wrote and confirmed for a timebox's event. */
export type OwnEvent = { uid: string; timeboxId: number | null; eventId: string; fields: Fields; deletedAt: string | null };

export type SyncOp = "create" | "update" | "delete";
const same = (a: Fields, b: Fields) => a.subject === b.subject && sameBody(a.body, b.body) && ms(a.start) === ms(b.start) && ms(a.end) === ms(b.end) && a.showAs === b.showAs;
/**
 * Does Outlook need a change to match the timebox? Create when it should be on Outlook and isn't; update when what
 * was written differs; delete when the timebox is removed or "Put on Outlook" is off. Null when in step.
 */
export function syncNeed(tb: Pick<Timebox, "outlook" | "removedAt"> | null, own: OwnEvent | null, want: Fields | null): SyncOp | null {
  const live = own && !own.deletedAt ? own : null;
  const on = !!tb && tb.outlook && !tb.removedAt;
  if (on && !live) return "create";
  if (!on && live) return "delete";
  if (on && live && want && !same(live.fields, want)) return "update";
  return null;
}

/** FocusTime's own Outlook events, by the ids it recorded when it wrote them (reads can't see the marker). */
export function ownEventIds(own: readonly OwnEvent[]): Set<string> {
  return new Set(own.filter((o) => !o.deletedAt).map((o) => `outlook:${o.eventId}`));
}
/** Calendar events without FocusTime's own: they show once, as timeboxes, and never count as meetings. */
export function withoutOwn<E extends Pick<CalEvent, "id">>(events: readonly E[], own: ReadonlySet<string>): E[] {
  return own.size ? events.filter((e) => !own.has(e.id)) : [...events];
}

/** Minutes of a timebox inside [start, end). */
export function clippedMinutes(tb: { start: string; end: string }, w: { start: string; end: string }): number {
  const a = Math.max(ms(tb.start), ms(w.start));
  const b = Math.min(ms(tb.end), ms(w.end));
  return b > a ? Math.round((b - a) / 60_000) : 0;
}

type PickLike = { id: number; status: string; size: string | null; minutes?: number | null; remainingMinutes?: number | null; resolved?: boolean };
type Settled = { settled?: string | null };
/** TX-1: a session a check-in answered as partly or not got to is past: it no longer counts as planned time. */
const stillPlanned = (t: Settled) => t.settled !== "partly" && t.settled !== "none";
/**
 * Planned minutes of a half-day with timeboxes: a planned pick with a timebox counts its timeboxed time instead of its
 * size; every live timebox in the half-day counts its minutes inside it (clipped), whether tied to a pick or not, unless
 * its pick is done, moved or dropped. Picks without a timebox count their size, or TX-1's time left, as before.
 */
export function plannedWithTimeboxes(picks: readonly PickLike[], sizes: SizeScale, timeboxes: readonly (Pick<Timebox, "pickId" | "start" | "end" | "removedAt"> & Settled)[], slot: { start: string; end: string }, allPicks: readonly PickLike[] = picks): number {
  const live = timeboxes.filter((t) => !t.removedAt && stillPlanned(t));
  const boxed = new Set(live.map((t) => t.pickId).filter((x): x is number => x !== null));
  // PL-1: a pick whose item is resolved counts zero, timed or not (it shows as done).
  const status = new Map(allPicks.map((p) => [p.id, p.resolved ? "done" : p.status]));
  const fromSizes = picks.filter((p) => p.status === "planned" && !boxed.has(p.id)).reduce((s, p) => s + pickNeed(p, sizes), 0);
  const fromBoxes = live.filter((t) => t.pickId === null || (status.get(t.pickId) ?? "planned") === "planned").reduce((s, t) => s + clippedMinutes(t, slot), 0);
  return fromSizes + fromBoxes;
}

/** A half-day's planned minutes with that day's timeboxes (see plannedWithTimeboxes). */
export function slotPlanned(picks: readonly PickLike[], sizes: SizeScale, timeboxes: readonly (Pick<Timebox, "date" | "pickId" | "start" | "end" | "removedAt"> & Settled)[] | undefined, slot: { date: IsoDate; start: string; end: string }, allPicks: readonly PickLike[] = picks): number {
  return plannedWithTimeboxes(picks, sizes, (timeboxes ?? []).filter((t) => t.date === slot.date), slot, allPicks);
}
/** Timeboxed minutes per pick (live timeboxes), or null for a pick without one: its need instead of its size. */
export function boxedMinutes(timeboxes: readonly (Pick<Timebox, "pickId" | "start" | "end" | "removedAt"> & Settled)[] | undefined): (pickId: number) => number | null {
  const m = new Map<number, number>();
  for (const t of timeboxes ?? []) if (!t.removedAt && stillPlanned(t) && t.pickId !== null) m.set(t.pickId, (m.get(t.pickId) ?? 0) + minutesOf(t));
  return (id) => m.get(id) ?? null;
}

/** The timeboxes of a date, live, in time order. */
export const dayTimeboxes = <T extends Pick<Timebox, "date" | "start" | "removedAt">>(all: readonly T[], date: IsoDate) => all.filter((t) => t.date === date && !t.removedAt).sort((a, b) => ms(a.start) - ms(b.start));

/** Local state a write log entry keeps, so undo can put the timebox back too. */
export type LocalState = { start: string; end: string; outlook: boolean; removedAt: string | null; title?: string; showAs?: OutlookShowAs; date?: string };
/** What a write was for (step 13): a timebox's event, one of my own events, a help invite, or a sync from Outlook. */
export type WriteKind = "timebox" | "event" | "invite" | "sync" | "rsvp";
export type WriteRecord = { op: SyncOp; uid: string; eventId: string | null; before: Fields | null; after: Fields | null; localBefore: LocalState | null; kind?: WriteKind };
/**
 * How to undo a write: delete what was created (an invite is cancelled, so attendees hear), put back what was changed,
 * recreate what was deleted (same marker). A cancelled invite isn't sent again, and a sync from Outlook isn't undone
 * from the log (it records what happened there).
 */
export function undoOf(w: WriteRecord): { op: SyncOp; uid: string; eventId: string | null; fields: Fields | null; local: LocalState | null } | null {
  if (w.kind === "sync") return null;
  // Step 16 (D284): an RSVP is undone by a new response restoring the previous one, without the note or a proposed
  // time. Graph can't take a response back, so there is no undo when there was none before.
  if (w.kind === "rsvp") {
    const prev = w.before?.response;
    if (!w.eventId || !w.before || !prev || !RSVP_RESPONSES.includes(prev as never)) return null;
    const { comment: _c, proposed: _p, ...fields } = w.before;
    return { op: "update", uid: w.uid, eventId: w.eventId, fields, local: null };
  }
  if (w.kind === "invite" && w.op !== "create") return null;
  if (w.op === "create") return w.eventId ? { op: "delete", uid: w.uid, eventId: w.eventId, fields: null, local: w.localBefore } : null;
  if (w.op === "update") return w.eventId && w.before ? { op: "update", uid: w.uid, eventId: w.eventId, fields: w.before, local: w.localBefore } : null;
  return w.before ? { op: "create", uid: w.uid, eventId: null, fields: w.before, local: w.localBefore } : null;
}

export type WriteStatus = "pending" | "confirmed" | "unconfirmed" | "failed" | "refused";
/** One external write in the audit log: what, where, when, the result, and the values before it. */
export type WriteEntry = {
  id: number; at: string; system: "outlook"; op: SyncOp; kind: WriteKind; uid: string; eventId: string | null; account: string | null; calendar: string | null;
  before: Fields | null; after: Fields | null; localBefore: LocalState | null; localAfter: LocalState | null;
  status: WriteStatus; message: string | null; auto: boolean; undoOf: number | null; undoneBy: number | null; attempts: number; updatedAt: string;
};
