// AH-3: client DevOps identities across FocusTime: a linked client login ("Ext-…") counts as the person in Ahead (mine,
// rights, their FocusTime name, assigning writes the login), in the DevOps source (my items, names), in the scope and
// for notes; a suggestion is shown in Admin › People and changes nothing until an admin confirms it; every link and
// removal is audited without the email.
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { createAdminCheck } from "./admin.ts";
import { adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import { scopeDepsOf } from "./scope-deps.ts";
import { aheadIdentities, identityRef, myLinkedLogins } from "./identities.ts";
import { rightsOf, withIdentities } from "./ahead-actions.ts";
import { anAheadClient, anAheadItem } from "../test/builders/index.ts";
import { normalizeWorkItems } from "../sources/devops/normalize.ts";
import type { ClientIdentitiesView } from "../plan/identities.ts";

const NOW = "2026-11-05T15:00:00Z";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CY = "00000000-0000-4000-8000-0000000000c3";
const BEN_LOGIN = "ext-ben.person@fabrikam.example";
const CY_LOGIN = "ext-cy.person@fabrikam.example";

async function setup() {
  const db = sqliteDb().conn;
  const now = () => Temporal.Instant.from(NOW);
  const accounts = createAccountStore(db, now);
  for (const [id, name] of [[ADMIN, "Ada Admin"], [BEN, "Ben Person"], [CY, "Cy Person"]] as const) await accounts.users.signedIn({ id, tenantId: "t", upn: `${name.split(" ")[0]!.toLowerCase()}@cooptimize.example`, displayName: name, email: null });
  const store = createAdminStore(db, now);
  await store.replaceDirectory(
    [
      { personId: BEN, systemUserId: "10000000-0000-4000-8000-000000000001", name: "Ben Person", email: "ben@cooptimize.example", level: "consultant", positionName: "Consultant" },
      { personId: CY, systemUserId: "10000000-0000-4000-8000-000000000002", name: "Cy Person", email: "cy@cooptimize.example", level: "lead", positionName: "Lead Consultant" },
    ],
    [{ clientKey: "fabrikam", personId: CY, source: "owner" }],
    [{ personId: BEN, clientKey: "fabrikam" }, { personId: CY, clientKey: "fabrikam" }],
    undefined,
    // Ben's Account Worker row on Fabrikam has his client login; Cy's isn't in Dataverse.
    [{ personId: BEN, clientKey: "fabrikam", email: BEN_LOGIN }],
  );
  const org = createOrgRuntime({ store, bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["cooptimize.example"], feedback: null }, holdMs: 0, signedIn: async () => [BEN, CY, ADMIN].map((id) => ({ id, email: null, upn: null })) });
  const assignees = { fabrikam: [{ email: BEN_LOGIN, name: "Ext-Ben Person" }, { email: CY_LOGIN, name: "Ext-Cy Person" }, { email: "ext-zed@fabrikam.example", name: "Ext-Zed Nobody" }, { email: "pat@fabrikam.example", name: "Pat Client" }] };
  const ops = createAdminOps({
    check: createAdminCheck({ groupId: null, breakGlass: [ADMIN], graph: async () => null, now: Date.now }),
    org,
    groupId: null,
    breakGlass: [ADMIN],
    tenantId: "t",
    users: () => accounts.users.all(),
    personStore: () => ({ setupState: async () => ({}), devopsIdentities: async () => [] }),
    hasSecret: async () => false,
    chats: async () => [],
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "abc1234", pr: "", builtAt: null },
    directory: null,
    removePerson: async () => {},
    assignees: async (keys) => Object.fromEntries(keys.map((k) => [k, assignees[k as "fabrikam"] ?? []])),
    log: () => {},
  });
  const ctx: AdminContext = { ops, me: async () => ({ id: ADMIN, name: "Ada Admin" }) };
  const run = async <T = unknown,>(action: Parameters<typeof adminAction>[1], input: unknown) => {
    const r = await adminAction(ctx, action, input);
    if (!r.ok) throw Object.assign(new Error(r.error), { status: r.status });
    return r.data as T;
  };
  const people = async () => (await run<{ identities: ClientIdentitiesView[] }>("admin.load", { section: "people" })).identities;
  return { db, store, org, run, people };
}

