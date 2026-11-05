// ADM-2 (D590): FocusTime is for Cooptimize accounts. A guest is told from the ID token alone (acct, idp, a #EXT# UPN)
// and refused before anything is kept, audited, with any sessions they still had ended; an address outside the
// Cooptimize email domains (when the Rule is set) too. Break-glass admins get the same check. Dataverse plays no part:
// a member signs in while it is down.
import { describe, expect, it } from "vitest";
import { createAccountStore } from "../store/accounts.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createUserSettings } from "../store/user-settings.ts";
import { createAdminCheck } from "../actions/admin.ts";
import { createEntraSignIn, type SignedIn } from "./auth/entra.ts";
import { createFakeIdp, FAKE_CLIENT, FAKE_ISSUER, FAKE_SECRET, FAKE_TENANT, type IdpKnobs } from "./auth/test-idp.ts";
import { createPeople } from "./people.ts";

const now = () => Temporal.Instant.from("2026-11-06T14:30:00Z");
const TOKENS = { refreshToken: "r", accessToken: "fake-access", expiresIn: 3599, scope: "" };
const MEMBER: SignedIn = { oid: "a4d00000-0000-4000-8000-0000000000a1", tid: "tid", upn: "ana@contoso.example", name: "Ana", email: "ana@contoso.example", guest: null };
const GUEST: SignedIn = { oid: "a4d00000-0000-4000-8000-0000000000b2", tid: "tid", upn: "gus@partner.example", name: "Gus", email: "gus@partner.example", guest: "idp" };

function setup(domains: string[] = ["contoso.example"]) {
  const db = sqliteConn(openPlanDb({ path: ":memory:", now: () => now().toZonedDateTimeISO("UTC") }));
  const accounts = createAccountStore(db, now);
  const refused: { name: string; why: string }[] = [];
  const settingsFor = (userId: string) =>
    createUserSettings({ db, userId, app: { dataverse: null, entra: null, google: null }, person: async () => ({ email: null, upn: "", timeZone: null }), setZone: (z) => accounts.users.setTimeZone(userId, z), defaultZone: "UTC", now });
  const people = createPeople({
    db,
    accounts,
    settingsFor,
    configFile: { load: async () => null, raw: async () => null },
    mailboxZone: async () => null,
    hostZone: () => "UTC",
    cooptimizeDomains: async () => domains,
    refusedGuest: async (u, why) => {
      await accounts.sessions.endAllFor(u.oid);
      refused.push({ name: u.name, why });
    },
    log: () => {},
  });
  return { db, accounts, people, refused };
}

async function token(knobs: IdpKnobs) {
  const idp = createFakeIdp(knobs);
  const entra = createEntraSignIn({ tenantId: FAKE_TENANT, clientId: FAKE_CLIENT, redirectUri: "https://ft.example/auth/microsoft/callback", clientSecret: async () => FAKE_SECRET, log: () => {}, fetch: idp.fetch as never, issuer: FAKE_ISSUER });
  const { url, pending } = await entra.start({});
  return (await entra.finish(new URL(idp.approve(url), "https://ft.example"), pending)).user;
}

describe("guests at sign-in", () => {
  it("the ID token says guest: acct 1, or an idp that isn't the issuer; a member's says nothing", async () => {
    expect((await token({ claims: { acct: 1 } })).guest).toBe("acct");
    expect((await token({ claims: { idp: "https://sts.windows.net/22222222-2222-4222-8222-222222222222/" } })).guest).toBe("idp");
    expect((await token({})).guest).toBeNull();
  });

  it("a guest is refused, audited, keeps no account and loses any session it had", async () => {
    const t = setup();
    await t.accounts.users.signedIn({ id: GUEST.oid, tenantId: "tid", upn: GUEST.upn, displayName: GUEST.name, email: GUEST.email });
    const cookie = (await t.accounts.sessions.create(GUEST.oid)).cookie;
    expect(await t.people.signedIn(GUEST, TOKENS)).toEqual({ refused: "guest" });
    expect(t.refused).toEqual([{ name: "Gus", why: "idp" }]);
    expect(await t.accounts.sessions.resolve(cookie)).toBeNull();
  });

  it("with the domains Rule set, an address outside it is refused even with a member token", async () => {
    const t = setup();
    expect(await t.people.signedIn({ ...MEMBER, oid: "a4d00000-0000-4000-8000-0000000000c3", email: "cy@elsewhere.example", upn: "cy@elsewhere.example" }, TOKENS)).toEqual({ refused: "guest" });
    expect(t.refused[0]?.why).toBe("domain");
  });

  it("a member signs in with Dataverse down (nothing here reads it), and with the Rule empty", async () => {
    for (const domains of [["contoso.example"], []]) {
      const t = setup(domains);
      const r = await t.people.signedIn(MEMBER, TOKENS);
      expect(r).toMatchObject({ userId: MEMBER.oid });
      expect(await t.accounts.users.get(MEMBER.oid)).toBeTruthy();
    }
  });

  it("break-glass: a member on the list signs in and is an admin; a guest on the list is still refused", async () => {
    const t = setup();
    const check = createAdminCheck({ groupId: null, breakGlass: [MEMBER.oid, GUEST.oid], graph: async () => null, now: Date.now });
    expect(await t.people.signedIn(MEMBER, TOKENS)).toMatchObject({ userId: MEMBER.oid });
    expect(await check.isAdmin(MEMBER.oid)).toBe(true);
    expect(await t.people.signedIn(GUEST, TOKENS)).toEqual({ refused: "guest" });
  });
});
