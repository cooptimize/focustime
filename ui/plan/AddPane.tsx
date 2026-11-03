// U6: the right pane on both planning screens: "Add to <client>" in its color with a muted count, an optional search,
// the sections (THIS WEEK'S MUSTS or FROM DEVOPS first, then "▸ More from <client>'s DevOps · N" in DevOps order, open on its own when nothing is above it), and the type
// box pinned at the bottom with its one-line hint.
import type { CSSProperties, ReactNode } from "react";

type Props = {
  className?: string | undefined;
  color: string;
  /** The client's name (in its color), or a fallback like "this block". */
  client: ReactNode;
  /** After the client's name ("morning"). */
  suffix?: ReactNode | undefined;
  count?: ReactNode | undefined;
  titleClass?: string | undefined;
  /** Between the title and the sections: a client chooser, the search box. */
  top?: ReactNode | undefined;
  children: ReactNode;
  scrollClass?: string | undefined;
  /** The type box and its hint, pinned at the bottom. */
  box?: ReactNode | undefined;
  label?: string | undefined;
};

export function AddPane({ className = "", color, client, suffix, count, titleClass = "", top, children, scrollClass = "", box, label = "Add work" }: Props) {
  return (
    <div className={`pl-add ${className}`} data-plan="add" style={{ "--c": color } as CSSProperties} aria-label={label}>
      <h3 className={`pl-add-title ${titleClass}`}>
        Add to <span className="pl-add-client">{client}</span>
        {suffix != null && <> {suffix}</>}
        {count != null && count !== "" && <span className="pl-add-count"> · {count}</span>}
      </h3>
      {top}
      <div className={`pl-add-scroll ${scrollClass}`}>{children}</div>
      {box && <div className="pl-add-box">{box}</div>}
    </div>
  );
}

/** A section in the right pane with its uppercase label. */
export function AddSection({ label, title, children, className = "" }: { label: string; title?: ReactNode | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={`pl-sec ${className}`} aria-label={label}>
      {title !== null && <h4 className="pl-label">{title ?? label}</h4>}
      {children}
    </section>
  );
}

/** The type box's one-line hint. */
export function BoxHint({ children, className = "" }: { children: ReactNode; className?: string | undefined }) {
  return <p className={`pl-hint ${className}`}>{children}</p>;
}
