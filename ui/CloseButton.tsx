// UI-3: the one close control for dialogs and side panels, and the hook that puts focus back where they were opened.
import { useEffect, useState, type Ref } from "react";

/**
 * A quiet × at the top right of a dialog or panel header: a 44 px tap target, the focus ring, aria-label "Close" and
 * the tooltip "Close (Esc)" (Setup's says what closing keeps instead, since its Esc skips a screen). Disabled while a
 * write is busy, with the same tooltip. The key hint lives in the tooltip and the key legend, never on the button.
 */
export function CloseButton({ onClose, disabled = false, title = "Close (Esc)", buttonRef }: { onClose: () => void; disabled?: boolean; title?: string; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={buttonRef} type="button" className="x-close" onClick={onClose} disabled={disabled} aria-label="Close" title={title}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}

// The last control focused outside any menu, dialog or panel overlay: where focus goes back to when the control that
// opened a dialog was a menu item (gone with its menu, e.g. ⋯ › About) or the command menu.
let lastOutside: HTMLElement | null = null;
const IN_MENU = "[data-menu]";
const IN_OVERLAY = "[data-overlay], [data-menu]";
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && !t.closest(IN_OVERLAY)) lastOutside = t;
    },
    true,
  );
}

/** The element a dialog should return focus to, read when it opens. */
export function openerOf(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return lastOutside;
  if (active.closest(IN_MENU)) return lastOutside;
  return active;
}

/**
 * Focus returns to the control that opened the dialog or panel when it closes (Esc, ×, the backdrop or its own
 * buttons), when that control is still there and nothing else has taken focus meanwhile.
 */
export function useReturnFocus(): void {
  const [opener] = useState(() => (typeof document === "undefined" ? null : openerOf(document.activeElement)));
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body) return;
        const back = opener?.isConnected ? opener : lastOutside?.isConnected ? lastOutside : null;
        // Another dialog took over (a command that opens one): it returns focus when it closes, not now behind it.
        if (!back || (document.querySelector('[data-overlay="modal"]') && !back.closest('[data-overlay="modal"]'))) return;
        back.focus({ preventScroll: true });
      });
    },
    [opener],
  );
}
