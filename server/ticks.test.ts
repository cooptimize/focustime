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
import type { Conn } from "../store/sql/conn.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { addUsers, forEachDriver, type DriverCase } from "../test/db.ts";
import { keepRoute, takeRoute } from "./open-route.ts";
import { createScheduler } from "./scheduler.ts";
import { wakeStoreOn } from "../store/wake-store.ts";
import { personTicks } from "./ticks.ts";
import { backgroundPolicy } from "../config/background-policy.ts";

const PRODUCTION = backgroundPolicy({ FOCUSTIME_ENV: "prod" });

const NY = "America/New_York";
const MEDIA: HostMedia = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function machine(d: DriverCase) {
  const server = d.driver === "sqlserver" ? await d.open() : null;
  if (server) await addUsers(server.conn, "ana", "ben");
  const dir = mkdtempSync(join(tmpdir(), "focustime-ticks-"));
  dirs.push(dir);
  const path = join(dir, "plan.db");
  let at = Temporal.Instant.from("2026-11-02T13:40:00Z"); // Mon 8:40 AM in New York; work starts at 9:00.
  const shown: Notice[] = [];
  // As the settings rows put it together: the starter with the person's work email.
  const config = parseConfig(setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example"));
  if (!config.ok) throw new Error("bad test config");
  /** The server starting: a fresh process (nothing in memory) on the same store file, or the same SQL Server database. */
  function boot(o: { active?: () => boolean } = {}) {
    const raw = server ? null : openPlanDb({ path, now: () => at.toZonedDateTimeISO(NY) });
    const db: Conn = server ? server.conn : sqliteConn(raw!);
    const close = () => raw?.close();
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
    const ticks = personTicks({ policy: PRODUCTION, log: () => {}, now: () => at, notifications, media: MEDIA, openRoute: () => {} }, plan, ctx, { zone: NY });
    const scheduler = createScheduler({ policy: PRODUCTION, people: () => [ticks], log: () => {}, now: () => at, wakeStore: wakeStoreOn(db, () => at), ...(o.active ? { active: o.active } : {}) });
    const passes = async () => {
      await scheduler.pass("fast");
      await scheduler.pass("slow");
      await scheduler.pass("fast");
      // HK-1: wait for the notifier's deliveries themselves (a 20 ms sleep was too short on SQL Server under load).
      await ticks.settled!();
    };
    /** One beat of the clock every 5 seconds (and a slow one every 30) from now until `until`. */
    const tickUntil = async (until: string) => {
      const end = Temporal.Instant.from(until);
      for (let n = 0; Temporal.Instant.compare(at, end) < 0; n++) {
        at = at.add({ seconds: 5 });
        await scheduler.beat("fast");
        if (n % 6 === 5) await scheduler.beat("slow");
      }
      await ticks.settled!();
    };
    return { db, close, plan, passes, ctx, scheduler, tickUntil, settled: () => ticks.settled!() };
  }
  return { boot, shown, config: config.config, setTime: (iso: string) => void (at = Temporal.Instant.from(iso)), now: () => at };
}

const count = (shown: Notice[], kind: string) => shown.filter((n) => n.kind === kind).length;

await forEachDriver("background work across a restart (A2)", (d) => {
  it("a running timer and a due reminder fire once after the server comes back, and not again", async () => {
    const m = await machine(d);
    const first = m.boot();
    const r = await timerAction({ plan: first.plan, config: async () => m.config, now: () => m.now().toString() }, "timer.start", { minutes: 25 });
    expect(r.ok).toBe(true);
    await first.passes();
    expect(count(m.shown, "timer")).toBe(0);
    expect(count(m.shown, "plan_day")).toBe(0);
    // The server stops (nothing in memory survives), and comes back at 9:20: the timer ended at 9:05, the day's plan
    // reminder came due at 9:00.
    first.close();
    m.setTime("2026-11-02T14:20:00Z");
    const second = m.boot();
    await second.passes();
    expect(count(m.shown, "timer")).toBe(1);
    expect(count(m.shown, "plan_day")).toBe(1);
    expect((await second.plan.getState<{ ended: boolean }>(TIMER_KEY))?.ended).toBe(true);
    // More passes: nothing again.
    const before = m.shown.length;
    await second.passes();
    m.setTime("2026-11-02T14:21:00Z");
    await second.passes();
    expect(m.shown.length).toBe(before);
    // Another restart: still nothing again.
    second.close();
    const third = m.boot();
    await third.passes();
    expect(count(m.shown, "timer")).toBe(1);
    expect(count(m.shown, "plan_day")).toBe(1);
    third.close();
  });

  it("a clicked notification's view waits in the person's store across a restart, for 2 minutes, taken once", async () => {
    const m = await machine(d);
    const a = m.boot();
    expect((await keepRoute(a.plan, "today", m.now()))).toBe(true);
    expect((await keepRoute(a.plan, "javascript:alert(1)", m.now()))).toBe(false);
    a.close();
    m.setTime("2026-11-02T13:41:00Z");
    const b = m.boot();
    expect((await takeRoute(b.plan, m.now()))).toBe("today");
    expect((await takeRoute(b.plan, m.now()))).toBeNull();
    await keepRoute(b.plan, "today", m.now());
    m.setTime("2026-11-02T13:43:01Z");
    expect((await takeRoute(b.plan, m.now()))).toBeNull();
    // Another person's store never has it.
    await keepRoute(b.plan, "today", m.now());
    expect((await takeRoute(planStoreOn(b.db, { userId: "ben", now: () => m.now().toZonedDateTimeISO(NY) }), m.now()))).toBeNull();
    b.close();
  });

  it("the idle rule (A3): with nobody using FocusTime, no database call until the stored next-due time", async () => {
    const m = await machine(d);
    const a = m.boot({ active: () => false });
    // Start at 8:40: the passes run once, then the next-due time is worked out and stored: 9:00, when work starts.
    await a.scheduler.first();
    expect(a.scheduler.wakeAt()?.toString()).toBe("2026-11-02T14:00:00Z");
    // 19 minutes of the clock (228 beats): not one statement.
    const before = a.db.statements;
    await a.tickUntil("2026-11-02T13:59:55Z");
    expect(a.db.statements - before).toBe(0);
    expect(count(m.shown, "plan_day")).toBe(0);
    // 9:00: it wakes, the day's plan reminder goes, and it sleeps again until the next moment.
    await a.tickUntil("2026-11-02T14:00:00Z");
    expect(count(m.shown, "plan_day")).toBe(1);
    const next = a.scheduler.wakeAt()!;
    expect(Temporal.Instant.compare(next, m.now())).toBe(1);
    a.close();
    // A restart before the stored time. SQL Server: the one read of it, and nothing else until then. SQLite keeps the
    // time in memory (it never pauses), so it runs the passes once, which find nothing new to do.
    m.setTime("2026-11-02T14:00:30Z");
    const b = m.boot({ active: () => false });
    const s0 = b.db.statements;
    await b.scheduler.first();
    if (d.driver === "sqlserver") {
      expect(b.db.statements - s0).toBe(1);
      expect(b.scheduler.wakeAt()?.toString()).toBe(next.toString());
    }
    await b.settled();
    expect(count(m.shown, "plan_day")).toBe(1);
    b.close();
  });

  it("a timer started while someone is active is in the stored time, so a restart with nobody there still ends it on time", async () => {
    if (d.driver !== "sqlserver") return; // SQLite keeps the time in memory only.
    const m = await machine(d);
    const a = m.boot({ active: () => true });
    await a.scheduler.first();
    const r = await timerAction({ plan: a.plan, config: async () => m.config, now: () => m.now().toString() }, "timer.start", { minutes: 25 });
    expect(r.ok).toBe(true);
    await a.tickUntil("2026-11-02T13:40:30Z");
    a.close();
    // Restart; nobody comes back. The timer ends at 9:05 (14:05Z); the stored time is no later than its 5-minute recheck.
    const b = m.boot({ active: () => false });
    await b.scheduler.first();
    expect(Temporal.Instant.compare(b.scheduler.wakeAt()!, Temporal.Instant.from("2026-11-02T13:45:30Z"))).toBeLessThanOrEqual(0);
    await b.tickUntil("2026-11-02T14:05:30Z");
    expect(count(m.shown, "timer")).toBe(1);
    b.close();
  });

  it("while someone is using FocusTime the passes run every beat", async () => {
    const m = await machine(d);
    const a = m.boot({ active: () => true });
    await a.scheduler.first();
    const before = a.db.statements;
    await a.tickUntil("2026-11-02T13:41:00Z");
    expect(a.db.statements - before).toBeGreaterThan(0);
    expect(a.scheduler.wakeAt()).toBeNull();
    a.close();
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
    const s = createScheduler({ policy: PRODUCTION, people: () => [slowJob, failing, ok], log: (r) => logs.push(r) });
    const p = s.pass("fast");
    expect(await s.pass("fast")).toBe(0);
    expect(await s.pass("slow")).toBe(3);
    release();
    expect(await p).toBe(3);
    expect(ran.sort()).toEqual(["a", "a-slow", "c"]);
    expect(logs).toEqual([{ source: "plan", op: "scheduler", kind: "fast_failed", count: 1 }]);
  });
});
