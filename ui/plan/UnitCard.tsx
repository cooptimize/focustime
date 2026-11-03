// U6: a planning unit, a block (Plan the day) or a client (Plan the week). Open, it is a card: a 4 px edge in the
// client's color, the name, a muted detail and the fit words on the right (amber when over, muted when it fits,
// green when all is planned), an optional muted line, then its sections. Collapsed, it is one line on the same column
// grid on both screens: swatch and name · detail · fit · Open.
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";

/** How the fit words read: amber when over, muted when it fits, green when all is planned. */
export type FitTone = "over" | "fits" | "all" | "none";

type CardProps = {
  className?: string | undefined;
  color: string;
  label: string;
  name: ReactNode;
  detail?: ReactNode | undefined;
  fit?: ReactNode | undefined;
  tone?: FitTone | undefined;
  /** Extra classes on the fit words (Plan the day keeps its kinds). */
  fitClass?: string | undefined;
  sub?: ReactNode | undefined;
  children?: ReactNode | undefined;
  headClass?: string | undefined;
  onClick?: ((e: MouseEvent) => unknown) | undefined;
  onDragOver?: ((e: DragEvent) => unknown) | undefined;
  onDragLeave?: ((e: DragEvent) => unknown) | undefined;
  onDrop?: ((e: DragEvent) => unknown) | undefined;
};

export function UnitCard({ className = "", color, label, name, detail, fit, tone = "fits", fitClass = "", sub, children, headClass = "", onClick, onDragOver, onDragLeave, onDrop }: CardProps) {
  return (
    <section className={`pl-unit ${className}`} data-plan="unit" style={{ "--c": color } as CSSProperties} aria-label={label} onClick={onClick} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className={`pl-unit-head ${headClass}`}>
        <span className="pl-unit-name">{name}</span>
        {detail != null && detail !== "" && <span className="pl-unit-detail">{detail}</span>}
        <span className="pl-spacer" />
        {fit != null && fit !== "" && <span className={`pl-fit ${tone} ${fitClass}`}>{fit}</span>}
      </header>
      {sub != null && sub !== "" && <p className="pl-unit-sub">{sub}</p>}
      {children}
    </section>
  );
}

/** A section label inside a card or the right pane: MUST, NICE TO HAVE, AGENDA, FROM DEVOPS. */
export function PlanLabel({ children, className = "" }: { children: ReactNode; className?: string | undefined }) {
  return <h4 className={`pl-label ${className}`}>{children}</h4>;
}

type LineProps = { className?: string | undefined; color: string; name: string; detail: ReactNode; fit: ReactNode; tone?: FitTone | undefined; open?: boolean | undefined; onOpen: () => void; openLabel?: string | undefined; label?: string | undefined };

/** A collapsed unit: one line, swatch and name · detail · fit · Open ("Planning" while it is the open one). */
export function UnitLine({ className = "", color, name, detail, fit, tone = "fits", open = false, onOpen, openLabel = "Open", label }: LineProps) {
  return (
    <li className={`pl-line${open ? " open" : ""} ${className}`} data-plan="line" style={{ "--c": color } as CSSProperties} aria-label={label ?? name} aria-current={open ? "true" : undefined}>
      <button type="button" className="pl-line-name" onClick={onOpen} aria-expanded={open}>
        <span className="swatch" aria-hidden="true" />
        <span className="pl-line-text">{name}</span>
      </button>
      <span className="pl-line-detail">{detail}</span>
      <span className={`pl-fit ${tone}`}>{fit}</span>
      {open ? <span className="pl-line-open on">Planning</span> : <button type="button" className="link-btn pl-line-open" onClick={onOpen}>{openLabel}</button>}
    </li>
  );
}
