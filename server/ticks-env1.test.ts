// ENV-1: a person's passes on a test site. Production sends the day's reminder, a Web Push and the Teams rhythm; a test
// site sends nothing, touches no AI and no Teams status, unless the person switched "from this test site" on, and then
// gets the reminders, pushes and Teams messages and nothing else changes (Teams status stays untouched).
import { afterEach, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { TEAMS_STATUS_KEY } from "../actions/presence-actions.ts";
import { timerAction } from "../actions/timer-actions.ts";
import { backgroundPolicy, type BackgroundPolicy } from "../config/background-policy.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Notice } from "../plan/notify.ts";
import { openPlanDb, planStoreOn } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { PushControl } from "./push.ts";
import { personTicks } from "./ticks.ts";
import { join } from "node:path";

const NY = "America/New_York";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function person(policy: BackgroundPolicy, o: { optIn?: boolean } = {}) {
  let at = Temporal.Instant.from("2026-11-02T13:40:00Z"); // Mon 8:40 AM in New York; work starts at 9:00.
  let toml = setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example");
  toml = setValue(toml, "notify", "teams_messages", true);
  if (o.optIn) toml = setValue(toml, "notify", "from_test_site", true);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error("bad test config");
  const dir = mkdtempSync(join(tmpdir(), "focustime-env1-"));
  const raw = openPlanDb({ path: join(dir, "plan.db"), now: () => at.toZonedDateTimeISO(NY) });
  closers.push(() => raw.close());
  const plan = planStoreOn(sqliteConn(raw), { userId: "ana", path: join(dir, "plan.db"), now: () => at.toZonedDateTimeISO(NY) });
  const shown: Notice[] = [];
  const pushed: Notice[] = [];
  const teamsTicks: string[] = [];
  const touched: string[] = [];
  const presenceCalls: string[] = [];
  const presence = { setMine: async () => void presenceCalls.push("set"), clearMine: async () => void presenceCalls.push("clear"), mine: async () => (presenceCalls.push("mine"), { availability: null, activity: null }), people: async () => new Map() };
  const notifications = {
    show: async (n: Notice, handle?: (h: string) => void) => (shown.push(n), handle?.(String(shown.length)), null),
    close: () => {},
    line: () => {},
  } as unknown as HostNotifications;
  const push: PushControl = { status: async () => ({}) as never, subscribe: async () => {}, remove: async () => false, send: async (n) => void pushed.push(n) };
  // Anything that would reach AI, Teams, chats or calls through the person's context is recorded.
  const ctx = new Proxy(
    {
      plan,
      loadConfig: async () => ({ path: "x", parsed: config }),
      now: () => at.toString(),
      makeDataverse: () => { throw new Error("no Dataverse here"); },
      makeOutlook: () => { throw new Error("no Outlook here"); },
      makeGoogle: () => { throw new Error("no Google here"); },
      account: () => ({ presence }),
    } as Record<string, unknown>,
    {
      get(t, k) {
        if (typeof k === "string" && ["ai", "account", "requests", "meetings", "team", "takes", "devopsNotes"].includes(k)) touched.push(k);
        return t[k as string];
      },
    },
  ) as unknown as ActionContext;
  const ticks = personTicks(
    { policy, log: () => {}, now: () => at, notifications, media: MEDIA, openRoute: () => {}, push, teams: { tick: async () => void teamsTicks.push("tick"), wake: async () => null } },
    plan,
    ctx,
    { zone: NY },
  );
  const passes = async () => {
    await ticks.fast();
    await ticks.slow();
    await ticks.fast();
    await ticks.settled!();
  };
  return { plan, shown, pushed, teamsTicks, touched, presenceCalls, passes, ticks, setTime: (iso: string) => void (at = Temporal.Instant.from(iso)), now: () => at };
}

const PROD = backgroundPolicy({ FOCUSTIME_ENV: "prod" });
const DEV = backgroundPolicy({ FOCUSTIME_ENV: "dev" });

describe("ENV-1: a person's passes outside production", () => {
  it("production: the day's reminder is shown and pushed, and the Teams rhythm runs (as before)", async () => {
    const p = await person(PROD);
    p.setTime("2026-11-02T14:20:00Z");
    await p.passes();
    expect(p.shown.map((n) => n.kind)).toContain("plan_day");
    expect(p.pushed.map((n) => n.kind)).toContain("plan_day");
    expect(p.teamsTicks.length).toBeGreaterThan(0);
  });

  it("a test site: no reminder, no push, no Teams message, no AI, chats, calls or Teams account touched", async () => {
    const p = await person(DEV);
    p.setTime("2026-11-02T14:20:00Z");
    await p.passes();
    p.setTime("2026-11-02T21:50:00Z"); // close out time too
    await p.passes();
    expect(p.shown).toEqual([]);
    expect(p.pushed).toEqual([]);
    expect(p.teamsTicks).toEqual([]);
    expect(p.touched).toEqual([]);
  });

  it("a test site with the person's switch on: reminders, pushes and Teams messages as production sends them; still no Teams status", async () => {
    const p = await person(DEV, { optIn: true });
    p.setTime("2026-11-02T14:20:00Z");
    await p.passes();
    expect(p.shown.map((n) => n.kind)).toContain("plan_day");
    expect(p.pushed.map((n) => n.kind)).toContain("plan_day");
    expect(p.teamsTicks.length).toBeGreaterThan(0);
    // A running timer on a test site never reaches Teams status, even with the switch on.
    await p.plan.setAccountState(TEAMS_STATUS_KEY, { session: null, set: "Busy", key: null, setAt: null, until: null, manual: false, error: null, errorAt: null, checkedAt: null });
    await timerAction({ plan: p.plan, config: async () => null, now: () => p.now().toString() }, "timer.start", { minutes: 25 });
    await p.passes();
    p.setTime("2026-11-02T14:50:00Z");
    await p.passes();
    expect(p.presenceCalls).toEqual([]);
  });

  it("the focus timer still ends on time on a test site (the person started it here)", async () => {
    const p = await person(DEV);
    await timerAction({ plan: p.plan, config: async () => null, now: () => p.now().toString() }, "timer.start", { minutes: 25 });
    p.setTime("2026-11-02T14:10:00Z");
    await p.passes();
    expect((await p.plan.getState<{ ended: boolean }>("timer"))?.ended).toBe(true);
    // Its notice shows in the page; no push without the switch.
    expect(p.shown.map((n) => n.kind)).toEqual(["timer"]);
    expect(p.pushed).toEqual([]);
  });

  for (const [label, policy, optIn, expected] of [
    ["a test site", DEV, false, 0],
    ["a test site, switch on", DEV, true, 1],
    ["production", PROD, false, 1],
  ] as const) {
    it(`a meeting warning during focus (a timed reminder): ${label}`, async () => {
      const p = await person(policy, { optIn });
      await timerAction({ plan: p.plan, config: async () => null, now: () => p.now().toString() }, "timer.start", { minutes: 50 });
      await p.plan.setState("warn_points", { date: "2026-11-02", points: [{ key: "m1", at: "2026-11-02T13:50:00Z", label: "A meeting at 8:50" }] });
      p.setTime("2026-11-02T13:47:00Z");
      await p.passes();
      expect(p.shown.filter((n) => n.kind === "meeting")).toHaveLength(expected);
    });
  }
});
