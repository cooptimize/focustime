// P1: one person's Web Push: their devices (sealed subscriptions, store/push-devices.ts), the app's VAPID key (Key
// Vault in the hosted app; none in the developer loop or the demo, where push says it isn't set up) and sending. The
// notifier calls send() for a notice it delivers, after its gate, so push follows the same switches, quiet hours, once
// per key and holding during focus as every other notification. A device the push service says is gone is removed.
// Logs say only how many were sent, gone or failed: never an endpoint, a key or the text.
import type { Logger } from "../log/logger.ts";
import { pushPayload } from "../plan/push.ts";
import type { Notice } from "../plan/notify.ts";
import { DEVICE_ID, MAX_PUSH_DEVICES, type PushDevice, type PushDevices, type PushSubscriptionJson } from "../store/push-devices.ts";
import { allowedEndpoint, isVapidJwk, sendPush, vapidPublicKey, type VapidJwk } from "./webpush.ts";

/** The app's VAPID key: the raw secret text (a JWK), null when there is none for this app. */
export type VapidSource = () => Promise<string | null>;

export type PushStatus = { available: boolean; reason: string | null; publicKey: string | null; devices: PushDevice[] };

export type PushControl = {
  status(): Promise<PushStatus>;
  subscribe(deviceId: string, label: string, sub: unknown): Promise<void>;
  remove(deviceId: string): Promise<boolean>;
  /** Sends a delivered notice to every device; details decide what it says (plan/push.ts). */
  send(n: Notice, details: boolean): Promise<void>;
};

export class PushInputError extends Error {
  override name = "PushInputError";
}

const NOT_SET_UP = "Push isn't set up for this app yet (no VAPID key). In-app notifications still work.";

/** A subscription as the browser gives it (PushSubscription.toJSON()), checked: a known push service and P-256 keys. */
export function readSubscription(v: unknown): PushSubscriptionJson {
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!o || typeof o !== "object" || typeof o.endpoint !== "string" || o.endpoint.length > 1000 || !o.keys || typeof o.keys !== "object") throw new PushInputError("Not a push subscription");
  if (!allowedEndpoint(o.endpoint)) throw new PushInputError("That push service isn't one FocusTime sends to");
  const { p256dh, auth } = o.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new PushInputError("The subscription's keys aren't valid");
  return { endpoint: o.endpoint, keys: { p256dh, auth } };
}

export function createPush(o: { devices: PushDevices | null; vapid: VapidSource | null; subject: string; fetch: typeof fetch; now: () => number; log: Logger; demo?: boolean }): PushControl {
  let key: { at: number; k: VapidJwk | null } | null = null;
  const vapid = async (): Promise<VapidJwk | null> => {
    // Read once; a missing key is asked again after 5 minutes (it may have been set up since).
    if (key && (key.k || o.now() - key.at < 5 * 60_000)) return key.k;
    const raw = o.vapid ? await o.vapid().catch(() => null) : null;
    let k: VapidJwk | null = null;
    try {
      const j = raw ? (JSON.parse(raw) as unknown) : null;
      k = isVapidJwk(j) ? j : null;
    } catch {
      k = null;
    }
    key = { at: o.now(), k };
    return k;
  };
  const unavailable = async (): Promise<string | null> => {
    if (o.demo) return "Push isn't part of the demo. In-app notifications still work.";
    if (!o.devices) return "Push needs a signed-in account.";
    return (await vapid()) ? null : NOT_SET_UP;
  };
  return {
    async status() {
      const reason = await unavailable();
      const k = reason ? null : await vapid();
      return { available: !reason, reason, publicKey: k ? vapidPublicKey(k) : null, devices: o.devices ? await o.devices.list() : [] };
    },
    async subscribe(deviceId, label, sub) {
      const reason = await unavailable();
      if (reason) throw new PushInputError(reason);
      if (!DEVICE_ID.test(deviceId)) throw new PushInputError("Not a device id");
      const checked = readSubscription(sub);
      if (!(await o.devices!.list()).some((d) => d.deviceId === deviceId) && (await o.devices!.list()).length >= MAX_PUSH_DEVICES) throw new PushInputError(`Push is on for ${MAX_PUSH_DEVICES} devices already. Remove one first.`);
      await o.devices!.save(deviceId, label, checked);
      o.log({ source: "server", op: "push_device_added" });
    },
    async remove(deviceId) {
      if (!o.devices) return false;
      if (!DEVICE_ID.test(deviceId)) throw new PushInputError("Not a device id");
      const gone = await o.devices.remove(deviceId);
      if (gone) o.log({ source: "server", op: "push_device_removed" });
      return gone;
    },
    async send(n, details) {
      if (o.demo || !o.devices) return;
      const subs = await o.devices.subscriptions();
      if (!subs.length) return;
      const k = await vapid();
      if (!k) return;
      const payload = pushPayload(n, details);
      // The timer and meetings are now or never; the rest can wait a few hours for a phone that's off.
      const urgent = n.kind === "timer" || n.kind === "meeting";
      const counts = { sent: 0, gone: 0, failed: 0 };
      for (const { deviceId, sub } of subs) {
        const r = await sendPush({ fetch: o.fetch, sub, payload, key: k, subject: o.subject, now: o.now, ttlSeconds: urgent ? 15 * 60 : 4 * 3600, urgent });
        counts[r]++;
        if (r === "sent") await o.devices.sent(deviceId);
        else if (r === "gone") await o.devices.remove(deviceId);
        else await o.devices.failed(deviceId);
      }
      for (const [what, count] of Object.entries(counts)) if (count) o.log({ source: "server", op: `push_${what}`, kind: String(n.kind), count });
    },
  };
}
