// DY-1: Day's folds, for the Timeline and the cards. Day decides (plan/day-fold.ts) and hands each block what it needs
// through DayFoldCtx; Week has no provider, so its cards never fold. Folds by hand are kept for today in this browser's
// storage and forgotten the next day; with storage refused they last for the visit. Nothing goes to the server.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  /** The person is in the block as it would fold by itself: it waits until they leave. */
  hold: (half: Half, inside: boolean) => void;
  /** Whether the block would fold by itself now (for holding it while the person is in it). */
  wants: (half: Half) => boolean;
};

export const DayFoldCtx = createContext<DayFold | null>(null);
export const useDayFold = () => useContext(DayFoldCtx);

/**
 * Holds a block open while the person is in it (focus or the pointer inside) at the moment it would fold by itself;
 * it folds once they leave.
 */
export function useHoldWhileInside(ref: RefObject<HTMLElement | null>, half: Half, fold: DayFold | null) {
  const wants = !!fold?.wants(half);
  const was = useRef(wants);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!fold || !el) return;
    if (wants && !was.current) {
      const inside = el.contains(document.activeElement) || el.matches(":hover");
      if (inside) fold.hold(half, true);
    }
    was.current = wants;
  });
  useEffect(() => {
    const el = ref.current;
    if (!fold || !el) return;
    const leave = () => {
      window.setTimeout(() => {
        if (!el.contains(document.activeElement) && !el.matches(":hover")) fold.hold(half, false);
      }, 0);
    };
    el.addEventListener("focusout", leave);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("focusout", leave);
      el.removeEventListener("pointerleave", leave);
    };
  }, [ref, half, fold]);
}
