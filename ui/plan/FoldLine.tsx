// U6: the one fold control, "▸ Label · count", on both planning screens (Nice to have, Everything else, Agenda).
import type { ReactNode } from "react";

export function FoldLine({ open, onToggle, label, count, className = "", title }: { open: boolean; onToggle: () => void; label: ReactNode; count?: ReactNode | undefined; className?: string | undefined; title?: string | undefined }) {
  return (
    <button type="button" className={`pl-fold ${className}`} aria-expanded={open} title={title} onClick={(e) => (e.stopPropagation(), onToggle())}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span> {label}
      {count != null && count !== "" && <> · {count}</>}
    </button>
  );
}
