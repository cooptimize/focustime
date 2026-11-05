// ADM-2 (D587, D588): Admin › People reads the one person match: a signed-in person found by email (Dataverse has no
// Entra id for them) shows Matched with the key, beside the level and leads from the same row; an external Dataverse
// user is under Not Cooptimizers, never in People, a lead picker or a teammate picker.
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { anAccount, aDirectoryPerson } from "../test/builders/index.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { createAdminCheck } from "./admin.ts";
import { adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import { onlyClients } from "./client-accounts.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import { guidanceFor } from "../config/org.ts";

const NOW = "2026-11-06T15:00:00Z";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const PAT = "00000000-0000-4000-8000-0000000000b2";

type Row = { id: string; name: string; dataverseMatch: boolean; dataverseText: string; levelName: string | null; leads: { clientKey: string }[]; clients: string[]; notCooptimizerText: string | null };
type People = { people: Row[]; others: Row[]; noDomains: boolean; positions: { name: string; people: number; mapped: boolean; level: string | null }[]; unmappedPositions: number };

async function setup(domains = ["contoso.example"]) {
  const db = sqliteDb().conn;
  const now = () => Temporal.Instant.from(NOW);
  const accounts = createAccountStore(db, now);
  await accounts.users.signedIn({ id: ADMIN, tenantId: "t", upn: "ada@contoso.example", displayName: "Ada Admin", email: "ada@contoso.example" });
  await accounts.users.signedIn({ id: PAT, tenantId: "t", upn: "pat@contoso.example", displayName: "Pat Lead", email: "pat@contoso.example" });
  const store = createAdminStore(db, now);
  // Pat: in Dataverse without an Entra id, a Lead Consultant who owns the customer and a prospect.
  const pat = aDirectoryPerson({ personId: "dv:d3300000-0000-4000-8000-0000000000b2", name: "Pat Lead", email: "pat@contoso.example", level: "lead", positionName: "Lead Consultant" });
  const gus = aDirectoryPerson({ name: "Gus Guest", email: "gus@partner.example", level: null, positionName: null, guest: true });
  const pia = aDirectoryPerson({ name: "Pia Principal", email: "pia@contoso.example", level: null, positionName: "Principal Architect" });
  await store.replaceDirectory(
    [pat, gus, pia],
    [
      { clientKey: "Adatum", personId: pat.personId, source: "owner" },
      { clientKey: "Prospect Co", personId: pat.personId, source: "owner" },
      { clientKey: "Adatum", personId: gus.personId, source: "owner" },
    ],
    [{ personId: pat.personId, clientKey: "Adatum", worker: true }, { personId: gus.personId, clientKey: "Adatum", worker: true }],
    [anAccount({ clientKey: "Adatum" }), anAccount({ clientKey: "Prospect Co", type: "prospect", workers: 0, focus: 0 })],
  );
  const org = createOrgRuntime({
    store,
    bootstrap: { model: "m", appCapUsd: 100, inviteDomains: domains, feedback: null },
    holdMs: 0,
    signedIn: async () => (await accounts.users.all()).map((u) => ({ id: u.id, email: u.email, upn: u.upn })),
  });
  const teams = createTeamsStore(db, now);
  const ops = createAdminOps({
    check: createAdminCheck({ groupId: null, breakGlass: [ADMIN], graph: async () => null, now: Date.now }),
    org,
    groupId: null,
    breakGlass: [ADMIN],
    tenantId: "t",
    users: () => accounts.users.all(),
    personStore: () => ({ setupState: async () => ({}), devopsIdentities: async () => [] }),
    hasSecret: async () => false,
    chats: () => teams.chats(),
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "abc", pr: "", builtAt: null },
    directory: null,
    removePerson: async () => {},
    log: () => {},
  });
  const admin: AdminContext = { ops, me: async () => ({ id: ADMIN, name: "Ada Admin" }) };
  const people = async () => {
    const r = await adminAction(admin, "admin.load", { section: "people" });
    if (!r.ok) throw new Error(r.error);
    return r.data as People;
  };
  return { org, admin, people, pat, gus, pia, store };
}

