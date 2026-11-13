// IB-4: the slim Inbox's rules. Pure: no I/O, no clock (now is passed in), no AI.
//
// A suggestion is a conversation the sorting step judged to need a DevOps item (itemNeeded), with no linked item and no
// likely existing one, not wrapped up or closed, quiet for at least 4 working hours (the chat's followers' hours, so a
// night or a weekend doesn't count) and no older than 7 days, and not dismissed by me. Who may see it is the store's
// viewer (members who follow the client), unchanged.
//
// A promise found in a chat clears on its own in two ways, worked out when it is read (no job): its linked item was
// finished (it is done), or I never touched it and it is 7 days past its due date, or 7 days after it was found when it
// has none (it expired: never done, never broken). Promises I added and ones a rule made never expire.
import { inWorkingHours } from "./notify.ts";
import type { TimeModel } from "../week/hours.ts";
import type { Conversation } from "./conversations.ts";
import type { ClearedHow, InboxMark } from "./inbox-items.ts";

/** A suggestion waits this many working minutes after the last work message, so the chat can settle first. */
export const SUGGEST_AFTER_WORK_MINUTES = 4 * 60;
/** A suggestion older than this (since the last work message) is no longer offered. */
export const SUGGEST_FOR_DAYS = 7;
/** An untouched chat promise expires this many days after its due date (or after it was found, without one). */
export const EXPIRE_AFTER_DAYS = 7;
/** Cleared promises show under "Cleared on their own" this long. */
export const CLEARED_SHOWN_DAYS = 14;

const STEP_MINUTES = 15;

/**
 * Working minutes between two instants in the union of these working hours (each in its own zone), counted in
 * 15-minute steps (a step counts when its start is inside anyone's hours). Stops counting at `cap`.
 */
export function workingMinutesBetween(from: string, to: string, hours: readonly TimeModel[], cap = Number.POSITIVE_INFINITY): number {
  if (!hours.length) return 0;
  const end = Temporal.Instant.from(to);
  let t = Temporal.Instant.from(from);
  let n = 0;
  while (Temporal.Instant.compare(t, end) < 0 && n < cap) {
    if (hours.some((h) => inWorkingHours(h, t.toZonedDateTimeISO(h.timeZone)))) n += STEP_MINUTES;
    t = t.add({ minutes: STEP_MINUTES });
  }
  return Math.min(n, cap);
}

export type SuggestionFacts = Pick<Conversation, "itemId" | "likelyItem" | "windDown" | "closedAt" | "status" | "lastWorkAt" | "mergedInto"> & { itemNeeded?: Conversation["itemNeeded"] };

/** Why a conversation isn't a suggestion for me now (null: it is one). */
export type NotSuggested = "no_judgment" | "has_item" | "likely_item" | "wrapped_up" | "closed" | "too_soon" | "too_old" | "dismissed";

export function notSuggested(c: SuggestionFacts, o: { now: string; hours: readonly TimeModel[]; mark?: Pick<InboxMark, "outcome" | "hiddenAt"> | null }): NotSuggested | null {
  if (!c.itemNeeded) return "no_judgment";
  if (c.itemId) return "has_item";
  if (c.likelyItem) return "likely_item";
  if (c.closedAt || c.mergedInto || c.status === "resolved" || c.status === "closed") return "closed";
  if (c.windDown) return "wrapped_up";
  if (o.mark?.outcome === "dismissed" || o.mark?.outcome === "promised" || o.mark?.hiddenAt) return "dismissed";
  if (Date.parse(o.now) - Date.parse(c.lastWorkAt) > SUGGEST_FOR_DAYS * 86_400_000) return "too_old";
  if (workingMinutesBetween(c.lastWorkAt, o.now, o.hours, SUGGEST_AFTER_WORK_MINUTES) < SUGGEST_AFTER_WORK_MINUTES) return "too_soon";
  return null;
}

export const isSuggestion = (c: SuggestionFacts, o: Parameters<typeof notSuggested>[1]) => notSuggested(c, o) === null;

/** What clearing needs to know about one open promise of mine. */
export type ClearFacts = {
  /** Found in a chat (a commitment), or added by me or by a rule (a follow-up): only chat ones expire. */
  fromChat: boolean;
  /** Its due day in my zone (null: none). */
  dueDate: string | null;
  /** When it was found (or added). */
  createdAt: string;
  /** Its linked item, as the store has it now (null: none linked, or not in the store). */
  item: { closed: boolean; changedAt: string | null } | null;
  /** Touched by me: a due or who change, a note, my week or day, an item linked or created, Close the loop sent. */
  touched: boolean;
  putBackAt: string | null;
};

/**
 * How an open promise clears now (null: it stays). A finished linked item clears it as done; after Put back only an
 * item finished since does. An untouched chat promise expires 7 days after its due day ends, or 7 days after it was
 * found without one.
 */
export function clearsAs(p: ClearFacts, now: string, zone: string): ClearedHow | null {
  if (p.item?.closed && (!p.putBackAt || (p.item.changedAt && Date.parse(p.item.changedAt) > Date.parse(p.putBackAt)))) return "item";
  if (!p.fromChat || p.touched || p.putBackAt) return null;
  if (p.dueDate) {
    const today = Temporal.Instant.from(now).toZonedDateTimeISO(zone).toPlainDate();
    return Temporal.PlainDate.compare(today, Temporal.PlainDate.from(p.dueDate).add({ days: EXPIRE_AFTER_DAYS })) > 0 ? "expired" : null;
  }
  return Date.parse(now) - Date.parse(p.createdAt) >= EXPIRE_AFTER_DAYS * 86_400_000 ? "expired" : null;
}

/** The reason a cleared promise shows under "Cleared on their own". */
export function clearedReason(how: ClearedHow, itemId: number | null): string {
  return how === "item" ? (itemId ? `#${itemId} was finished` : "Its item was finished") : `Not touched for ${EXPIRE_AFTER_DAYS} days`;
}

/** Whether a cleared promise still shows under "Cleared on their own" (the last 14 days). */
export const clearedRecently = (clearedAt: string | null, now: string) => !!clearedAt && Date.parse(now) - Date.parse(clearedAt) <= CLEARED_SHOWN_DAYS * 86_400_000;

/**
 * The Inbox tab's count: suggestions plus my promises that are late or due today. Captures never count. Zero shows
 * nothing.
 */
export function tabCount(o: { suggestions: number; promisesLateOrToday: number }): number {
  return o.suggestions + o.promisesLateOrToday;
}

/** The level a suggestion proposes, in the client's own words (its process's backlog level names). */
export function levelWord(level: "child" | "feature" | "epic", names: { child?: string | null; feature?: string | null; epic?: string | null }): string {
  return names[level] ?? (level === "child" ? "Story" : level === "feature" ? "Feature" : "Epic");
}
