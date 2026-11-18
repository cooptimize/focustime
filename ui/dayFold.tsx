// DY-1: Day's folds, for the Timeline and the cards. Day decides (plan/day-fold.ts) and hands each block what it needs
// through DayFoldCtx; Week has no provider, so its cards never fold. Folds by hand are kept for today in this browser's
// storage and forgotten the next day; with storage refused they last for the visit. Nothing goes to the server.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { readHandFolds, writeHandFolds } from "../plan/day-fold.ts";
import type { Half } from "../week/types.ts";

const KEY = "focustime.dayFolds";

/** The folds made by hand on `today` (in memory when storage is refused). */
export function useHandFolds(today: string): { hand: Record<string, boolean>; set: (half: Half, folded: boolean) => void } {
  const memory = useRef<{ date: string; folds: Record<string, boolean> }>({ date: today, folds: {} });
  const read = useCallback((): Record<string, boolean> => {
    try {
      return readHandFolds(window.localStorage.getItem(KEY), today);
    } catch {
      return memory.current.date === today ? memory.current.folds : {};
    }
  }, [today]);
  const [hand, setHand] = useState<Record<string, boolean>>(read);
  useEffect(() => setHand(read()), [read]);
  const set = useCallback(
    (half: Half, folded: boolean) => {
      setHand((h) => {
        const next = { ...h, [half]: folded };
        memory.current = { date: today, folds: next };
        try {
          window.localStorage.setItem(KEY, writeHandFolds(today, next));
        } catch {
          // Storage refused: the fold lasts for this visit.
        }
        return next;
      });
    },
    [today],
  );
  return { hand, set };
}

export type DayFold = {
  /** Whether the block is drawn folded. */
  folded: (half: Half) => boolean;
  /** Whether the block shows the fold arrow (today's blocks in the ordinary view). */
  canFold: (half: Half) => boolean;
  /** Fold or unfold by hand. */
  toggle: (half: Half) => void;
  /** A drag passed over the block: it stays open until the drag ends. */
  dragOver: (half: Half) => void;
};

export const DayFoldCtx = createContext<DayFold | null>(null);
export const useDayFold = () => useContext(DayFoldCtx);

/**
 * Whether the person is in the block (`el`): keyboard focus in it, the pointer over it, or focus in a menu or dialog
 * (which lives outside the block and may have been opened from it). Read while the block is still drawn open, so a
 * fold never removes what they are on.
 */
export function personIn(el: Element | null): boolean {
  const a = document.activeElement;
  if (a && a !== document.body && a.closest("dialog[open], [popover], [role='dialog'], [role='menu'], [role='listbox']")) return true;
  return !!el && (el.contains(a) || el.matches(":hover"));
}
