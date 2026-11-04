// P1: offline, FocusTime says so in one plain line over whatever is on screen (the last shell the service worker
// kept, or the page as it was): when the browser says it's offline, or a call to FocusTime got no answer at all. It
// needs a connection for everything: nothing of a person's is kept for offline use.
import { useSyncExternalStore } from "react";
import { lastCallReached, onReachChange } from "./api.ts";

export const OFFLINE_LINE = "You're offline. FocusTime needs a connection.";

const subscribe = (f: () => void) => {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  const off = onReachChange(f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
    off();
  };
};
/** Offline: the browser says so, or the last call to FocusTime got no answer at all. */
const isOffline = () => !navigator.onLine || !lastCallReached();

export function OfflineLine() {
  const offline = useSyncExternalStore(subscribe, isOffline, () => false);
  if (!offline) return null;
  return (
    <div className="offline-line" role="status">
      {OFFLINE_LINE}
    </div>
  );
}
