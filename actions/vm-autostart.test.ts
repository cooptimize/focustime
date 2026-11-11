// VM-2: the automatic start's runner against a fake Azure Resource Manager: production only (nothing read outside it),
// one start a day, the log row marked automatic, the notice, sign-in that can't be used, PTO, pausing, Skip, and dev
// beside prod on the same VM. Fictional data only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML } from "../fixtures/four-day-week.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { Notice } from "../plan/notify.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "./account.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { autoStartTick, autoStartWake, recordUse, type AutoStartDeps } from "./vm-autostart.ts";
import { AUTOSTART_KEY, clearVmState, settled, vmKey, vmAction, type VmContext, type VmStatus } from "./vm-actions.ts";

const SUB = "00000000-0000-4000-8000-0000000000ab";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-sam-01`;
const NY = "America/New_York";
const OID = "0f0f0f0f-2222-4222-8333-444455556666";
// Working hours from the four-day week fixture (Mon to Thu); the person's zone New York.
const tomlWith = (auto: string) => `${FOUR_DAY_TOML.replace('my_email = ""', 'my_email = "sam@example.com"')}\n[azure]\n${auto}\n`;
const ON = tomlWith("auto_start = true\nauto_start_minutes = 5");
const cfgOf = (toml: string) => {
  const p = parseConfig(toml);
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.config;
};

function world(o: { start: string; toml?: string; arm?: ReturnType<typeof fakeArm>; armToken?: () => Promise<string>; pto?: string[]; daysOffFails?: boolean } ) {
  let t = Date.parse(o.start);
  const clock = { now: () => new Date(t).toISOString(), advance: (ms: number) => void (t += ms), set: (iso: string) => void (t = Date.parse(iso)) };
  const arm = o.arm ?? fakeArm({ now: () => t, transitionMs: 30_000 });
  if (!arm.vms.has(VM.toLowerCase())) arm.addVm({ id: VM, name: "vm-sam-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "Sam Example" }, power: "deallocated" }, { time: "1900" });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO(NY) });
  const tokens = { n: 0 };
  const account: MicrosoftAccount = {
    signIn: async () => ({ status: "connected" }),
    identity: async () => ({ oid: OID, tid: "t", name: "Sam Example", username: "sam@example.com", email: "sam@example.com" }),
    armToken: o.armToken ?? (async () => (tokens.n++, "FAKE-ARM")),
    writeAccess: async () => ({ status: "read_only", message: "x" }),
    signOut: async () => {},
  };
  let toml = o.toml ?? ON;
  const reads = { config: 0 };
  const vm = (): VmContext => ({
    plan,
    config: async () => cfgOf(toml),
    account,
    azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    focusRunning: async () => false,
    workday: async () => true,
    autoStartEnv: "prod",
    daysOff: async (_c, from, to) => {
      if (o.daysOffFails) throw new Error("Dataverse down");
      return { pto: new Set((o.pto ?? []).filter((d) => d >= from && d <= to)), holidays: new Set() };
    },
  });
  const sent: Notice[] = [];
  let allows = true;
  const deps = (env: string | undefined): AutoStartDeps => ({
    env,
    plan,
    config: async () => (reads.config++, cfgOf(toml)),
    vm: async () => vm(),
    now: () => Temporal.Instant.from(clock.now()),
    allows: () => allows,
    send: async (n) => void sent.push(n),
    log: () => {},
  });
  const ctx = (): ActionContext => ({
    loadConfig: async () => ({ path: "/x", parsed: parseConfig(toml) }),
    makeDataverse: () => ({ pto: async () => ({ items: [] }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    plan,
    account: () => account,
    azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
    autoStartEnv: "prod",
  });
  return {
    clock, arm, plan, sent, tokens, reads, deps, vm, ctx,
    setToml: (x: string) => void (toml = x),
    quiet: (q: boolean) => void (allows = !q),
    starts: () => arm.calls.filter((c) => c.method === "POST" && c.path.endsWith("/start")).length,
    async init() {
      await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Sam Example", username: "sam@example.com", email: "sam@example.com", systemUserId: null });
      await plan.setAccountState(vmKey(OID), { id: VM, name: "vm-sam-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", chosenAt: clock.now() });
      // Opted in on Monday and used FocusTime today.
      await plan.setState(AUTOSTART_KEY, { onSince: "2026-11-09", lastUseOn: "2026-11-11" });
      return this;
    },
  };
}
// Wed Nov 11, 2026, New York (EST, UTC-5): working day from 8:00 in the fixture? Read it from the config.
const workStart = (toml = ON) => cfgOf(toml).week.hours.weekdays.wed[0]!.start;
const nyAt = (hm: string, date = "2026-11-11") => Temporal.PlainDateTime.from(`${date}T${hm}`).toZonedDateTime(NY).toInstant().toString();
const minus = (hm: string, m: number) => {
  const t = Temporal.PlainTime.from(hm).subtract({ minutes: m });
  return t.toString().slice(0, 5);
};

beforeEach(() => clearVmState());

async function status(ctx: VmContext, input: unknown): Promise<VmStatus> {
  const r = await vmAction(ctx, "vm.status", input);
  if (!r.ok) throw new Error(r.error);
  return r.data as VmStatus;
}

describe("production only", () => {
  it("anything but exactly prod returns before reading settings, state, the VM or a token", async () => {
    const w = await world({ start: nyAt(workStart()) }).init();
    for (const env of ["dev", "local", "demo", "", undefined, "Prod", "production", "prod "]) {
      const d = w.deps(env);
      const guarded: AutoStartDeps = {
        ...d,
        plan: new Proxy(w.plan, { get: () => { throw new Error("store read outside production"); } }),
        config: async () => { throw new Error("settings read outside production"); },
        vm: async () => { throw new Error("VM read outside production"); },
      };
      expect(await autoStartTick(guarded), String(env)).toBe("env");
    }
    expect(w.tokens.n).toBe(0);
    expect(w.arm.calls).toEqual([]);
    expect(w.sent).toEqual([]);
    expect(await autoStartWake({ env: "dev", now: () => Temporal.Now.instant(), config: cfgOf(ON) })).toBeNull();
  });

  it("dev and prod both opted in, the same person and the same VM: exactly one start, from prod", async () => {
    const ws = workStart();
    const prod = await world({ start: nyAt(minus(ws, 5)) }).init();
    const dev = await world({ start: nyAt(minus(ws, 5)), arm: prod.arm }).init();
    expect(await autoStartTick(dev.deps("dev"))).toBe("env");
    expect(await autoStartTick(prod.deps("prod"))).toBe("started");
    dev.clock.advance(10 * 60_000);
    expect(await autoStartTick(dev.deps("dev"))).toBe("env");
    await settled();
    expect(prod.starts()).toBe(1);
    expect(dev.sent).toEqual([]);
    expect(await dev.plan.azureWriteLog()).toEqual([]);
  });
});

describe("the start", () => {
  it("at my day's start less my minutes: starts, logs it as automatic, follows it, and says so once", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 6)) }).init();
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    expect(w.tokens.n).toBe(0);
    w.clock.advance(60_000);
    expect(await autoStartTick(w.deps("prod"))).toBe("started");
    const [row] = await w.plan.azureWriteLog();
    expect(row).toMatchObject({ op: "start", auto: true, before: { power: "deallocated", by: "automatic" } });
    const st = await status(w.vm(), { fresh: true });
    expect(st.chip).toBe("starting");
    await settled();
    expect((await w.plan.azureWriteLog())[0]).toMatchObject({ status: "confirmed" });
    expect(w.sent.map((n) => [n.key, n.title])).toEqual([["vm_auto:2026-11-11", "Your VM was started"]]);
    expect(w.sent[0]!.body).toMatch(/vm-sam-01 was started at \d+:\d\d AM/);
    // One a day: later passes do nothing.
    for (let i = 0; i < 5; i++) {
      w.clock.advance(60_000);
      w.arm.setPower(VM, "deallocated");
      expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    }
    expect(w.starts()).toBe(1);
    expect(w.arm.calls.filter((c) => c.path.includes("DevTestLab")).every((c) => c.method === "GET")).toBe(true);
  });

  it("before my working hours the notifier is quiet: the notice waits and goes out once it may", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 5)) }).init();
    w.quiet(true);
    expect(await autoStartTick(w.deps("prod"))).toBe("started");
    expect(w.sent).toEqual([]);
    w.clock.advance(6 * 60_000);
    w.quiet(false);
    await autoStartTick(w.deps("prod"));
    await autoStartTick(w.deps("prod"));
    expect(w.sent.map((n) => n.key)).toEqual(["vm_auto:2026-11-11"]);
  });

  it("two passes (or two server instances on one database) at once: one start", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 5)) }).init();
    const r = await Promise.all([autoStartTick(w.deps("prod")), autoStartTick(w.deps("prod")), autoStartTick(w.deps("prod"))]);
    expect(r.filter((x) => x === "started")).toHaveLength(1);
    expect(w.starts()).toBe(1);
  });

  it("a running VM isn't started (and the day is used up)", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 5)) }).init();
    w.arm.setPower(VM, "running");
    expect(await autoStartTick(w.deps("prod"))).toBe("not_stopped");
    w.arm.setPower(VM, "deallocated");
    w.clock.advance(5 * 60_000);
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    expect(w.starts()).toBe(0);
  });

  it("running late: starts within 60 minutes of my day's start, not after", async () => {
    const ws = workStart();
    const late = await world({ start: nyAt(ws) }).init();
    late.clock.advance(59 * 60_000);
    expect(await autoStartTick(late.deps("prod"))).toBe("started");
    clearVmState();
    const tooLate = await world({ start: nyAt(ws) }).init();
    tooLate.clock.advance(60 * 60_000);
    expect(await autoStartTick(tooLate.deps("prod"))).toBe("not_due");
    expect(tooLate.starts()).toBe(0);
  });

  it("PTO (even entered after the day began) or PTO that can't be read: the VM stays off", async () => {
    const ws = workStart();
    const pto = await world({ start: nyAt(minus(ws, 5)), pto: ["2026-11-11"] }).init();
    expect(await autoStartTick(pto.deps("prod"))).toBe("not_due");
    const unread = await world({ start: nyAt(minus(ws, 5)), daysOffFails: true }).init();
    expect(await autoStartTick(unread.deps("prod"))).toBe("not_due");
    expect(pto.starts() + unread.starts()).toBe(0);
  });

  it("working hours edited five minutes before: the new start time counts", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 5)) }).init();
    // Two hours later today: not due yet.
    const later = minus(ws, -120);
    w.setToml(ON.replace(new RegExp(`"${ws}-`, "g"), `"${later}-`));
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    expect(w.starts()).toBe(0);
  });

  it("no confirmed VM, or a VM deleted or moved: nothing is started, and it isn't retried", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 5)) }).init();
    w.arm.vms.delete(VM.toLowerCase());
    expect(await autoStartTick(w.deps("prod"))).toBe("failed");
    expect(w.sent.map((n) => n.title)).toEqual(["Auto-start couldn't start your VM"]);
    w.clock.advance(60_000);
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
  });
});

describe("Azure sign-in can't be used", () => {
  it("consent missing or the sign-in expired: no start, one notice with Allow Azure access, no retry loop", async () => {
    for (const kind of ["consent", "expired", "not_connected"] as const) {
      clearVmState();
      const ws = workStart();
      let asked = 0;
      const w = await world({ start: nyAt(minus(ws, 5)), armToken: async () => (asked++, Promise.reject(new AuthFailure(kind, "x"))) }).init();
      expect(await autoStartTick(w.deps("prod")), kind).toBe("sign_in");
      for (let i = 0; i < 10; i++) {
        w.clock.advance(60_000);
        expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
      }
      expect(asked).toBe(1);
      expect(w.arm.calls).toEqual([]);
      expect(w.sent.map((n) => [n.title, n.buttons.map((b) => b.label)])).toEqual([["Auto-start couldn't sign in to Azure", ["Allow Azure access"]]]);
      const st = await status(w.vm(), {});
      expect(st.autoStart?.signInProblem).toEqual({ seen: false });
    }
  });
});

describe("pausing, Resume and Skip", () => {
  it("after 3 working days without FocusTime it pauses, says so once, and Resume starts it again", async () => {
    const ws = workStart();
    // Last used Fri Nov 6 (no hours); Mon, Tue, Wed pass unused; Thu Nov 12 it's paused.
    const w = await world({ start: nyAt(minus(ws, 5), "2026-11-12") }).init();
    await w.plan.setState(AUTOSTART_KEY, { onSince: "2026-11-02", lastUseOn: "2026-11-06" });
    expect(await autoStartTick(w.deps("prod"))).toBe("paused");
    expect(w.starts()).toBe(0);
    const st = await status(w.vm(), {});
    expect(st.autoStart).toMatchObject({ paused: true, pauseNotice: true, next: null });
    await vmAction(w.vm(), "vm.autostart_seen", { what: "paused" });
    expect((await status(w.vm(), {})).autoStart).toMatchObject({ paused: true, pauseNotice: false });
    // Using FocusTime alone doesn't resume it; Resume does.
    await recordUse(w.plan, "2026-11-12");
    expect(await autoStartTick(w.deps("prod"))).toBe("paused");
    await vmAction(w.vm(), "vm.autostart_resume", {});
    expect(await autoStartTick(w.deps("prod"))).toBe("started");
  });

  it("Skip this one prevents the next start; Not today on Day's prompt skips today's", async () => {
    const ws = workStart();
    const w = await world({ start: nyAt(minus(ws, 30)) }).init();
    const skip = await dispatch(w.ctx(), { action: "vm.autostart_skip", input: {} });
    expect(skip).toMatchObject({ ok: true, data: { skipped: "2026-11-11" } });
    w.clock.advance(25 * 60_000);
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    // Tomorrow's still comes; Not today on Thursday skips Thursday's.
    w.clock.set(nyAt(minus(ws, 30), "2026-11-12"));
    await recordUse(w.plan, "2026-11-12");
    await dispatch(w.ctx(), { action: "vm.dismiss_prompt", input: {} });
    w.clock.advance(25 * 60_000);
    expect(await autoStartTick(w.deps("prod"))).toBe("not_due");
    expect(w.starts()).toBe(0);
  });
});

describe("the status's auto-start part", () => {
  it("outside production: the form's line says so and the chip's menu gets no time", async () => {
    const w = await world({ start: nyAt("06:00") }).init();
    const dev: VmContext = { ...w.vm(), autoStartEnv: "dev" };
    const st = await status(dev, {});
    expect(st.autoStart).toMatchObject({ on: true, prodOnly: true, next: null, line: "Auto-start runs only on the production FocusTime. Here it never starts your VM." });
    const unset: VmContext = { ...w.vm() };
    delete unset.autoStartEnv;
    expect((await status(unset, {})).autoStart).toMatchObject({ prodOnly: true, next: null });
  });

  it('in production: "Next: Wed, Nov 11 at …" and the chip\'s short time', async () => {
    const w = await world({ start: nyAt("06:00") }).init();
    const st = await status(w.vm(), {});
    expect(st.autoStart).toMatchObject({ on: true, prodOnly: false, minutes: 5, offDays: [], line: expect.stringMatching(/^Next: Wed, Nov 11 at \d+:\d\d AM$/), next: { date: "2026-11-11", short: expect.stringMatching(/^Wed \d+:\d\d AM$/) } });
    expect(st.autoStart?.days).toEqual(["mon", "tue", "wed", "thu"]);
  });

  it("the wake rule wakes the scheduler for the next planned start, in production only", async () => {
    const ws = workStart();
    const cfg: AppConfig = cfgOf(ON);
    const now = () => Temporal.Instant.from(nyAt("06:00"));
    expect((await autoStartWake({ env: "prod", now, config: cfg }))?.toString()).toBe(nyAt(minus(ws, 5)));
    expect(await autoStartWake({ env: "prod", now, config: cfgOf(tomlWith("auto_start = false")) })).toBeNull();
    expect(await autoStartWake({ env: undefined, now, config: cfg })).toBeNull();
  });
});
