// WK-1: how Week's Board fits the space it has. One tier for the whole grid, chosen from the real width of a Mon–Thu
// column (the grid's content box, after the detail panel's space and the gaps) divided by the text scale, so Larger
// text reaches the smaller tiers sooner. Each card renders exactly its tier's element:
// - rail   (≥ 320): the time rail with titles (186 px, 140 on a narrower card)
// - ruler  (250 to 320): a slim ruler, hour ticks and event bars, no titles
// - strip  (170 to 250): no rail; a thin day strip under the card header (busy, free, the now tick)
// - mini   (130 to 170): the strip, the header stacked, the status pill without its reason
// When even mini doesn't fit with all five days open, the week folds: the selected day and its neighbours stay open
// and the others become narrow strips (their AM and PM halves still drop targets).
// WK-2 (supersedes WK-1's single tier): the Mon–Thu tier still decides the fold, but each open column then takes the
// tier of its own width (its share of the row), so Friday, a PTO day and a folded week's open days drop to ruler,
// strip or mini on their own instead of drawing a rail they have no room for.

export type Tier = "rail" | "ruler" | "strip" | "mini";

/** The narrowest Mon–Thu column, in CSS px at Default text, for each tier. */
export const TIER_MIN: Readonly<Record<Tier, number>> = { rail: 320, ruler: 250, strip: 170, mini: 130 };

/** A folded day's strip, in CSS px at Default text. */
export const FOLD_PX = 44;

/** How many days stay open when the week folds (the selected day and its neighbours). */
export const FOLD_OPEN = 3;

/** The tier for a column this wide, or "fold" when not even mini fits. */
export function tierFor(colPx: number, scale = 1): Tier | "fold" {
  const w = colPx / scale;
  if (w >= TIER_MIN.rail) return "rail";
  if (w >= TIER_MIN.ruler) return "ruler";
  if (w >= TIER_MIN.strip) return "strip";
  if (w >= TIER_MIN.mini) return "mini";
  return "fold";
}

export type Fit = {
  tier: Tier;
  /** Per day: open (a normal column) or folded to a strip. */
  open: boolean[];
  /** The width of one Mon–Thu share, in CSS px. */
  col: number;
  /** grid-template-columns. */
  tracks: string;
  /** The rail tier's rail width: what the column leaves after about 200 px of text (scaled), 140 to 186 px. */
  railPx: number;
  /** WK-2: per day, the tier and rail width from that column's own width (a folded day keeps the working tier). */
  days: { tier: Tier; railPx: number }[];
};

const railWidth = (col: number, scale: number) => Math.round(Math.min(186, Math.max(140, col - 200 * scale)));

/**
 * @param contentPx the grid's content width (no padding)
 * @param gapPx the column gap
 * @param shares each day's share: 1 for a working day, 0.6 for Friday, a weekend day or PTO, more for the day being planned
 * @param selected the day that stays open (the selection, or the day being planned)
 */
export function weekFit({ contentPx, gapPx, scale = 1, shares, selected }: { contentPx: number; gapPx: number; scale?: number; shares: readonly number[]; selected: number }): Fit {
  const n = shares.length;
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const free = Math.max(0, contentPx - gapPx * Math.max(0, n - 1));
  const all = free / Math.max(0.0001, sum(shares));
  const t = tierFor(all, scale);
  const track = (s: number) => `minmax(0, ${s}fr)`;
  if (t !== "fold" || n <= 1) {
    const tier = t === "fold" ? "mini" : t;
    return { tier, open: shares.map(() => true), col: all, tracks: shares.map(track).join(" "), railPx: railWidth(all, scale), days: perDay(shares, all, scale, tier) };
  }

  // Fold: a window of FOLD_OPEN days around the selected one (kept inside the week), shrunk only while the open
  // columns are still under mini.
  const strip = FOLD_PX * scale;
  const sel = Math.max(0, Math.min(n - 1, selected));
  let size = Math.min(FOLD_OPEN, n);
  let open: boolean[] = [];
  let col = 0;
  for (; size >= 1; size--) {
    const start = Math.max(0, Math.min(sel - Math.floor((size - 1) / 2), n - size));
    open = shares.map((_, i) => i >= start && i < start + size);
    const openShares = sum(shares.filter((_, i) => open[i]));
    col = Math.max(0, free - strip * (n - size)) / Math.max(0.0001, openShares);
    if (tierFor(col, scale) !== "fold" || size === 1) break;
  }
  const t2 = tierFor(col, scale);
  const tier = t2 === "fold" ? "mini" : t2;
  return { tier, open, col, tracks: shares.map((s, i) => (open[i] ? track(s) : `${Math.round(strip)}px`)).join(" "), railPx: railWidth(col, scale), days: perDay(shares, col, scale, tier) };
}

/**
 * WK-2: each column's own tier, from its own width (its share of one Mon–Thu share), never a wider tier than the
 * working days' and never below mini (a column that open is still drawn as mini).
 */
function perDay(shares: readonly number[], col: number, scale: number, working: Tier): { tier: Tier; railPx: number }[] {
  const order: Tier[] = ["rail", "ruler", "strip", "mini"];
  return shares.map((s) => {
    const w = col * Math.min(1, s);
    const own = tierFor(w, scale);
    const t = own === "fold" ? "mini" : own;
    return { tier: order[Math.max(order.indexOf(t), order.indexOf(working))]!, railPx: railWidth(w, scale) };
  });
}

/** A day's share of the week: working days 1, Friday, weekend days and PTO days 0.6, the day being planned 2.6. */
export function dayShare(day: { kind: string; pto?: unknown }, planning: boolean): number {
  if (planning) return 2.6;
  return day.kind === "work" && !day.pto ? 1 : 0.6;
}
