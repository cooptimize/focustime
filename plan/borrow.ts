// Borrowed time (step 7, roadmap "borrowed time"): planned focus that slipped and that I said I'd make up, tonight,
// on Friday or another day. Pure: where the pick goes, how many minutes, and whether to offer a flex session.
import { hoursOn, toHm, toMin, type TimeModel } from "../week/hours.ts";
import type { Half, IsoDate } from "../week/types.ts";

export type Payback = "tonight" | "friday" | "day";
export const PAYBACKS: readonly Payback[] = ["tonight", "friday", "day"];

/** Where the pick goes: tonight is today's evening, Friday the coming Friday (today on a Friday), or a chosen day and slot. */
export function paybackSlot(when: Payback, today: IsoDate, chosen?: { date?: IsoDate; half?: Half }): { date: IsoDate; half: Half } | string {
  if (when === "tonight") return { date: today, half: "EVE" };
  if (when === "friday") {
    const t = Temporal.PlainDate.from(today);
    return { date: t.add({ days: (5 - t.dayOfWeek + 7) % 7 }).toString(), half: chosen?.half ?? "AM" };
  }
  if (!chosen?.date || !chosen.half) return "Choose the day and half-day to make it up";
  if (chosen.date < today) return "Make it up today or later";
  return { date: chosen.date, half: chosen.half };
}

/** Minutes still owed: the pick's size less the time already focused on it, in quarter hours, at least 15. */
export function borrowMinutes(sizeMinutes: number, focusedSeconds: number): number {
  const left = sizeMinutes - Math.floor(focusedSeconds / 60);
  return Math.max(15, Math.ceil(left / 15) * 15);
}

/**
 * For tonight or a weekend day without working hours there, a flex session to make the time real (local only).
 * Tonight starts at 8 PM (or the next half hour when later); a weekend day at 10 AM. Null when not needed or it
 * wouldn't fit before midnight.
 */
export function flexOffer(slot: { date: IsoDate; half: Half }, minutes: number, model: TimeModel, now: Temporal.ZonedDateTime): { date: IsoDate; start: string; end: string } | null {
  const day = hoursOn(model, slot.date);
  const weekend = Temporal.PlainDate.from(slot.date).dayOfWeek >= 6;
  let start: number;
  if (slot.half === "EVE") {
    if (day.extra.length) return null;
    const later = now.toPlainDate().toString() === slot.date ? Math.ceil((now.hour * 60 + now.minute) / 30) * 30 : 0;
    start = Math.max(20 * 60, later, day.main ? toMin(day.main.end) : 0);
  } else if (weekend && !day.segments.length) start = 10 * 60;
  else return null;
  const end = start + minutes;
  return end > 24 * 60 ? null : { date: slot.date, start: toHm(start), end: end === 24 * 60 ? "24:00" : toHm(end) };
}

export type BorrowedLike = { minutes: number; date: IsoDate; paidAt: string | null };

/** The week's borrowed total (records from its days) and what is still unpaid (any week). */
export function borrowedSummary(list: readonly BorrowedLike[], from: IsoDate, to: IsoDate): { totalMinutes: number; unpaid: number; unpaidMinutes: number } {
  const week = list.filter((b) => b.date >= from && b.date <= to);
  const unpaid = list.filter((b) => !b.paidAt);
  return { totalMinutes: week.reduce((n, b) => n + b.minutes, 0), unpaid: unpaid.length, unpaidMinutes: unpaid.reduce((n, b) => n + b.minutes, 0) };
}
