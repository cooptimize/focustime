// ADM-1: the admin console's actions. The server refuses every one of them for a non-admin; admins' changes are
// validated and audited; overrides are marked; removing a person needs their typed name and never yourself; and no
// section ever carries anyone's plan, picks, follow-ups, captures, PATs, AI request text or chat messages.
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { hardDeleteUser } from "../store/user-data.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { createAdminCheck } from "./admin.ts";
import { ADMIN_ACTIONS, ADMIN_SECTIONS, adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import { buildProcessModel, type ProcessOverrides } from "../plan/process.ts";
import { aStandardsArticle, STD_COMMIT, STD_REPO } from "../test/builders/standards.ts";
import { codeViewsStoreOn } from "../store/code-views-store.ts";

const NOW = "2026-11-04T15:00:00Z";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CY = "00000000-0000-4000-8000-0000000000c3";
const PRIVATE = ["PRIVATE-CAPTURE-TEXT", "PRIVATE-FOLLOWUP-TEXT", "PRIVATE-RESUME-NOTE", "PRIVATE-PAT-VALUE", "PRIVATE-CHAT-MESSAGE"];

const synced = { n: 0 };

async function setup() {
  const db = sqliteDb().conn;
  const now = () => Temporal.Instant.from(NOW);
  const accounts = createAccountStore(db, now);
  for (const [id, name] of [[ADMIN, "Ada Admin"], [BEN, "Ben Person"], [CY, "Cy Person"]] as const) await accounts.users.signedIn({ id, tenantId: "t", upn: `${name.split(" ")[0]!.toLowerCase()}@cooptimize.example`, displayName: name, email: null });
  // Ben's private things: a capture, a follow-up, a resume note, a write PAT and a chat message.
  const plan = planStoreOn(db, { userId: BEN, now: () => now().toZonedDateTimeISO("UTC") });
  const capture = await plan.addCapture({ text: PRIVATE[0]!, clientKey: "fabrikam" });
  await plan.addFollowUp({ who: "Dana", what: PRIVATE[1]!, due: null, clientKey: "fabrikam" });
  await plan.setResumeNote("fabrikam", "2026-11-04", PRIVATE[2]!);
  const secrets = new Map<string, string>([[`${BEN}|devops-write-pat:fabrikam`, PRIVATE[3]!], [`${BEN}|outlook-refresh-token`, "rt"]]);
  const teams = createTeamsStore(db, now);
  await teams.addChat({ chatId: "19:fab@thread.v2", clientKey: "fabrikam", kind: "delivery", displayName: "Fabrikam team", webUrl: null, members: null, by: BEN });
  await teams.saveMessages([{ chatId: "19:fab@thread.v2", messageId: "m1", clientKey: "fabrikam", senderId: CY, senderName: "Cy", senderTenant: "t", createdAt: NOW, modifiedAt: NOW, html: null, text: PRIVATE[4]!, hasImage: false, hasFile: false, replyToId: null, mentions: [], fetchedAt: NOW }]);
  const store = createAdminStore(db, now);
  await store.replaceDirectory(
    [
      { personId: BEN, systemUserId: "10000000-0000-4000-8000-000000000001", name: "Ben Person", email: "ben@cooptimize.example", level: "consultant", positionName: "Consultant" },
      { personId: CY, systemUserId: "10000000-0000-4000-8000-000000000002", name: "Cy Person", email: "cy@cooptimize.example", level: "lead", positionName: "Lead Consultant" },
    ],
    [{ clientKey: "fabrikam", personId: CY, source: "owner" }],
    [{ personId: BEN, clientKey: "fabrikam" }],
  );
  const org = createOrgRuntime({ store, bootstrap: { model: "test-model", appCapUsd: 100, inviteDomains: ["cooptimize.example"], feedback: null }, holdMs: 0 });
  const check = createAdminCheck({ groupId: null, breakGlass: [ADMIN], graph: async () => null, now: Date.now });
  const removed: string[] = [];
  const ops = createAdminOps({
    check,
    org,
    groupId: null,
    breakGlass: [ADMIN],
    tenantId: "t",
    users: () => accounts.users.all(),
    personStore: (id) => planStoreOn(db, { userId: id, now: () => now().toZonedDateTimeISO("UTC") }),
    hasSecret: async (id, account) => secrets.has(`${id}|${account}`),
    chats: () => teams.chats(),
    conversationCounts: (day) => createConversationStore(db, now, teams).counts(day),
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "abc1234", pr: "", builtAt: null },
    directory: null,
    removePerson: async (id) => {
      removed.push(id);
      await hardDeleteUser(db, id, now());
    },
    log: () => {},
    code: { views: codeViewsStoreOn(db, now), status: async (k) => (k === "fabrikam" ? { state: "readable", repos: 3 } : { state: "needs_code_read", text: "Can't read yet: the token needs Code (read)" }) },
    standards: {
      library: async () => ({ repo: STD_REPO, commit: STD_COMMIT, articles: [aStandardsArticle({ title: "Gold Fact Tables", layer: "gold", artifact: "fact_table", path: "SQL/Gold/Fact Tables.md", body: "- SECRET-ARTICLE-TEXT" })] }),
      state: async () => ({ repoUrl: "https://github.com/contoso/standards", branch: "", commit: STD_COMMIT, syncedAt: NOW, checkedAt: NOW, error: "GitHub answered 503", errorAt: NOW, warnings: [{ kind: "duplicate_id", id: "dup", paths: ["SQL/A.md", "SQL/B.md"] }] }),
      syncNow: async () => { synced.n++; return { ok: true, changed: true, error: null }; },
    },
  });
  const as = (id: string, name: string): AdminContext => ({ ops, me: async () => ({ id, name }) });
  const run = (who: AdminContext, action: (typeof ADMIN_ACTIONS)[number], input: unknown = {}) => adminAction(who, action, input);
  return { db, accounts, plan, capture, store, org, ops, admin: as(ADMIN, "Ada Admin"), ben: as(BEN, "Ben Person"), run, removed };
}