describe("Admin › People: client DevOps identities (AH-3)", () => {
  it("shows the counts line, the Dataverse link, a suggestion and the unmatched login, by display name and ref only", async () => {
    const s = await setup();
    const [f] = await s.people();
    expect(f!.line).toBe("3 identities on fabrikam look like client logins, 1 linked");
    expect(f!.rows.map((r) => [r.name, r.state, r.personName])).toEqual([
      ["Ext-Ben Person", "linked", "Ben Person"],
      ["Ext-Cy Person", "suggested", "Cy Person"],
      ["Ext-Zed Nobody", "unmatched", null],
    ]);
    // Emails never leave the server.
    expect(JSON.stringify(f)).not.toMatch(/@/);
    expect(f!.rows[1]!.ref).toBe(identityRef("fabrikam", CY_LOGIN));
  });
  it("a suggestion isn't applied until an admin confirms it; then it's Cy everywhere; the audit has no email", async () => {
    const s = await setup();
    expect((await s.org.identities()).personOf("fabrikam", CY_LOGIN)).toBeNull();
    await s.run("admin.identity", { clientKey: "fabrikam", ref: identityRef("fabrikam", CY_LOGIN), personId: CY, op: "link" });
    expect((await s.org.identities()).personOf("fabrikam", CY_LOGIN)?.name).toBe("Cy Person");
    expect((await s.people())[0]!.line).toBe("3 identities on fabrikam look like client logins, 2 linked");
    const audit = await s.store.auditList({ area: "people", text: null });
    expect(audit[0]).toMatchObject({ target: "Cy Person · fabrikam", setting: "devops_identity", note: "linked by an admin" });
    expect(JSON.stringify(audit)).not.toContain("fabrikam.example");
  });
  it("Remove hides a Dataverse identity (and it isn't suggested again); Link to a person links an unmatched one", async () => {
    const s = await setup();
    await s.run("admin.identity", { clientKey: "fabrikam", ref: identityRef("fabrikam", BEN_LOGIN), personId: BEN, op: "remove" });
    expect((await s.org.identities()).personOf("fabrikam", BEN_LOGIN)).toBeNull();
    const rows = (await s.people())[0]!.rows;
    expect(rows.find((r) => r.name === "Ext-Ben Person")!.state).toBe("unmatched");
    await s.run("admin.identity", { clientKey: "fabrikam", ref: identityRef("fabrikam", "ext-zed@fabrikam.example"), personId: CY, op: "link" });
    expect((await s.org.identities()).personOf("fabrikam", "ext-zed@fabrikam.example")?.id).toBe(CY);
  });
  it("refuses a ref FocusTime doesn't see, a non-admin, and taking a login linked to someone else", async () => {
    const s = await setup();
    await expect(s.run("admin.identity", { clientKey: "fabrikam", ref: "0".repeat(20), personId: CY, op: "link" })).rejects.toMatchObject({ status: 404 });
    await expect(s.run("admin.identity", { clientKey: "fabrikam", ref: identityRef("fabrikam", BEN_LOGIN), personId: CY, op: "link" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("a linked client login is the person (AH-3)", () => {
  it("in Ahead: counts as mine, gives my rights, shows the FocusTime name, and assigning writes the login", async () => {
    const s = await setup();
    const ix = await s.org.identities();
    const ben = aheadIdentities(ix, BEN, () => []);
    const epic = anAheadItem({ id: 1, type: "Epic", level: "top", rung: 0, assignee: { name: "Ext-Ben Person", email: BEN_LOGIN } });
    const feature = anAheadItem({ id: 2, parentId: 1, assignee: { name: "Ext-Cy Person", email: CY_LOGIN } });
    const c = withIdentities(anAheadClient({ clientKey: "fabrikam", me: "ben@cooptimize.example", items: [epic, feature] }), ben);
    expect(c.mine.sort()).toEqual(["ben@cooptimize.example", BEN_LOGIN]);
    expect(c.items[0]!.assignee!.name).toBe("Ben Person");
    // Cy's login isn't confirmed, so it shows as DevOps has it.
    expect(c.items[1]!.assignee!.name).toBe("Ext-Cy Person");
    expect([...rightsOf(c, { lead: false, automation: false })].filter(([, r]) => r.ok).map(([id]) => id)).toEqual([1, 2]);
    expect(ben.writeAs("fabrikam", "ben@cooptimize.example")).toBe(BEN_LOGIN);
    expect(ben.writeAs("fabrikam", "cy@cooptimize.example")).toBe("cy@cooptimize.example");
    expect(await myLinkedLogins(s.org, BEN)).toEqual([BEN_LOGIN]);
  });
  it("in the DevOps scope: a linked login is a Cooptimizer on that client", async () => {
    const s = await setup();
    const deps = await scopeDepsOf(s.org)("fabrikam");
    expect(deps!.isCooptimizer(BEN_LOGIN)).toBe(true);
    expect(deps!.isCooptimizer(CY_LOGIN)).toBe(false);
    expect((await scopeDepsOf(s.org)("contoso"))!.isCooptimizer(BEN_LOGIN)).toBe(false);
  });
  it("in Week's items: assigned to my other login is mine, and a Cooptimizer's login shows their FocusTime name", () => {
    const states = new Map([["User Story", new Map([["new", "Proposed" as const]])]]);
    const v = (id: number, email: string, name: string) => ({ id, fields: { "System.WorkItemType": "User Story", "System.State": "New", "System.Title": `S${id}`, "System.AssignedTo": { uniqueName: email, displayName: name } } });
    const { items } = normalizeWorkItems([v(1, BEN_LOGIN, "Ext-Ben Person"), v(2, "pat@fabrikam.example", "Pat Client")], { org: "fabrikam", projectName: "P", orderField: null, categories: states, me: "ben@cooptimize.example", alsoMe: [BEN_LOGIN], nameOf: (e) => (e === BEN_LOGIN ? "Ben Person" : null), people: true });
    expect(items.map((i) => [i.assignedTo, i.assignedToMe])).toEqual([["Ben Person", true], ["Pat Client", false]]);
  });
});
