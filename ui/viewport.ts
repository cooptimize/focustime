// Which week layout fits the window. Breakpoints come from what the content needs, not device names:
// - wide: each Mon–Thu column holds the 330 px rail plus an hour timeline wide enough to read
//   an event's time and title (300 px, of which 58 px are hour labels).
// - medium: the whole week as compact cards, from 1024 px (WK-1); the cards' tier comes from ui/weekfit.ts.
// - narrow: below that, one day at a time: rail plus timeline while they fit side by side, else the compact card.
import { useSyncExternalStore } from "react";

export type Layout = "wide" | "medium" | "narrow";

export const SIZES = {
  railPx: 330,
  minTimelinePx: 300,
  /** Side padding of the single-day view (2 × 16 px). */
  dayChromePx: 32,
  /** Grid gaps (4 of 14 px) plus side padding (2 × 24 px). */
  chromePx: 4 * 14 + 2 * 24,
  /** Mon–Thu take one share each, Friday (overflow) 0.6. */
  shares: 4.6,
} as const;

/** The narrowest window, in CSS px, at which each layout still fits. */
export const MIN_WIDTH = {
  wide: Math.ceil((SIZES.railPx + SIZES.minTimelinePx) * SIZES.shares + SIZES.chromePx),
  /** WK-1: the whole week from 1024 px; the Board picks its tier (and folds days) from the grid's real width (weekfit.ts). */
  medium: 1024,
  /** One day with the rail beside its timeline. */
  dayTimeline: SIZES.railPx + SIZES.minTimelinePx + SIZES.dayChromePx,
} as const;

export function chooseLayout(widthPx: number): Layout {
  if (widthPx >= MIN_WIDTH.wide) return "wide";
  if (widthPx >= MIN_WIDTH.medium) return "medium";
  return "narrow";
}

/** In the narrow layout, whether the day uses compact cards instead of rail plus timeline. */
export const narrowCompact = (widthPx: number) => widthPx < MIN_WIDTH.dayTimeline;

const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

/** The current layout; re-renders live when the window is resized across a breakpoint. */
export function useLayout(): { layout: Layout; compact: boolean } {
  const key = useSyncExternalStore(subscribe, () => {
    const w = window.innerWidth;
    const layout = chooseLayout(w);
    return `${layout}:${layout === "medium" || (layout === "narrow" && narrowCompact(w))}`;
  });
  const [layout, compact] = key.split(":") as [Layout, string];
  return { layout, compact: compact === "true" };
}

/**
 * P1 (phone): under 600 CSS px wide, FocusTime is a phone app for checking and doing, not planning (bottom bar, one
 * day at a time, planning read-only). The same width as the CSS breakpoint `@media (max-width: 599.98px)`.
 */
export const PHONE_MAX_PX = 600;
export const isPhoneWidth = (widthPx: number) => widthPx < PHONE_MAX_PX;

/** Whether the window is phone width; re-renders live when it crosses the breakpoint. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => isPhoneWidth(window.innerWidth), () => false);
}
