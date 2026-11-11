// PL-1: the From last week proposal and Watching through the actions, on a real plan store and a fake DevOps store.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { setValue } from "../config/edit.ts";
import { starterToml } from "../config/starter.ts";
import { clientAccounts } from "../plan/client-accounts.ts";
import { levels } from "../plan/levels.ts";
import type { ProposalData, WatchView } from "../plan/carry.ts";
import { pickNeed } from "../plan/types.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aClient, aDirectoryPerson, aFocusBlock, anAccount, aPortfolioChild, aPortfolioItem, aWeek, ZONE } from "../test/builders/index.ts";
import type { PortfolioItem } from "../week/types.ts";
import { carryAction, checkinMinutes, type CarryContext } from "./carry-actions.ts";
import type { OrgRuntime } from "./org.ts";

const THIS_WEEK = "2026-11-02";
const LAST_WEEK = "2026-10-26";
const NOW = "2026-11-03T14:00:00Z"; // Tue 9:00 New York
const SIZES = { XS: 30, S: 60, M: 120, L: 240, unsized: 60 };

const me = aDirectoryPerson({ name: "Me", email: "me@contoso.example" });
const dana = aDirectoryPerson({ name: "Dana", email: "dana@contoso.example" });
const kat = aDirectoryPerson({ name: "Kat", email: "kat@contoso.example" });

type Opts = { lead?: boolean; meAutomation?: boolean; katOwns?: string; changes?: { known: boolean; itemIds: number[] } };

