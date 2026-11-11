// DM-1: Settings › Demo, only in a demo session. Reset demo puts the session's demo data back as it started (every
// write, pick, capture and send since is gone), so each run of the demo script starts the same.
import { useState } from "react";
import { call } from "../api.ts";

export function DemoSection() {
  const [state, setState] = useState<"idle" | "resetting" | { error: string }>("idle");
  const reset = async () => {
    setState("resetting");
    try {
      await call<{ reset: boolean; ms: number }>("demo.reset", {});
      // Everything on screen was the old demo: start again from the top.
      location.hash = "#/day";
      location.reload();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Reset didn't work. Try again" });
    }
  };
  return (
    <div className="set-form">
      <p className="muted">Fictional data only: nothing in the demo is real and nothing leaves FocusTime. Writes to DevOps and Outlook are simulated, with the real preview, confirm and undo.</p>
      <div className="set-field">
        <span className="set-label">Reset demo</span>
        <div>
          <button type="button" className="mini primary" disabled={state === "resetting"} onClick={() => void reset()}>
            {state === "resetting" ? "Resetting…" : "Reset demo"}
          </button>
          <span className="set-hint">Puts the demo back as it started: every change, write, capture and send since is gone. Takes a few seconds.</span>
          {typeof state === "object" && <p className="field-problem">{state.error}</p>}
        </div>
      </div>
    </div>
  );
}
