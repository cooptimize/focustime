// Step 15.4 fix: when Coopilot was restarted, this window's launch token is old. Say so in plain words with one
// button that asks the host to open a fresh window (coopilot-open replaces this one), never "Session expired".
import { useEffect, useState } from "react";
import { reopenCoopilot, setStaleListener } from "./api.ts";

export function ReopenButton() {
  const [state, setState] = useState<"idle" | "opening" | "manual">("idle");
  return (
    <span className="reopen-actions">
      <button
        type="button"
        className="commit"
        disabled={state === "opening"}
        onClick={() => {
          setState("opening");
          void reopenCoopilot().then((ok) => setState(ok ? "opening" : "manual"));
        }}
      >
        {state === "opening" ? "Opening…" : "Reopen Coopilot"}
      </button>
      {state === "manual" && <span className="muted"> Coopilot couldn't open a window from here. Press Super + Alt + C or run coopilot-open.</span>}
    </span>
  );
}

/** A banner over everything once any call finds the window out of date. */
export function StaleBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStaleListener(() => setStale(true));
    return () => setStaleListener(null);
  }, []);
  if (!stale) return null;
  return (
    <div className="stale-banner" role="alert">
      <span>Coopilot was restarted, so this window is out of date.</span>
      <ReopenButton />
    </div>
  );
}
