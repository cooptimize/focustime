// WD-2: what a click on a block card means. A click on its header or empty space opens the block panel; a click on a
// control (a button, link, checkbox, event or timebox), on a to-do's row or on a chip doesn't.
import type { MouseEvent as ReactMouseEvent } from "react";

/** A click on a control inside a card (a button, link, checkbox, event or timebox) isn't a click on the card body. */
export function interactive(e: ReactMouseEvent): boolean {
  const t = e.target as HTMLElement;
  const card = e.currentTarget as HTMLElement;
  const hit = t.closest("button, a, input, label, select, textarea, [role='button'], [role='menuitem'], .tbox, .r-ev, .event");
  return !!hit && hit !== card && card.contains(hit);
}

/** A click on a to-do's row, a placed feature, a check-in or a chip: it never opens the panel. */
export function onRowOrChip(e: ReactMouseEvent): boolean {
  const t = e.target as HTMLElement;
  const card = e.currentTarget as HTMLElement;
  const hit = t.closest("[data-pick], .checklist li, .placed-features li, .checkin-chips li, .card-events li, .flex-list li, .status-pill, .due-badge, .late-chip, .card-live, .card-calls");
  return !!hit && card.contains(hit);
}
