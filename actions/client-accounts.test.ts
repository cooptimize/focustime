// ADM-2 (D575, D576): one rule for which accounts are clients, used by Admin › Clients and AI (Customers by default,
// All accounts on request), by every personal list (Settings › Clients, the week's clients and pickers, through
// onlyClients on the action context), with Status warnings for a filtered-out account that still has things, and
// nothing deleted.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { aClient, anAccount, aDirectoryPerson } from "../test/builders/index.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createAdminCheck } from "./admin.ts";
import { adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import { onlyClients } from "./client-accounts.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { SettingsData } from "./types.ts";

const NOW = "2026-11-06T15:00:00Z";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const INTERNAL = "Cooptimize";

async function team() {
  const db = sqliteDb().conn;
  const now = () => Temporal.Instant.from(NOW);
  const accounts = createAccountStore(db, now);
  await accounts.users.signedIn({ id: ADMIN, tenantId: "t", upn: "ada@contoso.example", displayName: "Ada Admin", email: "ada@contoso.example" });
  const store = createAdminStore(db, now);
  const owner = aDirectoryPerson({ level: "lead", positionName: "Lead Consultant" });
  await store.replaceDirectory(
    [owner],
    // The owner of every account: a lead only of the customer.
    ["Adatum", "Prospect Co", "Vendor Co", "Pat Person", "Worked Co"].map((clientKey) => ({ clientKey, personId: owner.personId, source: "owner" as const })),
    [],
    [
      anAccount({ clientKey: "Adatum" }),
      anAccount({ clientKey: INTERNAL }),
      anAccount({ clientKey: "Prospect Co", type: "prospect", workers: 0, focus: 0 }),
      anAccount({ clientKey: "Vendor Co", type: "vendor", workers: 0, focus: 0 }),
      anAccount({ clientKey: "Pat Person", type: "partner", workers: 0, focus: 0 }),
      // Not a customer, but someone has focus blocks on it.
      anAccount({ clientKey: "Worked Co", type: null, workers: 1, focus: 2 }),
    ],
  );
  const teams = createTeamsStore(db, now);
  const org = createOrgRuntime({ store, bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["contoso.example"], feedback: null }, holdMs: 0 });
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
  const load = async <T,>(section: string, more: Record<string, unknown> = {}) => {
    const r = await adminAction(admin, "admin.load", { section, ...more });
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  const set = (scope: string, key: string, value: unknown) => adminAction(admin, "admin.set", value === undefined ? { scope, key, clear: true } : { scope, key, value });
  return { db, store, org, ops, admin, load, set, owner };
}

type Clients = { filter: string; counts: { customers: number; all: number }; clients: { key: string; isClient: boolean; hasSettings: boolean; leads: unknown[] }[] };
type Status = { warnings: { area: string; text: string }[] };

describe("clientAccounts() in Admin", () => {
  it("Admin › Clients lists customers and Internal by default; owning other accounts never adds them", async () => {
    const t = await team();
    const c = await t.load<Clients>("clients");
    expect(c.filter).toBe("customers");
    expect(c.clients.map((x) => x.key)).toEqual(["Adatum", INTERNAL]);
    const ai = await t.load<Clients>("ai");
    expect(ai.clients.map((x) => x.key)).toEqual(["Adatum", INTERNAL]);
  });
  it("All accounts shows everything, each marked client or not", async () => {
    const t = await team();
    const c = await t.load<Clients>("clients", { filter: "all" });
    expect(c.clients.map((x) => [x.key, x.isClient])).toEqual([
      ["Adatum", true],
      [INTERNAL, true],
      ["Pat Person", false],
      ["Prospect Co", false],
      ["Vendor Co", false],
      ["Worked Co", false],
    ]);
    expect(c.counts).toEqual({ customers: 2, all: 6 });
  });
  it("Treat as a client and Hide from FocusTime work and are audited; Internal can't be hidden", async () => {
    const t = await team();
    expect((await t.set("client:Prospect Co", "treat_as_client", true)).ok).toBe(true);
    expect((await t.set("client:Adatum", "hidden", true)).ok).toBe(true);
    expect((await t.load<Clients>("clients")).clients.map((x) => x.key)).toEqual([INTERNAL, "Prospect Co"]);
    const r = await t.set(`client:${INTERNAL}`, "hidden", true);
    expect(r.ok).toBe(false);
    const audit = await t.store.auditList({ area: "clients" });
    expect(audit.map((a) => a.setting)).toEqual(expect.arrayContaining(["client:Prospect Co/treat_as_client", "client:Adatum/hidden"]));
  });
  it("Status warns about a filtered-out account with focus blocks, and one with AI allowed; nothing is deleted", async () => {
    const t = await team();
    await t.set("client:Vendor Co", "allow_ai", true);
    await t.set("client:Vendor Co", "color", "ochre");
    const hide = await t.set("client:Adatum", "allow_ai", true);
    expect(hide.ok).toBe(true);
    const hidden = await t.set("client:Adatum", "hidden", true);
    expect(hidden.ok && (hidden.data as { warning: string | null }).warning).toMatch(/AI allowed/);
    const st = await t.load<Status>("status");
    const lines = st.warnings.map((w) => w.text);
    expect(lines.find((l) => l.startsWith("Worked Co"))).toMatch(/3 Dataverse Account Worker or Focus Time rows/);
    expect(lines.find((l) => l.startsWith("Vendor Co"))).toMatch(/AI allowed/);
    expect(lines.find((l) => l.startsWith("Adatum"))).toMatch(/hidden from FocusTime.*AI allowed/);
    // The settings stay stored, and All accounts says so.
    const rows = await t.store.orgRows();
    expect(rows.some((r) => r.scope === "client:Vendor Co" && r.key === "color")).toBe(true);
    const all = await t.load<Clients>("clients", { filter: "all" });
    expect(all.clients.find((x) => x.key === "Vendor Co")).toMatchObject({ isClient: false, hasSettings: true, leads: [] });
  });
});

describe("Status: Rules and jobs (D582)", () => {
  it("a poll interval stored over 30 reads as 5 with a warning; the jobs list each interval, and data retention isn't enforced yet", async () => {
    const t = await team();
    // A value from before the bound (ADM-1 allowed 60).
    await t.store.setOrg({ scope: "org", key: "conv.poll_minutes", value: 45, actor: { id: ADMIN, name: "Ada Admin" }, area: "conversations", target: "Everyone" });
    expect((await t.set("org", "conv.poll_minutes", 45)).ok).toBe(false);
    const st = await t.load<Status & { jobs: { name: string; every: string; note: string | null }[] }>("status");
    expect(st.warnings.map((w) => w.text)).toContain("Read client chats every (minutes): the stored value isn't allowed any more, so FocusTime uses 5. Set it again in Admin.");
    expect(st.jobs.find((j) => j.name === "Read client chats")?.every).toBe("Every 5 minutes in followers' working hours");
    expect(st.jobs.find((j) => j.name === "Delete people's data")).toMatchObject({ every: "After 2 years", note: "Not enforced yet" });
    expect((await t.set("org", "conv.poll_minutes", 12)).ok).toBe(true);
    const after = await t.load<Status & { jobs: { name: string; every: string }[] }>("status");
    expect(after.warnings.some((w) => w.text.startsWith("Read client chats"))).toBe(false);
    expect(after.jobs[0]?.every).toBe("Every 12 minutes in followers' working hours");
  });
});

describe("clientAccounts() on every personal list", () => {
  const customer = aClient({ name: "Adatum", clientKey: "Adatum" });
  const prospect = aClient({ name: "Prospect Co", clientKey: "Prospect Co" });
  const source = (): Pick<DataverseSource, "myClients"> => ({ myClients: async () => [customer, prospect] });

  it("myClients() through the action context keeps clients only (the week, Capture, follow-ups, Plan the week, the help finder)", async () => {
    const t = await team();
    const ctx = onlyClients({ org: t.org, makeDataverse: (() => source()) as never });
    const list = await (ctx.makeDataverse as unknown as () => Pick<DataverseSource, "myClients">)().myClients();
    expect(list?.map((c) => c.clientKey)).toEqual(["Adatum"]);
  });

  it("Settings › Clients lists customers and Internal only", async () => {
    const t = await team();
    const dir = mkdtempSync(join(tmpdir(), "c-adm2-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, STARTER_TOML.replace('my_email = ""', 'my_email = "me@contoso.example"').replace('my_systemuserid = ""', 'my_systemuserid = "10000000-0000-4000-8000-000000000001"'));
    const no = () => {
      throw new Error("n/a");
    };
    const c: ActionContext = {
      loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
      makeDataverse: (() => source()) as never,
      makeOutlook: no,
      makeGoogle: no,
      makeDevOps: no,
      saveSystemUserId: async () => {},
      now: () => NOW,
      org: t.org,
    };
    const r = await dispatch(c, { action: "settings.load", input: {} });
    expect(r.ok).toBe(true);
    expect((r as { data: SettingsData }).data.clients.map((x) => x.key)).toEqual(["Adatum", INTERNAL]);
  });
});
