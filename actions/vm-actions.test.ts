// Step 15.4: the Microsoft sign-in as the app's user, and my VM (find, confirm, status, start, the morning prompt)
// against a fake Azure Resource Manager. D465: no stop, and the auto-shutdown schedule is read only. Fictional only.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML as STARTER_TOML } from "../fixtures/four-day-week.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { AuthFailure, type ConnectOptions } from "../sources/oauth/oauth.ts";
import type { IdClaims } from "../sources/oauth/idtoken.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { IDENTITY_KEY, withMe, type MicrosoftAccount, type StoredIdentity } from "./account.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearVmState, settled, shutdownKey, vmKey, type VmPreview, type VmStatus } from "./vm-actions.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`;
const OTHER = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-dana-01`;
const PAT: IdClaims = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
const TOML = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(/(\[outlook\]\ntenant_id = "[^"]*"\n)client_id = ""/, '$1client_id = "44444444-4444-4444-8444-444444444444"');

type AccountOpts = { signedIn?: boolean; arm?: "ok" | "consent"; identityFails?: AuthFailure["kind"] };
function setup(opts: AccountOpts & { start?: string; forbid?: string[]; failOps?: "start"[]; toml?: string } = {}) {
  clearVmState();
  let t = Date.parse(opts.start ?? "2026-11-02T14:00:00Z");
  const clock = { now: () => new Date(t).toISOString(), advance: (ms: number) => void (t += ms) };
  const offline = { on: false };
  const arm = fakeArm({ now: () => t, transitionMs: 45_000, forbid: new Set(opts.forbid ?? []), failOps: new Set(opts.failOps ?? []), offline });
  arm.addVm({ id: VM, name: "vm-pat-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "Pat Example" }, power: "deallocated" }, { time: "1900" });
  arm.addVm({ id: OTHER, name: "vm-dana-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "Dana Example" }, power: "running" }, { time: "1800" });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO("America/New_York") });
  const state = { signedIn: opts.signedIn ?? true, arm: opts.arm ?? "ok", write: false };
  const signIns: ConnectOptions[] = [];
  let signedOut = 0;
  const account: MicrosoftAccount = {
    signIn: async (o) => {
      signIns.push(o);
      state.signedIn = true;
      if (o.azure) state.arm = "ok";
      return { status: "connected", identity: PAT };
    },
    identity: async () => {
      if (opts.identityFails) throw new AuthFailure(opts.identityFails, "Outlook unreachable");
      if (!state.signedIn) throw new AuthFailure("not_connected", "Outlook is not connected yet");
      return PAT;
    },
    armToken: async () => {
      if (!state.signedIn) throw new AuthFailure("not_connected", "Outlook is not connected yet");
      if (state.arm === "consent") throw new AuthFailure("consent", "Outlook needs you to sign in again to allow this");
      return "FAKE-ARM-TOKEN-1";
    },
    writeAccess: async () => (state.write ? { status: "write" } : { status: "read_only", message: "x" }),
    signOut: async () => void ((state.signedIn = false), signedOut++),
  };
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(opts.toml ?? TOML) }),
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
  const fail = async (action: string, input?: unknown) => {
    const r = await dispatch(c, { action, input });
    if (r.ok) throw new Error(`expected ${action} to fail`);
    return r;
  };
  const vmCtx = () => ({
    plan, config: async () => (parseConfig(TOML) as { ok: true; config: never }).config, account, azure: c.azure!, now: clock.now, sleep: c.sleep!,
    focusRunning: async () => false, workday: async () => true,
  });
  return { c, run, fail, plan, arm, clock, state, signIns, offline, account, vmCtx, signedOut: () => signedOut };
}

async function signedInWithVm(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.run("auth.sign_in", {});
  await s.run("vm.choose", { vmId: VM });
  return s;
}

describe("sign-in: the app's user (step 15.4)", () => {
  it("no app registration: no sign-in screen (configured false)", async () => {
    const s = setup();
    s.c.loadConfig = async () => ({ path: "/x", parsed: parseConfig(STARTER_TOML) });
    expect(await s.run("auth.status")).toMatchObject({ configured: false, state: "signed_out" });
  });

  it("first open: signed out until I sign in; signing in asks for Azure too and keeps who I am", async () => {
    const s = setup({ signedIn: false });
    expect(await s.run("auth.status")).toEqual({ configured: true, state: "signed_out", person: null, message: null });
    expect(await s.run("auth.sign_in", {})).toEqual({ status: "connected", person: { name: "Pat Example", username: "pat@example.com", initials: "PE" } });
    expect(s.signIns).toEqual([{ azure: true }]);
    expect((await s.plan.accountState<StoredIdentity>(IDENTITY_KEY))).toMatchObject({ oid: PAT.oid, username: "pat@example.com", systemUserId: null });
    expect(await s.run("auth.status")).toMatchObject({ state: "signed_in", person: { initials: "PE" } });
  });

  it("an existing Outlook sign-in is signed in silently (no new browser visit)", async () => {
    const s = setup({ signedIn: true });
    expect(await s.run("auth.status")).toMatchObject({ state: "signed_in", person: { name: "Pat Example" } });
    expect(s.signIns).toEqual([]);
  });

  it("signing in again prefills my account and keeps calendar changes when I had them", async () => {
    const s = setup();
    await s.run("auth.status");
    s.state.write = true;
    await s.run("auth.sign_in", { azure: true });
    expect(s.signIns.at(-1)).toEqual({ azure: true, write: true, loginHint: "pat@example.com" });
  });

  it("offline: keeps working with who was signed in (no sign-in screen)", async () => {
    const s = setup();
    await s.run("auth.status");
    const off = setup({ identityFails: "network" });
    (await off.plan.setAccountState(IDENTITY_KEY, (await s.plan.accountState(IDENTITY_KEY))));
    expect(await off.run("auth.status")).toMatchObject({ state: "unavailable", person: { name: "Pat Example" } });
  });

  it("sign out clears the token and who I am, keeps the local plan and my VM choice", async () => {
    const s = await signedInWithVm();
    (await s.plan.setState("x", 1));
    expect(await s.run("auth.sign_out")).toEqual({ status: "signed_out" });
    expect(s.signedOut()).toBe(1);
    expect((await s.plan.accountState(IDENTITY_KEY))).toBeNull();
    expect((await s.plan.getState("x"))).toBe(1);
    expect((await s.plan.accountState(vmKey(PAT.oid)))).toMatchObject({ id: VM });
    expect(await s.run("auth.status")).toMatchObject({ state: "signed_out" });
  });

  it("sign-in and sign-out are refused in demo mode", async () => {
    const s = setup();
    s.c.demo = { on: true, set: async () => {} };
    expect(await s.fail("auth.sign_out")).toMatchObject({ status: 403 });
  });
});

describe("me from the signed-in account", () => {
  const parsed = parseConfig(TOML.replace('my_systemuserid = ""', 'my_systemuserid = "dddddddd-0000-4000-8000-000000000001"'));
  const me: StoredIdentity = { ...PAT, signedInAt: "x", systemUserId: null, systemUserEmail: null };
  it("uses the signed-in email; the Dataverse user is found again for a new address", () => {
    const r = withMe(parsed, me);
    expect(r.ok && r.config.dataverse).toMatchObject({ myEmail: "pat@example.com", mySystemUserId: null });
    const found = withMe(parsed, { ...me, systemUserId: "dddddddd-0000-4000-8000-000000000002", systemUserEmail: "pat@example.com" });
    expect(found.ok && found.config.dataverse.mySystemUserId).toBe("dddddddd-0000-4000-8000-000000000002");
  });
  it("signed out, or an account with no email: config as it is (the fallback)", () => {
    expect(withMe(parsed, null)).toBe(parsed);
    expect(withMe(parsed, { ...me, username: "pat", email: null })).toBe(parsed);
  });
  it("same address as config: config's user id is kept", () => {
    const same = parseConfig(TOML.replace('my_email = "me@example.com"', 'my_email = "Pat@Example.com"').replace('my_systemuserid = ""', 'my_systemuserid = "dddddddd-0000-4000-8000-000000000001"'));
    expect(withMe(same, me)).toBe(same);
  });
  it("a found Dataverse user is kept with the sign-in, not written to config", async () => {
    const s = setup();
    await s.run("auth.status");
    const saved: string[] = [];
    s.c.saveSystemUserId = async (id) => void saved.push(id);
    s.c.makeDataverse = () => ({ resolveUserId: async (email: string) => ({ ok: true, id: email === "pat@example.com" ? "dddddddd-0000-4000-8000-0000000000f1" : "wrong" }), load: async () => ({ source: "dataverse", status: "ok", fetchedAt: null, fromCache: false, items: [] }), pto: async () => ({ items: [] }), devopsTargets: async () => ({ ok: true, targets: [] }), team: async () => ({ items: [] }), following: async () => null }) as never;
    s.c.makeOutlook = () => ({ load: async () => ({ source: "outlook", status: "ok", fetchedAt: null, fromCache: false, items: [] }) }) as never;
    s.c.makeDevOps = () => ({ load: async () => [], lookup: () => null, orgOf: () => null, last: () => null, portfolio: async () => [], description: async () => null, forget: () => undefined }) as never;
    await s.run("week.load", { weekStart: "2026-11-02" });
    expect(saved).toEqual([]);
    expect((await s.plan.accountState<StoredIdentity>(IDENTITY_KEY))).toMatchObject({ systemUserId: "dddddddd-0000-4000-8000-0000000000f1", systemUserEmail: "pat@example.com" });
  });
});

describe("my VM: find and confirm", () => {
  it("finds VMs tagged Owner = my display name when none has my UPN, across what I can see", async () => {
    const s = setup();
    await s.run("auth.status");
    const r = await s.run<{ tag: string; value: string; vms: { id: string; power: string }[] }>("vm.find", {});
    expect(r).toMatchObject({ tag: "Owner", value: "Pat Example" });
    expect(r.vms).toEqual([expect.objectContaining({ id: VM, name: "vm-pat-01", power: "deallocated" })]);
    expect((await s.run<{ vms: unknown[] }>("vm.find", { value: "Dana Example" })).vms).toHaveLength(1);
  });

  it("finds VMs tagged Owner = my UPN first (A2)", async () => {
    const s = setup();
    s.arm.addVm({ id: `${VM}-upn`, name: "vm-pat-02", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: { Owner: "pat@example.com" }, power: "running" }, { time: "1900" });
    await s.run("auth.status");
    const r = await s.run<{ value: string; vms: { name: string }[] }>("vm.find", {});
    expect(r.value).toBe("pat@example.com");
    expect(r.vms.map((v) => v.name)).toEqual(["vm-pat-02"]);
  });

  it("tag name and value come from config when set", async () => {
    const s = setup();
    await s.run("auth.status");
    s.c.loadConfig = async () => ({ path: "/x", parsed: parseConfig(`${TOML}\n[azure]\nowner_tag = "Owner"\nowner_value = "Dana Example"\n`) });
    expect((await s.run<{ vms: { id: string }[] }>("vm.find", {})).vms.map((v) => v.id)).toEqual([OTHER]);
  });

  it("confirms a VM by resource ID after reading it, per signed-in person", async () => {
    const s = setup();
    await s.run("auth.status");
    expect(await s.run("vm.choose", { vmId: VM })).toMatchObject({ vm: { id: VM, name: "vm-pat-01", resourceGroup: "rg-dev", location: "eastus" } });
    expect((await s.plan.accountState(vmKey(PAT.oid)))).toMatchObject({ id: VM });
    expect(await s.fail("vm.choose", { vmId: "vm-pat-01" })).toMatchObject({ status: 400 });
    expect(await s.fail("vm.choose", { vmId: VM.replace("vm-pat-01", "vm-nope") })).toMatchObject({ status: 404, error: expect.stringMatching(/VM not found/) });
    await s.run("vm.choose", { vmId: null });
    expect((await s.plan.accountState(vmKey(PAT.oid)))).toBeNull();
  });

  it("signed out: nothing to find", async () => {
    const s = setup({ signedIn: false });
    expect(await s.fail("vm.find", {})).toMatchObject({ status: 401 });
  });

  it("Azure not consented yet: the status says so (Allow Azure access)", async () => {
    const s = await signedInWithVm();
    s.state.arm = "consent";
    clearVmState();
    expect(await s.run("vm.status")).toMatchObject({ needsConsent: true, chip: "unknown", error: { kind: "consent" } });
  });
});

describe("my VM: status and start through the write framework", () => {
  it("shows the state and the auto-shutdown time", async () => {
    const s = await signedInWithVm();
    const st = await s.run<VmStatus>("vm.status");
    expect(st).toMatchObject({ chip: "deallocated", label: "Stopped (deallocated)", canStart: true, refreshMs: 60_000, schedule: { label: "Auto-shutdown 7:00 PM", time: "1900", status: "Enabled" } });
    s.arm.setPower(VM, "stopped");
    expect(await s.run<VmStatus>("vm.status", { fresh: true })).toMatchObject({ label: "Stopped (still billing)", canStart: true });
  });

  it("start: preview, confirm, Starting… with 10 s refresh, then read back running and logged", async () => {
    const s = await signedInWithVm();
    const p = await s.run<VmPreview>("vm.preview", { op: "start", vmId: VM });
    expect(p).toMatchObject({ title: "Start your VM", lines: [{ before: "Stopped (deallocated)", after: "Running" }], confirmLabel: "Start" });
    const r = await s.run<{ entry: { status: string }; transition: { op: string } }>("vm.confirm", { previewId: p.previewId });
    expect(r).toMatchObject({ entry: { status: "pending" }, transition: { op: "start" } });
    expect(await s.run<VmStatus>("vm.status")).toMatchObject({ chip: "starting", label: "Starting…", refreshMs: 10_000 });
    expect(s.arm.calls.filter((x) => x.method === "POST" && x.path.endsWith("/start"))).toHaveLength(1);
    await settled();
    const log = (await s.plan.azureWriteLog());
    expect(log[0]).toMatchObject({ op: "start", vmId: VM, status: "confirmed", message: "Read back: Running", before: { power: "deallocated" }, after: { power: "running" } });
    // It polled the operation, not just the state.
    expect(s.arm.calls.some((x) => x.path.includes("/operations/"))).toBe(true);
    expect(await s.run<VmStatus>("vm.status", { fresh: true })).toMatchObject({ chip: "running", canStart: false });
  });

  it("refuses any VM other than the confirmed one", async () => {
    const s = await signedInWithVm();
    expect(await s.fail("vm.preview", { op: "start", vmId: OTHER })).toMatchObject({ status: 403, error: "FocusTime only acts on the VM you confirmed as yours" });
    // A preview held for the VM I had, after choosing another: refused at confirm.
    const p = await s.run<VmPreview>("vm.preview", { op: "start" });
    await s.run("vm.choose", { vmId: OTHER });
    expect(await s.fail("vm.confirm", { previewId: p.previewId })).toMatchObject({ status: 403 });
    expect(s.arm.calls.some((x) => x.method === "POST" && x.path.includes("vm-"))).toBe(false);
  });

  it("no VM chosen: nothing to act on", async () => {
    const s = setup();
    await s.run("auth.status");
    expect(await s.fail("vm.preview", { op: "start" })).toMatchObject({ status: 409, error: expect.stringMatching(/Choose your VM first/) });
  });

  it("missing permission says which Azure permission, and the log shows it refused", async () => {
    const s = await signedInWithVm({ forbid: ["start"] });
    const p = await s.run<VmPreview>("vm.preview", { op: "start" });
    expect(await s.fail("vm.confirm", { previewId: p.previewId })).toMatchObject({ status: 403, error: "Azure says you don't have permission: Microsoft.Compute/virtualMachines/start/action", code: "forbidden" });
    expect((await s.plan.azureWriteLog())[0]).toMatchObject({ op: "start", status: "refused" });
  });

  it("an operation that fails, and one that never finishes, are logged as such", async () => {
    const s = await signedInWithVm({ failOps: ["start"] });
    await s.run("vm.confirm", { previewId: (await s.run<VmPreview>("vm.preview", { op: "start" })).previewId });
    await settled();
    expect((await s.plan.azureWriteLog())[0]).toMatchObject({ status: "failed", message: "Azure says the start failed" });

    const t = await signedInWithVm();
    t.arm.vms.get(VM.toLowerCase())!.tags.stuck = "1";
    await t.run("vm.confirm", { previewId: (await t.run<VmPreview>("vm.preview", { op: "start" })).previewId });
    // Azure never shows it running: offline after the start was accepted.
    t.offline.on = true;
    await settled();
    expect((await t.plan.azureWriteLog())[0]).toMatchObject({ status: "timed_out", message: expect.stringMatching(/within 15 minutes/) });
  });

  it("previews expire after 5 minutes", async () => {
    const s = await signedInWithVm();
    const p = await s.run<VmPreview>("vm.preview", { op: "start" });
    s.clock.advance(5 * 60_000 + 1);
    expect(await s.fail("vm.confirm", { previewId: p.previewId })).toMatchObject({ status: 410 });
  });
});

describe("D465: FocusTime never changes a VM's auto-shutdown and never stops it", () => {
  /** Every call that isn't a read, a start or its progress: none may ever reach Azure. */
  const writes = (s: Awaited<ReturnType<typeof signedInWithVm>>) =>
    s.arm.calls.filter((x) => x.path.includes("Microsoft.DevTestLab") ? x.method !== "GET" : x.method !== "GET" && !x.path.endsWith("/start") && !x.path.includes("ResourceGraph"));

  it("the chip shows the schedule as Azure has it, read only", async () => {
    const s = await signedInWithVm();
    s.arm.setPower(VM, "running");
    expect(await s.run<VmStatus>("vm.status", { fresh: true })).toMatchObject({ text: "Running · off at 7:00 PM", schedule: { label: "Auto-shutdown 7:00 PM", time: "1900", status: "Enabled" } });
    (s.arm.schedules.get(VM.toLowerCase())!.properties as { status: string }).status = "Disabled";
    expect(await s.run<VmStatus>("vm.status", { fresh: true })).toMatchObject({ text: "Running · auto-shutdown off", schedule: { label: "Auto-shutdown off" } });
    expect(Object.keys(await s.run<VmStatus>("vm.status"))).not.toEqual(expect.arrayContaining(["change", "stillChanged", "canStop"]));
    expect(s.arm.calls.filter((x) => x.path.includes("DevTestLab")).every((x) => x.method === "GET")).toBe(true);
  });

  it("delay, skip, restore and stop are refused before Azure is asked; vm.restore is gone", async () => {
    const s = await signedInWithVm();
    s.arm.setPower(VM, "running");
    for (const op of ["delay60", "delay120", "skip", "restore", "deallocate", "powerOff"])
      expect(await s.fail("vm.preview", { op }), op).toMatchObject({ status: 400, error: expect.stringMatching(/only starts your VM/) });
    expect(await s.fail("vm.restore", {})).toMatchObject({ status: 400 });
    expect(writes(s)).toEqual([]);
    expect(s.arm.schedule(VM)).toEqual({ time: "1900", status: "Enabled" });
    expect(await s.plan.azureWriteLog()).toEqual([]);
  });

  it("a restore left from an earlier Skip tonight never runs: days pass, the status is read, nothing is written", async () => {
    const s = await signedInWithVm();
    // As the old Skip tonight left it, with Azure still showing it off tonight.
    (await s.plan.setAccountState(shutdownKey(VM), { vmId: VM, date: "2026-11-02", original: { time: "1900", status: "Enabled" }, changed: { time: "1900", status: "Disabled" }, timeZoneId: "Eastern Standard Time", failedAt: null, message: null }));
    (s.arm.schedules.get(VM.toLowerCase())!.properties as { status: string }).status = "Disabled";
    for (let day = 0; day < 3; day++) {
      s.clock.advance(24 * 3600_000);
      clearVmState();
      const st = await s.run<VmStatus>("vm.status");
      expect(st).toMatchObject({ schedule: { status: "Disabled" } });
      expect(st).not.toHaveProperty("stillChanged");
    }
    expect(writes(s)).toEqual([]);
    expect(s.arm.schedule(VM)).toEqual({ time: "1900", status: "Disabled" });
  });

  it("the Azure write log names only starts", async () => {
    const s = await signedInWithVm();
    await s.run("vm.confirm", { previewId: (await s.run<VmPreview>("vm.preview", { op: "start" })).previewId });
    await settled();
    expect((await s.plan.azureWriteLog()).map((e) => e.op)).toEqual(["start"]);
    expect(writes(s)).toEqual([]);
  });
});

describe("the morning prompt", () => {
  beforeEach(() => clearVmState());
  it("on a workday from work start when the VM is off; dismissable for the day; never starts by itself", async () => {
    const early = await signedInWithVm({ start: "2026-11-02T13:30:00Z" }); // 8:30 in New York
    expect((await early.run<VmStatus>("vm.status")).prompt).toBe(false);
    const s = await signedInWithVm({ start: "2026-11-02T14:05:00Z" }); // 9:05
    expect((await s.run<VmStatus>("vm.status")).prompt).toBe(true);
    await s.run("vm.dismiss_prompt", {});
    expect((await s.run<VmStatus>("vm.status")).prompt).toBe(false);
    expect(s.arm.calls.some((x) => x.method === "POST" && !x.path.includes("ResourceGraph"))).toBe(false);
  });
  it("not on a day off, and not while it runs", async () => {
    const fri = await signedInWithVm({ start: "2026-11-06T15:00:00Z" }); // Friday: no hours in the starter config
    expect((await fri.run<VmStatus>("vm.status")).prompt).toBe(false);
    const s = await signedInWithVm({ start: "2026-11-02T15:00:00Z" });
    s.arm.setPower(VM, "running");
    expect((await s.run<VmStatus>("vm.status")).prompt).toBe(false);
  });
});

describe("never leaks", () => {
  it("no token in responses or the log", async () => {
    const s = await signedInWithVm();
    const out = [JSON.stringify(await s.run("vm.status")), JSON.stringify(await s.run("vm.log")), JSON.stringify(await s.run("auth.status"))].join("\n");
    expect(out).not.toContain("FAKE-ARM-TOKEN");
  });
});

describe("one-click Start from the morning box (step 15.5, Q87)", () => {
  it("starts at once (no preview), logged, followed and read back as running", async () => {
    const s = await signedInWithVm();
    const r = await s.run<{ entry: { status: string }; transition: { op: string } }>("vm.start_now", {});
    expect(r).toMatchObject({ entry: { status: "pending" }, transition: { op: "start" } });
    expect(s.arm.calls.filter((x) => x.method === "POST" && x.path.endsWith("/start"))).toHaveLength(1);
    await settled();
    expect((await s.plan.azureWriteLog())[0]).toMatchObject({ op: "start", vmId: VM, status: "confirmed", message: "Read back: Running" });
  });

  it("asks first when Settings > You turns it off; stop still needs its preview", async () => {
    const s = await signedInWithVm({ toml: TOML + "\n[azure]\nstart_without_asking = false\n" });
    const r = await s.fail("vm.start_now", {});
    expect(r).toMatchObject({ status: 409, code: "ask_first" });
    expect(s.arm.calls.some((x) => x.method === "POST")).toBe(false);
    expect((await s.plan.azureWriteLog())).toHaveLength(0);
  });

  it("refuses another VM, and a VM that is already running", async () => {
    const s = await signedInWithVm();
    expect((await s.fail("vm.start_now", { vmId: OTHER })).status).toBe(403);
    await s.run("vm.start_now", {});
    await settled();
    expect((await s.fail("vm.start_now", {})).error).toContain("nothing to start");
    expect(s.arm.calls.filter((x) => x.method === "POST" && x.path.endsWith("/start"))).toHaveLength(1);
  });

  it("the setting is on by default and saved under [azure] from Settings > You", async () => {
    expect((parseConfig(TOML) as { ok: true; config: { azure: { startWithoutAsking: boolean } } }).config.azure.startWithoutAsking).toBe(true);
    const { settingsEdit } = await import("../config/settings.ts");
    const text = settingsEdit("vm", { startWithoutAsking: false })(TOML);
    const parsed = parseConfig(text);
    expect(parsed.ok && parsed.config.azure.startWithoutAsking).toBe(false);
  });
});

