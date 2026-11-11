// SR-2: who sees a client's draft report, checked on the server: everyone on the client's team (Account Workers and
// leads who are Cooptimizers), and nobody else: not a guest, not an automation account, not an admin who isn't on
// the team (being an admin adds nothing). Week › Team's roster decides, through reportTeam. Also: the report's
// contents through the action (team commitments feed No update yet, the PTO is the team's only, no email leaves).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { clientAccounts } from "../plan/client-accounts.ts";
import { levels } from "../plan/levels.ts";
import type { StatusReportAnswer } from "../plan/status-types.ts";
import { createPlanStore, openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { teamStore } from "../store/team-store.ts";
import { aDirectoryPerson, anAccount, anAheadClient, anAheadItem, anAssignee, aReportComment, ZONE } from "../test/builders/index.ts";
import type { OrgRuntime } from "./org.ts";
import { NOT_ON_TEAM, PTO_SOURCE, statusAction, type StatusContext } from "./status-actions.ts";
import { reportTeam } from "./team-actions.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thu
const ADATUM = "adatum";
const FABRIKAM = "fabrikam";

const lead = aDirectoryPerson({ name: "Lee Lead", email: "lee@contoso.example" });
const dana = aDirectoryPerson({ name: "Dana Reyes", email: "dana@contoso.example" });
const sam = aDirectoryPerson({ name: "Sam Park", email: "sam@contoso.example" });
const fay = aDirectoryPerson({ name: "Fay Other", email: "fay@contoso.example" }); // on Fabrikam only
const ada = aDirectoryPerson({ name: "Ada Admin", email: "ada@contoso.example" }); // a FocusTime admin, on no client
const guest = aDirectoryPerson({ name: "Gus Guest", email: "gus@partner.example", guest: true });
const bot = aDirectoryPerson({ name: "Helper bot", email: "bot@contoso.example" });
const everyone = [lead, dana, sam, fay, ada, guest, bot];
const workers = [dana, sam, guest, bot].map((p) => ({ personId: p.personId, clientKey: ADATUM, worker: true })).concat([{ personId: fay.personId, clientKey: FABRIKAM, worker: true }]);

function world(extra: Partial<StatusContext> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-sr2-"));
  const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE);
  const team = teamStore(sqliteConn(openPlanDb({ path: join(dir, "app.db"), now })), () => Temporal.Instant.from(NOW));
  const parsed = parseConfig(setValue(starterToml(ZONE), "dataverse", "my_email", "me@contoso.example"));
  if (!parsed.ok) throw new Error("config");
  const people = levels({ directory: everyone, leads: [{ clientKey: ADATUM, personId: lead.personId, source: "owner" }], overrides: [], clients: workers, automation: [bot.personId], domains: ["contoso.example"] });
  const accounts = clientAccounts({ accounts: [anAccount({ clientKey: ADATUM }), anAccount({ clientKey: FABRIKAM })], overrides: {}, internal: "cooptimize" });
  const org = {
    clientAccounts: async () => accounts,
    levels: async () => people,
    isClientLead: async (u: string | null, k: string) => people.isClientLead(u, k),
    // Ada is an admin: nothing in the report's rule asks.
    isAdmin: async (u: string | null) => u === ada.personId,
    store: { peopleClients: async () => workers, directory: async () => everyone.map((p) => ({ ...p, entra: true, refreshedAt: NOW })) },
  } as unknown as OrgRuntime;
  const items = [
    anAheadItem({ id: 701, title: "Order history export", order: 2, assignee: anAssignee("Dana Reyes", "dana@contoso.example") }),
    anAheadItem({ id: 702, title: "Supplier onboarding", order: 1, assignee: anAssignee("Sam Park", "sam@contoso.example") }),
    anAheadItem({ id: 703, title: "Loyalty points", order: 3, assignee: null }),
    anAheadItem({ id: 710, title: "Points page", level: "child", type: "User Story", parentId: 703 }),
  ];
  const comments: Record<number, ReturnType<typeof aReportComment>[]> = {
    701: [aReportComment({ id: 1, authorName: "Dana Reyes", authorUnique: "dana@contoso.example", text: "Merged the CSV export.", createdAt: "2026-11-03T10:00:00Z" })],
    702: [aReportComment({ id: 2, authorName: "Sam Park", authorUnique: "sam@contoso.example", text: "Old note.", createdAt: "2026-10-20T10:00:00Z" })],
  };
  const reads: string[] = [];
  const plans = new Map<string, ReturnType<typeof createPlanStore>>();
  const ctxOf = (p: { personId: string; email: string | null }): StatusContext => {
    let plan = plans.get(p.personId);
    if (!plan) plans.set(p.personId, (plan = createPlanStore({ path: join(dir, `${p.personId}.db`), now })));
    return {
      plan,
      config: async () => parsed.config,
      clients: async () => [{ clientKey: ADATUM, clientName: "Adatum" }, { clientKey: FABRIKAM, clientName: "Fabrikam" }],
      devops: () => ({
        aheadItems: async (refs) => (reads.push(`ahead:${refs.map((r) => r.clientKey).join(",")}`), refs.map((r) => anAheadClient({ clientKey: r.clientKey, clientName: r.clientName, items: r.clientKey === ADATUM ? items : [] }))),
        featureComments: async (_k, ids) => (reads.push(`comments:${ids.join(",")}`), { ok: true as const, comments: Object.fromEntries(ids.map((id) => [id, comments[id] ?? []])), failed: [] }),
        activity: async () => ({ known: true, rows: [{ itemId: 710, kind: "state" as const, oldValue: "New", newValue: "Active", changedAt: "2026-11-04T10:00:00Z", mine: false }] }),
      }),
      katSent: async (_c, keys) => ({ ok: true, sent: Object.fromEntries(keys.map((k) => [k, "2026-11-02T12:04:00Z"])) }),
      myEmails: async () => (p.email ? [p.email] : []),
      canWrite: async () => true,
      ai: async () => null,
      now: () => NOW,
      team: () => reportTeam({ me: async () => p.personId, org, team, onFocusTime: () => true }),
      teamPto: async () => ({ ok: true, away: [{ userId: sam.systemUserId, date: "2026-11-10" }, { userId: fay.systemUserId, date: "2026-11-10" }, { userId: guest.systemUserId, date: "2026-11-11" }] }),
      writeName: async () => "Dana Reyes",
      ...extra,
    };
  };
  const as = (p: typeof dana) => ({
    run: async (input: unknown) => statusAction(ctxOf(p), "status.report", input),
  });
  return { as, team, reads };
}

