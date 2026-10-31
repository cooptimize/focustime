// The focus timer's server side (step 6c): checked every few seconds, so a session ends on time and warns ahead
// whether or not the window is open. The state is in the plan store, so a restart picks it up where it was.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { logSegment, TIMER_KEY } from "../actions/timer-actions.ts";
import { dueWarnings, tickTimer, type TimerState, type WarnPoint } from "../plan/timer.ts";
import type { PlanStore } from "../store/plan-store.ts";

export type NotifyAction = { key: string; label: string };
export type TimerTickDeps = {
  plan: PlanStore;
  now: () => Temporal.Instant;
  endSound: () => Promise<boolean>;
  /** A desktop notification; with actions, resolves to the chosen key (or null when dismissed). */
  notify: (title: string, body: string, actions?: NotifyAction[]) => Promise<string | null>;
  sound: () => void;
  /** Runs a timer action as the UI would (timer.done, timer.extend, timer.next). */
  act: (action: "timer.done" | "timer.extend" | "timer.next") => Promise<unknown>;
};

export const END_ACTIONS: NotifyAction[] = [
  { key: "done", label: "Done" },
  { key: "extend", label: "+15 min" },
  { key: "next", label: "Next pick" },
];
const ACTION_OF = { done: "timer.done", extend: "timer.extend", next: "timer.next" } as const;

/** One check. Returns what it did, for tests and logs. */
export async function checkTimer(d: TimerTickDeps): Promise<"ended" | "warned" | null> {
  const s = d.plan.getState<TimerState>(TIMER_KEY);
  if (!s) return null;
  const now = d.now();
  const t = tickTimer(s, now);
  if (t.ended) {
    logSegment(d.plan, s, t.segment);
    d.plan.setState(TIMER_KEY, t.state);
    if (await d.endSound().catch(() => false)) d.sound();
    const title = s.kind === "break" ? "Break over" : "Focus session done";
    // Not awaited: the notification stays until answered; the choice runs the same action as the UI.
    void d
      .notify(title, s.label, END_ACTIONS)
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
  void d.notify("In 5 minutes", due.map((p) => p.label).join("\n")).catch(() => {});
  return "warned";
}

/** notify-send with actions (fixed argument list, no shell); resolves the chosen key. */
export function notifyWithActions(title: string, body: string, actions: NotifyAction[] = []): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ["--app-name=Coopilot", "--urgency=normal", ...actions.map((a) => `--action=${a.key}=${a.label}`), title, body];
    const p = spawn("notify-send", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (c: Buffer) => (out += c.toString()));
    p.on("error", () => resolve(null));
    p.on("close", () => resolve(out.trim() || null));
    if (!actions.length) p.unref();
  });
}

const SOUND = "/usr/share/sounds/freedesktop/stereo/complete.oga";
/** A short end sound through PipeWire, when the sound file is there. Fire and forget. */
export function playEndSound(): void {
  if (!existsSync(SOUND)) return;
  const p = spawn("pw-play", [SOUND], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}
