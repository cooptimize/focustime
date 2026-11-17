// VM-3: why the automatic start didn't run on its first real morning (docs/ux/vm3/what-happened.md), reproduced in the
// real tick code (server/ticks.ts) with a fake Azure Resource Manager and a fake Dataverse. Fictional data only.
//
// The three leads, each a failing test on main:
//   1. the cause: a hosted person's settings carry no Dataverse user (it is kept with the sign-in, and only requests
//      added it), so the background start found PTO "unknown" and left the VM off without a word;
//   2. a part before the start that never returns held the pass, and with it every later pass;
//   3. the start's reasons for leaving the VM off were silent (holidays that can't be read left it off, unlogged).
import { describe, expect, it } from "vitest";
import { IDENTITY_KEY, type MicrosoftAccount } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { AUTOSTART_KEY, clearVmState, settled, vmKey } from "../actions/vm-actions.ts";
import { backgroundPolicy } from "../config/background-policy.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { LogRecord } from "../log/logger.ts";
import type { Notice } from "../plan/notify.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const SUB = "00000000-0000-4000-8000-0000000000ac";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-ana-01`;
const OID = "0f0f0f0f-3333-4222-8333-444455556666";
const DV_USER = "11111111-2222-4333-8444-555566667777";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
const real = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Opts = {
  /** The Dataverse user in the person's own settings (a developer's machine); hosted people have none there. */
  userInSettings?: boolean;
  /** The Teams rhythm's tick, before the start in the slow pass. */
  teamsTick?: () => Promise<void>;
  holidaysOk?: boolean;
};

async function person(o: Opts = {}) {
  clearVmState();
  // Mon Nov 2, 2026, 8:54 AM in New York; the starter's day starts at 9:00, auto-start 5 minutes before.
  let at = Temporal.Instant.from("2026-11-02T13:54:00Z");
  let toml = setValue(setValue(setValue(starterToml(NY), "dataverse", "my_email", "ana@example.com"), "azure", "auto_start", true), "azure", "auto_start_minutes", 5);
  if (o.userInSettings) toml = setValue(toml, "dataverse", "my_systemuserid", DV_USER);
  if (o.teamsTick) toml = setValue(toml, "notify", "teams_messages", true);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error(JSON.stringify(config.errors));
  const arm = fakeArm({ now: () => at.epochMilliseconds, transitionMs: 20_000 });
  arm.addVm({ id: VM, name: "vm-ana-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: {}, power: "deallocated" }, { time: "1900" });
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  // As the hosted app keeps it: the Dataverse user found for the signed-in work email, with the sign-in.
  await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Ana Example", username: "ana@example.com", email: "ana@example.com", signedInAt: at.toString(), systemUserId: DV_USER, systemUserEmail: "ana@example.com" });
  await plan.setAccountState(vmKey(OID), { id: VM, name: "vm-ana-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", chosenAt: at.toString() });
  await plan.setState(AUTOSTART_KEY, { onSince: "2026-11-02", lastUseOn: "2026-11-02" });
  const account = { signIn: async () => ({ status: "connected" }), identity: async () => ({ oid: OID }), armToken: async () => "FAKE", writeAccess: async () => ({ status: "read_only", message: "x" }), signOut: async () => {} } as unknown as MicrosoftAccount;
  const shown: Notice[] = [];
  const logs: LogRecord[] = [];
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    sleep: async (ms: number) => void (at = at.add({ milliseconds: ms })),
    // The real Dataverse source refuses PTO without a Dataverse user; the fake does the same.
    makeDataverse: (dv: { mySystemUserId: string | null }) => ({
      pto: async () => (dv.mySystemUserId ? { status: "ok", items: [] } : { status: "misconfigured", items: [], message: "Your Dataverse user id is not resolved yet" }),
      holidays: async () => (o.holidaysOk === false ? { ok: false, message: "Dataverse read failed" } : { ok: true, days: [] }),
    }),
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
    account: () => account,
    azure: (token: () => Promise<string>) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
    autoStartEnv: "prod",
  } as unknown as ActionContext;
  const teams = o.teamsTick ? { tick: o.teamsTick, wake: async () => null } : undefined;
  const ticks = personTicks({ policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }), log: (r) => void logs.push(r), now: () => at, notifications, media: MEDIA, openRoute: () => {}, ...(teams ? { teams } : {}) }, plan, ctx, { zone: NY });
  const starts = () => arm.calls.filter((c) => c.path.endsWith("/start")).length;
  return { ticks, arm, shown, logs, plan, starts, advance: (m: number) => void (at = at.add({ minutes: m })) };
}

describe("VM-3: the three leads, on the real tick", () => {
  it("1, the cause: a hosted person (the Dataverse user kept with the sign-in, not in settings) gets the start at 8:55", async () => {
    const p = await person();
    p.advance(1);
    await p.ticks.slow();
    await settled();
    expect(p.starts()).toBe(1);
    expect((await p.plan.azureWriteLog())[0]).toMatchObject({ op: "start", auto: true });
  });

  it("2: a part before the start that never returns doesn't keep the start from its time", async () => {
    const p = await person({ userInSettings: true, teamsTick: () => new Promise<void>(() => {}) });
    p.advance(1);
    await Promise.race([p.ticks.slow(), real(2_000)]);
    await settled();
    expect(p.starts()).toBe(1);
  });

  it("3: holidays that can't be read don't leave the VM off, and the start says what it did", async () => {
    const p = await person({ userInSettings: true, holidaysOk: false });
    p.advance(1);
    await p.ticks.slow();
    await settled();
    expect(p.starts()).toBe(1);
    expect(p.logs.filter((l) => l.op === "vm_autostart").length).toBeGreaterThan(0);
  });
});
