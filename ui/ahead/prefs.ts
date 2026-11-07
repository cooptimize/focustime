// AH-6: Ahead's per-viewer view choices in this browser: each view's level and carets, the Gantt's "Show callouts"
// and its label column width. Conveniences only: a blocked or empty storage gives the defaults, never an error.
import { useCallback, useState } from "react";
import { isFold, type Fold } from "../../plan/gantt-tree.ts";

const KEY = "focustime.ahead.";

export function readPref<T>(name: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY + name);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name: string, v: unknown): void {
  try {
    localStorage.setItem(KEY + name, JSON.stringify(v));
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}

/** A remembered value: read once, written on every change. */
export function usePref<T>(name: string, ok: (v: unknown) => v is T, fallback: T): [T, (v: T | ((old: T) => T)) => void] {
  const [v, setV] = useState<T>(() => readPref(name, ok, fallback));
  const set = useCallback(
    (next: T | ((old: T) => T)) =>
      setV((old) => {
        const n = typeof next === "function" ? (next as (o: T) => T)(old) : next;
        writePref(name, n);
        return n;
      }),
    [name],
  );
  return [v, set];
}

export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A view's level and carets ("gantt", "grid"). */
export const useFold = (view: "gantt" | "grid", fallback: Fold) => usePref<Fold>(`${view}.fold`, isFold, fallback);
