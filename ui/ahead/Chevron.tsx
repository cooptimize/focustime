// BL-1: the one expand and collapse control wherever the Backlog tab draws a tree (Grid, Gantt): a clear chevron, 16px,
// in the normal text color on hover, with a target the full height of its row and 28px wide. It points right when the
// row is closed and down when it's open. Rows with nothing under them keep the same space, so titles line up.
export function Chevron({ open, title, onToggle, tab = -1 }: { open: boolean; title: string; onToggle: () => void; tab?: number }) {
  return (
    <button type="button" className="ah-chev" tabIndex={tab} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what's under ${title}`} onClick={(e) => (e.stopPropagation(), onToggle())}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className={open ? "open" : undefined}>
        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function ChevronSpace() {
  return <span className="ah-chev-space" aria-hidden="true" />;
}
