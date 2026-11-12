// WD-2: whether Day's block panel was left open or closed, remembered on this device (never in the plan store: it is
// about this screen, not the person's plan). PS-1: until it has been closed or opened here, it opens on a wide window
// (WIDE and up), so the day's blocks and the work to add are side by side without a click; once closed it stays
// closed (it never reopens itself), until it is opened again.
const KEY = "focustime.day.panel";
/** PS-1: a window this wide or wider opens Day with the panel the first time. */
export const WIDE = 1280;

/** What was left on this device: "open", "closed", or null when nothing was (a first visit, or storage off). */
export function storedDayPanel(): "open" | "closed" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "open" || v === "closed" ? v : null;
  } catch {
    return null;
  }
}

/** PS-1: whether Day opens with its panel: what was left here, else open on a wide window. */
export const dayPanelOpens = (stored: "open" | "closed" | null, width: number): boolean => (stored ? stored === "open" : width >= WIDE);

export function readDayPanel(): boolean {
  return dayPanelOpens(storedDayPanel(), typeof window === "undefined" ? 0 : window.innerWidth);
}

export function writeDayPanel(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // A browser with storage off: the panel simply starts as a first visit would.
  }
}

// WD-2 follow-up: the block panel's Add list order (backlog order, or target date), remembered on this device.
const SORT = "focustime.panel.sort";
export function readPanelSort(): "backlog" | "target" {
  try {
    return localStorage.getItem(SORT) === "target" ? "target" : "backlog";
  } catch {
    return "backlog";
  }
}
export function writePanelSort(sort: "backlog" | "target"): void {
  try {
    localStorage.setItem(SORT, sort);
  } catch {
    // Storage off: the list stays in backlog order.
  }
}
