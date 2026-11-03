// The focus timer's server side (step 6c): checked every few seconds, so a session ends on time and warns ahead
// whether or not the window is open. The state is in the plan store, so a restart picks it up where it was.
import { logSegment, TIMER_KEY } from "../actions/timer-actions.ts";
import { dueWarnings, tickTimer, type TimerState, type WarnPoint } from "../plan/timer.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { notices, type Notice } from "../plan/notify.ts";

export type NotifyAction = { key: string; label: string };
export type TimerTickDeps = {
  plan: PlanStore;
  now: () => Temporal.Instant;
  endSound: () => Promise<boolean>;
  /** A notification (step 15.5: through the notifier); with buttons, resolves to the chosen key (or null). */
  notify: (n: Notice) => Promise<string | null>;
  sound: () => void;
  /** Runs a timer action as the UI would (timer.done, timer.extend, timer.next). */
  act: (action: "timer.done" | "timer.extend" | "timer.next") => Promise<unknown>;
  /** After a session ends on its own (step 10: media pause). */
  ended?: (before: TimerState, after: TimerState) => Promise<void>;
};

/** A timer notification's buttons and the timer action each runs. */
export const TIMER_BUTTONS = { done: "timer.done", extend: "timer.extend", next: "timer.next" } as const;
const ACTION_OF = TIMER_BUTTONS;

/** One check. Returns what it did, for tests and logs. */
export async function checkTimer(d: TimerTickDeps): Promise<"ended" | "warned" | null> {
  const s = d.plan.getState<TimerState>(TIMER_KEY);
  if (!s) return null;
  const now = d.now();
  const t = tickTimer(s, now);
  if (t.ended) {
    logSegment(d.plan, s, t.segment);
    d.plan.setState(TIMER_KEY, t.state);
    if (d.ended) await d.ended(s, t.state).catch(() => {});
    if (await d.endSound().catch(() => false)) d.sound();
    // Not awaited: the notification stays until answered; the choice runs the same action as the UI.
    void d
      .notify(notices.timerEnd(s.kind === "break", s.label, s.startedAt, now.toString()))
      .then((key) => {
        // Only if the session is still the one that ended (the UI may have answered first).
        const still = d.plan.getState<TimerState>(TIMER_KEY);
        if (key && key in ACTION_OF && still?.ended && still.startedAt === s.startedAt) return d.act(ACTION_OF[key as keyof typeof ACTION_OF]);
        return undefined;
      })
      .catch(() => {});
    return "ended";
  }
  if (!s.runningSince) return null;
  const today = d.plan.getState<{ date: string; points: WarnPoint[] }>("warn_points");
  const due = today ? dueWarnings(today.points, now, s.warned) : [];
  if (!due.length) return null;
  d.plan.setState(TIMER_KEY, { ...s, warned: [...s.warned, ...due.map((p) => p.key)] });
  void d.notify(notices.meeting(due.map((p) => p.label), due.map((p) => p.key), now.toString())).catch(() => {});
  return "warned";
}

/** While a timer runs, today's calendars are reloaded this often (step 6d), through their own 5-minute cache. */
export const CALENDAR_REFRESH_MS = 5 * 60_000;

/** Whether to reload today's calendars now: a running timer, and none done in the last 5 minutes. */
export function calendarRefreshDue(s: TimerState | null, lastMs: number | null, nowMs: number): boolean {
  return !!s?.runningSince && !s.ended && (lastMs === null || nowMs - lastMs >= CALENDAR_REFRESH_MS);
}
