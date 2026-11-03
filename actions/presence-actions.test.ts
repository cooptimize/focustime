// Step 16.3: focus sets my Teams status (set, refresh on +15, clear however it ends, hands off after a manual change,
// Settings), and teammates' presence (one batched read, words only, never kept, nothing when it can't be read).
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { HttpError } from "../sources/calendar/http.ts";
import type { PresenceClient, RawPresence } from "../sources/graph/presence.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "./account.ts";
import { dispatch, presenceContext, type ActionContext } from "./dispatch.ts";
import { syncTeamsStatus, TEAMS_STATUS_KEY, type PresencePeopleData, type TeamsStatusView } from "./presence-actions.ts";

const ME = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
const TOML = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(/(\[outlook\]\ntenant_id = "[^"]*"\n)client_id = ""/, '$1client_id = "44444444-4444-4444-8444-444444444444"');
const aad = (n: number) => `a4d00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEAM = [
  { id: "d1", name: "Jordan Lee", email: "jordan.lee@example.com", aadId: aad(1) },
  { id: "d2", name: "Priya Shah", email: "priya.shah@example.com", aadId: aad(2) },
  { id: "d3", name: "Sam Ortiz", email: "sam.ortiz@example.com", aadId: null },
];

async function setup(o: { toml?: string; signedIn?: boolean; fail?: unknown } = {}) {
  let t = Date.parse("2026-11-02T15:00:00Z");
  const clock = { now: () => new Date(t).toISOString(), advance: (min: number) => void (t += min * 60_000) };
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO("America/New_York") });
  if (o.signedIn !== false) (await plan.setAccountState(IDENTITY_KEY, { ...ME, signedInAt: clock.now(), systemUserId: null, systemUserEmail: null }));
  const calls: { op: string; oid?: string; status?: string; minutes?: number; ids?: string[] }[] = [];
  const g = { mine: "Busy" as string | null, fail: o.fail as unknown };
  const presence: PresenceClient = {
    setMine: async (oid, status, minutes) => {
      if (g.fail) throw g.fail;
      calls.push({ op: "set", oid, status, minutes });
    },
    clearMine: async (oid) => {
      if (g.fail) throw g.fail;
      calls.push({ op: "clear", oid });
    },
    mine: async (): Promise<RawPresence> => {
      if (g.fail) throw g.fail;
      calls.push({ op: "mine" });
      return { availability: g.mine, activity: g.mine };
    },
    people: async (ids) => {
      if (g.fail) throw g.fail;
      calls.push({ op: "people", ids: [...ids] });
      const all: Record<string, RawPresence> = { [aad(1)]: { availability: "Available", activity: "Available" }, [aad(2)]: { availability: "Busy", activity: "InAMeeting" } };
      return new Map(ids.filter((i) => all[i]).map((i) => [i, all[i]!]));
    },
  };
  const account: MicrosoftAccount = { signIn: async () => ({ status: "connected" }), identity: async () => ME, armToken: async () => "x", writeAccess: async () => ({ status: "read_only", message: "x" }), signOut: async () => {}, presence };
  let teamReads = 0;
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(o.toml ?? TOML) }),
    makeDataverse: () => ({ teammates: async () => (teamReads++, { ok: true, people: TEAM }), pto: async () => ({ items: [] }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: clock.now,
    plan,
    account: () => account,
  };
  const run = async <T = unknown>(action: string, input?: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  /** One sync, as the server's tick runs it (after the one a timer action starts on its own). */
  const sync = async () => syncTeamsStatus(await presenceContext(c));
  const writes = () => calls.filter((x) => x.op === "set" || x.op === "clear");
  return { c, plan, clock, calls, writes, g, run, sync, teamReads: () => teamReads };
}

describe("focus sets my Teams status", () => {
  it("start sets Busy on my own user for the time left plus 5 minutes; logged", async () => {
    const s = (await setup());
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    expect(s.writes()).toEqual([{ op: "set", oid: ME.oid, status: "Busy", minutes: 55 }]);
    expect((await s.plan.teamsStatusLog())).toMatchObject([{ op: "set", status: "Busy", minutes: 55, result: "done" }]);
    const v = await s.run<TeamsStatusView>("presence.status");
    expect(v).toMatchObject({ enabled: true, set: "Busy", until: "2026-11-02T15:55:00Z", manual: false });
    // Nothing more while nothing changes.
    s.clock.advance(10);
    await s.sync();
    expect(s.writes()).toHaveLength(1);
  });

  it("deep focus sets Do not disturb; switching during a session sets it again", async () => {
    const s = (await setup());
    await s.run("timer.start", { minutes: 30, deep: true });
    await s.sync();
    expect(s.writes().at(-1)).toMatchObject({ status: "DoNotDisturb", minutes: 35 });
    s.clock.advance(10);
    await s.run("timer.deep", { on: false });
    await s.sync();
    expect(s.writes().at(-1)).toMatchObject({ op: "set", status: "Busy", minutes: 25 });
  });

  it("+15 refreshes the expiration", async () => {
    const s = (await setup());
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    s.clock.advance(40);
    await s.run("timer.extend");
    await s.sync();
    expect(s.writes().map((w) => w.minutes)).toEqual([55, 30]);
  });

  for (const [how, end] of [
    ["Stop", async (s: Awaited<ReturnType<typeof setup>>) => void (await s.run("timer.stop"))],
    ["Done", async (s: Awaited<ReturnType<typeof setup>>) => void (await s.run("timer.done"))],
    ["Pause", async (s: Awaited<ReturnType<typeof setup>>) => void (await s.run("timer.pause"))],
    ["a break instead", async (s: Awaited<ReturnType<typeof setup>>) => void (await s.run("timer.start", { kind: "break" }))],
    ["the session ending on time", async (s: Awaited<ReturnType<typeof setup>>) => s.clock.advance(60)],
    ["abandoned (the timer gone, e.g. Reset local plan)", async (s: Awaited<ReturnType<typeof setup>>) => (await s.plan.setState("timer", null))],
  ] as const) {
    it(`${how} clears it (back to automatic)`, async () => {
      const s = (await setup());
      await s.run("timer.start", { minutes: 50 });
      await s.sync();
      await end(s);
      if (how === "the session ending on time") {
        // The server's timer tick ends it; here the stored state says ended.
        const st = (await s.plan.getState<{ runningSince: string | null; ended: boolean; elapsedMs: number; plannedMinutes: number }>("timer"))!;
        (await s.plan.setState("timer", { ...st, runningSince: null, ended: true, elapsedMs: st.plannedMinutes * 60_000 }));
      }
      await s.sync();
      expect(s.writes().at(-1)).toEqual({ op: "clear", oid: ME.oid });
      expect((await s.plan.teamsStatusLog())[0]).toMatchObject({ op: "clear", result: "done" });
      // Once.
      await s.sync();
      expect(s.writes().filter((w) => w.op === "clear")).toHaveLength(1);
    });
  }

  it("a restart still clears it: what FocusTime set is kept in account state", async () => {
    const s = (await setup());
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    expect((await s.plan.accountState<{ set: string }>(TEAMS_STATUS_KEY))?.set).toBe("Busy");
    await s.run("timer.stop");
    await s.sync();
    expect((await s.plan.accountState<{ set: string | null }>(TEAMS_STATUS_KEY))?.set).toBeNull();
  });

  it("a status I set by hand in Teams is not overridden, not even on +15, and is left at the end", async () => {
    const s = (await setup());
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    s.clock.advance(2);
    s.g.mine = "Available";
    await s.sync();
    expect((await s.plan.teamsStatusLog())[0]).toMatchObject({ op: "left" });
    await s.run("timer.extend");
    await s.sync();
    await s.run("timer.stop");
    await s.sync();
    expect(s.writes()).toHaveLength(1);
    // The next session sets it again.
    await s.run("timer.start", { minutes: 25 });
    await s.sync();
    expect(s.writes().at(-1)).toMatchObject({ op: "set", status: "Busy", minutes: 30 });
  });

  it("Settings > Focus: off sets nothing; plain focus can leave status alone (deep still sets Do not disturb)", async () => {
    const off = (await setup({ toml: `${TOML}\n[focus]\nteams_status = false\n` }));
    await off.run("timer.start", { minutes: 50, deep: true });
    await off.sync();
    expect(off.writes()).toEqual([]);
    expect(await off.run<TeamsStatusView>("presence.status")).toMatchObject({ enabled: false });
    const none = (await setup({ toml: `${TOML}\n[focus]\nplain_focus_status = "none"\n` }));
    await none.run("timer.start", { minutes: 50 });
    await none.sync();
    expect(none.writes()).toEqual([]);
    await none.run("timer.deep", { on: true });
    await none.sync();
    expect(none.writes()).toEqual([{ op: "set", oid: ME.oid, status: "DoNotDisturb", minutes: 55 }]);
  });

  it("no consent: nothing set, one failed log entry (not one a minute), and Settings can say Allow Teams status", async () => {
    const s = (await setup({ fail: new AuthFailure("consent", "x") }));
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    s.clock.advance(1);
    await s.sync();
    s.clock.advance(1);
    await s.sync();
    expect((await s.plan.teamsStatusLog())).toMatchObject([{ op: "set", result: "failed", message: expect.stringContaining("Allow Teams status") }]);
    expect(await s.run<TeamsStatusView>("presence.status", { check: true })).toMatchObject({ access: "consent", set: null });
  });

  it("signed out: nothing is attempted", async () => {
    const s = (await setup({ signedIn: false }));
    await s.run("timer.start", { minutes: 50 });
    await s.sync();
    expect(s.calls).toEqual([]);
    expect(await s.run<TeamsStatusView>("presence.status", { check: true })).toMatchObject({ access: "signed_out" });
  });
});

describe("teammates' presence", () => {
  it("one batched read for the people on screen (emails and exact names), words only", async () => {
    const s = (await setup());
    const r = await s.run<PresencePeopleData>("presence.people", { emails: ["Jordan.Lee@example.com", "sam.ortiz@example.com", "client@contoso.example"], names: ["Priya Shah", "Nobody"] });
    expect(s.calls).toEqual([{ op: "people", ids: [aad(1), aad(2)] }]);
    expect(r).toEqual({ available: true, reason: null, people: [{ email: "jordan.lee@example.com", name: "Jordan Lee", word: "Available" }, { email: "priya.shah@example.com", name: "Priya Shah", word: "In a meeting" }] });
  });

  it("is never kept: nothing about teammates in the plan store, the export or the Teams status log", async () => {
    const s = (await setup());
    await s.run("presence.people", { emails: ["jordan.lee@example.com", "priya.shah@example.com"] });
    const all = JSON.stringify((await s.plan.exportJson()));
    for (const x of [aad(1), aad(2), "Available", "InAMeeting", "In a meeting", "jordan"]) expect(all).not.toContain(x);
  });

  it("can't be read (no consent, error, signed out): shows nothing rather than a guess", async () => {
    for (const fail of [new AuthFailure("consent", "x"), new HttpError(403), new HttpError(500)]) {
      const s = (await setup({ fail }));
      expect(await s.run<PresencePeopleData>("presence.people", { emails: ["jordan.lee@example.com"] })).toMatchObject({ available: false, people: [] });
    }
    const out = (await setup({ signedIn: false }));
    expect(await out.run<PresencePeopleData>("presence.people", { emails: ["jordan.lee@example.com"] })).toEqual({ available: false, reason: "signed_out", people: [] });
    expect(out.calls).toEqual([]);
  });

  it("refuses odd input and more than 100 people", async () => {
    const s = (await setup());
    for (const bad of [{ emails: "x" }, { emails: [1] }, { other: [] }, { emails: Array.from({ length: 101 }, (_, i) => `p${i}@example.com`) }]) {
      const r = await dispatch(s.c, { action: "presence.people", input: bad });
      expect(r.ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });
});