async function setup(trees: Record<string, PortfolioItem[]>, o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-carry-"));
  const plan = createPlanStore({ path: join(dir, "plan.db"), now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE) });
  const parsed = parseConfig(setValue(starterToml(ZONE), "dataverse", "my_email", "me@contoso.example"));
  if (!parsed.ok) throw new Error("config");
  const people = levels({
    directory: [me, dana, kat],
    leads: [
      ...(o.lead ? [{ clientKey: "adatum", personId: me.personId, source: "owner" as const }] : []),
      ...(o.katOwns ? [{ clientKey: o.katOwns, personId: kat.personId, source: "owner" as const }] : []),
    ],
    overrides: [],
    automation: [kat.personId, ...(o.meAutomation ? [me.personId] : [])],
    domains: ["contoso.example"],
  });
  const accounts = clientAccounts({ accounts: [anAccount({ clientKey: "adatum" }), anAccount({ clientKey: "fabrikam" }), anAccount({ clientKey: "tailspin", type: "prospect" })], overrides: {}, internal: "cooptimize" });
  const org = { clientAccounts: async () => accounts, levels: async () => people, isClientLead: async (u: string | null, k: string) => people.isClientLead(u, k) } as unknown as OrgRuntime;
  const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "PM", Wed: "AM" } })] });
  const ctx: CarryContext = {
    plan,
    config: async () => parsed.config,
    devops: () => ({
      featureTrees: async (clients, ids) => clients.map((c) => ({ clientKey: c.clientKey, items: (trees[c.clientKey] ?? []).filter((t) => (ids[c.clientKey] ?? []).includes(t.id)) })),
      stateChanges: async () => o.changes ?? { known: false, itemIds: [] },
    }),
    clients: async () => ["adatum", "fabrikam", "tailspin"].map((k) => ({ clientKey: k, clientName: k[0]!.toUpperCase() + k.slice(1) })),
    blocks: async () => week,
    org,
    me: async () => me.personId,
    now: () => NOW,
  };
  const run = async <T,>(action: Parameters<typeof carryAction>[1], input: unknown): Promise<T> => {
    const r = await carryAction(ctx, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  /** Puts these features on last week's list for a client. */
  const lastWeek = async (clientKey: string, items: PortfolioItem[]) => {
    for (const t of items) await plan.addWeekItem({ weekStart: LAST_WEEK, clientKey, itemId: t.id, title: t.title, itemType: t.type, url: t.url, level: "feature", estimate: 360 });
  };
  return { plan, ctx, run, lastWeek };
}

const mine = (o = {}) => aPortfolioChild({ assignedTo: "Me", assignedToEmail: "me@contoso.example", mine: true, ...o });
const danas = (o = {}) => aPortfolioChild({ assignedTo: "Dana", assignedToEmail: "dana@contoso.example", ...o });
const katS = (o = {}) => aPortfolioChild({ assignedTo: "Kat", assignedToEmail: "kat@contoso.example", ...o });
const closed = { state: "Closed", stateCategory: "Completed", open: false };
const rowsOf = (p: ProposalData) => p.clients.flatMap((c) => c.rows);

describe("From last week through the actions (PL-1)", () => {
  it("proposes without adding anything, then Accept all keeps carries and watches the Watching rows", async () => {
    const carry = aPortfolioItem({ children: [mine(), danas()] });
    const watch = aPortfolioItem({ mine: true, children: [mine(closed), danas()] });
    const done = aPortfolioItem({ stateCategory: "Resolved" });
    const s = await setup({ adatum: [carry, watch, done] });
    await s.lastWeek("adatum", [carry, watch, done]);

    const p = await s.run<ProposalData>("weekplan.proposal", { weekStart: THIS_WEEK });
    expect(p.counts).toMatchObject({ carry: 1, watch: 1, finished: 1 });
    // The dry run writes nothing.
    expect((await s.plan.weekPlan(THIS_WEEK)).features).toEqual([]);
    expect(await s.plan.weekWatches(THIS_WEEK)).toEqual([]);

    const after = await s.run<ProposalData & { accepted: number }>("weekplan.carry_accept_all", { weekStart: THIS_WEEK });
    expect(after.accepted).toBe(2);
    const list = (await s.plan.weekPlan(THIS_WEEK)).features;
    expect(list.filter((f) => f.level === "feature").map((f) => [f.itemId, f.estimate])).toEqual([[carry.id, 360]]);
    // Only my open story comes along, under its feature.
    expect(list.filter((f) => f.level === "story").map((f) => [f.itemId, f.parentId])).toEqual([[carry.children[0]!.id, carry.id]]);
    expect((await s.plan.weekWatches(THIS_WEEK)).map((w) => [w.itemId, w.why])).toEqual([[watch.id, "owner"]]);
    // Finished stays as a row until dismissed; the accepted ones are gone.
    expect(rowsOf(after).map((r) => r.kind)).toEqual(["finished"]);
  });

  it("row by row: keep, drop and change to Watching; a dropped row stays dropped that week", async () => {
    const a = aPortfolioItem({ children: [mine()] });
    const b = aPortfolioItem({ children: [mine()] });
    const c = aPortfolioItem({ children: [mine(closed), danas()] });
    const s = await setup({ adatum: [a, b, c] });
    await s.lastWeek("adatum", [a, b, c]);

    await s.run("weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: a.id, decision: "keep" });
    await s.run("weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: b.id, decision: "drop" });
    // "Your part is done" with Keep watching.
    const last = await s.run<ProposalData>("weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: c.id, decision: "watch" });
    expect(rowsOf(last)).toEqual([]);
    expect((await s.plan.weekPlan(THIS_WEEK)).features.filter((f) => f.level === "feature").map((f) => f.itemId)).toEqual([a.id]);
    expect((await s.plan.weekWatches(THIS_WEEK)).map((w) => [w.itemId, w.why])).toEqual([[c.id, "chosen"]]);
    // Dismissed rows don't come back, even after the kept feature is taken off the list again.
    const [kept] = (await s.plan.weekPlan(THIS_WEEK)).features.filter((f) => f.itemId === a.id);
    await s.plan.removeWeekItem(kept!.id);
    expect(rowsOf(await s.run<ProposalData>("weekplan.proposal", { weekStart: THIS_WEEK }))).toEqual([]);
    // Deciding a row that is no longer proposed is refused.
    const r = await carryAction(s.ctx, "weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: b.id, decision: "keep" });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses to keep a row with nothing to plan", async () => {
    const t = aPortfolioItem({ children: [danas()] });
    const s = await setup({ adatum: [t] });
    await s.lastWeek("adatum", [t]);
    const r = await carryAction(s.ctx, "weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: t.id, decision: "keep" });
    expect(r).toMatchObject({ ok: false, status: 409, error: "Take one of its stories first, or drop it" });
  });

  it("a prospect gives no rows, and an automation account signed in gets none at all", async () => {
    const t = aPortfolioItem({ mine: true, children: [mine()] });
    const s = await setup({ tailspin: [t] });
    await s.lastWeek("tailspin", [t]);
    expect((await s.run<ProposalData>("weekplan.proposal", {})).counts.carry).toBe(0);

    const u = aPortfolioItem({ mine: true, children: [mine()] });
    const s2 = await setup({ adatum: [u] }, { meAutomation: true });
    await s2.lastWeek("adatum", [u]);
    expect(rowsOf(await s2.run<ProposalData>("weekplan.proposal", {}))).toEqual([]);
  });

  it("a Kat-owned account makes nobody a watcher", async () => {
    const t = aPortfolioItem({ children: [mine(closed), danas()] });
    const s = await setup({ fabrikam: [t] }, { katOwns: "fabrikam" });
    await s.lastWeek("fabrikam", [t]);
    expect(rowsOf(await s.run<ProposalData>("weekplan.proposal", {})).map((r) => r.kind)).toEqual(["part_done"]);
  });
});

describe("Watching check-ins through the actions (PL-1)", () => {
  async function watched(o: Opts = {}, children = [danas(), danas(), katS(), katS(), katS()]) {
    const t = aPortfolioItem({ children });
    const s = await setup({ adatum: [t] }, { lead: true, ...o });
    await s.lastWeek("adatum", [t]);
    await s.run("weekplan.carry_decide", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: t.id, decision: "watch" });
    return { ...s, t };
  }
  const watching = async (s: Awaited<ReturnType<typeof watched>>) => (await s.run<ProposalData>("weekplan.proposal", {})).watching;

  it("goes in the client's first block, counts 30 minutes at once, and is a pick only once that day is opened", async () => {
    const s = await watched();
    const [w] = await s.plan.weekWatches(THIS_WEEK);
    expect(w).toMatchObject({ why: "lead", checkin: { date: "2026-11-03", half: "PM", minutes: 30 }, checkinPickId: null });
    expect(checkinMinutes(await watching(s))).toEqual({ adatum: 30 });
    expect(await s.plan.picksFor("2026-11-03")).toEqual([]);

    const { materializeCheckins } = await import("./carry-actions.ts");
    expect(await materializeCheckins(s.plan, "2026-11-03")).toBe(1);
    const [p] = await s.plan.picksFor("2026-11-03");
    expect(p).toMatchObject({ half: "PM", clientKey: "adatum", kind: "intention", minutes: 30 });
    expect(pickNeed(p!, SIZES)).toBe(30);
    // Once is enough: opening the day again adds nothing, and it still counts 30 (as the pick now).
    expect(await materializeCheckins(s.plan, "2026-11-03")).toBe(0);
    expect(checkinMinutes(await watching(s))).toEqual({ adatum: 30 });
  });

  it("moves with its chip, and removing it keeps the Watching row", async () => {
    const s = await watched();
    const { materializeCheckins } = await import("./carry-actions.ts");
    await materializeCheckins(s.plan, "2026-11-03");
    const moved = await s.run<{ watching: WatchView[] }>("weekplan.watch_checkin", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: s.t.id, to: { date: "2026-11-04", half: "AM" } });
    expect(moved.watching[0]!.checkin).toEqual({ date: "2026-11-04", half: "AM", minutes: 30 });
    // Its pick left the old day.
    expect(await s.plan.picksFor("2026-11-03")).toEqual([]);

    const removed = await s.run<{ watching: WatchView[] }>("weekplan.watch_checkin", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: s.t.id, to: null });
    expect(removed.watching).toHaveLength(1);
    expect(removed.watching[0]!.checkin).toBeNull();
    expect(checkinMinutes(removed.watching)).toEqual({});
    // Never into the past, never out of its week.
    expect(await carryAction(s.ctx, "weekplan.watch_checkin", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: s.t.id, to: { date: "2026-11-02", half: "AM" } })).toMatchObject({ ok: false, status: 400 });
    expect(await carryAction(s.ctx, "weekplan.watch_checkin", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: s.t.id, to: { date: "2026-11-09", half: "AM" } })).toMatchObject({ ok: false, status: 400 });
  });

  it("Stop watching removes the row and it isn't proposed again that week", async () => {
    const s = await watched();
    const r = await s.run<{ watching: WatchView[] }>("weekplan.watch_remove", { weekStart: THIS_WEEK, clientKey: "adatum", itemId: s.t.id });
    expect(r.watching).toEqual([]);
    expect(rowsOf(await s.run<ProposalData>("weekplan.proposal", {}))).toEqual([]);
  });

  it("amber after no state change, naming the Cooptimizer with the most open stories (never Kat)", async () => {
    // Tuesday is early in the week: not amber yet.
    const early = await watched({ changes: { known: true, itemIds: [] } });
    expect((await watching(early))[0]!.state.kind).toBe("early");
    const s = await watched({ changes: { known: true, itemIds: [] } });
    s.ctx.now = () => "2026-11-06T15:00:00Z"; // Friday
    expect((await watching(s))[0]!.state).toEqual({ kind: "quiet", text: "No movement this week", checkInWith: "Dana" });
  });

  it("says Movement not known yet before the store has change data", async () => {
    const s = await watched({ changes: { known: false, itemIds: [] } });
    s.ctx.now = () => "2026-11-06T15:00:00Z";
    expect((await watching(s))[0]!.state).toEqual({ kind: "unknown", text: "Movement not known yet" });
  });
});
