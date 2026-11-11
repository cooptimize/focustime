// VM-2: the real tick code (server/ticks.ts) runs the VM auto-start only where the context says exactly "prod", and
// wakes an idle scheduler for it. A fake Azure Resource Manager; fictional data only.
import { describe, expect, it } from "vitest";
import { IDENTITY_KEY, type MicrosoftAccount } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { AUTOSTART_KEY, clearVmState, settled, vmKey } from "../actions/vm-actions.ts";
import { backgroundPolicy } from "../config/background-policy.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Notice } from "../plan/notify.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const SUB = "00000000-0000-4000-8000-0000000000ac";
const VM = `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-ana-01`;
const OID = "0f0f0f0f-3333-4222-8333-444455556666";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;

async function person(env: string | undefined, policyEnv: string | undefined = env) {
  clearVmState();
  // Mon Nov 2, 2026, 8:54 AM in New York; the starter's day starts at 9:00, auto-start 5 minutes before.
  let at = Temporal.Instant.from("2026-11-02T13:54:00Z");
  const toml = setValue(setValue(setValue(setValue(starterToml(NY), "dataverse", "my_email", "ana@example.com"), "dataverse", "my_systemuserid", "11111111-2222-4333-8444-555566667777"), "azure", "auto_start", true), "azure", "auto_start_minutes", 5);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error(JSON.stringify(config.errors));
  const arm = fakeArm({ now: () => at.epochMilliseconds, transitionMs: 20_000 });
  arm.addVm({ id: VM, name: "vm-ana-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", tags: {}, power: "deallocated" }, { time: "1900" });
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Ana Example", username: "ana@example.com", email: "ana@example.com", systemUserId: null });
  await plan.setAccountState(vmKey(OID), { id: VM, name: "vm-ana-01", resourceGroup: "rg-dev", subscriptionId: SUB, location: "eastus", chosenAt: at.toString() });
  await plan.setState(AUTOSTART_KEY, { onSince: "2026-11-02", lastUseOn: "2026-11-02" });
  let tokens = 0;
  const account = { signIn: async () => ({ status: "connected" }), identity: async () => ({ oid: OID }), armToken: async () => (tokens++, "FAKE"), writeAccess: async () => ({ status: "read_only", message: "x" }), signOut: async () => {} } as unknown as MicrosoftAccount;
  const shown: Notice[] = [];
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    sleep: async (ms: number) => void (at = at.add({ milliseconds: ms })),
    makeDataverse: () => ({ pto: async () => ({ status: "ok", items: [] }), holidays: async () => ({ ok: true, days: [] }) }),
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
    account: () => account,
    azure: (token: () => Promise<string>) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
    ...(env !== undefined ? { autoStartEnv: env } : {}),
  } as unknown as ActionContext;
  // ENV-1: the policy follows the same environment, so a test site is refused twice (the part never runs there).
  const policy = backgroundPolicy({ FOCUSTIME_ENV: policyEnv });
  const ticks = personTicks({ policy, log: () => {}, now: () => at, notifications, media: MEDIA, openRoute: () => {} }, plan, ctx, { zone: NY });
  return { ticks, arm, shown, tokens: () => tokens, plan, advance: (m: number) => void (at = at.add({ minutes: m })), now: () => at };
}

describe("VM-2 in the real tick", () => {
  it('"prod": the slow pass starts my VM at 8:55, once, logged as automatic', async () => {
    const p = await person("prod");
    await p.ticks.slow();
    expect(p.arm.calls.filter((c) => c.path.endsWith("/start"))).toHaveLength(0);
    p.advance(1);
    await p.ticks.slow();
    p.advance(1);
    await p.ticks.slow();
    await settled();
    expect(p.arm.calls.filter((c) => c.path.endsWith("/start"))).toHaveLength(1);
    expect((await p.plan.azureWriteLog())[0]).toMatchObject({ op: "start", auto: true });
  });

  it("dev, unset, or anything else: the tick never starts it (no Azure write at all) and sends no auto-start notice", async () => {
    for (const env of ["dev", undefined, "local", "", "Prod", "production"]) {
      const p = await person(env);
      for (let i = 0; i < 20; i++) {
        p.advance(1);
        await p.ticks.slow();
      }
      await p.ticks.settled!();
      expect(p.arm.calls.filter((c) => c.method !== "GET"), String(env)).toEqual([]);
      expect(p.shown.filter((n) => n.key.startsWith("vm_auto")), String(env)).toEqual([]);
      expect(await p.plan.azureWriteLog()).toEqual([]);
    }
  });

  it("ENV-1: a test site's policy alone keeps it off, even if the gate were handed \"prod\" (no start, no wake)", async () => {
    const p = await person("prod", "dev");
    expect(Temporal.Instant.compare(await p.ticks.wake!(), Temporal.Instant.from("2026-11-02T13:55:00Z"))).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      p.advance(1);
      await p.ticks.slow();
    }
    await p.ticks.settled!();
    expect(p.arm.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(await p.plan.azureWriteLog()).toEqual([]);
  });

  it("the idle rule: an idle scheduler wakes for the planned start in prod, not in dev", async () => {
    const prod = await person("prod");
    expect((await prod.ticks.wake!()).toString()).toBe("2026-11-02T13:55:00Z");
    const dev = await person("dev");
    expect(Temporal.Instant.compare(await dev.ticks.wake!(), Temporal.Instant.from("2026-11-02T13:55:00Z"))).toBeGreaterThan(0);
  });
});