describe("admin actions", () => {
  it("the server refuses every admin action for a non-admin (and admin.status says no)", async () => {
    const s = await setup();
    const inputs: Record<string, unknown> = {
      "admin.load": { section: "people" },
      "admin.set": { scope: "org", key: "ai.on", value: true },
      "admin.override": { personId: CY, kind: "level", value: "senior" },
      "admin.refresh_people": {},
      "admin.remove_person": { personId: CY, confirmName: "Cy Person" },
      "admin.audit": {},
    };
    for (const a of ADMIN_ACTIONS) {
      const r = await s.run(s.ben, a, inputs[a] ?? {});
      if (a === "admin.status") expect(r).toMatchObject({ ok: true, data: { admin: false, via: null } });
      else expect(r).toMatchObject({ ok: false, status: 403, code: "admin" });
    }
    expect(s.removed).toEqual([]);
    expect(await s.store.auditList({})).toEqual([]);
    expect((await s.org.rules()).ai.on).toBe(false);
  });

  it("an admin's change is validated, saved and audited with old and new values", async () => {
    const s = await setup();
    expect(await s.run(s.admin, "admin.status")).toMatchObject({ ok: true, data: { admin: true, via: "break_glass" } });
    expect(await s.run(s.admin, "admin.set", { scope: "org", key: "ai.on", value: true })).toMatchObject({ ok: true, data: { old: null, value: true, warning: null } });
    expect(await s.run(s.admin, "admin.set", { scope: "org", key: "ai.on", value: false })).toMatchObject({ ok: true, data: { old: true, value: false, warning: "AI is off for everyone." } });
    expect(await s.run(s.admin, "admin.set", { scope: "org", key: "ai.person_cap_usd", value: 0 })).toMatchObject({ ok: true, data: { warning: expect.stringContaining("AI budget is set to $0") } });
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "color", value: "#00416b" })).toMatchObject({ ok: false, status: 422 });
    expect(await s.run(s.admin, "admin.set", { scope: "org", key: "nope", value: 1 })).toMatchObject({ ok: false, status: 400 });
    const audit = await s.store.auditList({});
    expect(audit.map((e) => [e.actorName, e.setting, e.oldValue, e.newValue])).toEqual([
      ["Ada Admin", "org/ai.person_cap_usd", null, "0"],
      ["Ada Admin", "org/ai.on", "true", "false"],
      ["Ada Admin", "org/ai.on", null, "true"],
    ]);
    expect((await s.store.auditList({ area: "ai", text: "cap" })).map((e) => e.setting)).toEqual(["org/ai.person_cap_usd"]);
  });

  it("CV-4: Send attachments to AI is a client Rule, off by default, saved and audited", async () => {
    const s = await setup();
    const ai = async () => ((await s.run(s.admin, "admin.load", { section: "ai" })) as { data: { clients: { key: string; attachmentsAi: boolean }[] } }).data.clients;
    expect((await ai()).find((c) => c.key === "fabrikam")?.attachmentsAi).toBe(false);
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "attachments_ai", value: true })).toMatchObject({ ok: true, data: { old: null, value: true } });
    expect((await ai()).find((c) => c.key === "fabrikam")?.attachmentsAi).toBe(true);
    expect((await s.store.auditList({})).map((e) => [e.actorName, e.setting, e.oldValue, e.newValue])[0]).toEqual(["Ada Admin", "client:fabrikam/attachments_ai", null, "true"]);
  });

  it("AI-F1: Admin › AI shows each task's tier; an admin puts a background task back on standard, audited", async () => {
    const s = await setup();
    type Row = { name: string; background: boolean; tier: string };
    const tasks = async () => ((await s.run(s.admin, "admin.load", { section: "ai" })) as { data: { tasks: Row[] } }).data.tasks;
    const before = await tasks();
    expect(before.filter((t) => t.background).map((t) => [t.name, t.tier])).toEqual([["conversations.update", "flex"], ["promises.extract", "flex"], ["asks.classify", "flex"], ["meeting.capture", "flex"]]);
    expect(before.filter((t) => !t.background).every((t) => t.tier === "standard")).toBe(true);
    expect(await s.run(s.admin, "admin.set", { scope: "org", key: "ai.standard_tasks", value: ["asks.classify"] })).toMatchObject({ ok: true, data: { old: null } });
    expect((await tasks()).find((t) => t.name === "asks.classify")?.tier).toBe("standard");
    expect((await s.store.auditList({ area: "ai" })).map((e) => e.setting)[0]).toBe("org/ai.standard_tasks");
  });

  it("CV-3: Group messages without AI is a client Rule, on by default, saved and audited like Allow AI", async () => {
    const s = await setup();
    const ai = async () => ((await s.run(s.admin, "admin.load", { section: "ai" })) as { data: { clients: { key: string; groupWithoutAi: boolean }[] } }).data.clients;
    expect((await ai()).find((c) => c.key === "fabrikam")?.groupWithoutAi).toBe(true);
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "group_without_ai", value: false })).toMatchObject({ ok: true, data: { old: null, value: false } });
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "group_without_ai", value: "no" })).toMatchObject({ ok: false, status: 422 });
    expect((await ai()).find((c) => c.key === "fabrikam")?.groupWithoutAi).toBe(false);
    expect((await s.store.auditList({})).map((e) => [e.actorName, e.setting, e.oldValue, e.newValue])[0]).toEqual(["Ada Admin", "client:fabrikam/group_without_ai", null, "false"]);
  });

  it("level and lead overrides: marked, logged, and read by levelOf and clientLeads", async () => {
    const s = await setup();
    expect(await s.org.levelOf(BEN)).toMatchObject({ level: "consultant", source: "dataverse" });
    expect(await s.run(s.admin, "admin.override", { personId: BEN, kind: "level", value: "senior" })).toMatchObject({ ok: true });
    expect(await s.run(s.admin, "admin.override", { personId: BEN, kind: "lead_add", clientKey: "fabrikam" })).toMatchObject({ ok: true });
    expect(await s.org.levelOf(BEN)).toMatchObject({ level: "senior", source: "override", dataverse: "consultant" });
    expect((await s.org.clientLeads("fabrikam")).map((l) => [l.personId, l.why, l.primary])).toEqual([[CY, ["owner"]], [BEN, ["override"]]].map(([p, w]) => [p, w, p === CY]));
    expect(await s.org.isClientLead(BEN, "fabrikam")).toBe(true);
    await s.run(s.admin, "admin.override", { personId: CY, kind: "lead_remove", clientKey: "fabrikam" });
    expect(await s.org.isClientLead(CY, "fabrikam")).toBe(false);
    expect((await s.store.auditList({ area: "people" })).map((e) => e.note)).toEqual(["override", "override", "override"]);
    const people = (await s.run(s.admin, "admin.load", { section: "people" })) as { ok: true; data: { people: { id: string; levelSource: string; leads: { whyText: string[] }[] }[] } };
    expect(people.data.people.find((p) => p.id === BEN)).toMatchObject({ levelSource: "override", leads: [{ whyText: ["Added by an admin"] }] });
  });

  it("removing a person: never yourself, only with their typed name; their data goes and it's logged", async () => {
    const s = await setup();
    expect(await s.run(s.admin, "admin.remove_person", { personId: ADMIN, confirmName: "Ada Admin" })).toMatchObject({ ok: false, code: "self" });
    expect(await s.run(s.admin, "admin.remove_person", { personId: BEN, confirmName: "Ben" })).toMatchObject({ ok: false, status: 422, code: "confirm" });
    expect(s.removed).toEqual([]);
    expect(await s.run(s.admin, "admin.remove_person", { personId: BEN, confirmName: "  ben  person " })).toMatchObject({ ok: true, data: { removed: "Ben Person" } });
    expect(s.removed).toEqual([BEN]);
    expect(await s.accounts.users.get(BEN)).toBeNull();
    expect(await s.plan.getCapture(s.capture.id)).toBeNull();
    expect((await s.store.auditList({ area: "people" }))[0]).toMatchObject({ actorName: "Ada Admin", target: "Ben Person", note: expect.stringMatching(/^removed/) });
  });

  it("admins never see anyone's plan, follow-ups, captures, PATs or chat messages", async () => {
    const s = await setup();
    const seen: string[] = [];
    for (const section of ADMIN_SECTIONS) {
      const r = await s.run(s.admin, "admin.load", { section });
      expect(r.ok).toBe(true);
      seen.push(JSON.stringify(r));
    }
    seen.push(JSON.stringify(await s.run(s.admin, "admin.audit", {})));
    const all = seen.join("\n");
    for (const p of PRIVATE) expect(all).not.toContain(p);
    // Status carries CV-1's counts: numbers per status, role and state, and AI calls per chat by its name.
    const st = (await s.run(s.admin, "admin.load", { section: "status" })) as { ok: true; data: { conversations: { conversationsByStatus: Record<string, number>; aiCallsToday: unknown[] } } };
    expect(st.data.conversations.conversationsByStatus).toMatchObject({ new: 0, resolved: 0 });
    expect(st.data.conversations.aiCallsToday).toEqual([{ chatName: "Fabrikam team", clientKey: "fabrikam", calls: 0 }]);
    // What People does show: names and yes or no for sign-ins.
    expect(all).toContain("Ben Person");
    expect(all).toContain('"microsoft":true');
  });

  it("Admin › Clients shows each client's process with its Rules applied, and Refresh reads again", async () => {
    const s = await setup();
    await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "no_breakdown", value: ["Feature"] });
    await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "background", value: ["Bug"] });
    const lvl = (type: string, rank: number, types: string[]) => ({ type, rank, workItemTypes: types.map((name) => ({ name })), defaultWorkItemType: { name: types[0] } });
    const states = [{ name: "New", category: "Proposed", color: "b2b2b2" }];
    const model = (o: ProcessOverrides) =>
      buildProcessModel(
        {
          org: "fabrikam", project: "Fabrikam Data", process: "Agile", fetchedAt: NOW, teamSettings: { bugsBehavior: "asTasks" }, processConfig: { bugWorkItems: { workItemTypes: [{ name: "Bug" }] } },
          teamBacklogs: { value: [lvl("portfolio", 4, ["Epic"]), lvl("portfolio", 3, ["Feature"]), lvl("requirement", 2, ["User Story"]), lvl("task", 1, ["Task", "Bug"])] },
          types: ["Epic", "Feature", "User Story", "Task", "Bug"].map((name) => ({ name, icon: { id: "icon_book" }, color: "009CCC", states })),
        },
        o,
      );
    const asked: [string[], boolean][] = [];
    const rules = async () => (await s.org.rules()).clients.fabrikam!;
    const who = { ...s.admin, process: async (keys: string[], refresh: boolean) => (asked.push([keys, refresh]), Promise.all(keys.map(async (clientKey) => (clientKey === "fabrikam" ? { clientKey, ok: true as const, model: model({ noBreakdown: (await rules()).noBreakdown, background: (await rules()).background }) } : { clientKey, ok: false as const, message: "No Account Worker" })))) };
    const r = (await s.run(who, "admin.load", { section: "clients", refresh: true })) as { ok: true; data: { clients: { key: string; noBreakdown: string[]; process: { ok: boolean; types?: { name: string; level: string; needsBreakdown: boolean; countsHours: boolean; breakdownSource: string }[]; bugs?: string } }[] } };
    expect(asked.at(-1)![1]).toBe(true);
    const fab = r.data.clients.find((c) => c.key === "fabrikam")!;
    expect(fab.noBreakdown).toEqual(["Feature"]);
    expect(fab.process).toMatchObject({ ok: true, bugs: "Bugs are planned with tasks" });
    expect(fab.process.types!.map((t) => [t.name, t.level, t.needsBreakdown, t.countsHours, t.breakdownSource])).toEqual([
      ["Epic", "top", true, true, "default"],
      ["Feature", "parent", false, true, "override"],
      ["User Story", "child", false, true, "level"],
      ["Bug", "task", false, false, "level"],
      ["Task", "task", false, true, "level"],
    ]);
    // Without a process reader (or for a client DevOps can't read), it says so and the Rules still show.
    const plain = (await s.run(s.admin, "admin.load", { section: "clients" })) as typeof r;
    expect(plain.data.clients.find((c) => c.key === "fabrikam")!.process).toEqual({ ok: false, message: "DevOps can't be read from here" });
  });

  it("GD-3: editing a client's aliases or Match only as written re-checks its held messages; other settings don't", async () => {
    const { ops, admin, run } = await setup();
    const asked: string[] = [];
    ops.recheckHeld = async (k) => void asked.push(k);
    await run(admin, "admin.set", { scope: "client:contoso", key: "aliases", value: ["CTS"] });
    await run(admin, "admin.set", { scope: "client:contoso", key: "exact_case", value: true });
    await run(admin, "admin.set", { scope: "client:contoso", key: "allow_ai", value: true });
    expect(asked).toEqual(["contoso", "contoso"]);
  });
});


