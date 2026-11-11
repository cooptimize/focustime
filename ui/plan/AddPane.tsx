// U6, WD-1: a section of the block panel with its uppercase label, and the type box's one-line hint.
import type { ReactNode } from "react";

/** A section in the right pane with its uppercase label. */
export function AddSection({ label, title, children, className = "", tour }: { label: string; title?: ReactNode | undefined; children: ReactNode; className?: string | undefined; /** WD-1: a Guide tour's hook. */ tour?: string | undefined }) {
  return (
    <section className={`pl-sec ${className}`} aria-label={label} data-tour={tour}>
      {title !== null && <h4 className="pl-label">{title ?? label}</h4>}
      {children}
    </section>
  );
}

/** The type box's one-line hint. */
export function BoxHint({ children, className = "" }: { children: ReactNode; className?: string | undefined }) {
  return <p className={`pl-hint ${className}`}>{children}</p>;
}
