// A2: background work survives a restart. A focus timer is running and the day's plan reminder is not due yet when the
// server stops; both come due while it is down; after it starts again they fire on the first passes, once, and not
// again after another restart. The real tick code (server/ticks.ts) and scheduler on a store file on disk.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { TIMER_KEY, timerAction } from "../actions/timer-actions.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Notice } from "../plan/notify.ts";
import { openPlanDb, planStoreOn } from "../store/plan-store.ts";
import { keepRoute, takeRoute } from "./open-route.ts";
import { createScheduler } from "./scheduler.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const MEDIA: HostMedia = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function machine() {
  const dir = mkdtempSync(join(tmpdir(), "focustime-ticks-"));
  dirs.push(dir);
  const path = join(dir, "plan.db");
  let at = Temporal.Instant.from("2026-11-02T13:40:00Z"); // Mon 8:40 AM in New York; work starts at 9:00.
  const shown: Notice[] = [];
  // As the settings rows put it together: the starter with the person's work email.
  const config = parseConfig(setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example"));
  if (!config.ok) throw new Error("bad test config");
  /** The server starting: a fresh process (nothing in memory) on the same store file. */
  function boot() {
    const db = openPlanDb({ path, now: () => at.toZonedDateTimeISO(NY) });
    const plan = planStoreOn(db, { userId: "ana", path, now: () => at.toZonedDateTimeISO(NY) });
    const notifications: HostNotifications = {
      show: async (n: Notice, handle?: (h: string) => void) => {
        shown.push(n);
        handle?.(String(shown.length));
        return null;
      },
      close: () => {},
      line: () => {},
    } as unknown as HostNotifications;
    const ctx = {
      plan,
      loadConfig: async () => ({ path: "x", parsed: config }),
      now: () => at.toString(),
      makeDataverse: () => { throw new Error("no Dataverse here"); },
      makeOutlook: () => { throw new Error("no Outlook here"); },
      makeGoogle: () => { throw new Error("no Google here"); },
    } as unknown as ActionContext;
    const ticks = personTicks({ log: () => {}, now: () => at, notifications, media: MEDIA, openRoute: () => {} }, plan, ctx, { zone: NY });
    const scheduler = createScheduler({ people: () => [ticks], log: () => {} });
    const passes = async () => {
      await scheduler.pass("fast");
      await scheduler.pass("slow");
      await scheduler.pass("fast");
      // Let the notifier's deliveries settle.
      await new Promise((r) => setTimeout(r, 20));
    };
    return { db, plan, passes, ctx };
  }
  return { boot, shown, config: config.config, setTime: (iso: string) => void (at = Temporal.Instant.from(iso)), now: () => at };
}

const count = (shown: Notice[], kind: string) => shown.filter((n) => n.kind === kind).length;

describe("background work across a restart (A2)", () => {
  it("a running timer and a due reminder fire once after the server comes back, and not again", async () => {
    const m = machine();
    const first = m.boot();
    const r = await timerAction({ plan: first.plan, config: async () => m.config, now: () => m.now().toString() }, "timer.start", { minutes: 25 });
    expect(r.ok).toBe(true);
    await first.passes();
    expect(count(m.shown, "timer")).toBe(0);
    expect(count(m.shown, "plan_day")).toBe(0);
    // The server stops (nothing in memory survives), and comes back at 9:20: the timer ended at 9:05, the day's plan
    // reminder came due at 9:00.
    first.db.close();
    m.setTime("2026-11-02T14:20:00Z");
    const second = m.boot();
    await second.passes();
    expect(count(m.shown, "timer")).toBe(1);
    expect(count(m.shown, "plan_day")).toBe(1);
    expect(second.plan.getState<{ ended: boolean }>(TIMER_KEY)?.ended).toBe(true);
    // More passes: nothing again.
    const before = m.shown.length;
    await second.passes();
    m.setTime("2026-11-02T14:21:00Z");
    await second.passes();
    expect(m.shown.length).toBe(before);
    // Another restart: still nothing again.
    second.db.close();
    const third = m.boot();
    await third.passes();
    expect(count(m.shown, "timer")).toBe(1);
    expect(count(m.shown, "plan_day")).toBe(1);
    third.db.close();
  });

  it("a clicked notification's view waits in the person's store across a restart, for 2 minutes, taken once", async () => {
    const m = machine();
    const a = m.boot();
    expect(keepRoute(a.plan, "today", m.now())).toBe(true);
    expect(keepRoute(a.plan, "javascript:alert(1)", m.now())).toBe(false);
    a.db.close();
    m.setTime("2026-11-02T13:41:00Z");
    const b = m.boot();
    expect(takeRoute(b.plan, m.now())).toBe("today");
    expect(takeRoute(b.plan, m.now())).toBeNull();
    keepRoute(b.plan, "today", m.now());
    m.setTime("2026-11-02T13:43:01Z");
    expect(takeRoute(b.plan, m.now())).toBeNull();
    // Another person's store never has it.
    keepRoute(b.plan, "today", m.now());
    expect(takeRoute(planStoreOn(b.db, { userId: "ben", now: () => m.now().toZonedDateTimeISO(NY) }), m.now())).toBeNull();
    b.db.close();
  });
});

describe("the scheduler (A2)", () => {
  it("runs everyone, never overlaps a pass of its own kind, and one person's failure doesn't stop the rest", async () => {
    let release!: () => void;
    const ran: string[] = [];
    const slowJob = { fast: () => new Promise<void>((r) => (release = r)).then(() => void ran.push("a")), slow: async () => void ran.push("a-slow") };
    const failing = { fast: async () => { throw new Error("x"); }, slow: async () => {} };
    const ok = { fast: async () => void ran.push("c"), slow: async () => {} };
    const logs: unknown[] = [];
    const s = createScheduler({ people: () => [slowJob, failing, ok], log: (r) => logs.push(r) });
    const p = s.pass("fast");
    expect(await s.pass("fast")).toBe(0);
    expect(await s.pass("slow")).toBe(3);
    release();
    expect(await p).toBe(3);
    expect(ran.sort()).toEqual(["a", "a-slow", "c"]);
    expect(logs).toEqual([{ source: "plan", op: "scheduler", kind: "fast_failed", count: 1 }]);
  });
});
