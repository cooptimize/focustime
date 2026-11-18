// DY-1: what a folded block on Day shows in its one line (the Timeline and the cards): done, not done (in the late
// color once the block has ended), the number of meetings, and the mark of any call still to review, which opens the
// call. And the arrow that folds or unfolds a block by hand.
import { foldCounts, foldWords } from "../plan/day-fold.ts";
import type { Pick } from "../plan/types.ts";
import type { Half, Slot } from "../week/types.ts";
import { Icon } from "./icons.tsx";
import { CallMarkButton } from "./meetings/CallMark.tsx";
import { useBlockCalls } from "./meetings/calls.ts";
import type { DayFold } from "./dayFold.tsx";

export function FoldArrow({ fold, half, name, folded, tabIndex }: { fold: DayFold; half: Half; name: string; folded: boolean; tabIndex?: number }) {
  return (
    <button
      type="button"
      className="day-fold-arrow"
      aria-expanded={!folded}
      aria-label={`${folded ? "Unfold" : "Fold"} ${name}`}
      title={folded ? "Unfold this block" : "Fold this block to one line"}
      {...(tabIndex !== undefined ? { tabIndex } : {})}
      onClick={(e) => (e.stopPropagation(), fold.toggle(half))}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Icon name={folded ? "closed" : "open"} />
    </button>
  );
}

export function FoldSummary({ slot, picks, ended, tabIndex }: { slot: Slot; picks: readonly Pick[]; ended: boolean; tabIndex?: number }) {
  const c = foldCounts(picks, slot.half, slot.events);
  const w = foldWords(c);
  const toReview = useBlockCalls(slot).needs;
  return (
    <span className="day-fold-sum">
      {w.done && <span className="dfs-done">{w.done}</span>}
      {w.notDone && <span className={`dfs-left${ended ? " late" : ""}`}>{w.notDone}</span>}
      {w.meetings && <span className="dfs-meetings">{w.meetings}</span>}
      {toReview.map((m) => (
        <CallMarkButton key={m.occurrenceId} call={m} {...(tabIndex !== undefined ? { tabIndex } : {})} />
      ))}
    </span>
  );
}
