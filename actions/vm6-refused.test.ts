// VM-6: why Azure refused the VM's state now and then (docs/ux/vm6/what-happened.md). Production's logs: every state
// read from one revision (and one in five from another) answered 403, with no Azure code where it was logged, whatever
// the token or the sign-in; the next revision's were answered. Not FocusTime's code and not a missing role. What the
// chip does about it: Azure's reason in plain words with when the state was last read, a sign-in ask shown as one, and
// a refused auto-shutdown read no longer hiding anything. Fictional VM and person only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML } from "../fixtures/four-day-week.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import type { IdClaims } from "../sources/oauth/idtoken.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { MicrosoftAccount } from "./account.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearVmState, type VmStatus } from "./vm-actions.ts";
import { PROBLEM_AFTER_MS, READ_PROBLEM, type VmReadFail } from "../plan/vm.ts";
import { userZone } from "../week/zone.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`;
const PAT: IdClaims = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
const TOML = FOUR_DAY_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(/(\[outlook\]\ntenant_id = "[^"]*"\n)client_id = ""/, '$1client_id = "44444444-4444-4444-8444-444444444444"');
const START = "2026-11-18T15:28:00Z";
/** The person's clock time of an instant, as the menu says it. */
const parsed = parseConfig(TOML);
const ZONE = userZone(parsed.ok ? parsed.config : null);
const clockOf = (iso: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(ZONE);
  return `${z.hour % 12 === 0 ? 12 : z.hour % 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};

async function setup() {
  clearVmState();
  let t = Date.parse(START);
  const clock = { now: () => new Date(t).toISOString(), advance: (ms: number) => void (t += ms) };
  const readFails: { kind: VmReadFail | null } = { kind: null };
  const arm = fakeArm({ now: () => t, transitionMs: 45_000, readFails });
  arm.addVm({ id: VM, name: "vm-pat-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "Pat Example" }, power: "running" }, { time: "1900" });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO("America/New_York") });
  const tokens: string[] = [];
  const account: MicrosoftAccount = {
    signIn: async () => ({ status: "connected", identity: PAT }),
    identity: async () => PAT,
    armToken: async () => (tokens.push("arm"), "FAKE-ARM-TOKEN-1"),
    writeAccess: async () => ({ status: "read_only", message: "x" }),
    signOut: async () => {},
  };
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(TOML) }),
    makeDataverse: () => ({ pto: async () => ({ items: [] }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    plan,
    account: (cfg) => (cfg.outlook ? account : null),
    azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
  };
  const run = async <T = unknown>(action: string, input?: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  await run("auth.sign_in", {});
  await run("vm.choose", { vmId: VM });
  const status = () => run<VmStatus>("vm.status", {});
  /** Reads fail this way for more than 2 minutes: what the chip says then. */
  const failing = async (kind: VmReadFail) => {
    await status();
    readFails.kind = kind;
    clock.advance(10_000);
    await status();
    clock.advance(PROBLEM_AFTER_MS);
    return status();
  };
  return { status, arm, clock, readFails, tokens, failing };
}

beforeEach(() => clearVmState());

describe("lead 1: one of several calls refused, shown as the whole state refused", () => {
  it("the chip asks Azure for the state and the auto-shutdown only: no VM read, no list at a subscription or resource group", async () => {
    const s = await setup();
    const before = s.arm.calls.length;
    await s.status();
    expect(s.arm.calls.slice(before).map((c) => `${c.method} ${c.path.replace(/^.*\/(instanceView|schedules)\/?.*$/, "$1")}`)).toEqual(["GET instanceView", "GET schedules"]);
    // Every one of them on the Azure token, the one kind the chip asks for.
    expect(new Set(s.tokens)).toEqual(new Set(["arm"]));
  });

  it("the state read and the auto-shutdown read refused: the chip shows the state, and the menu says the time couldn't be read", async () => {
    const s = await setup();
    s.readFails.kind = "schedule";
    s.clock.advance(10_000);
    const st = await s.status();
    expect(st).toMatchObject({ chip: "running", label: "Running", text: "Running", checking: null, problem: null, schedule: null, noShutdown: false, canStop: true });
    expect(st.scheduleUnread).toBe("FocusTime couldn't read your VM's auto-shutdown time.");
  });

  it("a schedule that reads again clears the line", async () => {
    const s = await setup();
    s.readFails.kind = "schedule";
    s.clock.advance(10_000);
    expect((await s.status()).scheduleUnread).toBeTruthy();
    s.readFails.kind = null;
    s.clock.advance(10_000);
    const st = await s.status();
    expect(st.scheduleUnread ?? null).toBeNull();
    expect(st.text).toMatch(/^Running · off at /);
  });
});

describe("Azure's reason in plain words, with when the state was last read", () => {
  it("not allowed right now (AuthorizationFailed): Azure's words and what to do", async () => {
    const s = await setup();
    const st = await s.failing("refused");
    expect(st.problem).toMatchObject({ kind: "not_allowed", text: "Azure says your sign-in isn't allowed to read this VM right now. If your access is switched on for a time, switch it on again in Azure." });
    expect(st.chip).toBe("running");
  });

  it("not found: Azure can't find this VM", async () => {
    const s = await setup();
    const st = await s.failing("not_found");
    expect(st.problem).toMatchObject({ kind: "not_found", text: "Azure can't find this VM. It may have been moved or deleted." });
  });

  it("the sign-in asked for again (a 403 with a challenge naming the token): the sign-in problem, not refused", async () => {
    const s = await setup();
    const st = await s.failing("challenge");
    expect(st.problem).toMatchObject({ kind: "sign_in", ...READ_PROBLEM.sign_in });
  });

  it("production's 403 with no code: today's sentence", async () => {
    const s = await setup();
    const st = await s.failing("no_code");
    expect(st.problem).toMatchObject({ kind: "refused", ...READ_PROBLEM.refused });
  });

  it("Last read is the time of the last good read, never of a failed one", async () => {
    const s = await setup();
    const good = await s.status();
    expect(good.lastRead).toBe(`Last read ${clockOf(START)}`);
    const st = await s.failing("no_code");
    expect(st.lastRead).toBe(`Last read ${clockOf(START)}`);
    s.readFails.kind = null;
    s.clock.advance(30_000);
    const back = await s.status();
    expect(back.lastRead).toBe(`Last read ${clockOf(back.readAt!)}`);
    expect(back.readAt).not.toBe(good.readAt);
  });

  it("nothing read since FocusTime started: no Last read at all", async () => {
    const s = await setup();
    clearVmState();
    s.readFails.kind = "no_code";
    const st = await s.status();
    expect(st.lastRead ?? null).toBeNull();
  });
});
