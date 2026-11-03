import { describe, expect, it } from "vitest";
import { AUTH_REQUEST_MS, createAccountStore, DEMO_SESSION_MS, SESSION_IDLE_MS, SESSION_MAX_MS } from "./accounts.ts";
import { forEachDriver } from "../test/db.ts";

await forEachDriver("accounts", ({ open }) => {
async function setup() {
  const db = (await open()).conn;
  let now = Temporal.Instant.from("2026-11-02T14:30:00Z");
  const store = createAccountStore(db, () => now);
  return { db, store, advance: (ms: number) => void (now = now.add({ milliseconds: ms })) };
}

describe("sessions", () => {
  it("stores only a hash of the session id, never the cookie value", async () => {
    const t = await setup();
    const { cookie, csrf } = (await t.store.sessions.create("user-a"));
    const rows = JSON.stringify(await t.db.all("SELECT * FROM sessions"));
    expect(rows).not.toContain(cookie);
    expect(cookie.length).toBeGreaterThanOrEqual(43);
    expect(csrf.length).toBeGreaterThanOrEqual(32);
    expect((await t.store.sessions.resolve(cookie))).toMatchObject({ userId: "user-a", demo: false });
    expect((await t.store.sessions.resolve("not-a-session"))).toBeNull();
    expect((await t.store.sessions.resolve(undefined))).toBeNull();
  });

  it("ends after 12 idle hours; use keeps it alive", async () => {
    const t = await setup();
    const { cookie } = (await t.store.sessions.create("user-a"));
    t.advance(SESSION_IDLE_MS - 60_000);
    expect((await t.store.sessions.resolve(cookie))).not.toBeNull();
    t.advance(SESSION_IDLE_MS - 60_000);
    expect((await t.store.sessions.resolve(cookie))).not.toBeNull();
    t.advance(SESSION_IDLE_MS + 1);
    expect((await t.store.sessions.resolve(cookie))).toBeNull();
  });

  it("ends after 7 days however much it's used", async () => {
    const t = await setup();
    const { cookie } = (await t.store.sessions.create("user-a"));
    let elapsed = 0;
    // Used every 11 hours (never idle for 12): alive until the 7 days are up.
    while (elapsed + 11 * 3600_000 < SESSION_MAX_MS) {
      t.advance(11 * 3600_000);
      elapsed += 11 * 3600_000;
      expect((await t.store.sessions.resolve(cookie))).not.toBeNull();
    }
    t.advance(SESSION_MAX_MS - elapsed);
    expect((await t.store.sessions.resolve(cookie))).toBeNull();
    expect((await t.db.get("SELECT COUNT(*) AS n FROM sessions"))!.n).toBe(0);
  });

  it("ends a demo session after 2 hours", async () => {
    const t = await setup();
    const { cookie } = (await t.store.sessions.create("demo-x", { demo: true }));
    t.advance(DEMO_SESSION_MS - 1000);
    expect((await t.store.sessions.resolve(cookie))).toMatchObject({ demo: true });
    t.advance(2000);
    expect((await t.store.sessions.resolve(cookie))).toBeNull();
  });

  it("checks the CSRF token in constant time, and ends every session of a person", async () => {
    const t = await setup();
    const a = (await t.store.sessions.create("user-a"));
    const b = (await t.store.sessions.create("user-a"));
    const s = (await t.store.sessions.resolve(a.cookie))!;
    expect(t.store.sessions.csrfOk(s, a.csrf)).toBe(true);
    expect(t.store.sessions.csrfOk(s, b.csrf)).toBe(false);
    expect(t.store.sessions.csrfOk(s, undefined)).toBe(false);
    expect(t.store.sessions.csrfOk(s, "")).toBe(false);
    await t.store.sessions.endAllFor("user-a");
    expect((await t.store.sessions.resolve(a.cookie))).toBeNull();
    expect((await t.store.sessions.resolve(b.cookie))).toBeNull();
  });
});

describe("pending sign-ins", () => {
  it("are taken once, for their own kind, within 10 minutes", async () => {
    const t = await setup();
    const p = { state: "s1", nonce: "n1", verifier: "v1" };
    await t.store.authRequests.put("microsoft", p);
    expect((await t.store.authRequests.take("microsoft", "s1"))).toMatchObject(p);
    expect((await t.store.authRequests.take("microsoft", "s1"))).toBeNull();
    // Offered as the other kind, it is refused and used up.
    await t.store.authRequests.put("microsoft", { state: "s3", nonce: "n3", verifier: "v3" });
    expect((await t.store.authRequests.take("google", "s3"))).toBeNull();
    expect((await t.store.authRequests.take("microsoft", "s3"))).toBeNull();
    await t.store.authRequests.put("google", { state: "s2", nonce: "n2", verifier: "v2" }, "user-a");
    t.advance(AUTH_REQUEST_MS + 1);
    expect((await t.store.authRequests.take("google", "s2"))).toBeNull();
    expect(JSON.stringify(await t.db.all("SELECT * FROM auth_requests"))).not.toContain("s2");
  });
});

describe("users", () => {
  it("records the first sign-in and updates the name on the next", async () => {
    const t = await setup();
    const first = (await t.store.users.signedIn({ id: "oid-1", tenantId: "tid", upn: "ana@cooptimize.example", displayName: "Ana", email: "ana@cooptimize.example" }));
    expect(first.created).toBe(true);
    t.advance(60_000);
    const again = (await t.store.users.signedIn({ id: "oid-1", tenantId: "tid", upn: "ana@cooptimize.example", displayName: "Ana Example", email: "ana@cooptimize.example" }));
    expect(again.created).toBe(false);
    expect(again.user.displayName).toBe("Ana Example");
    expect(again.user.createdAt).toBe(first.user.createdAt);
    expect((await t.store.users.count())).toBe(1);
  });
});
});
