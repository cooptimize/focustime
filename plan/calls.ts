// MC-2: Calls that aren't registered client calls. Pure: no I/O, no clock (the caller passes now and the zone).
//   - Which events on the person's own calendar are "your other calls": a meeting with at least one other person on
//     it, not declined, not cancelled, not all day, not their own hold (one they organize with nobody else on it), in
//     the last OTHER_CALL_DAYS of their own local days, started already. Teammates' calendars are never read.
//   - The client a call is about, as a suggestion only (the person picks; FocusTime never decides): a client named in
//     the call's title (the way a capture's @tag names one), else the client of the focus block the call starts in.
//   - Who may press: a Cooptimizer the call is on the calendar of (on the invite), not declined; for that one call.
import type { CaptureClient } from "./capture.ts";

/** The last this many of the person's own local days (today included). */
export const OTHER_CALL_DAYS = 14;

/** One event of my own calendar, as Graph gives it, before anything is kept (a key, never kept until Review). */
export type CalendarMeeting = {
  /** Graph's iCalUId: the same for one occurrence on every attendee's calendar. */
  key: string;
  subject: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  isCancelled: boolean;
  isOrganizer: boolean;
  /** My answer: accepted, tentativelyAccepted, declined, notResponded, organizer, none. */
  response: string;
  /** Distinct addresses on it other than mine (the organizer included when it isn't me). */
  others: number;
  /** The Teams join link (server only; never to the page), or null for a meeting that isn't online. */
  joinUrl: string | null;
  organizerEmail: string | null;
  /** Cooptimize addresses on it (lowercase), for matching FocusTime users; never returned to the page. */
  homeAttendees: string[];
  /** MC-4: the series it is one of on my calendar (Graph's seriesMasterId), or null for a single meeting. */
  seriesKey?: string | null;
  /** MC-4: everyone on it is at Cooptimize by address (the organizer and every attendee who isn't a room). */
  allHome?: boolean;
};

/** A meeting that counts as one of my calls: someone else on it, not declined, not cancelled, not all day, not a hold. */
export function isOtherCall(e: Pick<CalendarMeeting, "isAllDay" | "isCancelled" | "isOrganizer" | "response" | "others">): boolean {
  if (e.isAllDay || e.isCancelled) return false;
  if (e.response.toLowerCase() === "declined") return false;
  return e.others > 0;
}

/** The window of other calls: from the start of the first of the last OTHER_CALL_DAYS local days, up to now. */
export function otherCallsWindow(nowIso: string, zone: string, days = OTHER_CALL_DAYS): { fromIso: string; toIso: string; fromDay: string } {
  const today = Temporal.Instant.from(nowIso).toZonedDateTimeISO(zone).toPlainDate();
  const first = today.subtract({ days: days - 1 });
  return { fromIso: first.toZonedDateTime({ timeZone: zone }).toInstant().toString(), toIso: Temporal.Instant.from(nowIso).toString(), fromDay: first.toString() };
}

/** Started, and inside the window (its start on or after the window's first day, before now). */
export function inWindow(startAt: string, w: { fromIso: string; toIso: string }): boolean {
  const t = Date.parse(startAt);
  return t >= Date.parse(w.fromIso) && t < Date.parse(w.toIso);
}

const flat = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const wordsOf = (s: string) => ` ${flat(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * The client a call is likely about, or null. Only ever a suggestion: the setup shows it chosen and the person can
 * change it. A client whose key or name is a whole word (or words) of the title wins when only one is; otherwise the
 * focus block's client for the half-day the call starts in, when there is one; otherwise nothing.
 */
export function suggestClient(title: string, clients: readonly CaptureClient[], blockClient: string | null = null): string | null {
  const t = wordsOf(title);
  const named = clients.filter((c) => [c.clientKey, c.clientName].some((n) => {
    const w = wordsOf(n).trim();
    return w.length >= 3 && t.includes(` ${w} `);
  }));
  if (named.length === 1) return named[0]!.clientKey;
  if (blockClient && clients.some((c) => c.clientKey === blockClient)) return blockClient;
  return null;
}

/** "45 min" or "1 h 30 min". */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
