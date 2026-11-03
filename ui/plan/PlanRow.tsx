// U6: the one planning row, on both screens: a drag handle, the title (a link when it has a DevOps id), badges, then
// on the right the size chip (a pick) or "1 block" with a stepper on hover (a week item), and ⋯ on hover. Same height,
// hover and selection colors everywhere. PickRow's "plan" density and Plan the week's rows are built on it.
import type { HTMLAttributes, ReactNode } from "react";

type Props = Omit<HTMLAttributes<HTMLLIElement>, "title"> & {
  className?: string | undefined;
  /** The handle's mark: ⋮⋮, or ✓ when done; null for none (a nested row, a past week). */
  handle?: ReactNode | undefined;
  handleTitle?: string | undefined;
  title: ReactNode;
  /** Hover text for the title (the full title). */
  titleText?: string | undefined;
  /** Badges after the title (Needs stories, a due badge, "not in DevOps"). */
  badges?: ReactNode | undefined;
  /** Always shown on the right (the size chip, the blocks chip, a time). */
  right?: ReactNode | undefined;
  /** Shown on hover or focus (+ time, the stepper, ⋯). */
  hover?: ReactNode | undefined;
  /** Lines under the row (nested stories, a fill line). */
  children?: ReactNode | undefined;
  "data-pick"?: number | undefined;
};

export function PlanRow({ className = "", handle = "⋮⋮", handleTitle, title, titleText, badges, right, hover, children, ...li }: Props) {
  return (
    <li {...li} className={`pl-row ${className}`} data-plan="row">
      {handle !== null && (
        <span className="pl-handle pr-handle" aria-hidden="true" title={handleTitle}>
          {handle}
        </span>
      )}
      <span className="pl-title pr-title" title={titleText}>
        {title}
      </span>
      {badges}
      {right}
      {hover != null && <span className="pl-hover pr-hover">{hover}</span>}
      {children}
    </li>
  );
}