describe("one person match in Admin › People", () => {
  it("found by email with no Entra id in Dataverse: Matched by email, Entra id missing, beside the level and leads it gives", async () => {
    const t = await setup();
    const row = (await t.people()).people.find((p) => p.id === PAT)!;
    expect(row).toMatchObject({ dataverseMatch: true, dataverseText: "Matched by email, Entra id missing", levelName: "Lead consultant", clients: ["Adatum"] });
    // Owning a prospect makes no lead.
    expect(row.leads.map((l) => l.clientKey)).toEqual(["Adatum"]);
    // One row for Pat (the sign-in and the Dataverse row are one person).
    expect((await t.people()).people.filter((p) => p.name === "Pat Lead")).toHaveLength(1);
  });

  it("an external Dataverse user is under Not Cooptimizers: no level, no lead, not addable as a lead", async () => {
    const t = await setup();
    const p = await t.people();
    expect(p.people.some((x) => x.name === "Gus Guest")).toBe(false);
    expect(p.others.find((x) => x.name === "Gus Guest")).toMatchObject({ notCooptimizerText: "Guest account", levelName: null, leads: [] });
    expect((await t.org.clientLeads("Adatum")).map((l) => l.personId)).toEqual([PAT]);
    const r = await adminAction(t.admin, "admin.override", { personId: t.gus.personId, kind: "lead_add", clientKey: "Adatum" });
    expect(r.ok).toBe(false);
  });

  it("an external Dataverse user isn't in the teammate pickers (help finder, Who, follow-ups)", async () => {
    const t = await setup();
    const team = async () => ({ ok: true as const, people: [t.pat, t.gus].map((p) => ({ id: p.systemUserId, name: p.name, email: p.email!, aadId: p.personId.startsWith("dv:") ? null : p.personId })) });
    const ctx = onlyClients({ org: t.org, makeDataverse: (() => ({ teammates: team })) as never });
    const r = await (ctx.makeDataverse as unknown as () => Pick<DataverseSource, "teammates">)().teammates();
    expect(r.ok && r.people.map((p) => p.name)).toEqual(["Pat Lead"]);
  });

  it("an automation account goes under the fold, labelled Automation, once an admin flags it (audited)", async () => {
    const t = await setup();
    const set = await adminAction(t.admin, "admin.set", { scope: `person:${PAT}`, key: "automation", value: true });
    expect(set.ok).toBe(true);
    const p = await t.people();
    expect(p.others.find((x) => x.id === PAT)?.notCooptimizerText).toBe("Automation");
    expect(await t.org.clientLeads("Adatum")).toEqual([]);
  });

  it("with the domains Rule empty, the guest check still holds and People says to set the domains", async () => {
    const t = await setup([]);
    const p = await t.people();
    expect(p.noDomains).toBe(true);
    expect(p.others.map((x) => x.name)).toEqual(["Gus Guest"]);
  });
});

describe("positions to levels (D593)", () => {
  it("a new position is Not mapped, counted; its people have no level and use the Consultant defaults", async () => {
    const t = await setup();
    const p = await t.people();
    expect(p.unmappedPositions).toBe(1);
    expect(p.positions[0]).toEqual({ name: "Principal Architect", people: 1, mapped: false, level: null });
    expect(p.positions.find((x) => x.name === "Lead Consultant")).toMatchObject({ mapped: true, level: "lead", people: 1 });
    expect(p.people.find((x) => x.name === "Pia Principal")?.levelName).toBeNull();
    const rules = await t.org.rules();
    expect(guidanceFor(rules, null, {})).toEqual(guidanceFor(rules, "consultant", {}));
  });

  it("mapping it gives the level at once, with that level's defaults, and is audited", async () => {
    const t = await setup();
    const before = (await t.people()).positions.filter((x) => x.mapped);
    const map = { ...Object.fromEntries(before.map((x) => [x.name, x.level])), "Principal Architect": "lead" };
    expect((await adminAction(t.admin, "admin.set", { scope: "org", key: "org.position_levels", value: map })).ok).toBe(true);
    const p = await t.people();
    expect(p.unmappedPositions).toBe(0);
    expect(p.people.find((x) => x.name === "Pia Principal")?.levelName).toBe("Lead consultant");
    expect((await t.org.levelOf(t.pia.personId)).level).toBe("lead");
    const audit = await t.store.auditList({ area: "people" });
    expect(audit.map((a) => a.setting)).toContain("org/org.position_levels");
    // Not a level: refused.
    expect((await adminAction(t.admin, "admin.set", { scope: "org", key: "org.position_levels", value: { X: "boss" } })).ok).toBe(false);
  });
});
