// VM-4: the chip when a read of the VM's state fails. Production's chip said Unknown on every failed read (Nov 17: one
// read in four answered 403 for about two hours) and stayed so for a minute. Now it keeps the last state it knew with a
// checking mark and asks again in about 10 seconds; after 2 minutes it says why; Unknown only when Azure answers with no
// state. Nothing is started or stopped on an older reading. Fictional VM and person only.
import type { VmReadFail as ReadFail } from "../plan/vm.ts";
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
import { READ_PROBLEM } from "../plan/vm.ts";
import type { LogRecord } from "../log/logger.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`;
const PAT: IdClaims = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
const TOML = FOUR_DAY_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(/(\[outlook\]\ntenant_id = "[^"]*"\n)client_id = ""/, '$1client_id = "44444444-4444-4444-8444-444444444444"');

async function setup() {
  clearVmState();
  let t = Date.parse("2026-11-17T21:00:00Z");
  const clock = { now: () => new Date(t).toISOString(), advance: (ms: number) => void (t += ms) };
  const readFails: { kind: ReadFail | null } = { kind: null };
  const arm = fakeArm({ now: () => t, transitionMs: 45_000, readFails });
  arm.addVm({ id: VM, name: "vm-pat-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "Pat Example" }, power: "running" }, { time: "1900" });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO("America/New_York") });
  const logs: LogRecord[] = [];
  const account: MicrosoftAccount = {
    signIn: async () => ({ status: "connected", identity: PAT }),
    identity: async () => PAT,
    armToken: async () => "FAKE-ARM-TOKEN-1",
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
    azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: (r) => logs.push(r) }),
  };
  const run = async <T = unknown>(action: string, input?: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  await run("auth.sign_in", {});
  await run("vm.choose", { vmId: VM });
  const status = () => run<VmStatus>("vm.status", {});
  return { c, run, status, arm, clock, readFails, plan, logs };
}

beforeEach(() => clearVmState());

describe("VM-4: one failed read", () => {
  it("keeps the last state with its checking mark and asks again in about 10 seconds; a good read clears it", async () => {
    const s = await setup();
    const good = await s.status();
    expect(good).toMatchObject({ chip: "running", checking: null, problem: null, refreshMs: 60_000 });
    expect(good.readAt).toBe("2026-11-17T21:00:00.000Z");
    // Nov 17: Azure answered 403 to one read in four.
    s.readFails.kind = "refused";
    s.clock.advance(60_000);
    const once = await s.status();
    expect(once).toMatchObject({ chip: "running", label: "Running", checking: { since: "2026-11-17T21:01:00.000Z" }, problem: null, refreshMs: 10_000, canStop: true, prompt: false, error: null });
    expect(once.text).toContain("Running");
    expect(once.readAt).toBe("2026-11-17T21:00:00.000Z");
    expect(once.chip).not.toBe("unknown");
    s.readFails.kind = null;
    s.clock.advance(10_000);
    expect(await s.status()).toMatchObject({ chip: "running", checking: null, problem: null, refreshMs: 60_000, readAt: "2026-11-17T21:01:10.000Z" });
  });

  // VM-6: the fake's "refused" is AuthorizationFailed, which now says Azure's reason (not_allowed); "no_code" is
  // production's 403 with no code, which keeps VM-4's "Azure refused".
  for (const [fail, kind] of [["network", "network"], ["busy", "busy"], ["sign_in", "sign_in"], ["refused", "not_allowed"], ["no_code", "refused"]] as const)
    it(`failing for 2 minutes (${fail}): the reason on the face and in the menu, still the last state`, async () => {
      const s = await setup();
      await s.status();
      s.readFails.kind = fail;
      s.clock.advance(60_000); // 21:01: the first failed read
      expect((await s.status()).problem).toBeNull();
      s.clock.advance(119_000); // 1 minute 59 seconds of failing
      expect((await s.status()).problem).toBeNull();
      s.clock.advance(1_000); // 2 minutes
      const late = await s.status();
      expect(late).toMatchObject({ chip: "running", checking: { since: "2026-11-17T21:01:00.000Z" }, problem: { kind, short: READ_PROBLEM[kind].short, text: READ_PROBLEM[kind].text }, refreshMs: 30_000 });
      s.readFails.kind = null;
      s.clock.advance(30_000);
      expect(await s.status()).toMatchObject({ chip: "running", checking: null, problem: null });
    });

  it("Azure answers and gives no state: Unknown (the one case), not checking", async () => {
    const s = await setup();
    s.readFails.kind = "no_state";
    s.clock.advance(60_000);
    expect(await s.status()).toMatchObject({ chip: "unknown", label: "Unknown", checking: null, problem: null });
  });

  it("the log keeps Azure's error code as the failure's kind, and nothing else new", async () => {
    const s = await setup();
    s.readFails.kind = "refused";
    s.clock.advance(60_000);
    await s.status();
    const line = s.logs.find((l) => l.op === "instanceView" && l.status === 403)!;
    expect(line).toMatchObject({ source: "azure", op: "instanceView", status: 403, kind: "AuthorizationFailed" });
    expect(Object.keys(line).sort()).toEqual(["durationMs", "kind", "op", "source", "status"]);
  });
});

describe("VM-4: the first read after a restart", () => {
  it("says Checking… and then the state; never Unknown", async () => {
    const s = await setup();
    clearVmState(); // a restart: nothing in memory
    s.readFails.kind = "network";
    const first = await s.status();
    expect(first).toMatchObject({ chip: null, label: null, text: "Checking…", checking: { since: "2026-11-17T21:00:00.000Z" }, readAt: null, canStart: false, canStop: false, refreshMs: 10_000 });
    s.readFails.kind = null;
    s.clock.advance(10_000);
    expect(await s.status()).toMatchObject({ chip: "running", checking: null });
  });

  it("a read that needs the sign-in done again says so at once (Allow Azure access), still not Unknown", async () => {
    const s = await setup();
    clearVmState();
    s.readFails.kind = null;
    const account = s.c.account!((parseConfig(TOML) as unknown as { config: never }).config)!;
    const { AuthFailure } = await import("../sources/oauth/oauth.ts");
    account.armToken = async () => { throw new AuthFailure("consent", "x"); };
    const st = await s.status();
    expect(st).toMatchObject({ chip: null, needsConsent: true, error: { kind: "consent" }, checking: { since: "2026-11-17T21:00:00.000Z" } });
  });
});

describe("VM-4: nothing is started or stopped from a state that wasn't just read", () => {
  it("while checking, Start's preview reads Azure afresh: it fails while reads fail, and refuses once it reads the VM running", async () => {
    const s = await setup();
    s.arm.setPower(VM, "deallocated");
    expect(await s.status()).toMatchObject({ chip: "deallocated", canStart: true });
    // Someone started it elsewhere; reads fail, so the chip still shows the old Stopped.
    s.arm.setPower(VM, "running");
    s.readFails.kind = "busy";
    s.clock.advance(60_000);
    expect(await s.status()).toMatchObject({ chip: "deallocated", checking: { since: "2026-11-17T21:01:00.000Z" } });
    const p1 = await dispatch(s.c, { action: "vm.preview", input: { op: "start", vmId: VM } });
    expect(p1.ok).toBe(false);
    s.readFails.kind = null;
    const p2 = await dispatch(s.c, { action: "vm.preview", input: { op: "start", vmId: VM } });
    expect(p2).toMatchObject({ ok: false, status: 409 });
    expect(s.arm.calls.filter((c) => c.method === "POST" && /\/start$/.test(c.path))).toHaveLength(0);
    expect(await s.plan.azureWriteLog(10)).toHaveLength(0);
  });

  it("a stop confirmed after the VM changed is refused by the fresh read at Confirm", async () => {
    const s = await setup();
    await s.status();
    const p = await s.run<{ previewId: string }>("vm.preview", { op: "deallocate", vmId: VM });
    s.arm.setPower(VM, "deallocated");
    const r = await dispatch(s.c, { action: "vm.confirm", input: { previewId: p.previewId } });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(s.arm.calls.filter((c) => c.method === "POST" && /\/deallocate$/.test(c.path))).toHaveLength(0);
  });
});
