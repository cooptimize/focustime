// Step 16.4: profile photos: mine and the Cooptimizers on screen, matched by email, cached 7 days (stale ones shown and
// read again in the background), initials when there is no photo, no permission or no sign-in; cleared on sign-out.
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPhotoCache } from "../host/local/photos.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { demoAvatar, photoAge } from "../plan/photos.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { createPhotoClient, type Photo, type PhotoClient } from "../sources/graph/photos.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "./account.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { PhotosData } from "./types.ts";

const ME = { oid: "0f0f0f0f-1111-4222-8333-444455556666", tid: "11111111-1111-4111-8111-111111111111", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
const TOML = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(/(\[outlook\]\ntenant_id = "[^"]*"\n)client_id = ""/, '$1client_id = "44444444-4444-4444-8444-444444444444"');
const aad = (n: number) => `a4d00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEAM = [
  { id: "d1", name: "Jordan Lee", email: "jordan.lee@example.com", aadId: aad(1) },
  { id: "d2", name: "Priya Shah", email: "priya.shah@example.com", aadId: aad(2) },
  { id: "d3", name: "Sam Ortiz", email: "sam.ortiz@example.com", aadId: null },
];
const JPEG: Photo = { type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) };

function setup(o: { signedIn?: boolean; noClient?: boolean; fail?: unknown; cache?: boolean } = {}) {
  let t = Date.parse("2026-11-02T15:00:00Z");
  const clock = { now: () => new Date(t).toISOString(), advanceDays: (d: number) => void (t += d * 86_400_000) };
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock.now()).toZonedDateTimeISO("America/New_York") });
  if (o.signedIn !== false) plan.setAccountState(IDENTITY_KEY, { ...ME, signedInAt: clock.now(), systemUserId: null, systemUserEmail: null });
  const reads: string[] = [];
  const g = { fail: o.fail as unknown, photo: JPEG as Photo | null };
  const photos: PhotoClient = {
    mine: async () => {
      if (g.fail) throw g.fail;
      reads.push("me");
      return g.photo;
    },
    person: async (oid) => {
      if (g.fail) throw g.fail;
      reads.push(oid);
      return oid === aad(2) ? null : g.photo;
    },
  };
  const account: MicrosoftAccount = { signIn: async () => ({ status: "connected" }), identity: async () => ME, armToken: async () => "x", writeAccess: async () => ({ status: "read_only", message: "x" }), signOut: async () => {}, ...(o.noClient ? {} : { photos }) };
  const dir = mkdtempSync(join(tmpdir(), "focustime-photos-"));
  const cache = createPhotoCache(dir);
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(TOML) }),
    makeDataverse: () => ({ teammates: async () => ({ ok: true, people: TEAM }), pto: async () => ({ items: [] }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: clock.now,
    plan,
    account: () => account,
    ...(o.cache === false ? {} : { photoCache: cache }),
  };
  const run = async (input: unknown) => {
    const r = await dispatch(c, { action: "people.photos", input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as PhotosData;
  };
  return { c, run, reads, g, clock, dir };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("photos for the people on screen", () => {
  it("my photo and teammates' by email; no photo or no Entra ID reads as initials (null)", async () => {
    const s = setup();
    const r = await s.run({ me: true, emails: ["Jordan.Lee@example.com", "priya.shah@example.com", "sam.ortiz@example.com", "nobody@example.com"] });
    expect(r.available).toBe(true);
    expect(r.me).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.people).toEqual([
      { email: "jordan.lee@example.com", photo: expect.stringMatching(/^data:image\/jpeg;base64,/) },
      { email: "priya.shah@example.com", photo: null },
    ]);
    // Only Cooptimizers with an Entra ID are read; Sam has none, nobody@ isn't on the team.
    expect(s.reads.sort()).toEqual([aad(1), aad(2), "me"].sort());
  });
  it("serves from the cache for 7 days; then shows the old one and reads again in the background", async () => {
    const s = setup();
    await s.run({ emails: ["jordan.lee@example.com"] });
    expect(s.reads).toEqual([aad(1)]);
    s.clock.advanceDays(6);
    await s.run({ emails: ["jordan.lee@example.com"] });
    expect(s.reads).toHaveLength(1);
    s.clock.advanceDays(2);
    s.g.photo = null; // removed in Entra since
    const stale = await s.run({ emails: ["jordan.lee@example.com"] });
    expect(stale.people[0]!.photo).toMatch(/^data:image\/jpeg/);
    await settle();
    expect(s.reads).toHaveLength(2);
    const after = await s.run({ emails: ["jordan.lee@example.com"] });
    expect(after.people[0]!.photo).toBeNull();
  });
  it("a missing photo is remembered too (no read every time)", async () => {
    const s = setup();
    await s.run({ emails: ["priya.shah@example.com"] });
    await s.run({ emails: ["priya.shah@example.com"] });
    expect(s.reads).toEqual([aad(2)]);
  });
  it("no permission (403 or consent): initials, and says so", async () => {
    const s = setup({ fail: new HttpError(403) });
    expect(await s.run({ me: true, emails: ["jordan.lee@example.com"] })).toEqual({ available: false, reason: "consent", me: null, people: [] });
  });
  it("signed out, or no photo access on this account: initials, no reads", async () => {
    expect(await setup({ signedIn: false }).run({ me: true })).toMatchObject({ available: false, reason: "signed_out" });
    expect(await setup({ noClient: true }).run({ me: true })).toMatchObject({ available: false, reason: "signed_out" });
  });
  it("refuses bad input and too many people", async () => {
    const s = setup();
    await expect(s.run({ emails: "x" })).rejects.toThrow(/400/);
    await expect(s.run({ who: [] })).rejects.toThrow(/400/);
    await expect(s.run({ emails: Array.from({ length: 61 }, (_, i) => `p${i}@example.com`) })).rejects.toThrow(/At most 60/);
  });
  it("sign-out clears the photo cache", async () => {
    const s = setup();
    await s.run({ me: true, emails: ["jordan.lee@example.com"] });
    expect(readdirSync(join(s.dir, "photos")).length).toBeGreaterThan(0);
    const r = await dispatch(s.c, { action: "auth.sign_out", input: {} });
    expect(r.ok).toBe(true);
    expect(existsSync(join(s.dir, "photos"))).toBe(false);
  });
  it("the cache names no one: file names are hashes, not IDs or addresses", async () => {
    const s = setup();
    await s.run({ me: true, emails: ["jordan.lee@example.com"] });
    for (const f of readdirSync(join(s.dir, "photos"))) expect(f).toMatch(/^[0-9a-f]{40}\.(json|img)$/);
  });
});

describe("photo rules", () => {
  it("fresh for 7 days, then stale; missing when never read", () => {
    expect(photoAge(null, "2026-11-02T00:00:00Z")).toBe("missing");
    expect(photoAge({ fetchedAt: "2026-11-01T00:00:00Z" }, "2026-11-07T23:00:00Z")).toBe("fresh");
    expect(photoAge({ fetchedAt: "2026-11-01T00:00:00Z" }, "2026-11-08T00:00:00Z")).toBe("stale");
  });
  it("demo avatars are generated from the name, the same each time, no photo of anyone", () => {
    expect(demoAvatar("Jordan Lee")).toBe(demoAvatar("Jordan Lee"));
    expect(demoAvatar("Jordan Lee")).not.toBe(demoAvatar("Priya Shah"));
    expect(demoAvatar("Jordan Lee")).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe("the Graph photo client", () => {
  const client = (res: () => Response, seen: string[] = [], logs: unknown[] = []) =>
    createPhotoClient({ fetch: (async (u: string | URL | Request, init?: RequestInit) => (seen.push(`${String(u)} ${new Headers(init?.headers).get("authorization")}`), res())) as typeof fetch, token: async () => "tok", invalidate: () => {}, log: (e) => void logs.push(e) });
  it("asks for the small size, mine or a teammate's by object ID", async () => {
    const seen: string[] = [];
    const c = client(() => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } }), seen);
    expect(await c.mine()).toMatchObject({ type: "image/jpeg" });
    await c.person(aad(1).toUpperCase());
    expect(seen).toEqual([`https://graph.microsoft.com/v1.0/me/photos/96x96/$value Bearer tok`, `https://graph.microsoft.com/v1.0/users/${aad(1)}/photos/96x96/$value Bearer tok`]);
  });
  it("404 means no photo; anything not an image is ignored; other errors throw", async () => {
    expect(await client(() => new Response(null, { status: 404 })).mine()).toBeNull();
    expect(await client(() => new Response("<html>", { headers: { "content-type": "text/html" } })).mine()).toBeNull();
    await expect(client(() => new Response(null, { status: 403 })).mine()).rejects.toBeInstanceOf(HttpError);
    await expect(client(() => new Response(null)).person("not-a-guid")).rejects.toBeInstanceOf(HttpError);
  });
  it("logs only the status, never the person, the address or the token", async () => {
    const logs: unknown[] = [];
    await client(() => new Response(null, { status: 404 }), [], logs).person(aad(1));
    expect(JSON.stringify(logs)).not.toMatch(/a4d0|tok|example/);
    expect(logs).toEqual([expect.objectContaining({ op: "photo", status: 404 })]);
  });
});
