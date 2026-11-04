// P1: the browsers a person turned push on for (Settings › Notifications › Notify this device). A subscription's
// endpoint and keys are sealed with the app's data key (store/user-secrets.ts' seal, bound to the person and the device
// id), so they are never readable from the database, the export or the UI, and never logged. The device's own random
// id (kept in that browser) finds its row; the label is coarse ("iPhone · Safari"), from the browser's user agent.
import { SecretError, type KeyProvider } from "../host/types.ts";
import { scopedDb } from "./scope.ts";
import type { Conn, Row } from "./sql/conn.ts";
import { open, seal } from "./user-secrets.ts";

/** What PushManager.subscribe() gives, as its toJSON(): the push service's URL and the browser's keys. */
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushDevice = { deviceId: string; label: string; createdAt: string; sentAt: string | null; failedAt: string | null };

/** The device ids FocusTime makes in the browser: 16 to 64 letters, digits, dash or underscore. */
export const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_PUSH_DEVICES = 10;

const account = (deviceId: string) => `push-device:${deviceId}`;

export function createPushDevices(o: { db: Conn; userId: string; keys: KeyProvider; now: () => Temporal.Instant }) {
  const db = scopedDb(o.db, o.userId);
  const stamp = () => o.now().toString();
  const check = (deviceId: string) => {
    if (!DEVICE_ID.test(deviceId)) throw new Error("Not a device id");
  };
  return {
    async list(): Promise<PushDevice[]> {
      return ((await db.all("SELECT device_id, label, created_at, sent_at, failed_at FROM push_devices ORDER BY created_at")) as Row[]).map((r) => ({
        deviceId: r.device_id as string,
        label: r.label as string,
        createdAt: String(r.created_at),
        sentAt: r.sent_at == null ? null : String(r.sent_at),
        failedAt: r.failed_at == null ? null : String(r.failed_at),
      }));
    },
    /** Keeps (or replaces) this device's subscription. Refuses an eleventh device. */
    async save(deviceId: string, label: string, sub: PushSubscriptionJson): Promise<void> {
      check(deviceId);
      const had = await db.get("SELECT device_id FROM push_devices WHERE device_id = ?", deviceId);
      if (!had && (await this.list()).length >= MAX_PUSH_DEVICES) throw new Error(`At most ${MAX_PUSH_DEVICES} devices; remove one first`);
      const sealed = seal(await o.keys.dataKey(), o.userId, account(deviceId), JSON.stringify(sub));
      await db.run(
        "INSERT INTO push_devices (device_id, label, sealed, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (device_id) DO UPDATE SET label = excluded.label, sealed = excluded.sealed, failed_at = NULL",
        deviceId,
        label.slice(0, 100),
        sealed,
        stamp(),
      );
    },
    async remove(deviceId: string): Promise<boolean> {
      check(deviceId);
      return (await db.run("DELETE FROM push_devices WHERE device_id = ?", deviceId)).changes > 0;
    },
    /** Every device's subscription, opened, for sending; a row that no longer opens (another key) is skipped. */
    async subscriptions(): Promise<{ deviceId: string; sub: PushSubscriptionJson }[]> {
      const rows = (await db.all("SELECT device_id, sealed FROM push_devices")) as Row[];
      if (!rows.length) return [];
      const key = await o.keys.dataKey();
      const out: { deviceId: string; sub: PushSubscriptionJson }[] = [];
      for (const r of rows) {
        try {
          out.push({ deviceId: r.device_id as string, sub: JSON.parse(open(key, o.userId, account(r.device_id as string), r.sealed as string)) as PushSubscriptionJson });
        } catch (e) {
          if (!(e instanceof SecretError) && !(e instanceof SyntaxError)) throw e;
        }
      }
      return out;
    },
    async sent(deviceId: string): Promise<void> {
      await db.run("UPDATE push_devices SET sent_at = ?, failed_at = NULL WHERE device_id = ?", stamp(), deviceId);
    },
    async failed(deviceId: string): Promise<void> {
      await db.run("UPDATE push_devices SET failed_at = ? WHERE device_id = ?", stamp(), deviceId);
    },
  };
}
export type PushDevices = ReturnType<typeof createPushDevices>;
