// U6: the one fold control, "▸ Label · count", on both planning screens (Nice to have, More from <client>'s DevOps, Agenda).
import type { ReactNode } from "react";
import { Icon } from "../icons.tsx";

export function FoldLine({ open, onToggle, label, count, className = "", title, tabIndex }: { open: boolean; onToggle: () => void; label: ReactNode; count?: ReactNode | undefined; className?: string | undefined; title?: string | undefined; /** PS-1: a card's roving tab order (0 on the selected card, -1 elsewhere). */ tabIndex?: number | undefined }) {
  return (
    <button type="button" className={`pl-fold ${className}`} aria-expanded={open} title={title} tabIndex={tabIndex} onClick={(e) => (e.stopPropagation(), onToggle())}>
      <span aria-hidden="true"><Icon name={open ? "open" : "closed"} /></span> {label}
      {count != null && count !== "" && <> · {count}</>}
    </button>
  );
}
