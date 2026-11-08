// WK-3: Show weekend, remembered per viewer in this browser (localStorage). A private window, blocked storage or a
// preview simply starts with it off: Saturday and Sunday still show whenever something is on them.
const KEY = "focustime.showWeekend";

export function readShowWeekend(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowWeekend(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* not remembered this time; the switch still works for this visit */
  }
}

/** WK-3: a Deployment was just marked done (any path); App offers "Tell <client> it's deployed". */
export const DEPLOYED_EVENT = "focustime:deployed";
