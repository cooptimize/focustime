// U6: the planning header, in one order on both screens: ‹ › · title · muted summary · spacer · secondary action ·
// ⋯ · the mode area (green Done, then the mode switch).
import type { MouseEvent, ReactNode, Ref } from "react";

type Props = {
  step?: { prev: () => void; next: () => void; prevLabel: string; nextLabel: string; label?: string | undefined; className?: string | undefined } | undefined;
  title: ReactNode;
  titleRef?: Ref<HTMLHeadingElement> | undefined;
  /** After the title ("Next workday", "Past"). */
  badge?: ReactNode | undefined;
  summary?: ReactNode | undefined;
  summaryClass?: string | undefined;
  /** One secondary action (Timebox my day; DevOps health · N). */
  secondary?: ReactNode | undefined;
  more?: { label: string; onClick: (e: MouseEvent) => void } | undefined;
  /** The ModeArea: Done and the mode switch. */
  mode: ReactNode;
  className?: string | undefined;
  titleClass?: string | undefined;
};

export function PlanHeader({ step, title, titleRef, badge, summary, summaryClass = "", secondary, more, mode, className = "", titleClass = "" }: Props) {
  return (
    <header className={`pl-head ${className}`} data-plan="header">
      <div className={`pl-titlewrap ${titleClass}`}>
        {step && (
          <span className={`pl-step ${step.className ?? ""}`} role="group" aria-label={step.label}>
            <button type="button" onClick={step.prev} aria-label={step.prevLabel} title={step.prevLabel}>‹</button>
            <button type="button" onClick={step.next} aria-label={step.nextLabel} title={step.nextLabel}>›</button>
          </span>
        )}
        <h2 ref={titleRef} className="pl-heading" tabIndex={-1}>
          {title}
          {badge}
        </h2>
        {summary != null && <p className={`pl-summary ${summaryClass}`}>{summary}</p>}
      </div>
      <span className="pl-spacer" />
      {secondary && <span className="pl-secondary">{secondary}</span>}
      {more && (
        <button type="button" className="more pl-more" aria-label={more.label} title={more.label} onClick={more.onClick}>
          ⋯
        </button>
      )}
      {mode}
    </header>
  );
}
