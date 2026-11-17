// VM-3: every way the automatic start can end from the planned time on, and what the person sees for each: the log
// word once that day, the chip and its menu, the notice once when notices are allowed, Settings' line, whether the day
// counts as tried, and all of it gone the next day. Then the "Next:" line at each moment of a day, PTO and holidays
// that can't be read, the write log's row for a VM that can't be found, and the gate. Fake Azure; fictional data only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML } from "../fixtures/four-day-week.ts";
import type { LogRecord } from "../log/logger.ts";
import type { Notice } from "../plan/notify.ts";
import { OUTCOMES, type OutcomeReason } from "../plan/vm-autostart.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "./account.ts";
import { autoStartCheck, NO_VM_MESSAGE, type AutoStartDeps } from "./vm-autostart.ts";
import { AUTOSTART_KEY, clearVmState, readAutoStart, vmAction, vmKey, type VmContext, type VmStatus } from "./vm-actions.ts";

const SUB = "00000000-0000-4000-8000-0000000000ad";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-kim-01`;
const NY = "America/New_York";
const OID = "0f0f0f0f-4444-4222-8333-444455556666";
const TODAY = "2026-11-11";
const tomlWith = (auto: string) => `${FOUR_DAY_TOML.replace('my_email = ""', 'my_email = "kim@example.com"')}\n[azure]\n${auto}\n`;
const ON = tomlWith("auto_start = true\nauto_start_minutes = 5");
const cfgOf = (toml: string) => {
  const p = parseConfig(toml);
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.config;
};
const WS = cfgOf(ON).week.hours.weekdays.wed[0]!.start;
const at = (hm: string, date = TODAY) => Temporal.PlainDateTime.from(`${date}T${hm}`).toZonedDateTime(NY).toInstant().toString();
const shift = (hm: string, m: number) => Temporal.PlainTime.from(hm).add({ minutes: m }).toString().slice(0, 5);
const PLANNED = shift(WS, -5);

type W = {
  start?: string;
  toml?: string;
  pto?: readonly string[] | null;
  holidays?: readonly string[] | null;
  armToken?: () => Promise<string>;
  power?: "deallocated" | "running";
  noVmRecord?: boolean;
  vmGone?: boolean;
  state?: Record<string, unknown>;
};

beforeEach(() => clearVmState());

async function world(o: W = {}) {
  let t = Date.parse(o.start ?? at(PLANNED));
  const clock = { now: () => new Date(t).toISOString(), advance: (ms: number) => void (t += ms), set: (iso: string) => void (t = Date.parse(iso)) };
  const arm = fakeArm({ now: () => t, transitionMs: 30_000 });
  arm.addVm({ id: VM, name: "vm-kim-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: {}, power: o.power ?? "deallocated" }, { time: "1900" });
  if (o.vmGone) arm.vms.delete(VM.toLowerCase());
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO(NY) });
  const account: MicrosoftAccount = {
    signIn: async () => ({ status: "connected" }),
    identity: async () => ({ oid: OID, tid: "t", name: "Kim Example", username: "kim@example.com", email: "kim@example.com" }),
    armToken: o.armToken ?? (async () => "FAKE-ARM"),
    writeAccess: async () => ({ status: "read_only", message: "x" }),
    signOut: async () => {},
  };
  const reads = { daysOff: 0 };
  const vm = (env: string | undefined = "prod"): VmContext => ({
    plan,
    config: async () => cfgOf(o.toml ?? ON),
    account,
    azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    focusRunning: async () => false,
    workday: async () => true,
    ...(env !== undefined ? { autoStartEnv: env } : {}),
    daysOff: async (_c, from, to) => {
      reads.daysOff++;
      const pick = (x: readonly string[] | null | undefined) => (x === null ? null : new Set((x ?? []).filter((d) => d >= from && d <= to)));
      return { pto: pick(o.pto), holidays: pick(o.holidays) };
    },
  });
  const sent: Notice[] = [];
  const logs: LogRecord[] = [];
  let allows = true;
  const deps = (env: string | undefined = "prod"): AutoStartDeps => ({
    env,
    plan,
    config: async () => cfgOf(o.toml ?? ON),
    vm: async () => vm(env),
    now: () => Temporal.Instant.from(clock.now()),
    allows: () => allows,
    send: async (n) => void sent.push(n),
    log: (r) => void logs.push(r),
  });
  await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Kim Example", username: "kim@example.com", email: "kim@example.com", systemUserId: null });
  if (!o.noVmRecord) await plan.setAccountState(vmKey(OID), { id: VM, name: "vm-kim-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", chosenAt: clock.now() });
  await plan.setState(AUTOSTART_KEY, { onSince: "2026-11-09", lastUseOn: TODAY, ...o.state });
  const status = async (env: string | undefined = "prod") => {
    const r = await vmAction(vm(env), "vm.status", {});
    if (!r.ok) throw new Error(r.error);
    return r.data as VmStatus;
  };
  return {
    clock, arm, plan, sent, logs, reads, deps, vm, status,
    quiet: (q: boolean) => void (allows = !q),
    starts: () => arm.calls.filter((c) => c.method === "POST" && c.path.endsWith("/start")).length,
    words: () => logs.filter((l) => l.op === "vm_autostart").map((l) => l.kind),
  };
}

/** Each reason: how to get it at the planned time. */
const CASES: { reason: OutcomeReason; w: W; at?: string }[] = [
  { reason: "pto", w: { pto: [TODAY] } },
  { reason: "holiday", w: { holidays: [TODAY] } },
  { reason: "pto_unreadable", w: { pto: null } },
  { reason: "sign_in", w: { armToken: () => Promise.reject(new AuthFailure("expired", "x")) } },
  { reason: "no_vm", w: { noVmRecord: true } },
  { reason: "refused", w: { vmGone: true } },
  { reason: "not_running", w: {}, at: shift(WS, 61) },
  { reason: "already_on", w: { power: "running" } },
  { reason: "skipped", w: { state: { skipped: [TODAY] } } },
  { reason: "not_chosen", w: { toml: tomlWith('auto_start = true\nauto_start_minutes = 5\nauto_start_off_days = ["wed"]') } },
  { reason: "started", w: {} },
];

describe("VM-3: each reason, from the planned time on", () => {
  for (const c of CASES) {
    it(`${c.reason}: ${OUTCOMES[c.reason].tell ? "told once" : "not told"}, logged once, ${OUTCOMES[c.reason].tried ? "the day tried" : "not tried"}, gone the next day`, async () => {
      const w = await world({ ...c.w, start: at(c.at ?? PLANNED) });
      expect(await autoStartCheck(w.deps())).toBe(c.reason);
      // A second pass: the same, nothing more logged or told, no start.
      w.clock.advance(30_000);
      await autoStartCheck(w.deps());
      expect(w.words().filter((k) => k === OUTCOMES[c.reason].log), "logged once").toHaveLength(1);
      const tell = OUTCOMES[c.reason].tell;
      const told = w.sent.filter((n) => n.key.startsWith("vm_auto") && !n.key.startsWith("vm_auto:"));
      expect(told, "the notice").toHaveLength(tell ? 1 : 0);
      expect(w.starts()).toBe(c.reason === "started" ? 1 : 0);
      const s = await readAutoStart(w.plan);
      expect(s.attemptedOn === TODAY, "tried").toBe(OUTCOMES[c.reason].tried);
      expect(s.outcome).toMatchObject({ date: TODAY, reason: c.reason });
      // With no VM record there is no chip and no form (Settings asks to find the VM): the notice is the place.
      if (c.reason === "no_vm") return;
      // The chip and its menu (the view), and Settings' line.
      const st = await w.status();
      if (tell && c.reason !== "sign_in") expect(st.autoStart?.leftOff).toMatchObject({ reason: c.reason, short: OUTCOMES[c.reason].text, seen: false });
      if (c.reason === "sign_in") expect(st.autoStart?.signInProblem).toEqual({ seen: false });
      if (!tell) expect(st.autoStart?.leftOff).toBeNull();
      if (tell) expect(st.autoStart?.line).toMatch(new RegExp(`^${OUTCOMES[c.reason].text}\\.`));
      if (tell) expect(st.autoStart?.line).toMatch(/Next: Thu, Nov 12 at \d+:\d\d AM/);
      if (c.reason === "started") expect(st.autoStart?.line).toMatch(/^Started today at \d+:\d\d AM\. Next: Thu, Nov 12/);
      // The menu marks it seen; the reason stays.
      if (tell && c.reason !== "sign_in") {
        expect((await vmAction(w.vm(), "vm.autostart_seen", { what: "left_off" })).ok).toBe(true);
        expect((await w.status()).autoStart?.leftOff).toMatchObject({ reason: c.reason, seen: true });
      }
      // The next day: cleared.
      w.clock.set(at("06:00", "2026-11-12"));
      const next = await w.status();
      expect(next.autoStart?.leftOff).toBeNull();
      // (After a start or with the VM already on, it is still running the next morning, so that day is left out too.)
      expect(next.autoStart?.line).toMatch(c.reason === "started" || c.reason === "already_on" ? /^Next: / : /^Next: Thu, Nov 12 at/);
    });
  }

  it("a reason told while notices are quiet waits, and goes out once when they may", async () => {
    const w = await world({ pto: null });
    w.quiet(true);
    await autoStartCheck(w.deps());
    expect(w.sent).toEqual([]);
    w.clock.advance(60_000);
    await autoStartCheck(w.deps());
    expect(w.sent).toEqual([]);
    w.quiet(false);
    w.clock.advance(60_000);
    await autoStartCheck(w.deps());
    w.clock.advance(60_000);
    await autoStartCheck(w.deps());
    expect(w.sent.map((n) => [n.key, n.title])).toEqual([[`vm_auto_left:${TODAY}`, "Your VM was left off"]]);
    expect(w.sent[0]!.body).toBe("Left off today: FocusTime couldn't read your PTO. Start it from the VM menu if you need it today.");
  });

  it("before the planned time nothing is decided, logged or told", async () => {
    const w = await world({ pto: [TODAY], start: at(shift(PLANNED, -1)) });
    expect(await autoStartCheck(w.deps())).toBe("not_due");
    expect(w.logs).toEqual([]);
    expect(w.sent).toEqual([]);
    expect((await readAutoStart(w.plan)).outcome).toBeNull();
  });
});

describe('VM-3: the "Next:" line at each moment of a day', () => {
  it("before the planned time: today's time", async () => {
    const w = await world({ start: at("06:00") });
    expect((await w.status()).autoStart?.line).toMatch(/^Next: Wed, Nov 11 at \d+:\d\d AM$/);
  });
  it("after it, with no pass yet: today's start hasn't run, then tomorrow; never today's time as still to come", async () => {
    const w = await world({ start: at(shift(PLANNED, 2)) });
    expect((await w.status()).autoStart?.line).toMatch(/^Today's start \(\d+:\d\d AM\) hasn't run yet\. Next: Thu, Nov 12 at/);
  });
  it("after it, the VM started: when, then tomorrow", async () => {
    const w = await world();
    await autoStartCheck(w.deps());
    expect((await w.status()).autoStart?.line).toMatch(/^Started today at \d+:\d\d AM\. Next: Thu, Nov 12 at/);
  });
  it("after the late limit, nothing tried: FocusTime wasn't running, then tomorrow", async () => {
    const w = await world({ start: at(shift(WS, 75)) });
    await autoStartCheck(w.deps());
    expect((await w.status()).autoStart?.line).toMatch(/^Left off today: FocusTime wasn't running at the time\. Next: Thu, Nov 12 at/);
  });
  it("on PTO and on a holiday: said, then the next day", async () => {
    for (const [o, words] of [[{ pto: [TODAY] }, "it is PTO"], [{ holidays: [TODAY] }, "it is a holiday"]] as const) {
      const w = await world(o);
      await autoStartCheck(w.deps());
      expect((await w.status()).autoStart?.line).toMatch(new RegExp(`^Left off today: ${words}\\. Next: Thu, Nov 12 at`));
    }
  });
  it("PTO or holidays that can't be read: the line says so instead of leaving them out", async () => {
    const w = await world({ start: at("06:00"), pto: null });
    expect((await w.status()).autoStart?.line).toMatch(/^Next: Wed, Nov 11 at \d+:\d\d AM Your PTO couldn't be read, so a day off may still show a time\.$/);
    const h = await world({ start: at("06:00"), holidays: null });
    expect((await h.status()).autoStart?.line).toMatch(/^Next: Wed, Nov 11 at \d+:\d\d AM Holidays couldn't be checked\.$/);
  });
});

describe("VM-3: PTO and holidays that can't be read", () => {
  it("holidays unreadable: it starts and says once that holidays couldn't be checked", async () => {
    const w = await world({ holidays: null });
    expect(await autoStartCheck(w.deps())).toBe("started");
    expect(w.starts()).toBe(1);
    expect(w.sent.map((n) => n.title)).toEqual(["Your VM is starting"]);
    expect(w.sent[0]!.body).toMatch(/before your day\. Holidays couldn't be checked\.$/);
    expect(w.words()).toEqual(["started", "holidays_unchecked"]);
    expect((await w.status()).autoStart?.line).toMatch(/^Started today at \d+:\d\d AM\. Holidays couldn't be checked\. Next:/);
  });

  it("PTO unreadable with a read from this morning: it uses that read and says so", async () => {
    const morning = { at: at("06:30"), from: TODAY, to: "2026-11-24", days: [] };
    const w = await world({ pto: null, state: { ptoRead: morning } });
    expect(await autoStartCheck(w.deps())).toBe("started");
    expect(w.sent[0]!.body).toMatch(/Your PTO couldn't be read just now, so FocusTime used what it read earlier\.$/);
    expect(w.words()).toEqual(["started", "pto_earlier"]);
    // That read said today is PTO: left off for PTO, said so.
    const off = await world({ pto: null, state: { ptoRead: { ...morning, days: [TODAY] } } });
    expect(await autoStartCheck(off.deps())).toBe("pto");
    expect(off.starts()).toBe(0);
  });

  it("PTO unreadable with nothing as recent as 24 hours: left off and told; a later pass that reads it still starts", async () => {
    const old = { at: Temporal.Instant.from(at(PLANNED)).subtract({ hours: 25 }).toString(), from: "2026-11-10", to: "2026-11-24", days: [] };
    const w = await world({ pto: null, state: { ptoRead: old } });
    expect(await autoStartCheck(w.deps())).toBe("pto_unreadable");
    expect(w.starts()).toBe(0);
    expect(w.sent.map((n) => n.title)).toEqual(["Your VM was left off"]);
    expect((await readAutoStart(w.plan)).attemptedOn).toBeNull();
  });

  it("the line's PTO read is kept for the start to fall back on", async () => {
    const w = await world({ start: at("06:00"), pto: ["2026-11-16"] });
    await w.status();
    expect((await readAutoStart(w.plan)).ptoRead).toMatchObject({ from: TODAY, to: "2026-11-24", days: ["2026-11-16"] });
  });
});

describe("VM-3: no VM record", () => {
  it("the try is in the write log as one that didn't start, with why", async () => {
    const w = await world({ noVmRecord: true });
    expect(await autoStartCheck(w.deps())).toBe("no_vm");
    const [row] = await w.plan.azureWriteLog();
    expect(row).toMatchObject({ op: "start", auto: true, status: "failed", message: NO_VM_MESSAGE });
    expect(w.arm.calls).toEqual([]);
  });
});

describe("VM-3: with the gate closed nothing is read, logged, told or started, for every new path", () => {
  for (const c of CASES) {
    it(c.reason, async () => {
      const w = await world({ ...c.w, start: at(c.at ?? PLANNED) });
      for (const env of ["dev", undefined, "", "Prod", "production"]) {
        const d = { ...w.deps("prod"), env };
        const guarded: AutoStartDeps = {
          ...d,
          plan: new Proxy(w.plan, { get: () => { throw new Error("store read outside production"); } }),
          config: async () => { throw new Error("settings read outside production"); },
          vm: async () => { throw new Error("VM read outside production"); },
        };
        expect(await autoStartCheck(guarded), String(env)).toBe("env");
      }
      expect(w.logs).toEqual([]);
      expect(w.sent).toEqual([]);
      expect(w.arm.calls).toEqual([]);
      // The status outside production reads no PTO for it and shows no reason, even with one stored.
      await w.plan.setState(AUTOSTART_KEY, { ...(await readAutoStart(w.plan)), outcome: { date: TODAY, reason: "pto_unreadable", at: at(PLANNED), notes: [], seen: false } });
      const st = await w.status("dev");
      expect(st.autoStart?.leftOff ?? null).toBeNull();
      expect(w.reads.daysOff).toBe(0);
    });
  }
});

describe("VM-3 review: the words match the clock", () => {
  it('a few minutes after the planned time but before the day: "before your day"; at or after the day\'s start: "after your day began"', async () => {
    const w = await world({ start: at(shift(PLANNED, 3)) });
    expect(await autoStartCheck(w.deps())).toBe("started");
    expect(w.sent[0]!.body).toMatch(/before your day\.$/);
    const l = await world({ start: at(shift(WS, 2)) });
    expect(await autoStartCheck(l.deps())).toBe("started_late");
    expect(l.sent[0]!.body).toMatch(/after your day began\.$/);
  });
  it("the chip's next start gets its date when it is more than six days away", async () => {
    // Tue Nov 10 to Thu Nov 12 skipped: the next start is Mon Nov 16, five days on (weekday only)...
    const w = await world({ start: at("12:00", "2026-11-10"), state: { skipped: ["2026-11-11", "2026-11-12"] } });
    expect((await w.status()).autoStart?.next?.short).toMatch(/^Mon \d+:\d\d AM$/);
    // ...and from Mon Nov 9, Mon Nov 16 is seven days on: the date too.
    const far = await world({ start: at("12:00", "2026-11-09"), state: { skipped: ["2026-11-10", "2026-11-11", "2026-11-12"] } });
    expect((await far.status()).autoStart?.next?.short).toMatch(/^Mon, Nov 16 \d+:\d\d AM$/);
  });
});
