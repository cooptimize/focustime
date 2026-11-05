// CV-3b, guard: SW-1's client lists come only from clientAccounts(). A prospect I own, with a lead override on it,
// never shows in Week › Team, in Send to… (people or a send), in client priorities, in Ask to look or in what my
// commit publishes; with account types missing (the fallback) and after they are read. The real org runtime over
// the admin store; fictional names.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createPlanStore, openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { teamStore } from "../store/team-store.ts";
import { anAccount, aDirectoryPerson, aWeek, ZONE } from "../test/builders/index.ts";
import { createOrgRuntime } from "./org.ts";
import { publishWeek, teamAction, type TeamAction, type TeamContext, type TeamData } from "./team-actions.ts";

const NOW = "2026-11-03T14:00:00Z";
const THIS_WEEK = "2026-11-02";
const CLIENT = "adatum";
const PROSPECT = "Johnson Prospect";
const me = aDirectoryPerson({ name: "Mo Me", email: "mo@contoso.example", level: "lead", positionName: "Lead Consultant" });
const pat = aDirectoryPerson({ name: "Pat Peer", email: "pat@contoso.example" });
const ADMIN = { id: "00000000-0000-4000-8000-0000000000ad", name: "An admin" };

async function world(typed: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "c-team-only-"));
  const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE);
  const conn = sqliteConn(openPlanDb({ path: join(dir, "app.db"), now }));
  const admin = createAdminStore(conn, () => Temporal.Instant.from(NOW));
  const team = teamStore(conn, () => Temporal.Instant.from(NOW));
  // I own both (the owner is a lead); Pat and I are Account Workers on the client only. Owning a prospect doesn't
  // make it active, so the fallback leaves it out too.
  await admin.replaceDirectory(
    [me, pat],
    [CLIENT, PROSPECT].map((clientKey) => ({ clientKey, personId: me.personId, source: "owner" as const })),
    [me, pat].map((p) => ({ personId: p.personId, clientKey: CLIENT, worker: true })),
    typed ? [anAccount({ clientKey: CLIENT, type: "customer" }), anAccount({ clientKey: PROSPECT, type: "prospect" })] : [],
  );
  // An admin's lead override on the prospect: stays stored, never used.
  await admin.setOverride({ personId: pat.personId, personName: pat.name, kind: "lead_add", clientKey: PROSPECT, actor: ADMIN });
  const org = createOrgRuntime({ store: admin, bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["contoso.example"], feedback: null }, holdMs: 0 });
  const parsed = parseConfig(setValue(starterToml(ZONE), "dataverse", "my_email", "mo@contoso.example"));
  if (!parsed.ok) throw new Error("config");
  const plan = createPlanStore({ path: join(dir, "me.db"), now });
  const ctx: TeamContext = {
    plan,
    team,
    config: async () => parsed.config,
    org,
    me: async () => me.personId,
    devops: () => ({ itemStates: async () => [], stateChanges: async () => ({ known: true, itemIds: [] }) }),
    blocks: async () => aWeek(),
    onFocusTime: () => true,
    now: () => NOW,
  };
  const run = async <T>(a: TeamAction, input: unknown = {}) => {
    const r = await teamAction(ctx, a, input);
    return r as { ok: boolean; status?: number; data?: T };
  };
  return { ctx, plan, team, admin, run, conn };
}

describe.each([
  ["account types missing (the fallback)", false],
  ["after account types are read", true],
])("a prospect I own never appears, %s", (_label, typed) => {
  it("in Team, Send to…, priorities, Ask to look and the published week", async () => {
    const w = await world(typed);
    // A record left on the prospect from before (as if made while it counted): stored, hidden.
    await w.team.flag({ clientKey: PROSPECT, itemId: 77, title: "Prospect ask", itemType: "Feature", url: null, note: null, flaggedBy: { id: me.personId.toLowerCase(), name: me.name } }, NOW);

    const view = await w.run<TeamData>("team.view", { weekStart: THIS_WEEK });
    expect(view.ok).toBe(true);
    const keys = view.data!.clients.map((c) => c.clientKey);
    expect(keys).toContain(CLIENT);
    expect(keys).not.toContain(PROSPECT);
    // The lead label comes from isClientLead on clients only.
    expect(view.data!.clients.find((c) => c.clientKey === CLIENT)!.people.find((p) => p.you)?.lead).toBe(true);
    expect(JSON.stringify(view.data)).not.toContain("Prospect ask");

    const people = await w.run<{ people: unknown[]; canSend: boolean }>("send.people", { clientKey: PROSPECT });
    expect(people.data).toMatchObject({ people: [], canSend: false });
    const send = await w.run("send.create", { clientKey: PROSPECT, itemId: 5, level: "feature", title: "x", weekStart: THIS_WEEK, kind: "suggested", toId: pat.personId });
    expect(send.ok).toBe(false);
    expect((await w.run("priority.flag", { clientKey: PROSPECT, itemId: 9, title: "x" })).ok).toBe(false);
    expect((await w.run("look.ask", { clientKey: PROSPECT, weekStart: THIS_WEEK, toId: pat.personId })).ok).toBe(false);

    const commit = await w.run<{ clients: { clientKey: string }[] }>("team.commit", { weekStart: THIS_WEEK });
    expect(commit.data!.clients.map((c) => c.clientKey)).not.toContain(PROSPECT);

    // My week has a feature of each; only the client's is published (week_commitments).
    await w.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: CLIENT, itemId: 1, title: "Client feature", itemType: "Feature", url: null, level: "feature", tier: "must" });
    await w.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: PROSPECT, itemId: 2, title: "Prospect feature", itemType: "Feature", url: null, level: "feature", tier: "must" });
    await publishWeek(w.ctx, THIS_WEEK);
    const published = await w.team.commitments([CLIENT, PROSPECT], THIS_WEEK);
    expect(published.map((c) => c.clientKey)).toEqual([CLIENT]);

    // The override is still stored.
    expect((await w.admin.overrides()).some((o) => o.clientKey === PROSPECT && o.kind === "lead_add")).toBe(true);
  });
});
