// fix/vm-schedule (D475): FocusTime never changes a VM's auto-shutdown schedule. Before that, Delay and Skip tonight
// left a `vm_shutdown:<vm>` record in account state for a next-morning restore that wrote the schedule back. Those
// restores no longer run (the code is gone). This marks each record still waiting as cancelled, once, for everyone, and
// logs it in that person's Azure write log (status refused) with what the schedule should be, so they can check it in
// the Azure portal. Nothing here calls Azure.
import type { Conn } from "./sql/conn.ts";
import type { LegacyShutdownChange } from "../plan/vm.ts";

const PREFIX = "vm_shutdown:";

export type CancelledRestore = { userId: string; vmId: string; changed: LegacyShutdownChange["changed"]; original: LegacyShutdownChange["original"] };

/** Marks every pending restore cancelled; returns the ones marked now (already cancelled ones are left alone). */
export async function cancelShutdownRestores(db: Conn, now: () => Temporal.Instant): Promise<CancelledRestore[]> {
  const rows = (await db.all("SELECT user_id, key, value FROM account_state WHERE key LIKE ?", [`${PREFIX}%`])) as { user_id: string; key: string; value: string }[];
  const out: CancelledRestore[] = [];
  for (const r of rows) {
    if (!r.key.startsWith(PREFIX)) continue;
    let rec: LegacyShutdownChange;
    try {
      rec = JSON.parse(r.value) as LegacyShutdownChange;
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object" || rec.cancelledAt) continue;
    const at = now().toString({ smallestUnit: "second" });
    const vmId = typeof rec.vmId === "string" ? rec.vmId : r.key.slice(PREFIX.length);
    const vmName = vmId.split("/").pop() ?? vmId;
    const fmt = (x: { time?: string; status?: string } | undefined) => (!x ? "unknown" : x.status === "Disabled" ? "off" : `on at ${x.time ?? "?"}`);
    const message = `Not restored: FocusTime no longer changes auto-shutdown. It was set ${fmt(rec.changed)} (normally ${fmt(rec.original)}). Check it in the Azure portal`;
    await db.tx(async () => {
      await db.run("UPDATE account_state SET value = ?, updated_at = ? WHERE user_id = ? AND key = ?", [JSON.stringify({ ...rec, cancelledAt: at }), at, r.user_id, r.key]);
      await db.run(
        "INSERT INTO azure_write_log (user_id, at, op, vm_id, vm_name, before, after, status, message, auto, attempts, updated_at) VALUES (?, ?, 'shutdown_restore', ?, ?, ?, ?, 'refused', ?, 1, 1, ?)",
        [r.user_id, at, vmId, vmName, JSON.stringify(rec.changed ?? null), JSON.stringify(rec.original ?? null), message, at],
      );
    });
    out.push({ userId: r.user_id, vmId, changed: rec.changed, original: rec.original });
  }
  return out;
}
