// PF-1: the top bar's one line while a screen's file is arriving or didn't arrive (ui/screens.ts). The screen the
// person was on stays as it is; past 300 ms the line says "Loading…", as a week's read does (ReadLine). A file that
// can't be had says so in plain words with Retry. It hangs under the top bar's edge and takes no room, so nothing moves.
import { useEffect, useState } from "react";
import { retryScreens, useWaiting, type Failed } from "./screens.ts";
import "./screens.css";

export const SCREEN_LOADING_MS = 300;
export const SCREEN_FAILED: Record<Failed, string> = {
  // The app's own offline line says "You're offline" above this one.
  offline: "This screen needs a connection the first time it opens.",
  missing: "This screen didn't load.",
};

export function ScreenLine() {
  const w = useWaiting();
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (w.since === null) return;
    const t = window.setTimeout(() => setLate(true), Math.max(0, w.since + SCREEN_LOADING_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [w.since]);
  if (w.since !== null) return late ? <span className="read-line muted screen-line" role="status">Loading…</span> : null;
  if (!w.failed) return null;
  return (
    <span className="read-line failed screen-line" role="alert">
      {SCREEN_FAILED[w.failed]}{" "}
      <button type="button" className="mini" onClick={retryScreens}>
        Retry
      </button>
    </span>
  );
}
