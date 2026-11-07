// NV-1: Today's urgent strip, mine only. CV-3: built from pluggable sources ({ kind, lines(now, zone) }) in order.
// IB-1 slice 4: the first source is the Inbox's own rows (inboxSource): conversations needed now, my promises, sends.
// A promise is urgent only when overdue or due within the next 2 hours; one due today with no time joins in the last 2
// working hours of the day. Otherwise it shows only at its time in the agenda (or, with no time, in the attention
// line's follow-ups row). Pure.
import type { DayPromise } from "./conversation-views.ts";
import type { IsoDate } from "../week/types.ts";
import { TODAY_SOON_MS, todayLines, type InboxItemView } from "./inbox-items.ts";

/** How far ahead a promise with a time counts as urgent; also how early before the day's end an untimed one joins. */
export const PROMISE_SOON_MS = TODAY_SOON_MS;

export type UrgentLine =
  /** IB-1 slice 4: an Inbox item (a conversation needed now, a promise late or due soon, a send waiting), opening it in the Inbox. */
  | { kind: "item"; key: string; row: InboxItemView }
  /** Any other source's line: its tag, one line, and where it opens. */
  | { kind: "other"; source: string; key: string; who: string; what: string; tag: string; overdue?: boolean; open?: () => void };

/** One source of urgent lines; the strip shows the sources' lines in the order the sources are given. */
export type UrgentSource = { kind: string; lines: (now: string, zone: string) => UrgentLine[] };

/** IB-1 slice 4: the strip shows at most this many lines, the most urgent first; the rest wait in the Inbox. */
export const STRIP_MAX = 3;

/** The strip's lines from its sources, in order, at most STRIP_MAX; empty hides the strip. */
export function urgentLines(sources: readonly UrgentSource[], now: string, zone: string): UrgentLine[] {
  return sources.flatMap((s) => s.lines(now, zone)).slice(0, STRIP_MAX);
}

/**
 * "N more in Inbox": the Needs you items the strip doesn't show (the badge's number less the Inbox lines shown), or
 * null when there are none or the count isn't known.
 */
export function moreInInbox(lines: readonly UrgentLine[], needsYou: number | null | undefined): number | null {
  if (needsYou == null) return null;
  const n = needsYou - lines.filter((l) => l.kind === "item").length;
  return n > 0 ? n : null;
}

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

/**
 * IB-1 slice 4: the Inbox's own rows as the strip's first source (plan/inbox-items.ts `todayLines`): what Today shows
 * is what the Inbox holds, each line opening its item there. It replaces the strip's three sources before (urgent
 * requests from week.load, my chat promises, SW-1's sends line).
 */
export const inboxSource = (rows: readonly InboxItemView[], o: { today: IsoDate; dayEnd: string | null }): UrgentSource => ({
  kind: "inbox",
  lines: (now) => todayLines(rows, { today: o.today, now, dayEnd: o.dayEnd }).map((row): UrgentLine => ({ kind: "item", key: row.key, row })),
});

/** Promises due today with no time that aren't in the strip yet: the attention line's follow-ups row carries them. */
export function untimedDue(promises: readonly DayPromise[], o: { now: string; today: IsoDate; dayEnd: string | null }): DayPromise[] {
  return promises.filter((p) => !p.dueAt && p.dueDate === o.today && !promiseUrgent(p, { now: o.now, today: o.today, dayEnd: o.dayEnd }));
}

/** SW-1's Today line (send.today: "Lee sent you Order export (Must)", or a count). Since IB-1 slice 4 Today's strip shows each send from the Inbox instead. */
export type SentToday = { line: string | null; count: number; weekStart: IsoDate };
