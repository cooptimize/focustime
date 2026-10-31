import { describe, expect, it } from "vitest";
import { TIMER_KEY, timerAction } from "../actions/timer-actions.ts";
import { DEFAULT_PLAN, legacyHours, type AppConfig } from "../config/schema.ts";
import { startTimer, type TimerState } from "../plan/timer.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { checkTimer, type NotifyAction } from "./timer.ts";

const NY = "America/New_York";
const T = (hhmm: string) => Temporal.Instant.from(`2026-11-02T${hhmm}:00-05:00`);

function setup() {
  let clock = T("09:00");
  const plan = createPlanStore({ path: ":memory:", now: () => clock.toZonedDateTimeISO(NY) });
  const cfg = { plan: { ...DEFAULT_PLAN, pickablePortfolioTypes: [] }, week: { hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: NY }) } } as unknown as AppConfig;
  const run = (action: Parameters<typeof timerAction>[1], input?: unknown) => timerAction({ plan, config: async () => cfg, now: () => clock.toString() }, action, input);
  const sent: { title: string; body: string; actions?: NotifyAction[] }[] = [];
  let answer: string | null = null;
  const acted: string[] = [];
  let sounds = 0;
  let endSound = false;
  const deps = {
    plan,
    now: () => clock,
    endSound: async () => endSound,
    notify: async (title: string, body: string, actions?: NotifyAction[]) => (sent.push({ title, body, ...(actions ? { actions } : {}) }), answer),
    sound: () => void sounds++,
    act: async (a: "timer.done" | "timer.extend" | "timer.next") => (acted.push(a), run(a)),
  };
  return {
    plan, run, sent, acted, deps,
    at: (hhmm: string) => (clock = T(hhmm)),
    answer: (k: string | null) => (answer = k),
    sound: (on: boolean) => (endSound = on),
    sounds: () => sounds,
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const pickAt = (plan: ReturnType<typeof createPlanStore>, title: string, size: "S" | "M" | "L" = "S") => plan.addPick({ date: "2026-11-02", half: "AM", clientKey: "CSC", kind: "intention", title, size });

describe("focus timer on the server (step 6c)", () => {
  it("keeps its state across a restart of the store", async () => {
    const t = setup();
    await t.run("timer.start", { minutes: 25 });
    const raw = t.plan.getState<TimerState>(TIMER_KEY);
    expect(raw).toMatchObject({ kind: "focus", plannedMinutes: 25, runningSince: T("09:00").toString() });
    t.at("09:10");
    const r = await t.run("timer.pause");
    expect(r).toMatchObject({ ok: true, data: { timer: { running: false, remainingMs: 15 * 60_000 } } });
  });

  it("ends on time with a notification offering Done, +15 min and Next pick, and records focused time on the pick", async () => {
    const t = setup();
    const a = pickAt(t.plan, "Write the summary");
    const b = pickAt(t.plan, "Review the PR");
    await t.run("timer.start", { pickId: a.id, minutes: 25 });
    t.at("09:24");
    expect(await checkTimer(t.deps)).toBeNull();
    t.at("09:40"); // noticed late: still ends at 9:25
    t.answer("next");
    expect(await checkTimer(t.deps)).toBe("ended");
    await flush();
    expect(t.sent[0]).toMatchObject({ title: "Focus session done", body: "Write the summary", actions: [{ key: "done" }, { key: "extend" }, { key: "next" }] });
    expect(t.acted).toEqual(["timer.next"]);
    expect(t.plan.focusedSeconds([a.id])).toEqual({ [a.id]: 1500 });
    // Next pick: the next planned pick, suggested from its size (S = 60 min).
    expect(t.plan.getState<TimerState>(TIMER_KEY)).toMatchObject({ pickId: b.id, plannedMinutes: 60, ended: false });
    // Ending sends one notification only.
    expect(await checkTimer(t.deps)).toBeNull();
  });

  it("Done ticks the pick done; +15 runs again from now; the end sound only when turned on", async () => {
    const t = setup();
    const a = pickAt(t.plan, "Write the summary");
    await t.run("timer.start", { pickId: a.id, minutes: 5 });
    t.at("09:05");
    t.answer("extend");
    t.sound(true);
    await checkTimer(t.deps);
    await flush();
    expect(t.sounds()).toBe(1);
    expect(t.plan.getState<TimerState>(TIMER_KEY)).toMatchObject({ plannedMinutes: 20, ended: false, runningSince: T("09:05").toString() });
    t.at("09:20");
    t.answer("done");
    await checkTimer(t.deps);
    await flush();
    expect(t.plan.getState(TIMER_KEY)).toBeNull();
    expect(t.plan.getPick(a.id)?.status).toBe("done");
    expect(t.plan.focusedSeconds([a.id])).toEqual({ [a.id]: 20 * 60 });
  });

  it("a choice made in the window first wins; a late notification answer does nothing", async () => {
    const t = setup();
    await t.run("timer.start", { minutes: 5 });
    t.at("09:06");
    let release: (k: string | null) => void = () => {};
    t.deps.notify = (title, body, actions) => (t.sent.push({ title, body, ...(actions ? { actions } : {}) }), new Promise((r) => (release = r)));
    await checkTimer(t.deps);
    await t.run("timer.stop");
    release("extend");
    await flush();
    expect(t.acted).toEqual([]);
    expect(t.plan.getState(TIMER_KEY)).toBeNull();
  });

  it("warns 5 minutes before a meeting or the end of the block, once, even mid-session; not while paused", async () => {
    const t = setup();
    t.plan.setState("warn_points", { date: "2026-11-02", points: [{ key: "event:outlook:1", at: T("10:00").toString(), label: "Standup at 10:00 AM" }, { key: "end:AM", at: T("12:30").toString(), label: "The morning ends at 12:30 PM" }] });
    t.plan.setState(TIMER_KEY, startTimer(T("09:30"), { kind: "focus", pickId: null, label: "Focus", minutes: 120 }));
    t.at("09:54");
    expect(await checkTimer(t.deps)).toBeNull();
    t.at("09:56");
    expect(await checkTimer(t.deps)).toBe("warned");
    expect(t.sent.at(-1)).toEqual({ title: "In 5 minutes", body: "Standup at 10:00 AM" });
    t.at("09:58");
    expect(await checkTimer(t.deps)).toBeNull();
    await t.run("timer.pause");
    t.at("12:26");
    expect(await checkTimer(t.deps)).toBeNull();
  });

  it("refuses bad input and a pick that isn't planned", async () => {
    const t = setup();
    expect(await t.run("timer.start", { minutes: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await t.run("timer.start", { kind: "nap" })).toMatchObject({ ok: false, status: 400 });
    expect(await t.run("timer.pause")).toMatchObject({ ok: false, status: 409 });
    const a = pickAt(t.plan, "x");
    t.plan.setDone(a.id, true);
    expect(await t.run("timer.start", { pickId: a.id })).toMatchObject({ ok: false, status: 409 });
    expect(await t.run("plan.reset", { confirm: "yes" })).toMatchObject({ ok: false, status: 422 });
  });

  it("lists open loops and closes one with a note; reset needs the typed confirmation", async () => {
    const t = setup();
    t.plan.addFlex({ date: "2026-11-01", clientKey: "CSC", start: "2026-11-01T15:00:00Z", end: "2026-11-01T16:00:00Z" });
    const list = await t.run("loops.list", {});
    const loops = (list as { data: { loops: { id: number; what: string; session: unknown }[] } }).data.loops;
    expect(loops).toHaveLength(1);
    // Its when is the session it came from.
    expect(loops[0]!.session).toEqual({ start: "2026-11-01T15:00:00Z", end: "2026-11-01T16:00:00Z" });
    expect(await t.run("loop.close", { id: loops[0]!.id, note: "Posted" })).toMatchObject({ ok: true, data: { loop: { closeNote: "Posted" } } });
    expect((await t.run("loops.list", {}) as { data: { loops: unknown[] } }).data.loops).toEqual([]);
    expect((await t.run("loops.list", { includeClosed: true }) as { data: { loops: unknown[] } }).data.loops).toHaveLength(1);
    expect(await t.run("plan.reset", { confirm: "reset" })).toMatchObject({ ok: true });
    expect((await t.run("loops.list", { includeClosed: true }) as { data: { loops: unknown[] } }).data.loops).toEqual([]);
  });
});
