// fix/vm-schedule (D472): next-morning auto-shutdown restores left from before are marked cancelled once, for
// everyone, and logged; they are never run (nothing in FocusTime can write a schedule any more).
import { expect, it } from "vitest";
import { addUsers, forEachDriver } from "../test/db.ts";
import { planStoreOn } from "./plan-store.ts";
import { cancelShutdownRestores } from "./vm-restores.ts";
import type { LegacyShutdownChange } from "../plan/vm.ts";

const NOW = Temporal.Instant.from("2026-11-03T14:30:00Z");
const SUB = "00000000-0000-4000-8000-0000000000aa";
const vm = (n: string) => `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/${n}`;
const rec = (vmId: string): LegacyShutdownChange => ({ vmId, date: "2026-11-02", original: { time: "1900", status: "Enabled" }, changed: { time: "1900", status: "Disabled" }, timeZoneId: "Eastern Standard Time", failedAt: null, message: null });

await forEachDriver("cancelled auto-shutdown restores (D472)", (d) => {
  it("marks every pending restore cancelled for every person, logs each once, and leaves other state alone", async () => {
    const db = await d.open();
    await addUsers(db.conn, "u-pat", "u-dana");
    const pat = planStoreOn(db.conn, { userId: "u-pat", now: () => NOW.toZonedDateTimeISO("America/New_York") });
    const dana = planStoreOn(db.conn, { userId: "u-dana", now: () => NOW.toZonedDateTimeISO("America/Chicago") });
    await pat.setAccountState(`vm_shutdown:${vm("vm-pat-01").toLowerCase()}`, rec(vm("vm-pat-01")));
    await dana.setAccountState(`vm_shutdown:${vm("vm-dana-01").toLowerCase()}`, { ...rec(vm("vm-dana-01")), changed: { time: "2100", status: "Enabled" }, failedAt: "2026-11-03T05:00:00Z", message: "Azure unreachable" });
    await pat.setAccountState("vm:u-pat", { id: vm("vm-pat-01") });

    const done = await cancelShutdownRestores(db.conn, () => NOW);
    expect(done.map((x) => x.userId).sort()).toEqual(["u-dana", "u-pat"]);

    const p = await pat.accountState<LegacyShutdownChange>(`vm_shutdown:${vm("vm-pat-01").toLowerCase()}`);
    expect(p).toMatchObject({ changed: { status: "Disabled" }, cancelledAt: expect.stringMatching(/^2026-11-03T14:30:00/) });
    expect(await pat.accountState("vm:u-pat")).toEqual({ id: vm("vm-pat-01") });
    const patLog = await pat.azureWriteLog();
    expect(patLog).toHaveLength(1);
    expect(patLog[0]).toMatchObject({ op: "shutdown_restore", status: "refused", vmName: "vm-pat-01", auto: true, before: { time: "1900", status: "Disabled" }, after: { time: "1900", status: "Enabled" } });
    expect(patLog[0]!.message).toBe("Not restored: FocusTime no longer changes auto-shutdown. It was set off (normally on at 1900). Check it in the Azure portal");
    const danaLog = await dana.azureWriteLog();
    expect(danaLog).toHaveLength(1);
    expect(danaLog[0]!.message).toMatch(/It was set on at 2100 \(normally on at 1900\)/);

    // Once: a second run (the next server start) marks and logs nothing more.
    expect(await cancelShutdownRestores(db.conn, () => NOW.add({ hours: 1 }))).toEqual([]);
    expect(await pat.azureWriteLog()).toHaveLength(1);
  });

  it("nothing pending: nothing to do", async () => {
    const db = await d.open();
    expect(await cancelShutdownRestores(db.conn, () => NOW)).toEqual([]);
  });
});
