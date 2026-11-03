// One row per pick (step 14.5, D259): a pick is untimed, timed in FocusTime, or timed and on Outlook. "+ time" and the
// time editor offer the block's free gaps; an already-timed pick's own timebox counts as free, so the list never says
// "no free time" because of it, and "Keep current" comes first. Drag math for the card timelines. Pure.
import type { Slot } from "../week/types.ts";
import { DEFAULT_MIN_SIZES, openGaps, placeInGap, type AgendaTimebox } from "./agenda.ts";
import { minutesOf, TIMEBOX_MIN, TIMEBOX_SNAP } from "./timebox.ts";
import type { Size } from "./types.ts";

export type TimeState = "untimed" | "timed" | "outlook";
type Box = AgendaTimebox & { outlook: boolean };

/** The pick's live timebox and its row state ("outlook" while Put on Outlook is on). */
export function pickTime<T extends Box>(pickId: number, timeboxes: readonly T[]): { state: TimeState; timebox: T | null } {
  const t = timeboxes.find((x) => x.pickId === pickId && !x.removedAt) ?? null;
  return { state: !t ? "untimed" : t.outlook ? "outlook" : "timed", timebox: t };
}

export type TimeChoice = { kind: "keep" | "gap"; start: string; end: string; minutes: number; trimmed: boolean; gapStart: string; gapEnd: string; gapMinutes: number };

/**
 * Where the pick can go in its block: "Keep current" (when timed), then each free gap with the pick placed at its
 * start. The pick's own timebox is left out of the busy time; a timed pick keeps its length, an untimed one takes its
 * size from Settings. From `now` on today. Step 16 (D285): a gap shorter than the pick's shortest useful time (the same
 * rule as Timebox my day, D273) isn't offered, and a pick is never trimmed below it. Custom time stays free.
 */
export function timeChoices(slot: Slot, timeboxes: readonly Box[], pick: { id: number; size: Size | null }, sizes: Readonly<Record<Size, number>>, now?: string, minSizes: Readonly<Record<Size, number>> = DEFAULT_MIN_SIZES): TimeChoice[] {
  const own = timeboxes.find((t) => t.pickId === pick.id && !t.removedAt) ?? null;
  const others = timeboxes.filter((t) => t !== own);
  const want = own ? minutesOf(own) : sizes[pick.size ?? "M"];
  const out: TimeChoice[] = own ? [{ kind: "keep", start: own.start, end: own.end, minutes: want, trimmed: false, gapStart: own.start, gapEnd: own.end, gapMinutes: want }] : [];
  const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
  const seen = new Set<number>(own ? [ms(own.start)] : []);
  for (const g of openGaps(slot, others, now)) {
    // The gap's start, and (when the pick sits in this gap now) right after its current end.
    const starts = [g.start, ...(own && ms(own.end) > ms(g.start) && ms(own.end) < ms(g.end) ? [own.end] : [])];
    for (const s of starts) {
      const at = placeInGap({ start: s, end: g.end, minutes: Math.round((ms(g.end) - ms(s)) / 60_000) }, want, minSizes[pick.size ?? "M"]);
      if (!at || seen.has(ms(at.start))) continue;
      seen.add(ms(at.start));
      out.push({ kind: "gap", start: at.start, end: at.end, minutes: at.minutes, trimmed: at.trimmed, gapStart: g.start, gapEnd: g.end, gapMinutes: g.minutes });
    }
  }
  return out;
}

export type DragMode = "move" | "start" | "end";
const shift = (iso: string, minutes: number) => {
  const off = /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1] ?? "Z";
  const i = Temporal.Instant.from(iso).add({ minutes });
  return off === "Z" ? i.toString() : i.toZonedDateTimeISO(off).toString({ timeZoneName: "never", smallestUnit: "second" }).replace(/:00(?=[+-])/, ":00");
};

/** A drag of `delta` minutes, snapped to 15; null when it rounds to no change. Always 15 minutes long at least. */
export function dragTimes(mode: DragMode, start: string, end: string, delta: number): { start: string; end: string } | null {
  const d = Math.round(delta / TIMEBOX_SNAP) * TIMEBOX_SNAP;
  if (!d) return null;
  const len = minutesOf({ start, end });
  if (mode === "move") return { start: shift(start, d), end: shift(end, d) };
  if (mode === "start") return { start: shift(start, Math.min(d, len - TIMEBOX_MIN)), end };
  return { start, end: shift(end, Math.max(d, TIMEBOX_MIN - len)) };
}
