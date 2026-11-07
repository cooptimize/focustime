// UI-5: the Guide's layout, Settings-like: a title, a left rail of sections (a picker on a phone or narrow window),
// Back, the UI-3 close, Esc, and focus on the section's title. ST-1 is building one shared panel shell with exactly
// these parts (title, Back, X, left rail, Esc, focus); this frame's props are that shell's, so once ST-1 merges the
// Guide swaps this file's body for it and nothing else changes. Until then it borrows Settings' rail styles.
import { useEffect, useRef, type ReactNode } from "react";
import { CloseButton, useReturnFocus } from "../CloseButton.tsx";
import { WeekMark } from "../brand/Brand.tsx";
import { useNarrow } from "../settings/SideMenu.tsx";

export type RailItem = { id: string; label: string; group: string };

export function GuideFrame(p: {
  title: string;
  rail: readonly RailItem[];
  /** Group names in rail order. */
  groups: Readonly<Record<string, string>>;
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** The close's words: Back in the app, Back to sign in signed out. */
  closeLabel: string;
  standalone: boolean;
  children: ReactNode;
}) {
  useReturnFocus();
  const narrow = useNarrow();
  const body = useRef<HTMLElement>(null);
  // A new section starts at its top with focus on its title (screen readers read it).
  useEffect(() => {
    body.current?.closest(".guide")?.scrollTo?.({ top: 0 });
    body.current?.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
  }, [p.current]);
  const groups = Object.keys(p.groups).filter((g) => p.rail.some((r) => r.group === g));
  return (
    <main
      className={`guide gf${p.standalone ? " standalone" : ""}${narrow ? " narrow" : ""}`}
      aria-label={p.title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && p.standalone) (e.preventDefault(), p.onClose());
      }}
    >
      {/* One sticky bar: the brand (or, narrow, the section picker) and the close. */}
      <header className="gf-top">
        {narrow ? (
          <div className="set-picker gf-picker">
            <label>
              <span className="sr-only">Guide section</span>
              <select aria-label="Guide section" value={p.current} onChange={(e) => p.onPick(e.target.value)}>
                {groups.map((g) => (
                  <optgroup key={g} label={p.groups[g]}>
                    {p.rail.filter((r) => r.group === g).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="guide-brand">
            <WeekMark height={16} />
            FocusTime <span className="muted">{p.title}</span>
          </div>
        )}
        <span className="gf-spacer" />
        {p.standalone ? (
          <button type="button" className="quiet guide-close" onClick={p.onClose} title={`${p.closeLabel} (Esc)`}>
            {p.closeLabel}
          </button>
        ) : (
          <CloseButton onClose={p.onClose} />
        )}
      </header>
      <div className="gf-main">
        {narrow ? null : (
          <div className="set-side gf-rail" role="region" aria-label="Guide sections">
            {groups.map((g) => (
              <nav key={g} className="gf-group" aria-label={p.groups[g]}>
                <div className="gf-group-head">{p.groups[g]}</div>
                {p.rail.filter((r) => r.group === g).map((r) => (
                  <button key={r.id} type="button" className="set-tab" aria-current={p.current === r.id ? "page" : undefined} onClick={() => p.onPick(r.id)}>
                    {r.label}
                  </button>
                ))}
              </nav>
            ))}
            <button type="button" className="set-tab close" onClick={p.onClose} title={`${p.closeLabel} (Esc)`}>
              Back
            </button>
          </div>
        )}
        <section ref={body} className="gf-body" aria-live="off">
          {p.children}
        </section>
      </div>
    </main>
  );
}
