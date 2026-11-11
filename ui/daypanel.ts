// WD-2: whether Day's block panel was left open or closed, remembered on this device (never in the plan store: it is
// about this screen, not the person's plan). Closed the first time.
const KEY = "focustime.day.panel";

export function readDayPanel(): boolean {
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    return false;
  }
}

export function writeDayPanel(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // A browser with storage off: the panel simply starts closed.
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
