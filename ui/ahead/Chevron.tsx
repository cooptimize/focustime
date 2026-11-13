// BL-1: the one expand and collapse control wherever the Backlog tab draws a tree (Grid, Gantt): a clear chevron, 16px,
// in the normal text color on hover, with a target the full height of its row and 28px wide. It points right when the
// row is closed and down when it's open. Rows with nothing under them keep the same space, so titles line up.
import { Icon } from "../icons.tsx";
export function Chevron({ open, title, onToggle, tab = -1 }: { open: boolean; title: string; onToggle: () => void; tab?: number }) {
  return (
    <button type="button" className="ah-chev" tabIndex={tab} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what's under ${title}`} onClick={(e) => (e.stopPropagation(), onToggle())}>
      <Icon name="closed" className={`ah-chev-svg${open ? " open" : ""}`} />
    </button>
  );
}

export function ChevronSpace() {
  return <span className="ah-chev-space" aria-hidden="true" />;
}
