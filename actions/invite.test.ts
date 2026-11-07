// IN-1: Who's set up and Invite to FocusTime, through the admin actions. Cooptimizers only (never a guest, someone
// outside the Cooptimize domains or an automation account); yes or no marks for signed in, partly set up and never
// signed in; no PAT value, scope, expiry or the client a PAT is for anywhere in what the API returns; non-admins get
// 403; an invite records only who, when and how, and the same person can be invited again.
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { aDirectoryPerson } from "../test/builders/index.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { createAdminCheck } from "./admin.ts";
import { adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import type { SetupRow } from "../plan/invite.ts";

const NOW = "2026-11-06T15:00:00Z";
const ADA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const PAT_VALUE = "PRIVATE-PAT-VALUE-abc123";
// A client only a PAT names (nobody works there in Dataverse): it must never show up.
const PAT_CLIENT = "Fabrikam PAT Only";
const TEAMS_APP = "https://teams.microsoft.com/l/app/6f84bb2c-364d-4d76-8a62-153904d0551a";

type Setup = { people: SetupRow[]; counts: { text: string }; teamsKnown: boolean; invite: { appUrl: string; teamsAppLink: string | null; subject: string; template: string } | null };

async function setup(o: { teams?: boolean } = {}) {
  const db = sqliteDb().conn;
  let now = Temporal.Instant.from(NOW);
  const clock = () => now;
  const accounts = createAccountStore(db, clock);
  await accounts.users.signedIn({ id: ADA, tenantId: "t", upn: "ada@cooptimize.example", displayName: "Ada Admin", email: "ada@cooptimize.example" });
  await accounts.users.signedIn({ id: BEN, tenantId: "t", upn: "ben@cooptimize.example", displayName: "Ben Person", email: "ben@cooptimize.example" });
  const store = createAdminStore(db, clock);
  const ada = aDirectoryPerson({ personId: ADA, name: "Ada Admin", email: "ada@cooptimize.example" });
  const ben = aDirectoryPerson({ personId: BEN, name: "Ben Person", email: "ben@cooptimize.example" });
  const cy = aDirectoryPerson({ name: "Cy Person", email: "cy@cooptimize.example" });
  const dee = aDirectoryPerson({ name: "Dee Person", email: "dee@cooptimize.example" });
  const gus = aDirectoryPerson({ name: "Gus Guest", email: "gus@partner.example", guest: true });
  const oz = aDirectoryPerson({ name: "Oz Outside", email: "oz@elsewhere.example" });
  const bot = aDirectoryPerson({ name: "Build Bot", email: "build.bot@cooptimize.example" });
  await store.replaceDirectory([ada, ben, cy, dee, gus, oz, bot], [], [{ personId: BEN, clientKey: "Adatum", worker: true }]);
  const org = createOrgRuntime({
    store,
    bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["cooptimize.example"], feedback: null },
    holdMs: 0,
    signedIn: async () => (await accounts.users.all()).map((u) => ({ id: u.id, email: u.email, upn: u.upn })),
  });
  // Ada: Outlook and a write PAT (for a client only her PAT names) and the Teams app. Ben: Outlook only.
  const secrets = new Map<string, string>([
    [`${ADA}|outlook-refresh-token`, "rt"],
    [`${ADA}|devops-write-pat:${PAT_CLIENT}`, PAT_VALUE],
    [`${BEN}|outlook-refresh-token`, "rt"],
  ]);
  const teams = createTeamsStore(db, clock);
  const ops = createAdminOps({
    check: createAdminCheck({ groupId: null, breakGlass: [ADA], graph: async () => null, now: Date.now }),
    org,
    groupId: null,
    breakGlass: [ADA],
    tenantId: "t",
    users: () => accounts.users.all(),
    personStore: (id) => ({ setupState: async () => ({}), devopsIdentities: async () => (id === ADA ? [{ clientKey: PAT_CLIENT }] : []) }),
    hasSecret: async (id, account) => secrets.has(`${id}|${account}`),
    teamsApp: o.teams ? async (id) => id === ADA : null,
    lastSeen: () => accounts.sessions.lastSeenByUser(),
    invite: { appUrl: "https://focustime-dev.example.com/", teamsAppLink: o.teams ? TEAMS_APP : null },
    chats: () => teams.chats(),
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "abc", pr: "", builtAt: null },
    directory: null,
    removePerson: async () => {},
    log: () => {},
  });
  const admin: AdminContext = { ops, me: async () => ({ id: ADA, name: "Ada Admin" }), zone: async () => "America/New_York" };
  const benCtx: AdminContext = { ops, me: async () => ({ id: BEN, name: "Ben Person" }) };
  // Flag the bot as an automation account, the existing Rule.
  expect((await adminAction(admin, "admin.set", { scope: `person:${bot.personId}`, key: "automation", value: true })).ok).toBe(true);
  const raw = async (ctx: AdminContext = admin) => adminAction(ctx, "admin.load", { section: "setup" });
  const load = async () => ((await raw()) as { data: Setup }).data;
  return { db, accounts, store, admin, ben: benCtx, raw, load, cy, dee, gus, oz, bot, advance: (h: number) => void (now = now.add({ hours: h })) };
}

const byName = (d: Setup) => Object.fromEntries(d.people.map((p) => [p.name, p]));