describe("who sees a client's report (SR-2)", () => {
  it("every Cooptimizer on the client's team: Account Workers and leads", async () => {
    const w = world();
    for (const p of [dana, sam, lead]) {
      const list = await w.as(p).run({});
      expect(list).toMatchObject({ ok: true, data: { clients: [{ clientKey: ADATUM, clientName: "Adatum" }], report: null } });
      const r = await w.as(p).run({ clientKey: ADATUM });
      expect(r.ok).toBe(true);
    }
  });
  it("a guest, an automation account and an admin who isn't on the team: no switch and 403, and nothing is read", async () => {
    const w = world();
    for (const p of [guest, bot, ada]) {
      expect(await w.as(p).run({})).toMatchObject({ ok: true, data: { clients: [], report: null } });
      expect(await w.as(p).run({ clientKey: ADATUM })).toMatchObject({ ok: false, status: 403, error: NOT_ON_TEAM });
    }
    expect(w.reads).toEqual([]);
  });
  it("someone on another client only: 403 for this one, their own in the list", async () => {
    const w = world();
    expect(await w.as(fay).run({})).toMatchObject({ data: { clients: [{ clientKey: FABRIKAM }] } });
    expect(await w.as(fay).run({ clientKey: ADATUM })).toMatchObject({ ok: false, status: 403 });
    expect(w.reads).toEqual([]);
  });
});

