// U6 (D409): the one planning layout, shared by Today › Plan (Plan the day) and Week › Plan the week. Two panes: the
// work on the left (it scrolls), "Add to <client>" pinned on the right with its own scroll and the type box at its
// foot; 420 px at 1920, 520 px at 3840, one column under 1200 px with the right pane below the left.
import type { KeyboardEvent, ReactNode, Ref } from "react";

type Props = {
  /** Plan the week is the page's main; Plan the day sits inside Today. */
  as?: "main" | "section" | undefined;
  className?: string | undefined;
  label: string;
  header: ReactNode;
  /** Lines between the header and the panes (offers, errors). */
  notices?: ReactNode | undefined;
  left: ReactNode;
  leftClass?: string | undefined;
  leftLabel?: string | undefined;
  /** The right pane (an AddPane); none makes one column. */
  right?: ReactNode | undefined;
  /** Anything outside the panes (a drop strip, a dialog, a detail panel). */
  after?: ReactNode | undefined;
  frameRef?: Ref<HTMLElement> | undefined;
  onKeyDown?: ((e: KeyboardEvent) => void) | undefined;
};

export function PlanFrame({ as = "section", className = "", label, header, notices, left, leftClass = "", leftLabel, right, after, frameRef, onKeyDown }: Props) {
  const body = (
    <>
      {header}
      {notices}
      <div className={`pl-panes${right ? "" : " single"}`}>
        <div className={`pl-left ${leftClass}`} aria-label={leftLabel}>
          {left}
        </div>
        {right}
      </div>
      {after}
    </>
  );
  const cls = `pl-frame ${className}`;
  return as === "main" ? (
    <main ref={frameRef as Ref<HTMLElement>} className={cls} data-plan="frame" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
      {body}
    </main>
  ) : (
    <section ref={frameRef as Ref<HTMLElement>} className={cls} data-plan="frame" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
      {body}
    </section>
  );
}
