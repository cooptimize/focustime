// ST-1: the panel shell for full-page panels over a place (Settings now; the Guide can reuse it, UI-5). One header with
// the page's title, Back at the top left only on a sub-page, and UI-3's × at the top right; a left rail of grouped
// items with an optional slot above them (search); a body that scrolls on its own. Esc closes (after the rail slot's own
// Esc, e.g. clearing a search), focus starts on the title and goes back to what opened the panel when it closes.
// On a phone the rail is its own list page (current = null) and each item opens as a page with Back and ×.
// docs/settings.md has how to use it.
import { useEffect, useRef, type ReactNode } from "react";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";

export type RailItem = { id: string; label: string; href: string; hint?: ReactNode };
export type RailGroup = { id: string; label: string; items: readonly RailItem[] };

export type PanelShellProps = {
  /** The panel's name ("Settings"): the landmark's label and the phone list's title. */
  name: string;
  groups: readonly RailGroup[];
  /** The open item; null is the phone's list page (a big screen always has one open). */
  current: string | null;
  /** The rail item to mark as current (a sub-page marks its parent). */
  railCurrent?: string | null;
  onPick: (id: string) => void;
  /** × and Esc. The panel runs it; a caller with unsaved fields flushes them first. */
  onClose: () => void;
  /** Back at the top left: a sub-page's parent, or the list on a phone. */
  onBack?: (() => void) | null;
  backLabel?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Above the rail's items (search). */
  railTop?: ReactNode;
  /** In place of the rail's items while it has something (search results). */
  railOverride?: ReactNode;
  /** Under the rail's items, after a rule (another group, like Admin). */
  railFoot?: ReactNode;
  phone: boolean;
  /** A key that changes when the page changes: the body scrolls to its top and the title takes focus. */
  pageKey: string;
  /** Extra class on the root. */
  className?: string;
  children?: ReactNode;
};

/** Escape handled by the shell: only when no dialog or menu sits over it. */
const overShell = (shell: HTMLElement | null) => {
  const top = document.querySelector('[data-overlay="modal"], [data-overlay="details"], [data-menu]');
  return !!top && !shell?.contains(top);
};

export function PanelShell(p: PanelShellProps) {
  useReturnFocus();
  const root = useRef<HTMLElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || overShell(root.current)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    // Capture: before the window's own Esc (which would leave without the panel's flush).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
    root.current?.scrollTo?.({ top: 0 });
    head.current?.focus({ preventScroll: true });
  }, [p.pageKey]);
  const marked = p.railCurrent === undefined ? p.current : p.railCurrent;

  const rail = (
    <div className="ps-rail" role="navigation" aria-label={`${p.name} sections`}>
      {p.railTop}
      {p.railOverride ??
        p.groups.map((g) => (
          <div key={g.id} className="ps-group" role="group" aria-labelledby={`ps-g-${g.id}`}>
            <div className="ps-group-head" id={`ps-g-${g.id}`}>
              {g.label}
            </div>
            {g.items.map((it) => (
              <a
                key={it.id}
                href={it.href}
                data-settings-section={it.id}
                className="ps-item"
                aria-current={marked === it.id ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  p.onPick(it.id);
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="ps-hint">{it.hint}</span>}
                {p.phone && <span className="ps-chev" aria-hidden="true">›</span>}
              </a>
            ))}
          </div>
        ))}
      {!p.railOverride && p.railFoot}
    </div>
  );

  const header = (
    <header className="ps-head">
      {p.onBack ? (
        <button type="button" className="ps-back" onClick={p.onBack}>
          <span aria-hidden="true">‹</span> {p.backLabel ?? "Back"}
        </button>
      ) : null}
      <div className="ps-titles">
        <h2 ref={head} tabIndex={-1}>
          {p.current === null ? p.name : p.title}
        </h2>
        {p.current !== null && p.description && <p className="ps-desc">{p.description}</p>}
      </div>
      <CloseButton onClose={p.onClose} />
    </header>
  );

  if (p.phone)
    return (
      <main ref={root} className={`panel-shell phone ${p.className ?? ""}`} aria-label={p.name} data-overlay="page">
        {header}
        {p.current === null ? rail : <div className="ps-body" ref={body}>{p.children}</div>}
      </main>
    );
  return (
    <main ref={root} className={`panel-shell ${p.className ?? ""}`} aria-label={p.name} data-overlay="page">
      <aside className="ps-side">
        <div className="ps-name">{p.name}</div>
        {rail}
      </aside>
      <section className="ps-main">
        {header}
        <div className="ps-body" ref={body}>
          {p.children}
        </div>
      </section>
    </main>
  );
}