describe("the client report through the action (SR-2)", () => {
  it("has the commented features in backlog order, No update yet from the team's commitments and story activity, and the team's PTO", async () => {
    const w = world();
    // Sam committed Supplier onboarding this week (Week › Team's snapshot); nobody commented on it since Monday.
    await w.team.publish(sam.personId, "2026-11-02", [{ clientKey: ADATUM, itemId: 702, title: "Supplier onboarding", itemType: "Feature", url: null, tier: "nice", watching: false }], NOW);
    const r = await w.as(dana).run({ clientKey: ADATUM });
    if (!r.ok) throw new Error(r.error);
    const rep = (r.data as StatusReportAnswer).report!;
    expect(rep.header).toBe("Draft for Monday, Nov 9 · Kat sends it at 7:00 AM · last sent Nov 2");
    expect(rep.features.map((f) => [f.id, f.owner, f.thisWeek!.map((c) => [c.author, c.who, c.editable])])).toEqual([[701, "Dana Reyes", [["Dana Reyes", "mine", true]]]]);
    expect(rep.noUpdate.map((f) => [f.id, f.owner, f.active])).toEqual([[702, "Sam Park", "planned"], [703, null, "activity"]]);
    // The team only: Fay (another client) and the guest aren't listed.
    // SR-3: the next two weeks from the report's Monday; this context has no holidays reader, which says so.
    expect(rep.pto).toEqual({ rows: [{ kind: "pto", name: "Sam Park", when: "Tue, Nov 10", from: "2026-11-10", days: 1 }], source: PTO_SOURCE, range: "Mon, Nov 9 to Sun, Nov 22", ptoRead: true, holidaysRead: false, notes: ["Holidays couldn't be read (not available here)"] });
    expect(rep.authorAs).toBe("Dana Reyes");
    expect(JSON.stringify(r.data)).not.toMatch(/@contoso\.example/);
  });
  it("Sam sees Dana's comment read-only, and Refresh reads DevOps again", async () => {
    const w = world();
    const r = await w.as(sam).run({ clientKey: ADATUM, refresh: true });
    if (!r.ok) throw new Error(r.error);
    expect((r.data as StatusReportAnswer).report!.features[0]!.thisWeek!.map((c) => [c.who, c.editable])).toEqual([["teammate", false]]);
  });
});

describe("Upcoming PTO and Holidays (SR-3)", () => {
  const holidays: StatusContext["holidays"] = async (_cfg, from, to) => ({ ok: true, days: [{ date: "2026-11-10", name: "Founders Day" }, { date: "2026-11-16", name: null }, { date: "2026-11-26", name: "Thanksgiving Day" }].filter((d) => d.date >= from && d.date <= to) });
  it("holidays in the next two weeks, named '(observed)' or 'Holiday', before the team's PTO on the same day; past the window left out", async () => {
    const w = world({ holidays });
    const r = await w.as(dana).run({ clientKey: ADATUM });
    if (!r.ok) throw new Error(r.error);
    const pto = (r.data as StatusReportAnswer).report!.pto;
    expect(pto.rows.map((x) => `${x.name} · ${x.when}`)).toEqual(["Founders Day (observed) · Tue, Nov 10", "Sam Park · Tue, Nov 10", "Holiday · Mon, Nov 16"]);
    expect(pto.notes).toEqual([]);
    expect([pto.ptoRead, pto.holidaysRead]).toEqual([true, true]);
  });
  it("a source that can't be read says so and the rest still shows", async () => {
    const w = world({ holidays, teamPto: async () => ({ ok: false, message: "Dataverse said 403" }) });
    const r = await w.as(dana).run({ clientKey: ADATUM });
    if (!r.ok) throw new Error(r.error);
    const rep = (r.data as StatusReportAnswer).report!;
    expect(rep.pto.notes).toEqual(["PTO couldn't be read (Dataverse said 403)"]);
    expect(rep.pto.rows.map((x) => x.kind)).toEqual(["holiday", "holiday"]);
    expect(rep.features.map((f) => f.id)).toEqual([701]);
    const w2 = world({ holidays: async () => { throw new Error("boom"); } });
    const r2 = await w2.as(dana).run({ clientKey: ADATUM });
    if (!r2.ok) throw new Error(r2.error);
    expect((r2.data as StatusReportAnswer).report!.pto.notes).toEqual(["Holidays couldn't be read (Dataverse read failed)"]);
    expect((r2.data as StatusReportAnswer).report!.pto.rows.map((x) => x.name)).toEqual(["Sam Park"]);
  });
});
