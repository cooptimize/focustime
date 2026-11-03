// Freshness without blanking: when to refetch, and how a load result changes what the window shows.
// Pure apart from the timer; the clock and visibility are injected so tests can drive them.
import type { WeekLoadData } from "../actions/types.ts";

export type RefreshTrigger = "focus" | "interval" | "key" | "button";

export type AutoRefreshOptions = {
  refresh: (trigger: RefreshTrigger) => Promise<void>;
  now?: () => number;
  isHidden?: () => boolean;
  /** Window focus refetches at most this often. */
  focusGapMs?: number;
  /** Quiet background refetch once data is this old. */
  intervalMs?: number;
  /** How often the background check runs. */
  tickMs?: number;
};

export function createAutoRefresh(o: AutoRefreshOptions) {
  const now = o.now ?? (() => Date.now());
  const isHidden = o.isHidden ?? (() => false);
  const focusGap = o.focusGapMs ?? 60_000;
  const interval = o.intervalMs ?? 5 * 60_000;
  const tick = o.tickMs ?? 30_000;
  let last = now();
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function due(t: RefreshTrigger): boolean {
    if (inFlight) return false;
    const age = now() - last;
    if (t === "focus") return age >= focusGap;
    if (t === "interval") return !isHidden() && age >= interval;
    return true; // "r" and the Refresh button always refetch, unless one is already running
  }

  /** Returns true when a refresh was started. */
  function trigger(t: RefreshTrigger): boolean {
    if (!due(t)) return false;
    last = now();
    inFlight = true;
    void o
      .refresh(t)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
    return true;
  }

  return {
    trigger,
    start() {
      if (!timer) timer = setInterval(() => trigger("interval"), tick);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: WeekLoadData; refreshError?: string }
  | { kind: "session" }
  | { kind: "failed"; message: string };

export type LoadOutcome = { kind: "ok"; data: WeekLoadData } | { kind: "session" } | { kind: "error" };

/** New data replaces old. A failed load never blanks a grid that is already showing data. */
export function afterLoad(prev: LoadState, outcome: LoadOutcome): LoadState {
  if (outcome.kind === "ok") return { kind: "ready", data: outcome.data };
  if (outcome.kind === "session") return { kind: "session" };
  if (prev.kind === "ready") return { kind: "ready", data: prev.data, refreshError: "Could not reach the FocusTime server. Showing what was loaded earlier" };
  return { kind: "failed", message: "Could not reach the FocusTime server" };
}

/** "updated just now", "updated 4 min ago", "updated 3 h ago", or the date for older data. */
export function updatedAgo(fetchedAt: string, nowMs: number, timeZone: string): string {
  const at = Temporal.Instant.from(fetchedAt);
  const mins = Math.floor((nowMs - at.epochMilliseconds) / 60_000);
  if (mins < 1) return "updated just now";
  if (mins < 60) return `updated ${mins} min ago`;
  if (mins < 24 * 60) return `updated ${Math.floor(mins / 60)} h ago`;
  const d = at.toZonedDateTimeISO(timeZone).toPlainDate();
  return `updated ${d.toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}
