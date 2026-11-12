// WK-1: how Week's Board fits the space it has, from the grid's real width (its content box, after the detail panel's
// space and the gaps) divided by the text scale, so Larger text reaches the smaller tiers sooner. Each card renders
// exactly its tier's element:
// - rail   (≥ 320): the time rail with titles (186 px, 140 on a narrower card)
// - ruler  (250 to 320): a slim ruler, hour ticks and event bars, no titles
// - strip  (170 to 250): no rail; a thin day strip under the card header (busy, free, the now tick)
// - mini   (130 to 170): the strip, the header stacked, the status pill without its reason
// WK-2: each open column takes the tier of its own width.
// WK-5 (replaces WK-1's fold window around the selection): the day in focus takes twice a working day's share, and
// when the grid can't give every shown day its narrowest readable width (MIN_PX, measured: the client name whole or
// cut cleanly, the hours on one line, a to-do's title at least about twelve characters), days fold to a narrow strip
// in a fixed order (plan/weekdays.ts `foldOrder`: weekend days, the catch-up day, past days farthest from the focus
// day, then future days farthest from it). The focus day never folds. Every layout but the one-day ones uses it.

export type Tier = "rail" | "ruler" | "strip" | "mini";

/** The narrowest column, in CSS px at Default text, for each tier. */
export const TIER_MIN: Readonly<Record<Tier, number>> = { rail: 320, ruler: 250, strip: 170, mini: 130 };

/** A folded day's strip, in CSS px at Default text. */
export const FOLD_PX = 44;

/** WK-5: the day in focus, against a working day's 1. */
export const FOCUS_SHARE = 2;

/**
 * WK-5: each card form's narrowest readable width, in CSS px at Default text (scaled with the text), measured in the
 * demo (`e2e/wk5.test.ts` checks them): a working day's card (checkbox, type icon and about twelve characters of a
 * title; the client name cut cleanly with "…"; "12:30–5:00" whole on its own line), the catch-up day ("Catch-up" whole
 * and a to-do's title), a weekend day (its plain list) and a PTO or holiday day (its one word, the name wrapping).
 */
export const MIN_PX: Readonly<Record<"work" | "overflow" | "weekend" | "pto", number>> = { work: 156, overflow: 136, weekend: 128, pto: 96 };

/** The tier for a column this wide, or "fold" when not even mini fits. */
export function tierFor(colPx: number, scale = 1): Tier | "fold" {
  const w = colPx / scale;
  if (w >= TIER_MIN.rail) return "rail";
  if (w >= TIER_MIN.ruler) return "ruler";
  if (w >= TIER_MIN.strip) return "strip";
  if (w >= TIER_MIN.mini) return "mini";
  return "fold";
}

export type FitDay = { kind: string; pto?: unknown };

export type Fit = {
  /** The focus day's tier (or a working day's with none): the grid's class. */
  tier: Tier;
  /** Per day: open (a normal column) or folded to a strip. */
  open: boolean[];
  /** The width of one working day's share, in CSS px. */
  col: number;
  /** Per day, its column's width in CSS px (a folded day's strip). */
  widths: number[];
  /** grid-template-columns. */
  tracks: string;
  /** The rail tier's rail width for a working day. */
  railPx: number;
  /** WK-2: per day, the tier and rail width from that column's own width. */
  days: { tier: Tier; railPx: number }[];
};

const railWidth = (col: number, scale: number) => Math.round(Math.min(186, Math.max(140, col - 200 * scale)));

/** A day's kind for its minimum width. */
export const minKind = (d: FitDay): keyof typeof MIN_PX => (d.pto ? "pto" : d.kind === "overflow" ? "overflow" : d.kind === "weekend" ? "weekend" : "work");

/**
 * A day's share of the row: working days 1, Friday and PTO days 0.6, weekend days 0.4 (WK-3), the day in focus 2
 * (WK-5: about twice a working day, whatever its kind).
 */
