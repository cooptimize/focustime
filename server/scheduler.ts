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
//
// VM-3, nothing can hold it: every await in a pass has a time limit (a job, everyone's VM start, everyone's parts, the
// app's upkeep, each person's wake). Work over its limit keeps running but is left behind: logged by name and skipped by
// the next pass until it ends, so one person's or one job's stuck work never runs twice at once and never stops anyone
// else's. A pass still running past its own limit no longer stops the next pass of its kind from starting. Each slow
// pass first gives everyone's VM start its turn (PersonTicks.early), before the app jobs, which can take a minute.
import type { Logger } from "../log/logger.ts";
import type { PassView } from "../actions/admin-actions.ts";
import type { WakeStore } from "../store/wake-store.ts";
import type { PersonTicks } from "./ticks.ts";
import { policyJobs, type BackgroundPolicy } from "../config/background-policy.ts";

export type PassKind = "fast" | "slow";

/** The stored next-due time (SQL Server: one row in scheduler_state; SQLite: kept in memory). */
export type { WakeStore };

export type SchedulerOptions = {
  /**
   * ENV-1: which app jobs may run here (config/background-policy.ts). Production keeps every job as given; elsewhere a
   * job the policy doesn't name or allow is dropped at start, and an in_use job runs only while someone is active.
   */
  policy: BackgroundPolicy;
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
  /** VM-3: the time limits (tests shorten them); absent: PASS_LIMITS. */
  limits?: Partial<PassLimits>;
};

/** VM-3: how long each kind of work may hold a pass before the pass moves on without it. */
export type PassLimits = {
  /** A whole pass; past it the next pass of that kind may start. */
  fastPass: number;
  slowPass: number;
  /** One app job (the chats job took 80 s at most in production's last week). */
  job: number;
  /** Everyone's VM start, at the head of a slow pass. */
  early: number;
  /** One person's wake time, for the idle rule. */
  wake: number;
  /** The app's upkeep (hard deletes, ended sessions). */
  maintenance: number;
};
export const PASS_LIMITS: PassLimits = { fastPass: 2 * 60_000, slowPass: 10 * 60_000, job: 5 * 60_000, early: 3 * 60_000, wake: 30_000, maintenance: 5 * 60_000 };

/** VM-3: what Admin › Status shows of a kind of pass. */
export type { PassView };

