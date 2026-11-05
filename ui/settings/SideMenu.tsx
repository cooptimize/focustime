// ADM-2 (D603): the Settings and Admin side menu. Pinned, it fills the height between the top bar and the status bar
// and scrolls on its own (wheel, trackpad, touch, keyboard), and the selected item scrolls into view on open, deep
// links included. Two groups, Settings and Admin (admins only), each foldable; the fold is remembered in this browser
// (try/catch: private windows and blocked storage just start unfolded). An Admin page always opens with Admin unfolded.
// Phone and narrow windows get one "Settings ▾" picker at the top instead of the column.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type MenuItem = readonly [id: string, label: string];
type Folds = { settings: boolean; admin: boolean };

const FOLD_KEY = "focustime.settingsMenu.folds";
/** Below this width the column becomes the picker (the same breakpoint as Settings' one-column layout). */
export const NARROW_MAX_PX = 900;

function readFolds(): Folds {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "null") as Partial<Folds> | null;
    return { settings: v?.settings === true, admin: v?.admin === true };
  } catch {
    return { settings: false, admin: false };
  }
}
function writeFolds(f: Folds) {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(f));
  } catch {
    // Storage blocked: the fold just isn't remembered.
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
/** Whether the window is narrower than the side column needs. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.innerWidth < NARROW_MAX_PX, () => false);
}

export function SideMenu(p: { settings: readonly MenuItem[]; admin: readonly MenuItem[] | null; current: string; onPick: (id: string) => void; onBack: () => void; narrow: boolean }) {
  const inAdmin = !!p.admin?.some(([id]) => id === p.current);
  const [folds, setFolds] = useState<Folds>(readFolds);
  // An Admin page opens with Admin unfolded; a Settings page with Settings unfolded.
  const shown: Folds = { settings: folds.settings && inAdmin, admin: folds.admin && !inAdmin };
  const toggle = (g: keyof Folds) => {
    const next = { ...folds, [g]: !shown[g] };
    setFolds(next);
    writeFolds(next);
  };
  const side = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The selected item in view on open and on every change (deep links land on items far down).
    const el = side.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [p.current, p.narrow]);

  if (p.narrow)
    return (
      <div className="set-picker">
        <label>
          <span className="sr-only">Settings section</span>
          <select aria-label="Settings section" value={p.current} onChange={(e) => p.onPick(e.target.value)}>
            <optgroup label="Settings">
              {p.settings.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </optgroup>
            {p.admin && (
              <optgroup label="Admin">
                {p.admin.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button type="button" className="mini quiet" onClick={p.onBack}>
          Back
        </button>
      </div>
    );

  const group = (g: keyof Folds, title: string, items: readonly MenuItem[]) => (
    <nav className={`set-group set-group-${g}`} aria-label={`${title} sections`}>
      <button type="button" className="set-group-head" aria-expanded={!shown[g]} onClick={() => toggle(g)}>
        <span aria-hidden="true">{shown[g] ? "▸" : "▾"}</span> {title}
      </button>
      {!shown[g] &&
        items.map(([id, label]) => (
          <button key={id} type="button" className="set-tab" aria-current={p.current === id ? "page" : undefined} onClick={() => p.onPick(id)}>
            {label}
          </button>
        ))}
    </nav>
  );
  return (
    // The column scrolls on its own; tabIndex lets the keyboard scroll it too (arrows, Page Up/Down) once focused.
    <div className="set-side" ref={side} tabIndex={-1} role="region" aria-label="Settings menu">
      {group("settings", "Settings", p.settings)}
      {p.admin && group("admin", "Admin", p.admin)}
      <button type="button" className="set-tab close" onClick={p.onBack} title="Back (Esc)">
        Back
      </button>
    </div>
  );
}
