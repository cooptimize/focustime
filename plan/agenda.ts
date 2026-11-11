// A block's agenda and its free gaps (step 13.6, D244 to D246): what Plan the day shows per block, where a pick can be
// timeboxed with one click, and "Timebox my day". Pure: the caller passes the slot (from the week build), the
// timeboxes and, on today, the clock.
import { namedSize, unsizedText, type SizeScale } from "./estimate.ts";
import type { FreeGap, Half, IsoDate, ShowAs, Slot } from "../week/types.ts";
import { pickNeed, type Pick, type Size } from "./types.ts";
import { TIMEBOX_MIN, TIMEBOX_SNAP, TIMEBOX_STEP } from "./timebox.ts";

export type AgendaTimebox = { id: number; date: IsoDate; start: string; end: string; title: string; clientKey: string; pickId: number | null; removedAt: string | null };
export type AgendaKind = "meeting" | "personal" | "unavailable" | "timebox" | "free";
export type AgendaItem = {
  kind: AgendaKind;
  start: string;
  end: string;
  minutes: number;
  title: string;
  /** An event shown as free or working elsewhere: on the agenda, but it leaves the time free. */
  free?: boolean;
  /** The event's show-as (step 17.6), for the Week view's styling. */
  showAs?: ShowAs;
  /** The calendar event id, or the timebox id. */
  eventId?: string;
  timeboxId?: number;
};

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const minutes = (a: number, b: number) => Math.round((b - a) / 60_000);
/** An instant as a local time with the offset the slot's times use. */
function sameZone(x: number, like: string): string {
  const off = /([+-]\d{2}:\d{2})$/.exec(like)?.[1];
  const i = Temporal.Instant.fromEpochMilliseconds(x);
  return off ? i.toZonedDateTimeISO(off).toString({ timeZoneName: "never", smallestUnit: "second" }) : i.toString();
}

const live = (slot: Slot, timeboxes: readonly AgendaTimebox[]) => timeboxes.filter((t) => t.date === slot.date && !t.removedAt && ms(t.end) > ms(slot.start) && ms(t.start) < ms(slot.end));

/** Gaps of 15 minutes or more: the slot's free time (working windows minus busy events), minus timeboxes, from `now` on. */
export function openGaps(slot: Slot, timeboxes: readonly AgendaTimebox[], now?: string): FreeGap[] {
  const busy = live(slot, timeboxes).map((t) => [ms(t.start), ms(t.end)] as const).sort((a, b) => a[0] - b[0]);
  const from = now ? ms(now) : -Infinity;
  const out: FreeGap[] = [];
  for (const g of slot.freeGaps) {
    let a = Math.max(ms(g.start), from);
    const b = ms(g.end);
    const push = (x: number, y: number) => {
      if (minutes(x, y) >= TIMEBOX_MIN) out.push({ start: sameZone(x, g.start), end: sameZone(y, g.end), minutes: minutes(x, y) });
    };
    for (const [s, e] of busy) {
      if (e <= a || s >= b) continue;
      if (s > a) push(a, s);
      a = Math.max(a, e);
    }
    if (b > a) push(a, b);
  }
  return out;
}

/** The block's meetings, personal events, unavailable time and timeboxes in time order, with the free gaps between. */
export function agendaOf(slot: Slot, timeboxes: readonly AgendaTimebox[], now?: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  const [a, b] = [ms(slot.start), ms(slot.end)];
  for (const p of slot.events) {
    if (p.event.allDay || ms(p.clipEnd) <= a || ms(p.clipStart) >= b) continue;
    const kind: AgendaKind = p.event.unavailable ? "unavailable" : p.event.isPersonal ? "personal" : "meeting";
    const free = p.event.showAs === "free" || p.event.showAs === "workingElsewhere";
    items.push({ kind, start: p.clipStart, end: p.clipEnd, minutes: minutes(ms(p.clipStart), ms(p.clipEnd)), title: p.event.title, eventId: p.event.id, ...(p.event.showAs ? { showAs: p.event.showAs } : {}), ...(free ? { free: true } : {}) });
  }
  for (const t of live(slot, timeboxes)) items.push({ kind: "timebox", start: t.start, end: t.end, minutes: minutes(ms(t.start), ms(t.end)), title: t.title, timeboxId: t.id });
  for (const g of openGaps(slot, timeboxes, now)) items.push({ kind: "free", start: g.start, end: g.end, minutes: g.minutes, title: "Free" });
  const rank: Record<AgendaKind, number> = { free: 2, meeting: 0, personal: 0, unavailable: 0, timebox: 1 };
  return items.sort((a, b) => ms(a.start) - ms(b.start) || rank[a.kind] - rank[b.kind] || ms(a.end) - ms(b.end));
}

export type Placement = { start: string; end: string; minutes: number; trimmed: boolean };

