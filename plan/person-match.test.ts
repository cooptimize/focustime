// ADM-2 (D577, D578, D580): one person match, one Cooptimizer rule, and a guest told from the ID token alone.
import { describe, expect, it } from "vitest";
import { aDirectoryPerson } from "../test/builders/index.ts";
import { cooptimizers, guestToken, matchPerson, matchText, notCooptimizer } from "./person-match.ts";

const DOMAINS = ["contoso.example"];
const dir = (o: Parameters<typeof aDirectoryPerson>[0] = {}) => {
  const p = aDirectoryPerson(o);
  return { ...p, entra: !p.personId.startsWith("dv:") };
};

describe("matchPerson", () => {
  it("by Entra id first", () => {
    const p = dir();
    expect(matchPerson([p], { id: p.personId.toUpperCase(), email: null, upn: null })).toMatchObject({ by: "entra_id", entraMissing: false });
  });
  it("found by email with no Entra id in Dataverse: Matched by email, Entra id missing (never Not matched)", () => {
    const p = dir({ personId: "dv:d3300000-0000-4000-8000-000000000777", email: "pat@contoso.example" });
    const m = matchPerson([p], { id: "a4d00000-0000-4000-8000-000000000777", email: "Pat@Contoso.example", upn: null });
    expect(m).toMatchObject({ by: "email", entraMissing: true });
    expect(matchText(m!)).toBe("Matched by email, Entra id missing");
  });
  it("then the UPN, then the Dataverse user the sign-in was matched to (ms_identity)", () => {
    const p = dir({ email: "pat@contoso.example" });
    expect(matchPerson([p], { id: "other", email: null, upn: "pat@contoso.example" })?.by).toBe("upn");
    expect(matchPerson([p], { id: "other", email: "x@contoso.example", upn: "x@contoso.example", systemUserId: p.systemUserId.toUpperCase() })?.by).toBe("dataverse_user");
    expect(matchPerson([p], { id: "other", email: "x@contoso.example", upn: null })).toBeNull();
  });
});

describe("the Cooptimizer rule", () => {
  it("a guest, an address outside the domains and an automation account aren't Cooptimizers", () => {
    expect(notCooptimizer({ email: "pat@contoso.example" }, DOMAINS)).toBeNull();
    expect(notCooptimizer({ email: "pat@sub.contoso.example" }, DOMAINS)).toBeNull();
    expect(notCooptimizer({ email: "gus@partner.example", guest: true }, DOMAINS)).toBe("guest");
    expect(notCooptimizer({ email: "gus@partner.example", upn: "gus_partner.example#EXT#@contoso.example" }, [])).toBe("guest");
    expect(notCooptimizer({ email: "gus@partner.example" }, DOMAINS)).toBe("domain");
    expect(notCooptimizer({ email: "bot@contoso.example", automation: true }, DOMAINS)).toBe("automation");
  });
  it("with the domains Rule empty, only the guest check applies (and says so)", () => {
    const r = cooptimizers({ directory: [dir({ email: "gus@partner.example" })], signedIn: [], automation: [], domains: [] });
    expect(r.cooptimizers).toHaveLength(1);
    expect(r.noDomains).toBe(true);
  });
  it("cooptimizers(): each person once (a signed-in person and their Dataverse row are one entry); externals apart", () => {
    const ana = dir({ email: "ana@contoso.example" });
    const gus = dir({ email: "gus@partner.example", guest: true });
    const bot = dir({ email: "bot@contoso.example" });
    const r = cooptimizers({ directory: [ana, gus, bot], signedIn: [{ id: "a4d00000-0000-4000-8000-0000000009a1", email: "ana@contoso.example", upn: "ana@contoso.example" }], automation: [bot.personId], domains: DOMAINS });
    expect(r.cooptimizers.map((e) => e.id)).toEqual(["a4d00000-0000-4000-8000-0000000009a1"]);
    expect(r.entry(ana.personId)?.id).toBe("a4d00000-0000-4000-8000-0000000009a1");
    expect(r.others.map((e) => e.notCooptimizer)).toEqual(["guest", "automation"]);
    expect(r.isCooptimizer(gus.personId)).toBe(false);
  });
});

describe("guestToken (the ID token alone, never Dataverse)", () => {
  const iss = "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0";
  it("acct 1, an idp that isn't the issuer, or a #EXT# UPN", () => {
    expect(guestToken({ iss, acct: 1 })).toBe("acct");
    expect(guestToken({ iss, idp: "https://sts.windows.net/22222222-2222-4222-8222-222222222222/" })).toBe("idp");
    expect(guestToken({ iss, upn: "gus_partner.example#EXT#@contoso.example" })).toBe("upn");
  });
  it("a member: no idp, an idp equal to the issuer, or acct 0", () => {
    expect(guestToken({ iss })).toBeNull();
    expect(guestToken({ iss, idp: `${iss}/` })).toBeNull();
    expect(guestToken({ iss, acct: 0, upn: "pat@contoso.example" })).toBeNull();
  });
});