describe("Who's set up", () => {
  it("lists Cooptimizers only: never a guest, someone outside the domains or an automation account", async () => {
    const s = await setup();
    const names = (await s.load()).people.map((p) => p.name).sort();
    // Dataverse users with no email are outside the domains too (the existing rule), so every Cooptimizer has an address.
    expect(names).toEqual(["Ada Admin", "Ben Person", "Cy Person", "Dee Person"]);
  });

  it("marks signed in, partly set up and never signed in as yes or no, with plain counts", async () => {
    const s = await setup();
    const d = await s.load();
    const p = byName(d);
    expect(p["Ada Admin"]).toMatchObject({ signedIn: true, devops: true, calendar: true, teams: null, lastActiveDay: "2026-11-06", me: true, invited: null });
    expect(p["Ben Person"]).toMatchObject({ signedIn: true, devops: false, calendar: true, teams: null });
    expect(p["Cy Person"]).toMatchObject({ signedIn: false, devops: false, calendar: false, teams: null, lastActiveDay: null });
    expect(d.counts.text).toBe("2 of 4 signed in · 1 set up partly");
    // Teams isn't known here, so the column is left out and the invite has no Teams app link.
    expect(d.teamsKnown).toBe(false);
    expect(d.invite?.template).toContain("Open it here: https://focustime-dev.example.com/");
    expect(d.invite?.template).not.toContain("teams.microsoft.com");
  });

  it("with the Teams app set up: the Teams mark from its 1:1 chat, and the app's link in the message", async () => {
    const s = await setup({ teams: true });
    const d = await s.load();
    expect(d.teamsKnown).toBe(true);
    expect(byName(d)["Ada Admin"]!.teams).toBe(true);
    expect(byName(d)["Ben Person"]!.teams).toBe(false);
    expect(byName(d)["Cy Person"]!.teams).toBe(false);
    expect(d.counts.text).toBe("2 of 4 signed in · 1 set up partly");
    expect(d.invite?.template).toContain(TEAMS_APP);
  });

  it("last active is a day: the latest request in a live session, never a time", async () => {
    const s = await setup();
    await s.accounts.sessions.create(ADA);
    s.advance(30); // the next day in New York
    const { cookie } = await s.accounts.sessions.create(ADA);
    await s.accounts.sessions.resolve(cookie);
    expect(byName(await s.load())["Ada Admin"]!.lastActiveDay).toBe("2026-11-07");
  });

  it("no PAT value, scope, expiry or the client a PAT is for, in Who's set up or Admin › People", async () => {
    const s = await setup();
    for (const section of ["setup", "people"]) {
      const json = JSON.stringify(await adminAction(s.admin, "admin.load", { section }));
      expect(json).not.toContain(PAT_VALUE);
      expect(json).not.toContain(PAT_CLIENT);
      expect(json).not.toMatch(/devops-write-pat|expir|scope/i);
    }
  });

  it("non-admins get 403 from Who's set up and from recording an invite", async () => {
    const s = await setup();
    expect(await s.raw(s.ben)).toMatchObject({ ok: false, status: 403, code: "admin" });
    expect(await adminAction(s.ben, "admin.load", { section: "people" })).toMatchObject({ ok: false, status: 403 });
    expect(await adminAction(s.ben, "admin.invited", { personIds: [s.cy.personId], via: "copy" })).toMatchObject({ ok: false, status: 403, code: "admin" });
    expect(byName(await s.load())["Cy Person"]!.invited).toBeNull();
  });
});

describe("Invite", () => {
  it("records Invited <day> by <admin>, audited, and the same person can be invited again", async () => {
    const s = await setup();
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "teams" })).toMatchObject({ ok: true, data: { invited: 1 } });
    expect(byName(await s.load())["Cy Person"]!.invited).toEqual({ day: "2026-11-06", byName: "Ada Admin" });
    s.advance(48);
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId, s.dee.personId], via: "copy" })).toMatchObject({ ok: true, data: { invited: 2 } });
    const p = byName(await s.load());
    expect(p["Cy Person"]!.invited).toEqual({ day: "2026-11-08", byName: "Ada Admin" });
    expect(p["Dee Person"]!.invited).toEqual({ day: "2026-11-08", byName: "Ada Admin" });
    const audit = (await s.store.auditList({ area: "people" })).filter((e) => e.setting === "invite");
    expect(audit.map((e) => [e.actorName, e.target, e.note])).toEqual([
      ["Ada Admin", "Cy Person, Dee Person", "copied, 2 people"],
      ["Ada Admin", "Cy Person", "opened in Teams, 1 person"],
    ]);
  });

  it("refuses someone who signed in, anyone who isn't a Cooptimizer, and bad input", async () => {
    const s = await setup();
    expect(await adminAction(s.admin, "admin.invited", { personIds: [BEN], via: "outlook" })).toMatchObject({ ok: false, status: 409 });
    for (const p of [s.gus, s.oz, s.bot]) expect(await adminAction(s.admin, "admin.invited", { personIds: [p.personId], via: "copy" })).toMatchObject({ ok: false, status: 404 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "graph" })).toMatchObject({ ok: false, status: 400 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [], via: "copy" })).toMatchObject({ ok: false, status: 400 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "copy", message: "x" })).toMatchObject({ ok: false, status: 400 });
    expect((await s.store.auditList({})).filter((e) => e.setting === "invite")).toEqual([]);
  });

  it("removing a person forgets their invite", async () => {
    const s = await setup();
    await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "copy" });
    await s.store.forgetPerson(s.cy.personId);
    expect(byName(await s.load())["Cy Person"]!.invited).toBeNull();
  });
});
