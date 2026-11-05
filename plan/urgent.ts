// NV-1: Today's urgent strip, mine only. CV-3: built from pluggable sources ({ kind, lines(now, zone) }) in order:
// urgent requests from client chats (AI urgency "now"), then my promises, then SW-1's sends (and whatever else registers).
// A promise is urgent only when overdue or due within the next 2 hours; one due today with no time joins in the last 2
// working hours of the day. Otherwise it shows only at its time in the agenda (or, with no time, in the attention
// line's follow-ups row). Pure.
import type { UrgentAsk } from "../actions/types.ts";
import type { DayPromise } from "./conversation-views.ts";
import type { IsoDate } from "../week/types.ts";

/** How far ahead a promise with a time counts as urgent; also how early before the day's end an untimed one joins. */
export const PROMISE_SOON_MS = 2 * 3600_000;

export type UrgentLine =
  | { kind: "conversation"; key: string; who: string; what: string; ask: UrgentAsk }
  | { kind: "promise"; key: string; who: string; what: string; overdue: boolean; dueAt: string | null; promise: DayPromise }
  /** Any other source's line (SW-1's sends): its tag, one line, and where it opens. */
  | { kind: "other"; source: string; key: string; who: string; what: string; tag: string; overdue?: boolean; open?: () => void };

/** One source of urgent lines; the strip shows the sources' lines in the order the sources are given. */
export type UrgentSource = { kind: string; lines: (now: string, zone: string) => UrgentLine[] };

/** The strip's lines from its sources, in order; empty hides the strip. */
export function urgentLines(sources: readonly UrgentSource[], now: string, zone: string): UrgentLine[] {
  return sources.flatMap((s) => s.lines(now, zone));
}

/** Urgent requests from client chats. */
export const conversationSource = (urgent: readonly UrgentAsk[]): UrgentSource => ({
  kind: "conversation",
  lines: () => urgent.map((u) => ({ kind: "conversation", key: `c:${u.chatId}|${u.messageId}`, who: u.clientName, what: u.title, ask: u })),
});

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/**
 * Whether a promise belongs in the strip now: overdue; or due at a time within the next 2 hours; or due today with no
 * time once the day's working end (`dayEnd`, null with no working time today) is 2 hours away or less.
 */
export function promiseUrgent(p: DayPromise, o: { now: string; today: IsoDate; dayEnd: string | null }): boolean {
  if (p.overdue) return true;
  if (p.dueAt) return ms(p.dueAt) - ms(o.now) <= PROMISE_SOON_MS;
  return p.dueDate <= o.today && !!o.dayEnd && ms(o.dayEnd) - ms(o.now) <= PROMISE_SOON_MS;
}

/** My promises in the strip: overdue first, then by time (untimed last). */
export const promiseSource = (promises: readonly DayPromise[], o: { today: IsoDate; dayEnd: string | null }): UrgentSource => ({
  kind: "promise",
  lines: (now) =>
    promises
      .filter((p) => promiseUrgent(p, { now, today: o.today, dayEnd: o.dayEnd }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))
      .map((p): UrgentLine => ({ kind: "promise", key: `p:${p.id}`, who: p.toName ?? p.clientName, what: p.what, overdue: p.overdue, dueAt: p.dueAt, promise: p })),
});

/** Promises due today with no time that aren't in the strip yet: the attention line's follow-ups row carries them. */
export function untimedDue(promises: readonly DayPromise[], o: { now: string; today: IsoDate; dayEnd: string | null }): DayPromise[] {
  return promises.filter((p) => !p.dueAt && p.dueDate === o.today && !promiseUrgent(p, { now: o.now, today: o.today, dayEnd: o.dayEnd }));
}

/** SW-1's Today line ("Lee sent you Order export (Must)", or a count) as the strip's last source. */
export type SentToday = { line: string | null; count: number; weekStart: IsoDate };

/**
 * SW-1's sends: one line while anything sent to me waits for my answer, exactly as SW-1 words and opens it (send.today,
 * unchanged). A send has a week and no due time, so the strip's time rules have nothing to hold back: it shows while
 * something waits, after conversations and promises, and the strip hides when nothing is left.
 */
export const sendSource = (d: SentToday | null, open: (weekStart: IsoDate) => void): UrgentSource => ({
  kind: "sends",
  lines: () => (d?.line ? [{ kind: "other", source: "sends", key: `s:${d.weekStart}`, who: "", what: d.line, tag: "Sent to you", open: () => open(d.weekStart) }] : []),
});
