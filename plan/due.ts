// Due dates on follow-ups (step 13.5, D233): one urgency per follow-up, always in words (never color alone), and the
// Inbox order that puts what is late or close first. Pure: calendar days in the local date, no clock.
import type { IsoDate } from "../week/types.ts";

/** CV-2: "was_due" is a promise (or a follow-up made from one) past its due: amber, never red. */
export type DueLevel = "overdue" | "was_due" | "today" | "tomorrow" | "later";
export type DueState = { level: DueLevel; text: string; days: number };

const RANK: Record<DueLevel, number> = { overdue: 0, was_due: 0, today: 1, tomorrow: 2, later: 3 };

/** Overdue (red), Due today (orange), Due tomorrow (amber), or Due <day> (neutral). Null without a due date. */
export function dueState(due: IsoDate | null | undefined, today: IsoDate): DueState | null {
  if (!due) return null;
  const days = Temporal.PlainDate.from(today).until(Temporal.PlainDate.from(due), { largestUnit: "days" }).days;
  if (days < 0) return { level: "overdue", text: `Overdue ${-days} day${days === -1 ? "" : "s"}`, days };
  if (days === 0) return { level: "today", text: "Due today", days };
  if (days === 1) return { level: "tomorrow", text: "Due tomorrow", days };
  return { level: "later", text: `Due ${Temporal.PlainDate.from(due).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}`, days };
}

const dayText = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * CV-2: a promise past its due, in words: "Was due 3:00 PM" earlier today, else "Was due Wed, Nov 4". Amber
 * wherever it shows (My promises, Today, Week, a follow-up made from it), never red: a promise is a target.
 */
export function wasDueText(p: { dueAt: string | null; dueDate: string | null }, today: IsoDate, tz: string): string {
  if (p.dueAt) {
    const z = Temporal.Instant.from(p.dueAt).toZonedDateTimeISO(tz);
    return z.toPlainDate().toString() === today ? `Was due ${z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}` : `Was due ${dayText(z.toPlainDate().toString())}`;
  }
  return p.dueDate ? `Was due ${dayText(p.dueDate)}` : "Was due";
}

/** The same for a promise on Today or Week, with today taken in that zone now. */
export const wasDueNow = (p: { dueAt: string | null; dueDate: string | null }, tz: string) => wasDueText(p, Temporal.Now.plainDateISO(tz).toString(), tz);

/** CV-2: a follow-up made from a promise: as dueState, but past due it says when it was due, in amber. */
export function promiseDueState(due: IsoDate | null | undefined, today: IsoDate): DueState | null {
  const s = dueState(due, today);
  return s && s.level === "overdue" ? { level: "was_due", text: `Was due ${dayText(due!)}`, days: s.days } : s;
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

/**
 * U3 (D386): due badges on Week's cards. Only follow-ups due this week (or already overdue), each once in the week:
 * on its due day (an overdue one on today), on that day's first working block of its client, else the day's first
 * working block. Days not in `days` (another week, or before today for an overdue one) show nothing. Keys "date:half".
 */
export function weekDueBadges<T extends CardFollowUp>(days: readonly { date: IsoDate; slots: readonly DaySlot[] }[], followUps: readonly T[], today: IsoDate): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const last = days[days.length - 1]?.date;
  if (!last) return out;
  for (const f of dueOrder(followUps, today, (x) => x.due, (x) => x.openedAt)) {
    if (!f.due || f.due > last) continue;
    const on = f.due < today ? today : f.due;
    const day = days.find((d) => d.date === on);
    if (!day) continue;
    const slot = day.slots.find((s) => s.working && s.clientKey !== null && s.clientKey === f.clientKey) ?? day.slots.find((s) => s.working);
    if (!slot) continue;
    const k = `${on}:${slot.half}`;
    out.set(k, [...(out.get(k) ?? []), f]);
  }
  return out;
}
