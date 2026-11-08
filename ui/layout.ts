import type { PlacedEvent } from "../week/types.ts";

export type Positioned = { placed: PlacedEvent; top: number; height: number; lane: number; lanes: number };

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

/**
 * TY-2: the ids of events that share time with another one in this block. Back to back isn't an overlap. A show-as-free
 * event and unavailable time don't book you, so they neither get the marker nor give it to anything else.
 */
export function overlappingIds(events: readonly PlacedEvent[]): Set<string> {
  const booked = events.filter((p) => !p.event.unavailable && p.event.showAs !== "free").map((p) => ({ id: p.event.id, a: ms(p.clipStart), b: ms(p.clipEnd) }));
  const out = new Set<string>();
  for (const x of booked) for (const y of booked) if (x.id !== y.id && x.a < y.b && y.a < x.b) out.add(x.id);
  return out;
}

/** Vertical position (fractions of the slot) and side-by-side lanes for overlapping events. */
export function layoutEvents(events: readonly PlacedEvent[], slotStart: string, slotEnd: string): Positioned[] {
  const s0 = ms(slotStart);
  const span = ms(slotEnd) - s0;
  const items = events.map((placed) => ({ placed, a: ms(placed.clipStart), b: Math.max(ms(placed.clipEnd), ms(placed.clipStart) + 10 * 60000) }));
  items.sort((x, y) => x.a - y.a || y.b - x.b);

  const out: Positioned[] = [];
  let cluster: { item: (typeof items)[number]; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const c of cluster) {
      out.push({ placed: c.item.placed, top: (c.item.a - s0) / span, height: (c.item.b - c.item.a) / span, lane: c.lane, lanes: laneEnds.length });
    }
    cluster = [];
    laneEnds = [];
  };
  for (const item of items) {
    if (item.a >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.a);
    if (lane === -1) lane = laneEnds.push(item.b) - 1;
    else laneEnds[lane] = item.b;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.b);
  }
  flush();
  return out;
}

/** Full hours strictly inside the slot, as fractions, for gridlines. */
export function hourMarks(slotStart: string, slotEnd: string, timeZone: string, includeStart = false): { at: number; label: string }[] {
  const a = Temporal.Instant.from(slotStart).toZonedDateTimeISO(timeZone);
  const b = Temporal.Instant.from(slotEnd).toZonedDateTimeISO(timeZone);
  const span = b.epochMilliseconds - a.epochMilliseconds;
  const marks: { at: number; label: string }[] = [];
  let t = a.round({ smallestUnit: "hour", roundingMode: "ceil" });
  // Week's cards start on a line of their own; Today's left-hand labels (TY-2) name that first hour too.
  if (!includeStart && Temporal.ZonedDateTime.compare(t, a) === 0) t = t.add({ hours: 1 });
  while (Temporal.ZonedDateTime.compare(t, b) < 0) {
    const h = t.hour % 12 || 12;
    marks.push({ at: (t.epochMilliseconds - a.epochMilliseconds) / span, label: `${h} ${t.hour < 12 ? "AM" : "PM"}` });
    t = t.add({ hours: 1 });
  }
  return marks;
}

/**
 * Step 15 (D271): an event that crosses from one block into the next on the same day keeps its title in the block it
 * starts in; the later block draws only its unlabelled continuation, so it reads as one event across the seam.
 */
export function labelHere(placed: Pick<PlacedEvent, "continuesBefore" | "event">, earlier: ReadonlySet<string>): boolean {
  return !(placed.continuesBefore && earlier.has(placed.event.id));
}

/**
 * Step 15.1 (D276), U3 (D384), WK-1: what a compact Week card draws for its hours, by the Board's tier: the rail with
 * titles, the slim ruler, or the day strip (strip and mini). Nothing on a block with no working hours, on the phone,
 * or outside the medium layout (tier null: the wide timeline, the one-day view); the now line then sits at the top.
 */
export function railFor(tier: "rail" | "ruler" | "strip" | "mini" | null, slot: { off: boolean }, phone = false): "rail" | "slim" | "strip" | null {
  if (!tier || phone || slot.off) return null;
  return tier === "rail" ? "rail" : tier === "ruler" ? "slim" : "strip";
}

/** A band's place on the ruler, as fractions of the block's working hours (slot.start to slot.end); null outside them. */
export function rulerSpan(slot: { start: string; end: string }, start: string, end: string): { top: number; height: number } | null {
  const a = ms(slot.start), b = ms(slot.end);
  const s = Math.max(a, ms(start)), e = Math.min(b, ms(end));
  if (b <= a || e <= s) return null;
  return { top: (s - a) / (b - a), height: (e - s) / (b - a) };
}
