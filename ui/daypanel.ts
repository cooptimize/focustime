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
