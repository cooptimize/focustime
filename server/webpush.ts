// P1: Web Push from the server, with node:crypto only (no library): the message encrypted for one browser (RFC 8291,
// aes128gcm from RFC 8188, one record) and the request signed with the app's VAPID key (RFC 8292, an ES256 JWT). The
// push service learns nothing but the ciphertext; the payload is short and generic unless the person turned details on
// (plan/push.ts). Nothing here logs: never an endpoint, a key, a JWT or a body.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from "node:crypto";
import type { PushSubscriptionJson } from "../store/push-devices.ts";

/** The app's VAPID key pair as a JWK (P-256): kept as one Key Vault secret, ft-vapid-key. */
export type VapidJwk = { kty: "EC"; crv: "P-256"; d: string; x: string; y: string };

const b64 = (s: string) => Buffer.from(s, "base64url");

/** The application server key the browser subscribes with: the uncompressed public point, base64url (65 bytes). */
export const vapidPublicKey = (k: VapidJwk) => Buffer.concat([Buffer.from([4]), b64(k.x), b64(k.y)]).toString("base64url");

export function isVapidJwk(v: unknown): v is VapidJwk {
  const k = v as Partial<VapidJwk> | null;
  return !!k && k.kty === "EC" && k.crv === "P-256" && [k.d, k.x, k.y].every((p) => typeof p === "string" && b64(p).length === 32);
}

/**
 * Push services FocusTime sends to: Apple, Google (Chrome, Edge on Android), Mozilla and Microsoft (Edge on Windows).
 * Anything else is refused, so a subscription can't make the server call an arbitrary address.
 */
const PUSH_HOSTS = [/^([a-z0-9-]+\.)*push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

const RS = 4096;

/**
 * RFC 8291: the payload encrypted for one subscription, as the request body (header, then one record). `as` and `salt`
 * are for the RFC's test vector; otherwise a fresh key pair and salt per message.
 */
export function encryptPayload(plain: Buffer, keys: PushSubscriptionJson["keys"], test?: { as: ECDH; salt: Buffer }): Buffer {
  const uaPublic = b64(keys.p256dh);
  const authSecret = b64(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("The browser's push key isn't a P-256 point");
  if (authSecret.length !== 16) throw new Error("The browser's push auth secret isn't 16 bytes");
  if (plain.length > RS - 17) throw new Error("The push message is too long");
  const as = test?.as ?? createECDH("prime256v1");
  if (!test) as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  // IKM from the shared secret and the auth secret, bound to both public keys (RFC 8291 3.4).
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = test?.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  // One record, so it is the last one: the padding delimiter is 2 (RFC 8188 2).
  const body = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** RFC 8292: the Authorization header for one push service: a JWT for its origin, valid 12 hours, and the public key. */
export function vapidAuthorization(endpoint: string, key: VapidJwk, subject: string, nowSeconds: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })}`;
  // ES256 in a JWS is r and s, 32 bytes each (RFC 7518 3.4), not DER.
  const sig = sign("sha256", Buffer.from(data), { key: createPrivateKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${sig.toString("base64url")}, k=${vapidPublicKey(key)}`;
}

export type PushResult = "sent" | "gone" | "failed";

/**
 * Sends one message to one subscription. "gone": the push service says the subscription no longer exists (404 or
 * 410), so the device is removed; "failed": anything else, kept and tried again next time.
 */
export async function sendPush(o: { fetch: typeof fetch; sub: PushSubscriptionJson; payload: object; key: VapidJwk; subject: string; now: () => number; ttlSeconds: number; urgent: boolean }): Promise<PushResult> {
  if (!allowedEndpoint(o.sub.endpoint)) return "gone";
  let body: Buffer;
  try {
    body = encryptPayload(Buffer.from(JSON.stringify(o.payload)), o.sub.keys);
  } catch {
    return "gone";
  }
  try {
    const r = await o.fetch(o.sub.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: vapidAuthorization(o.sub.endpoint, o.key, o.subject, Math.floor(o.now() / 1000)),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(o.ttlSeconds),
        urgency: o.urgent ? "high" : "normal",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    await r.body?.cancel().catch(() => undefined);
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