describe("Code (RB-1)", () => {
  it("only admins read Code views: newest first, by client and person, with counts for 30 days and no content", async () => {
    const s = await setup();
    const views = s.ops.code!.views;
    await views.add({ actorId: BEN, actorName: "Ben Person", clientKey: "fabrikam", repoId: "11111111-2222-4333-8444-555555555555", repoName: "warehouse", path: "/sql/a.sql", event: "file_opened" });
    await views.add({ actorId: CY, actorName: "Cy Person", clientKey: "contoso", repoId: "11111111-2222-4333-8444-555555555555", repoName: "models", path: "/", event: "repo_opened" });
    expect(await s.run(s.ben, "admin.code_views")).toMatchObject({ ok: false, status: 403 });
    const all = await s.run(s.admin, "admin.code_views");
    expect(all).toMatchObject({ ok: true, data: { views: [{ actorName: "Cy Person", event: "repo_opened" }, { actorName: "Ben Person", path: "/sql/a.sql" }], counts: [{ clientKey: "contoso", views: 1 }, { clientKey: "fabrikam", views: 1 }] } });
    expect(await s.run(s.admin, "admin.code_views", { clientKey: "fabrikam" })).toMatchObject({ ok: true, data: { views: [{ actorName: "Ben Person" }] } });
    const byPerson = await s.run(s.admin, "admin.code_views", { personId: CY });
    expect(byPerson.ok && (byPerson.data as { views: unknown[] }).views).toHaveLength(1);
    expect(Object.keys((all as { data: { views: Record<string, unknown>[] } }).data.views[0]!).sort()).toEqual(["actorId", "actorName", "at", "clientKey", "event", "id", "path", "repoId", "repoName"]);
  });
  it("Who can read this client's code is a client Rule (Whole company by default), audited when it changes", async () => {
    const s = await setup();
    expect((await s.org.rules()).clients.fabrikam?.codeAccess ?? "company").toBe("company");
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "code_access", value: "everyone" })).toMatchObject({ ok: false, status: 422 });
    expect(await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "code_access", value: "team" })).toMatchObject({ ok: true });
    s.org.invalidate();
    expect((await s.org.rules()).clients.fabrikam?.codeAccess).toBe("team");
    expect(await s.store.auditList({})).toMatchObject([{ actorName: "Ada Admin", target: "fabrikam", setting: "client:fabrikam/code_access", oldValue: null, newValue: '"team"' }]);
    const c = await s.run(s.admin, "admin.load", { section: "clients" });
    expect(c.ok && (c.data as { clients: { key: string; codeAccess: string }[] }).clients.find((x) => x.key === "fabrikam")?.codeAccess).toBe("team");
  });
  it("Check reads a client's code status for an admin only", async () => {
    const s = await setup();
    expect(await s.run(s.admin, "admin.code_check", { clientKey: "fabrikam" })).toEqual({ ok: true, data: { state: "readable", repos: 3 } });
    expect(await s.run(s.admin, "admin.code_check", { clientKey: "contoso" })).toMatchObject({ ok: true, data: { state: "needs_code_read" } });
    expect(await s.run(s.ben, "admin.code_check", { clientKey: "fabrikam" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("Admin › Standards (KB-1)", () => {
  it("shows the repo, the sync, the article list (never its text) and the warnings", async () => {
    const s = await setup();
    const r = (await s.run(s.admin, "admin.load", { section: "standards" })) as { ok: true; data: Record<string, unknown> & { articles: { title: string; url: string }[] } };
    expect(r.data).toMatchObject({ repoUrl: "https://github.com/cooptimize/coop-standards", branch: "", commit: STD_COMMIT, error: "GitHub answered 503", warnings: [{ kind: "duplicate_id", id: "dup" }], everyMinutes: 60, budget: 6000 });
    expect(r.data.articles[0]).toMatchObject({ title: "Gold Fact Tables", layer: "gold", artifact: "fact_table", path: "SQL/Gold/Fact Tables.md", url: `https://github.com/contoso/standards/blob/${STD_COMMIT}/SQL/Gold/Fact%20Tables.md` });
    expect(JSON.stringify(r.data)).not.toContain("SECRET-ARTICLE-TEXT");
  });

  it("Sync now works for an admin and is refused for anyone else", async () => {
    const s = await setup();
    const before = synced.n;
    expect(await s.run(s.admin, "admin.standards_sync")).toMatchObject({ ok: true, data: { ok: true, changed: true } });
    expect(synced.n).toBe(before + 1);
    expect((await s.run(s.ben, "admin.standards_sync")).ok).toBe(false);
    expect(synced.n).toBe(before + 1);
    expect((await s.run(s.ben, "admin.load", { section: "standards" })).ok).toBe(false);
  });

  it("takes a repo address and branch through the Rules, only valid ones, and a client's Source systems", async () => {
    const s = await setup();
    expect((await s.run(s.admin, "admin.set", { scope: "org", key: "standards.repo_url", value: "https://evil.example/a/b" })).ok).toBe(false);
    expect((await s.run(s.admin, "admin.set", { scope: "org", key: "standards.repo_url", value: "https://github.com/contoso/other" })).ok).toBe(true);
    expect((await s.org.rules()).standards.repoUrl).toBe("https://github.com/contoso/other");
    expect((await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "source_systems", value: ["sap"] })).ok).toBe(false);
    expect((await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "source_systems", value: [] })).ok).toBe(true);
    expect((await s.org.rules()).clients.fabrikam?.sourceSystems).toEqual([]);
    expect((await s.run(s.admin, "admin.set", { scope: "client:fabrikam", key: "source_systems", value: ["d365_fo"] })).ok).toBe(true);
    expect((await s.org.rules()).clients.fabrikam?.sourceSystems).toEqual(["d365_fo"]);
  });
});
