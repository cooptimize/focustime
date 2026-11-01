// Due dates on follow-ups (step 13.5, D233): one urgency per follow-up, always in words (never color alone), and the
// Inbox order that puts what is late or close first. Pure: calendar days in the local date, no clock.
import type { IsoDate } from "../week/types.ts";

export type DueLevel = "overdue" | "today" | "tomorrow" | "later";
export type DueState = { level: DueLevel; text: string; days: number };

const RANK: Record<DueLevel, number> = { overdue: 0, today: 1, tomorrow: 2, later: 3 };

/** Overdue (red), Due today (orange), Due tomorrow (amber), or Due <day> (neutral). Null without a due date. */
export function dueState(due: IsoDate | null | undefined, today: IsoDate): DueState | null {
  if (!due) return null;
  const days = Temporal.PlainDate.from(today).until(Temporal.PlainDate.from(due), { largestUnit: "days" }).days;
  if (days < 0) return { level: "overdue", text: `Overdue ${-days} day${days === -1 ? "" : "s"}`, days };
  if (days === 0) return { level: "today", text: "Due today", days };
  if (days === 1) return { level: "tomorrow", text: "Due tomorrow", days };
  return { level: "later", text: `Due ${Temporal.PlainDate.from(due).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}`, days };
}

/** Overdue (most overdue first), due today, due tomorrow, later due dates (soonest first), then the rest newest first. */
export function dueOrder<T>(rows: readonly T[], today: IsoDate, due: (r: T) => IsoDate | null, at: (r: T) => string): T[] {
  const key = (r: T) => {
    const s = dueState(due(r), today);
    return s ? [RANK[s.level], s.days] : [4, 0];
  };
  const instant = (z: string) => Temporal.Instant.from(z.replace(/\[.*\]$/, "")).epochMilliseconds;
  return [...rows].sort((a, b) => {
    const [ra, da] = key(a);
    const [rb, db] = key(b);
    return ra! - rb! || da! - db! || instant(at(b)) - instant(at(a));
  });
}

/** What the week's cards need of a follow-up. */
export type CardFollowUp = { id: number; clientKey: string | null; due: IsoDate | null; openedAt: string };
/** One card of a day: its half, its block's client (null for Open, Friday or the evening), and whether it has working time. */
export type DaySlot = { half: string; clientKey: string | null; working: boolean };

/**
 * Follow-ups on a day's cards (step 13.5, D234): each client's open follow-ups on that client's first block of the
 * day, next to its DevOps work; a follow-up due that day (or overdue, on today) that isn't already there goes on the
 * day's first working card. Each follow-up shows at most once a day. Returns ids per half, in due order.
 */
export function followUpsOnDay<T extends CardFollowUp>(date: IsoDate, slots: readonly DaySlot[], followUps: readonly T[], today: IsoDate): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const shown = new Set<number>();
  const add = (half: string, f: T) => {
    if (shown.has(f.id)) return;
    shown.add(f.id);
    out.set(half, [...(out.get(half) ?? []), f]);
  };
  const ordered = dueOrder(followUps, today, (f) => f.due, (f) => f.openedAt);
  const seenClient = new Set<string>();
  for (const s of slots) {
    if (!s.clientKey || seenClient.has(s.clientKey)) continue;
    seenClient.add(s.clientKey);
    for (const f of ordered) if (f.clientKey === s.clientKey) add(s.half, f);
  }
  const first = slots.find((s) => s.working);
  if (first) for (const f of ordered) if (f.due && (f.due === date || (date === today && f.due < today))) add(first.half, f);
  return out;
}

/** At most this many follow-ups on a week card (step 13.6, Q76, D239); the rest are "+N more" in the details. */
export const CARD_FOLLOW_UPS = 3;
export function capFollowUps<T>(list: readonly T[], max = CARD_FOLLOW_UPS): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