export function dayShare(day: FitDay, focus: boolean): number {
  if (focus) return FOCUS_SHARE;
  if (day.kind === "weekend") return 0.4;
  return day.kind === "work" && !day.pto ? 1 : 0.6;
}

/**
 * @param contentPx the grid's content width (no padding)
 * @param gapPx the column gap
 * @param days the days shown, in order
 * @param focus the day in focus (an index into `days`), or -1
 * @param order the order days fold in (indices into `days`; the focus day is never in it)
 */
export function weekFit({ contentPx, gapPx, scale = 1, days, focus, order }: { contentPx: number; gapPx: number; scale?: number; days: readonly FitDay[]; focus: number; order: readonly number[] }): Fit {
  const n = days.length;
  const shares = days.map((d, i) => dayShare(d, i === focus));
  // A day's narrowest readable width; the focus day's is twice a working day's, so it stays the widest column.
  const mins = days.map((d, i) => (i === focus ? Math.max(MIN_PX[minKind(d)], FOCUS_SHARE * MIN_PX.work) : MIN_PX[minKind(d)]) * scale);
  const strip = FOLD_PX * scale;
  const open = days.map(() => true);
  const free = Math.max(0, contentPx - gapPx * Math.max(0, n - 1));
  const room = () => free - strip * open.filter((o) => !o).length;
  // Fold before squeeze: while the open days' narrowest widths don't fit, the next day in the order folds.
  for (const next of order) {
    if (days.reduce((a, _, i) => a + (open[i] ? mins[i]! : 0), 0) <= room() + 0.5) break;
    if (next === focus || !open[next]) continue;
    open[next] = false;
  }
  // Everything that may fold has: the focus day takes what is left (never below its own kind's minimum).
  const others = days.reduce((a, _, i) => a + (open[i] && i !== focus ? mins[i]! : 0), 0);
  if (focus >= 0 && others + mins[focus]! > room()) mins[focus] = Math.max(MIN_PX[minKind(days[focus]!)] * scale, room() - others);
  // The room goes by shares, but no open day below its narrowest width: those take their minimum and the rest share
  // what is left (repeated until none is under).
  const widths = days.map((_, i) => (open[i] ? 0 : strip));
  const pinned = new Set<number>();
  for (let pass = 0; pass <= n; pass++) {
    const pool = days.map((_, i) => i).filter((i) => open[i] && !pinned.has(i));
    const left = Math.max(0, room() - [...pinned].reduce((a, i) => a + mins[i]!, 0));
    const unit = left / Math.max(0.0001, pool.reduce((a, i) => a + shares[i]!, 0));
    const under = pool.filter((i) => shares[i]! * unit < mins[i]! - 0.5);
    for (const i of pool) widths[i] = shares[i]! * unit;
    for (const i of pinned) widths[i] = mins[i]!;
    if (!under.length) break;
    for (const i of under) pinned.add(i);
  }
  const unit = Math.max(...days.map((d, i) => (open[i] && i !== focus && d.kind === "work" && !d.pto ? widths[i]! : 0)), 0) || (focus >= 0 ? widths[focus]! / FOCUS_SHARE : 0);
  const own = (w: number): Tier => {
    const t = tierFor(w, scale);
    return t === "fold" ? "mini" : t;
  };
  const perDay = widths.map((w) => ({ tier: own(w), railPx: railWidth(w, scale) }));
  const lead = focus >= 0 ? focus : Math.max(0, days.findIndex((d, i) => open[i] && d.kind === "work"));
  const track = (s: number) => `minmax(0, ${s}fr)`;
  return {
    tier: perDay[lead]?.tier ?? "mini",
    open,
    col: unit,
    widths,
    tracks: widths.map((w, i) => (open[i] ? track(Math.round(w * 10) / 10) : `${Math.round(strip)}px`)).join(" "),
    railPx: railWidth(unit, scale),
    days: perDay,
  };
}