/**
 * A pick of `want` minutes placed at the gap's start (to 5 minutes), trimmed to the gap but never below `min`
 * (its shortest useful time, D273; 15 minutes when not given). Null when the gap is shorter than that.
 */
export function placeInGap(gap: FreeGap, want: number, min = TIMEBOX_MIN): Placement | null {
  const step = TIMEBOX_STEP * 60_000;
  const a = Math.ceil(ms(gap.start) / step) * step;
  const b = ms(gap.end);
  const room = Math.floor(minutes(a, b) / TIMEBOX_STEP) * TIMEBOX_STEP;
  // TX-1: the smaller of what's wanted and the gap; a trimmed length lands on the 15 minute grid.
  const len = want <= room ? want : Math.floor(room / TIMEBOX_SNAP) * TIMEBOX_SNAP;
  if (len < Math.max(TIMEBOX_MIN, Math.min(min, want))) return null;
  return { start: sameZone(a, gap.start), end: sameZone(a + len * 60_000, gap.start), minutes: len, trimmed: len < want };
}

export type DayPlacement = Placement & { pickId: number; half: Half; title: string; clientKey: string };
export type Unplaced = { pickId: number; half: Half; title: string; size: Size | null; reason: string };

/** The shortest useful time per size (D273): Timebox my day never places a pick in less. */
export const DEFAULT_MIN_SIZES: Readonly<Record<Size, number>> = { XS: 15, S: 30, M: 60, L: 90 };

const SIZE_RANK: Record<Size, number> = { L: 0, M: 1, S: 2, XS: 3 };
const halfWord = (h: Half) => (h === "AM" ? "the morning" : h === "PM" ? "the afternoon" : "the evening");
const dur = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);

/**
 * "Timebox my day" (D246, TY-1 shows the result as placeholders on Today's timeline): every planned pick without a timebox, larger sizes first, then pick order (CF-1: no musts),
 * into its own block: the first gap that fits it whole, else the largest gap left of at least its shortest useful
 * time (trimmed down to no less than that, D273), else not placed.
 */
export function planMyDay(picks: readonly Pick[], blocks: Partial<Record<Half, Slot>>, timeboxes: readonly AgendaTimebox[], sizes: SizeScale, now?: string, minSizes: Readonly<Record<Size, number>> = DEFAULT_MIN_SIZES): { placed: DayPlacement[]; unplaced: Unplaced[] } {
  const boxed = new Set(timeboxes.filter((t) => !t.removedAt && t.pickId !== null).map((t) => t.pickId));
  const todo = picks
    .filter((p) => p.status === "planned" && !boxed.has(p.id) && blocks[p.half])
    .sort((a, b) => SIZE_RANK[namedSize(a.size, sizes)] - SIZE_RANK[namedSize(b.size, sizes)] || a.position - b.position || a.id - b.id);
  const gaps = new Map<Half, FreeGap[]>();
  for (const [h, s] of Object.entries(blocks) as [Half, Slot][]) gaps.set(h, openGaps(s, timeboxes, now));
  const placed: DayPlacement[] = [];
  const unplaced: Unplaced[] = [];
  for (const p of todo) {
    const list = gaps.get(p.half)!;
    // E2, SZ-1: an unsized pick takes the person's assumption (never left out for having no size).
    const want = pickNeed(p, sizes); // TX-1: what's left, not the full size. The timebox is the smaller of this and the gap.
    const min = Math.min(minSizes[namedSize(p.size, sizes)], want);
    let i = list.findIndex((g) => placeInGap(g, want, min)?.trimmed === false);
    if (i < 0) i = list.reduce((best, g, k) => (placeInGap(g, want, min) && (best < 0 || g.minutes > list[best]!.minutes) ? k : best), -1);
    const at = i >= 0 ? placeInGap(list[i]!, want, min) : null;
    if (!at) {
      unplaced.push({ pickId: p.id, half: p.half, title: p.title, size: p.size, reason: `No gap of ${dur(min)} or more left in ${halfWord(p.half)}` });
      continue;
    }
    placed.push({ ...at, pickId: p.id, half: p.half, title: p.title, clientKey: p.clientKey });
    const g = list[i]!;
    const rest = minutes(ms(at.end), ms(g.end));
    if (rest >= TIMEBOX_MIN) list[i] = { start: at.end, end: g.end, minutes: rest };
    else list.splice(i, 1);
  }
  return { placed, unplaced };
}

/** What didn't fit, said plainly (D274): "2 picks didn't fit: Export spec draft (M), Delay alerts (S)." */
export function didntFitText(picks: readonly { title: string; size: Size | null }[], sizes: SizeScale): string {
  if (!picks.length) return "";
  return `${picks.length} ${picks.length === 1 ? "to-do" : "to-dos"} didn't fit: ${picks.map((p) => `${p.title} (${p.size ?? `not sized, ${unsizedText(sizes)}`})`).join(", ")}.`;
}
