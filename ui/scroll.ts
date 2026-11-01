// Scroll containment for the Plan panel (step 13.6, D242): the panel's list scrolls, the page behind never does.
// Pure: the component passes the list's sizes and the event's movement.

type Box = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** Whether a wheel or trackpad movement would leave the list (at its top or bottom edge) and scroll the page. */
export function wheelEscapes(el: Box, deltaY: number): boolean {
  if (deltaY === 0) return false;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return true;
  return deltaY < 0 ? el.scrollTop <= 0 : el.scrollTop >= max - 1;
}

/** How far a scroll key moves the list (Infinity for End, -Infinity for Home), or null for other keys or while typing. */
export function scrollKeyDelta(key: string, clientHeight: number, typing: boolean): number | null {
  if (typing) return null;
  const page = Math.round(clientHeight * 0.9);
  switch (key) {
    case "PageDown": return page;
    case "PageUp": return -page;
    case "ArrowDown": return 40;
    case "ArrowUp": return -40;
    case "End": return Infinity;
    case "Home": return -Infinity;
    default: return null;
  }
}
