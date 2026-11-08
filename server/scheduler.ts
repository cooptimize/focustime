// A2: the one scheduler for everyone's background work (server/ticks.ts): a fast pass every 5 seconds and a slow one
// every 30, each over every known person, reading what is due from their rows. A pass never overlaps one of its own
// kind; people run side by side, and one person's failure doesn't stop the others'. There is no lease: hosted
// FocusTime runs one replica (`maxReplicas: 1`), the daily jobs claim their period in `job_claims`, and running more
// than one replica needs a lease here first (HK-7, Q-DOC1-1; docs/technical/operations.md).
//
// A3, the idle rule: the passes run only while someone is using FocusTime (a signed-in request in the last 15
// minutes). Otherwise the scheduler sleeps until the next moment anyone's work could be due (plan/wake.ts), kept in
// one stored next-due time (people's and the app jobs'): it makes no database call until then, so a serverless database can pause. When it wakes
// it runs the passes once, works out the next time, stores it and sleeps again. At start it reads the stored time: if
// it hasn't come, nothing runs (a timer that ended while the server was down was due no later than that time).
import type { Logger } from "../log/logger.ts";
import type { WakeStore } from "../store/wake-store.ts";
import type { PersonTicks } from "./ticks.ts";

export type PassKind = "fast" | "slow";

/** The stored next-due time (SQL Server: one row in scheduler_state; SQLite: kept in memory). */
export type { WakeStore };

export type SchedulerOptions = {
  /** Everyone's ticks (built on first use, so an idle start reads nobody's rows). */
  people: () => Iterable<PersonTicks> | Promise<Iterable<PersonTicks>>;
  log: Logger;
  /** Whether someone is using FocusTime now (absent: always, as before A3). */
  active?: () => boolean;
  wakeStore?: WakeStore;
  /** Work for the app as a whole on a slow pass (hard deletes, expired sessions), at most this often. */
  maintenance?: { run: () => Promise<void>; everyMs: number };
  /**
   * App jobs (shared polling, D517): run at the start of every slow pass, before anyone's ticks (so what a job found
   * is there for them), each with its own next-due time for the idle rule (null: nothing due).
   */
  jobs?: readonly { name: string; run: () => Promise<void>; wake: () => Promise<Temporal.Instant | null> }[];
  now?: () => Temporal.Instant;
  fastMs?: number;
  slowMs?: number;
};

/** The longest sleep: the wake rule never asks for more than about a day; this is a guard. */
const MAX_SLEEP_MS = 24 * 3600_000;

export function createScheduler(o: SchedulerOptions) {
  const running: Record<PassKind, boolean> = { fast: false, slow: false };
  const now = o.now ?? (() => Temporal.Now.instant());
  const active = o.active ?? (() => true);
  /** When to wake while idle (in memory; the stored copy is what a restart reads). null: work it out next. */
  let wakeAt: Temporal.Instant | null = null;
  let lastMaintenance: Temporal.Instant | null = null;
  /** ADM-2: when each job last ran (in memory; Admin › Status shows it). */
  const lastRun = new Map<string, string>();
  let waking = false;

  /** One pass of a kind for everyone; how many people it ran for (0 when one of its kind is still running). */
  async function pass(kind: PassKind): Promise<number> {
    if (running[kind]) return 0;
    running[kind] = true;
    try {
      if (kind === "slow")
        for (const j of o.jobs ?? []) {
          await j.run().catch(() => o.log({ source: "plan", op: "scheduler", kind: `${j.name}_failed` }));
          lastRun.set(j.name, now().toString());
        }
      const people = [...(await o.people())];
      const r = await Promise.allSettled(people.map((t) => t[kind]()));
      const failed = r.filter((x) => x.status === "rejected").length;
      if (failed) o.log({ source: "plan", op: "scheduler", kind: `${kind}_failed`, count: failed });
      if (kind === "slow" && o.maintenance && (!lastMaintenance || now().since(lastMaintenance).total("milliseconds") >= o.maintenance.everyMs)) {
        lastMaintenance = now();
        lastRun.set("maintenance", lastMaintenance.toString());
        await o.maintenance.run().catch(() => o.log({ source: "plan", op: "scheduler", kind: "maintenance_failed" }));
      }
      return people.length;
    } finally {
      running[kind] = false;
    }
  }

  /** The earliest next moment over everyone, stored. */
  async function planWake(quiet = false): Promise<Temporal.Instant> {
    const t = now();
    let next = t.add({ milliseconds: MAX_SLEEP_MS });
    for (const p of await o.people()) {
      const w = await p.wake?.().catch(() => t.add({ minutes: 1 }));
      if (w && Temporal.Instant.compare(w, next) < 0) next = w;
    }
    for (const j of o.jobs ?? []) {
      const w = await j.wake().catch(() => t.add({ minutes: 1 }));
      if (w && Temporal.Instant.compare(w, next) < 0) next = w;
    }
    await o.wakeStore?.save(next).catch(() => o.log({ source: "plan", op: "scheduler", kind: "wake_not_stored" }));
    if (quiet) return next;
    wakeAt = next;
    o.log({ source: "plan", op: "scheduler", kind: "idle", count: Math.round(next.since(t).total("minutes")) });
    return next;
  }

  /** Both passes, the timer first (so a session that ended is over before reminders are weighed). */
  const both = () => pass("fast").then(() => pass("slow"));

  /** One beat of the clock: the passes when someone is active; otherwise only a look at the clock until the wake. */
  async function beat(kind: PassKind): Promise<void> {
    if (active()) {
      wakeAt = null;
      await pass(kind);
      // The stored time stays current while someone works (a timer started since): a restart then sleeps no later
      // than the next thing due, even if nobody comes back.
      if (kind === "slow") await planWake(true);
      return;
    }
    if (waking) return;
    waking = true;
    try {
      if (!wakeAt) await planWake();
      else if (Temporal.Instant.compare(now(), wakeAt) >= 0) {
        await both();
        await planWake();
      }
    } finally {
      waking = false;
    }
  }

  /** The first beat: the stored wake if it hasn't come and nobody is active, else both passes now. */
  async function first(): Promise<void> {
    const stored = await o.wakeStore?.load().catch(() => null);
    if (stored && !active() && Temporal.Instant.compare(stored, now()) > 0) {
      wakeAt = stored;
      o.log({ source: "plan", op: "scheduler", kind: "idle_start" });
      return;
    }
    await both();
    if (!active()) await planWake();
  }

  /** Starts the passes; returns the stop. */
  function start(): () => void {
    let started = false;
    const ready = first().finally(() => void (started = true));
    void ready;
    const timers = [setInterval(() => void (started && beat("fast")), o.fastMs ?? 5_000), setInterval(() => void (started && beat("slow")), o.slowMs ?? 30_000)];
    for (const t of timers) t.unref();
    return () => timers.forEach(clearInterval);
  }

  return { pass, start, first, beat, wakeAt: () => wakeAt, lastRuns: (): Record<string, string> => Object.fromEntries(lastRun) };
}
