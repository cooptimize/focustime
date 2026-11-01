// The keyboard legend (? or the command menu): every key from ui/keys.ts, so it can't drift from what works.
import { Fragment, useEffect, useRef } from "react";
import { KEYS } from "./keys.ts";

export function KeyLegend({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="command-menu key-legend"
        data-overlay="modal"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="command-head">
          <span className="command-step-title">Keyboard shortcuts</span>
          <button ref={close} type="button" className="mini" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <dl className="key-list">
          {KEYS.map((k) => (
            <Fragment key={k.does}>
              <dt>
                {k.keys.map((x) => (
                  <kbd key={x}>{x}</kbd>
                ))}
              </dt>
              <dd>{k.does}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="command-foot muted">Every key is also a command menu entry (Ctrl K) or a ⋯ menu item.</div>
      </div>
    </div>
  );
}
