import type { PlacedEvent } from "../week/types.ts";

export type Positioned = { placed: PlacedEvent; top: number; height: number; lane: number; lanes: number };

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

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
export function hourMarks(slotStart: string, slotEnd: string, timeZone: string): { at: number; label: string }[] {
  const a = Temporal.Instant.from(slotStart).toZonedDateTimeISO(timeZone);
  const b = Temporal.Instant.from(slotEnd).toZonedDateTimeISO(timeZone);
  const span = b.epochMilliseconds - a.epochMilliseconds;
  const marks: { at: number; label: string }[] = [];
  let t = a.round({ smallestUnit: "hour", roundingMode: "ceil" });
  if (Temporal.ZonedDateTime.compare(t, a) === 0) t = t.add({ hours: 1 });
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
 * Step 15.1 (D276): the compact time ruler shows on medium-width cards only, when switched on and the block has
 * working hours. Wide cards have the full timeline; narrow ones never show it.
 */
export function showRuler(layout: "wide" | "medium" | "narrow", on: boolean, slot: { off: boolean }): boolean {
  return layout === "medium" && on && !slot.off;
}

/** A band's place on the ruler, as fractions of the block's working hours (slot.start to slot.end); null outside them. */
export function rulerSpan(slot: { start: string; end: string }, start: string, end: string): { top: number; height: number } | null {
  const a = ms(slot.start), b = ms(slot.end);
  const s = Math.max(a, ms(start)), e = Math.min(b, ms(end));
  if (b <= a || e <= s) return null;
  return { top: (s - a) / (b - a), height: (e - s) / (b - a) };
}
