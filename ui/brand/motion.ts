// Step 17.5: reduced motion, from the system (prefers-reduced-motion) or Settings > Display "Reduce motion".
// The config's [ui] reduce_motion is the truth; a copy in localStorage lets the opening know before the first load.
// With either on: no sweep, unroll, hop or bob; the still pose shows; open and close cut straight to the result.
import { useEffect, useState } from "react";

const KEY = "coopilot.reduceMotion";
const EVENT = "coopilot:reduce-motion";
const QUERY = "(prefers-reduced-motion: reduce)";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage can be unavailable; the config still has it after the first load
  }
}

function systemReduced(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

/** Whether motion is reduced right now. */
export function reducedMotion(): boolean {
  return systemReduced() || stored();
}

/** Mirrors the saved setting locally (after a load or a change in Settings) and tells every listener. */
export function rememberReduceMotion(on: boolean): void {
  try {
    if (stored() === on) return;
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // ignore, see above
  }
  document.documentElement.toggleAttribute("data-reduce-motion", on);
  window.dispatchEvent(new Event(EVENT));
}

/** Marks <html> before the first paint, so CSS can stop motion too ([data-reduce-motion]). */
export function applyReduceMotion(): void {
  document.documentElement.toggleAttribute("data-reduce-motion", stored());
}

export function useReducedMotion(): boolean {
  const [on, setOn] = useState(reducedMotion);
  useEffect(() => {
    const update = () => setOn(reducedMotion());
    const mq = typeof matchMedia === "function" ? matchMedia(QUERY) : null;
    mq?.addEventListener("change", update);
    window.addEventListener(EVENT, update);
    return () => {
      mq?.removeEventListener("change", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return on;
}
