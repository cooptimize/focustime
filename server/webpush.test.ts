// P1: Web Push without a library: the encryption matches RFC 8291's worked example byte for byte, the VAPID JWT
// verifies with the public key the browser subscribes with, only known push services are called, a gone subscription
// says so, and a person's push never sends a client name or title unless details are on.
import { createECDH, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pushPayload, PUSH_GENERIC, deviceLabel, DEVICE_LABEL } from "../plan/push.ts";
import { notices } from "../plan/notify.ts";
import { createPushDevices } from "../store/push-devices.ts";
import { fakeKeyProvider } from "../store/user-secrets.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createPush, readSubscription } from "./push.ts";
import { allowedEndpoint, encryptPayload, isVapidJwk, sendPush, vapidAuthorization, vapidPublicKey, type VapidJwk } from "./webpush.ts";

const newVapid = (): VapidJwk => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }) as VapidJwk;
/** A browser's subscription keys (a real P-256 point and a 16-byte auth secret). */
function browser() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") } };
}

describe("RFC 8291 encryption", () => {
  it("matches the RFC's example (Appendix A)", () => {
    const as = createECDH("prime256v1");
    as.setPrivateKey(Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"));
    const out = encryptPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      { as, salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url") },
    );
    expect(out.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("refuses keys that aren't a browser's", () => {
    expect(() => encryptPayload(Buffer.from("x"), { p256dh: "AAAA", auth: "BTBZMqHH6r4Tts7J_aSIgg" })).toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service's origin that verifies with the public key, valid at most 24 hours", () => {
    const k = newVapid();
    expect(isVapidJwk(k)).toBe(true);
    const h = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMRQ?x=1", k, "https://ft.example", 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(vapidPublicKey(k));
    expect(Buffer.from(m[4]!, "base64url").length).toBe(65);
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString()) as { aud: string; exp: number; sub: string };
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600, sub: "https://ft.example" });
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: k.x, y: k.y }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3]!, "base64url"))).toBe(true);
  });
});

describe("sending", () => {
  it("calls only known push services, over https", () => {
    for (const ok of ["https://web.push.apple.com/abc", "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(allowedEndpoint(ok), ok).toBe(true);
    for (const no of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url"]) expect(allowedEndpoint(no), no).toBe(false);
    expect(() => readSubscription({ endpoint: "https://evil.example/x", keys: browser().keys })).toThrow(/push service/);
  });

  it("posts the encrypted body with the VAPID header, TTL and urgency; 404 and 410 mean gone", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const f = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status }))) as unknown as typeof fetch;
    const o = { fetch: f, sub: browser(), payload: { title: "t" }, key: newVapid(), subject: "https://ft.example", now: () => 1_800_000_000_000, ttlSeconds: 60, urgent: true };
    expect(await sendPush(o)).toBe("sent");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h).toMatchObject({ "content-encoding": "aes128gcm", ttl: "60", urgency: "high" });
    expect(h.authorization).toMatch(/^vapid t=.+, k=/);
    expect(calls[0]!.init.redirect).toBe("error");
    status = 410;
    expect(await sendPush(o)).toBe("gone");
    status = 404;
    expect(await sendPush(o)).toBe("gone");
    status = 500;
    expect(await sendPush(o)).toBe("failed");
  });
});

describe("what a push says", () => {
  const followUps = notices.followUps("2026-11-02", [{ id: 12, what: "Send Northwind the export spec", overdue: false }], "2026-11-02T14:00:00Z")!;
  const meeting = notices.meeting(["Northwind standup at 10:00"], ["e1"], "2026-11-02T14:55:00Z");

  it("with details off, only the kind of thing: no client, title or subject", () => {
    for (const n of [followUps, meeting]) {
      const p = pushPayload(n, false);
      expect(JSON.stringify(p)).not.toMatch(/Northwind|export spec|standup/);
      expect({ title: p.title, body: p.body }).toEqual(PUSH_GENERIC[n.kind]);
    }
    expect(pushPayload(followUps, false).route).toBe("followup:12");
  });

  it("with details on, the notice's own words", () => {
    expect(pushPayload(meeting, true).body).toContain("Northwind standup");
  });

  it("names a device only by kind and browser", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(DEVICE_LABEL.test("iPhone · Safari")).toBe(true);
    expect(DEVICE_LABEL.test("<script>")).toBe(false);
  });
});

describe("a person's devices", () => {
  const T = Temporal.Instant.from("2026-11-02T14:00:00Z");
  const setup = () => {
    const db = sqliteConn(openPlanDb({ path: ":memory:", now: () => T.toZonedDateTimeISO("UTC") }));
    const devices = createPushDevices({ db, userId: "ana", keys: fakeKeyProvider(), now: () => T });
    return { db, devices };
  };

  it("keeps the subscription sealed: the row holds no endpoint or key, and the list never returns them", async () => {
    const { db, devices } = setup();
    const sub = browser();
    await devices.save("device-aaaaaaaaaaaaaaaa", "iPhone · Safari", sub);
    const raw = JSON.stringify(await db.all("SELECT * FROM push_devices", []));
    expect(raw).not.toContain("fcm.googleapis.com");
    expect(raw).not.toContain(sub.keys.p256dh);
    expect(JSON.stringify(await devices.list())).not.toContain("fcm");
    expect(await devices.subscriptions()).toEqual([{ deviceId: "device-aaaaaaaaaaaaaaaa", sub }]);
  });

  it("removing a device deletes its subscription; a gone one is removed after a send", async () => {
    const { db, devices } = setup();
    await devices.save("device-aaaaaaaaaaaaaaaa", "iPhone · Safari", browser());
    await devices.save("device-bbbbbbbbbbbbbbbb", "Android · Chrome", browser());
    expect(await devices.remove("device-aaaaaaaaaaaaaaaa")).toBe(true);
    expect((await db.all("SELECT device_id FROM push_devices", [])).map((r) => r.device_id)).toEqual(["device-bbbbbbbbbbbbbbbb"]);
    const push = createPush({ devices, vapid: async () => JSON.stringify(newVapid()), subject: "https://ft.example", fetch: (async () => new Response(null, { status: 410 })) as unknown as typeof fetch, now: () => Date.now(), log: () => {} });
    await push.send(followUpsNotice(), false);
    expect(await devices.list()).toEqual([]);
  });

  it("says push isn't set up when the app has no VAPID key, and refuses a subscription then", async () => {
    const { devices } = setup();
    const push = createPush({ devices, vapid: async () => null, subject: "https://ft.example", fetch, now: () => Date.now(), log: () => {} });
    expect(await push.status()).toMatchObject({ available: false, publicKey: null });
    await expect(push.subscribe("device-aaaaaaaaaaaaaaaa", "Phone", browser())).rejects.toThrow(/isn't set up/);
  });
});

const followUpsNotice = () => notices.followUps("2026-11-02", [{ id: 1, what: "Reply", overdue: false }], "2026-11-02T14:00:00Z")!;
