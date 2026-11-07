// AH-5: where a cell's popover goes, pure: under the cell, its left edge on the cell's; flipped above when it doesn't
// fit below, slid left when it would pass the right edge, and kept 8 px inside the window either way.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Placed = { left: number; top: number; above: boolean; maxHeight: number };

export function placePopover(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, gap = 4, margin = 8): Placed {
  const left = Math.round(Math.max(margin, Math.min(anchor.left, view.width - size.width - margin)));
  const below = view.height - anchor.bottom - gap - margin;
  const aboveRoom = anchor.top - gap - margin;
  if (size.height <= below) return { left, top: Math.round(anchor.bottom + gap), above: false, maxHeight: Math.round(below) };
  if (size.height <= aboveRoom) return { left, top: Math.round(anchor.top - gap - size.height), above: true, maxHeight: Math.round(aboveRoom) };
  // Fits on neither side (a tall picker at a large text size): over the cell, as low as it can sit, all on screen.
  const full = view.height - 2 * margin;
  const h = Math.min(size.height, full);
  return { left, top: Math.round(Math.max(margin, Math.min(anchor.top, view.height - margin - h))), above: false, maxHeight: Math.round(full) };
}
