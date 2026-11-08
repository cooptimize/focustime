// UI-10: the pure parts of the shared growing text box (ui/TextBox.tsx): how tall it is for its content, whether it
// scrolls, and which key submits. No DOM here, so they are unit tested.

/** What the box needs from the browser to size itself: its content height, line height and vertical padding and borders. */
export type BoxMetrics = { scrollHeight: number; lineHeight: number; paddingY: number; borderY: number };

/**
 * The box's border-box height for its content: at least `minRows` lines, at most `maxRows`, and whether it scrolls.
 * `scrollHeight` includes the padding but not the borders, so the borders are added back; leaving them out made the
 * capture box 2px short of its own text, so it always scrolled and showed the native arrows (UI-10).
 */
export function boxSize(m: BoxMetrics, minRows: number, maxRows: number): { height: number; scrolls: boolean } {
  const lo = Math.max(1, minRows);
  const hi = Math.max(lo, maxRows);
  const min = lo * m.lineHeight + m.paddingY + m.borderY;
  const max = hi * m.lineHeight + m.paddingY + m.borderY;
  const need = m.scrollHeight + m.borderY;
  // Half a pixel of rounding is not overflow (fractional line heights at Large text).
  const scrolls = need > max + 0.5;
  return { height: Math.min(Math.max(need, min), max), scrolls };
}

/** A computed line height in px; "normal" is about 1.2 of the font size. */
export function lineHeightPx(lineHeight: string, fontSize: string): number {
  const px = parseFloat(lineHeight);
  if (lineHeight.endsWith("px") && Number.isFinite(px)) return px;
  const fs = parseFloat(fontSize) || 13;
  return Number.isFinite(px) && px > 0 ? px * fs : fs * 1.2;
}

/**
 * Whether a key submits a box that saves on Enter: Enter alone (or with Ctrl or Cmd where the field allows it), never
 * Shift+Enter (a new line) and never while an IME is composing (keyCode 229 covers browsers that miss isComposing).
 */
export function submitsOnEnter(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}
