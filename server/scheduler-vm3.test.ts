// VM-3: nothing can hold the scheduler. Each piece of work has a time limit, work over it is logged by name and left
// behind (never run twice at once), a pass past its own limit no longer stops the next one, the VM start's turn comes
// first in every slow pass, and one person's stuck work never stops another's. Fake people and jobs; short limits.
import { describe, expect, it } from "vitest";
import { backgroundPolicy } from "../config/background-policy.ts";
import type { LogRecord } from "../log/logger.ts";
import { createScheduler } from "./scheduler.ts";
import type { PersonTicks } from "./ticks.ts";

const forever = () => new Promise<void>(() => {});
const LIMITS = { fastPass: 60, slowPass: 60, job: 40, early: 40, wake: 40, maintenance: 40 };

function setup(people: PersonTicks[], jobs: { name: string; run: () => Promise<void> }[] = []) {
  const logs: LogRecord[] = [];
  let t = Temporal.Instant.from("2026-11-17T13:55:00Z");
  const s = createScheduler({
    policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }),
    people: () => people,
    log: (r) => void logs.push(r),
    jobs: jobs.map((j) => ({ ...j, wake: async () => null })),
    now: () => t,
    limits: LIMITS,
  });
  const kinds = () => logs.filter((l) => l.op === "scheduler").map((l) => l.kind);
  return { s, logs, kinds, advance: (ms: number) => void (t = t.add({ milliseconds: ms })) };
}

function counting(o: { slow?: () => Promise<void>; early?: () => Promise<void> } = {}) {
  const n = { slow: 0, early: 0, fast: 0, earlyArgs: [] as unknown[] };
  const t: PersonTicks = {
    fast: async () => void n.fast++,
    slow: async (a) => {
      n.slow++;
      n.earlyArgs.push(a);
      await o.slow?.();
    },
    early: async () => {
      n.early++;
      await o.early?.();
    },
  };
  return { t, n };
}

describe("VM-3: the scheduler can't be held", () => {
  it("everyone's VM start runs first, before a job that never returns; the pass moves on and the next one skips the stuck job", async () => {
    const order: string[] = [];
    const a = counting({ early: async () => void order.push("start") });
    const { s, kinds } = setup([a.t], [{ name: "requests_poll", run: async () => (order.push("job"), forever()) }]);
    expect(await s.pass("slow")).toBe(1);
    expect(order).toEqual(["start", "job"]);
    expect(kinds()).toContain("requests_poll_over_limit");
    // The scheduler gave the start its turn, so the person's slow parts don't run it again.
    expect(a.n.earlyArgs).toEqual([{ early: false }]);
    // Next pass: the job is still running and is not started again; everyone's work runs.
    expect(await s.pass("slow")).toBe(1);
    expect(order).toEqual(["start", "job", "start"]);
    expect(a.n.slow).toBe(2);
  });

  it("one person's stuck pass never stops another's, and never runs twice at once", async () => {
    const stuck = counting({ slow: forever });
    const fine = counting();
    const { s, kinds } = setup([stuck.t, fine.t]);
    await s.pass("slow");
    await s.pass("slow");
    await s.pass("slow");
    expect(fine.n.slow).toBe(3);
    expect(fine.n.early).toBe(3);
    // The stuck person's slow parts started once and were skipped while still running; their VM start still had its turn.
    expect(stuck.n.slow).toBe(1);
    expect(stuck.n.early).toBe(3);
    // Only the first pass waited its limit for them; the later ones skipped them at once.
    expect(kinds().filter((k) => k === "slow_people_over_limit")).toHaveLength(1);
  });

  it("a person's VM start that never returns is left behind after its limit; the pass goes on", async () => {
    const stuck = counting({ early: forever });
    const fine = counting();
    const { s, kinds } = setup([stuck.t, fine.t]);
    await s.pass("slow");
    expect(fine.n.slow).toBe(1);
    expect(stuck.n.slow).toBe(1);
    expect(kinds()).toContain("early_over_limit");
    await s.pass("slow");
    expect(stuck.n.early).toBe(1);
    expect(fine.n.early).toBe(2);
  });

  it("past its limit (by the clock), the next pass starts, logged once; Admin's view warns until it ends", async () => {
    let release!: () => void;
    const held = counting({ slow: () => new Promise<void>((r) => (release = r)) });
    const logs: LogRecord[] = [];
    let t = Temporal.Instant.from("2026-11-17T13:55:00Z");
    const s = createScheduler({ policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }), people: () => [held.t], log: (r) => void logs.push(r), now: () => t, limits: { ...LIMITS, slowPass: 10 * 60_000 }, active: () => true });
    const first = s.pass("slow");
    await new Promise((r) => setTimeout(r, 10));
    t = t.add({ minutes: 11 });
    const view = s.passes().find((p) => p.kind === "slow")!;
    expect(view.warning).toMatch(/has been running for 11 minutes, past its 10 minutes limit/);
    // The next pass starts (the held person is skipped, still running), and the line is said once.
    expect(await Promise.race([s.pass("slow"), new Promise((r) => setTimeout(() => r("held"), 500))])).toBe(1);
    await Promise.race([s.pass("slow"), new Promise((r) => setTimeout(r, 500))]);
    expect(logs.filter((l) => l.kind === "slow_over_limit")).toHaveLength(1);
    expect(held.n.slow).toBe(1);
    release();
    await first;
    expect(logs.filter((l) => l.kind === "slow_finished_late")).toHaveLength(1);
    expect(s.passes().find((p) => p.kind === "slow")!.warning).toBeNull();
  });

  it("Admin's view: when each pass last finished and how long it took; a warning when one hasn't finished while someone works", async () => {
    const a = counting();
    let t = Temporal.Instant.from("2026-11-17T13:55:00Z");
    let busy = true;
    const s = createScheduler({ policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }), people: () => [a.t], log: () => {}, now: () => t, limits: LIMITS, active: () => busy });
    expect(s.passes().map((p) => [p.kind, p.finishedAt, p.warning])).toEqual([
      ["fast", null, null],
      ["slow", null, null],
    ]);
    await s.pass("fast");
    await s.pass("slow");
    const v = s.passes();
    expect(v[0]).toMatchObject({ kind: "fast", finishedAt: "2026-11-17T13:55:00Z", warning: null });
    expect(typeof v[1]!.ms).toBe("number");
    t = t.add({ minutes: 20 });
    expect(s.passes()[1]!.warning).toMatch(/hasn't finished for 20 minutes while someone is using FocusTime/);
    busy = false;
    expect(s.passes()[1]!.warning).toBeNull();
  });
});