/** Waits for a promise at most `ms`; true when it settled in time. The promise keeps running either way. */
export function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((r) => {
    timer = setTimeout(() => r(false), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([p.then(() => true, () => true), late]).finally(() => clearTimeout(timer));
}

const minutesText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
};

/** The longest sleep: the wake rule never asks for more than about a day; this is a guard. */
const MAX_SLEEP_MS = 24 * 3600_000;

export function createScheduler(o: SchedulerOptions) {
  const limits: PassLimits = { ...PASS_LIMITS, ...o.limits };
  const passLimit = (k: PassKind) => (k === "fast" ? limits.fastPass : limits.slowPass);
  const now = o.now ?? (() => Temporal.Now.instant());
  const active = o.active ?? (() => true);
  /** When to wake while idle (in memory; the stored copy is what a restart reads). null: work it out next. */
  let wakeAt: Temporal.Instant | null = null;
  let lastMaintenance: Temporal.Instant | null = null;
  /** ADM-2: when each job last ran (in memory; Admin › Status shows it). */
  const lastRun = new Map<string, string>();
  let waking = false;
  // ENV-1: the jobs this deployment runs, decided once.
  const jobs = policyJobs(o.policy, o.jobs ?? [], active, (name) => o.log({ source: "plan", op: "scheduler", kind: `job_off:${name}` }));
  if (!o.policy.allows("maintenance")) o.log({ source: "plan", op: "scheduler", kind: "job_off:maintenance" });
  const maintenance = o.policy.allows("maintenance") ? o.maintenance : undefined;
  const say = (kind: string, extra: { count?: number; durationMs?: number } = {}) => o.log({ source: "plan", op: "scheduler", kind, ...extra });

  // VM-3: the passes running now (by start time) and the last finished of each kind.
  /** The passes of each kind running now, by start time, oldest first (one past its limit may still be running). */
  const running: Record<PassKind, Temporal.Instant[]> = { fast: [], slow: [] };
  /** Passes said to be over their limit (kind and start), so each is said once, and once more when it ends. */
  const overSaid = new Set<string>();
  const last: Record<PassKind, { finishedAt: Temporal.Instant; ms: number } | null> = { fast: null, slow: null };
  /** When someone started using FocusTime with no pass of a kind finished since (for the "hasn't finished" warning). */
  const waitingSince: Record<PassKind, Temporal.Instant | null> = { fast: null, slow: null };
  /** Work left behind over its limit and still running: a person's kind of pass, or a job by name. Skipped until it ends. */
  const busy = new Map<string, Promise<unknown>>();
  const people = new WeakMap<PersonTicks, number>();
  let nextPerson = 0;
  const idOf = (t: PersonTicks) => {
    let id = people.get(t);
    if (id === undefined) people.set(t, (id = nextPerson++));
    return id;
  };
  /** Runs one piece of work unless its last run is still going; never throws. */
  const guarded = (key: string, run: () => Promise<unknown>, onError: () => void): Promise<unknown> => {
    const still = busy.get(key);
    if (still) return Promise.resolve("busy");
    const p = Promise.resolve()
      .then(run)
      .catch(onError)
      .finally(() => busy.delete(key));
    busy.set(key, p);
    return p;
  };

  /** One pass of a kind for everyone; how many people it ran for (0 when one of its kind is still running inside its limit). */
  async function pass(kind: PassKind): Promise<number> {
    const t0 = now();
    const newest = running[kind].at(-1);
    if (newest) {
      if (t0.since(newest).total("milliseconds") < passLimit(kind)) return 0;
      // Past its limit: said once, and the next pass starts anyway (the guards keep anyone's work from running twice).
      for (const r of running[kind])
        if (!overSaid.has(`${kind}:${r}`)) {
          overSaid.add(`${kind}:${r}`);
          say(`${kind}_over_limit`, { durationMs: t0.since(r).total("milliseconds") });
        }
    }
    running[kind].push(t0);
    try {
      const everyone = [...(await o.people())];
      const failed = { n: 0 };
      if (kind === "slow") {
        // Everyone's VM start first, before the jobs and before any part that can be slow.
        const early = everyone.filter((t) => t.early).map((t) => guarded(`early:${idOf(t)}`, () => t.early!(), () => (failed.n++, undefined)));
        if (!(await within(Promise.all(early), limits.early))) say("early_over_limit");
        for (const j of jobs) {
          const ran = guarded(`job:${j.name}`, () => j.run(), () => say(`${j.name}_failed`));
          if (!(await within(ran, limits.job))) say(`${j.name}_over_limit`);
          else if ((await ran) !== "busy") lastRun.set(j.name, now().toString());
        }
      }
      const runs = everyone.map((t) => guarded(`${kind}:${idOf(t)}`, () => (kind === "slow" ? t.slow(t.early ? { early: false } : undefined) : t.fast()), () => (failed.n++, undefined)));
      if (!(await within(Promise.all(runs), passLimit(kind)))) say(`${kind}_people_over_limit`);
      if (failed.n) say(`${kind}_failed`, { count: failed.n });
      if (kind === "slow" && maintenance && (!lastMaintenance || now().since(lastMaintenance).total("milliseconds") >= maintenance.everyMs)) {
        lastMaintenance = now();
        lastRun.set("maintenance", lastMaintenance.toString());
        const ran = guarded("maintenance", () => maintenance.run(), () => say("maintenance_failed"));
        if (!(await within(ran, limits.maintenance))) say("maintenance_over_limit");
      }
      return everyone.length;
    } finally {
      const end = now();
      const ms = end.since(t0).total("milliseconds");
      last[kind] = { finishedAt: end, ms };
      waitingSince[kind] = null;
      running[kind] = running[kind].filter((r) => r !== t0);
      if (overSaid.delete(`${kind}:${t0}`)) say(`${kind}_finished_late`, { durationMs: ms });
      // A slow pass that took over half its limit is worth a line (with how long); a healthy one writes nothing.
      if (ms > passLimit(kind) / 2) say(`${kind}_slow`, { durationMs: ms });
    }
  }

  /** VM-3: Admin › Status's view of the passes. */
  function passes(): PassView[] {
    const t = now();
    return (["fast", "slow"] as const).map((kind) => {
      const lim = passLimit(kind);
      const run = running[kind][0];
      const done = last[kind];
      const name = kind === "fast" ? "The fast pass (every 5 seconds: the focus timer, held notices)" : "The slow pass (every 30 seconds: reminders, notices, the VM start)";
      let warning: string | null = null;
      if (run && t.since(run).total("milliseconds") >= lim) warning = `${name} has been running for ${minutesText(t.since(run).total("milliseconds"))}, past its ${minutesText(lim)} limit. The next pass runs anyway; the work that is stuck is named in the log.`;
      else if (active()) {
        const from = done ? done.finishedAt : waitingSince[kind];
        if (from && t.since(from).total("milliseconds") >= lim) warning = `${name} hasn't finished for ${minutesText(t.since(from).total("milliseconds"))} while someone is using FocusTime.`;
      }
      return { kind, finishedAt: done?.finishedAt.toString() ?? null, ms: done ? Math.round(done.ms) : null, since: run?.toString() ?? null, limitMs: lim, warning };
    });
  }

  /** The earliest next moment over everyone, stored. */
  async function planWake(quiet = false): Promise<Temporal.Instant> {
    const t = now();
    let next = t.add({ milliseconds: MAX_SLEEP_MS });
    const soon = t.add({ minutes: 1 });
    for (const p of await o.people()) {
      // A wake that doesn't answer in time counts as "soon": the scheduler looks again in a minute.
      let w: Temporal.Instant | null | undefined = soon;
      const asked = p.wake?.().then((x) => void (w = x), () => void (w = soon));
      if (asked && !(await within(asked, limits.wake))) {
        w = soon;
        say("wake_over_limit");
      }
      if (!p.wake) w = null;
      if (w && Temporal.Instant.compare(w, next) < 0) next = w;
    }
    for (const j of jobs) {
      let w: Temporal.Instant | null = soon;
      const asked = j.wake().then((x) => void (w = x), () => void (w = soon));
      if (!(await within(asked, limits.wake))) w = soon;
      if (w && Temporal.Instant.compare(w, next) < 0) next = w;
    }
    await o.wakeStore?.save(next).catch(() => say("wake_not_stored"));
    if (quiet) return next;
    wakeAt = next;
    say("idle", { count: Math.round(next.since(t).total("minutes")) });
    return next;
  }

  /** Both passes, the timer first (so a session that ended is over before reminders are weighed). */
  const both = () => pass("fast").then(() => pass("slow"));

  /** One beat of the clock: the passes when someone is active; otherwise only a look at the clock until the wake. */
  async function beat(kind: PassKind): Promise<void> {
    if (active()) {
      wakeAt = null;
      waitingSince[kind] ??= now();
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

  return { pass, passes, start, first, beat, wakeAt: () => wakeAt, lastRuns: (): Record<string, string> => Object.fromEntries(lastRun), jobNames: (): string[] => jobs.map((j) => j.name) };
}
