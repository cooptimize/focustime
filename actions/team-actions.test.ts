// SW-1: sends, priorities, the Team view and Ask to look through the actions: several people, each on their own plan
// store, one shared database for the team's app tables, a fake DevOps store for what resolved and moved.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { clientAccounts } from "../plan/client-accounts.ts";
import { levels } from "../plan/levels.ts";
import { createPlanStore, openPlanDb, type PlanStore } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { teamStore } from "../store/team-store.ts";
import { aClient, aDirectoryPerson, aFocusBlock, anAccount, aWeek, ZONE } from "../test/builders/index.ts";
import type { CommitData, SendView, TeamData } from "./team-actions.ts";
import { markScheduled, publishWeek, teamAction, teamNotices, type TeamAction, type TeamContext } from "./team-actions.ts";
import type { OrgRuntime } from "./org.ts";

const THIS_WEEK = "2026-11-02";
const NEXT_WEEK = "2026-11-09";
const NOW = "2026-11-03T14:00:00Z"; // Tue 9:00 New York
const ADATUM = "adatum";
const FABRIKAM = "fabrikam";

const lead = aDirectoryPerson({ name: "Lee Lead", email: "lee@contoso.example" });
const lead2 = aDirectoryPerson({ name: "Lou Lead", email: "lou@contoso.example" });
const dana = aDirectoryPerson({ name: "Dana Reyes", email: "dana@contoso.example" });
const sam = aDirectoryPerson({ name: "Sam Park", email: "sam@contoso.example" });
const fay = aDirectoryPerson({ name: "Fay Other", email: "fay@contoso.example" }); // on Fabrikam only
const guest = aDirectoryPerson({ name: "Gus Guest", email: "gus@partner.example", guest: true });
const bot = aDirectoryPerson({ name: "Helper bot", email: "bot@contoso.example" });
const newbie = aDirectoryPerson({ name: "Nia New", email: "nia@contoso.example" }); // on Adatum, never signed in
const everyone = [lead, lead2, dana, sam, fay, guest, bot, newbie];
const id = (p: { personId: string }) => p.personId.toLowerCase();

type World = { states?: Record<number, string>; moved?: number[] };

function world(w: World = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-team-"));
  const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO(ZONE);
  let clock = NOW;
  const team = teamStore(sqliteConn(openPlanDb({ path: join(dir, "app.db"), now })), () => Temporal.Instant.from(clock));
  const parsed = parseConfig(setValue(starterToml(ZONE), "dataverse", "my_email", "me@contoso.example"));
  if (!parsed.ok) throw new Error("config");
  const people = levels({
    directory: everyone,
    leads: [
      { clientKey: ADATUM, personId: lead.personId, source: "owner" },
      { clientKey: ADATUM, personId: lead2.personId, source: "owner" },
    ],
    overrides: [],
    clients: [dana, sam, guest, bot, newbie].map((p) => ({ personId: p.personId, clientKey: ADATUM, worker: true })).concat([{ personId: fay.personId, clientKey: FABRIKAM, worker: true }]),
    automation: [bot.personId],
    domains: ["contoso.example"],
  });
  const accounts = clientAccounts({ accounts: [anAccount({ clientKey: ADATUM }), anAccount({ clientKey: FABRIKAM })], overrides: {}, internal: "cooptimize" });
  const org = {
    clientAccounts: async () => accounts,
    levels: async () => people,
    isClientLead: async (u: string | null, k: string) => people.isClientLead(u, k),
    store: {
      peopleClients: async () => [dana, sam, guest, bot, newbie].map((p) => ({ personId: p.personId, clientKey: ADATUM, worker: true })).concat([{ personId: fay.personId, clientKey: FABRIKAM, worker: true }]),
      directory: async () => everyone.map((p) => ({ ...p, entra: true, refreshedAt: NOW })),
    },
  } as unknown as OrgRuntime;
  const signedIn = new Set([lead, lead2, dana, sam, fay, guest, bot].map(id));
  const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Wed: "AM", Thu: "PM" } })] });
  const plans = new Map<string, PlanStore>();
  const planOf = (p: { personId: string }) => {
    let s = plans.get(id(p));
    if (!s) plans.set(id(p), (s = createPlanStore({ path: join(dir, `${id(p)}.db`), now })));
    return s;
  };
  const ctxOf = (p: { personId: string }): TeamContext => ({
    plan: planOf(p),
    team,
    config: async () => parsed.config,
    org,
    me: async () => p.personId,
    devops: () => ({
      itemStates: async (clients, ids) => clients.map((c) => ({ clientKey: c.clientKey, states: Object.fromEntries((ids[c.clientKey] ?? []).map((i) => [i, w.states?.[i] ?? "InProgress"])) })),
      stateChanges: async () => ({ known: true, itemIds: w.moved ?? [] }),
    }),
    blocks: async () => week,
    onFocusTime: (x) => signedIn.has(x),
    now: () => clock,
  });
  const as = (p: { personId: string }) => ({
    ctx: ctxOf(p),
    plan: planOf(p),
    run: async <T,>(action: TeamAction, input: unknown = {}): Promise<T> => {
      const r = await teamAction(ctxOf(p), action, input);
      if (!r.ok) throw new Error(`${r.status} ${r.error}`);
      return r.data as T;
    },
    fail: async (action: TeamAction, input: unknown = {}) => {
      const r = await teamAction(ctxOf(p), action, input);
      if (r.ok) throw new Error(`${action} should have failed`);
      return r;
    },
  });
  return { team, as, setClock: (t: string) => void (clock = t), w };
}

const feature = (o: Record<string, unknown> = {}) => ({ clientKey: ADATUM, itemId: 701, level: "feature", title: "Order history export", itemType: "Feature", url: "https://dev.azure.com/contoso/p/_workitems/edit/701", weekStart: THIS_WEEK, kind: "suggested", ...o });
const sendTo = async (from: ReturnType<ReturnType<typeof world>["as"]>, to: { personId: string }, o: Record<string, unknown> = {}) => (await from.run<{ send: SendView }>("send.create", { ...feature(o), toId: to.personId })).send;
const incoming = async (who: ReturnType<ReturnType<typeof world>["as"]>, weekStart = THIS_WEEK) => (await who.run<CommitData>("team.commit", { weekStart })).clients.flatMap((c) => c.incoming);
const sent = async (who: ReturnType<ReturnType<typeof world>["as"]>, weekStart = THIS_WEEK) => (await who.run<CommitData>("team.commit", { weekStart })).clients.flatMap((c) => c.sent);

describe("Send to someone's week (SW-1)", () => {
  it("anyone on the client sends a Suggested; a Must only from that client's leads", async () => {
    const t = world();
    const s = await sendTo(t.as(sam), dana);
    expect(s).toMatchObject({ kind: "suggested", shown: "waiting", words: "Waiting", from: { name: "Sam Park" }, to: { name: "Dana Reyes" } });
    expect(await t.as(sam).fail("send.create", { ...feature({ kind: "must", itemId: 702 }), toId: dana.personId })).toMatchObject({ status: 403, error: expect.stringMatching(/leads send a Must/) });
    expect(await sendTo(t.as(lead), dana, { kind: "must", itemId: 702 })).toMatchObject({ kind: "must" });
    // Who may send a Must shows in the picker's answer.
    expect(await t.as(sam).run("send.people", { clientKey: ADATUM })).toMatchObject({ canMust: false });
    expect(await t.as(lead).run("send.people", { clientKey: ADATUM })).toMatchObject({ canMust: true });
  });

  it("guests and automation accounts never send, receive or appear; someone not on FocusTime yet can't be chosen", async () => {
    const t = world();
    const people = (await t.as(lead).run<{ people: { id: string; onFocusTime: boolean }[] }>("send.people", { clientKey: ADATUM })).people;
    expect(people.map((p) => p.id)).not.toContain(id(guest));
    expect(people.map((p) => p.id)).not.toContain(id(bot));
    expect(people.find((p) => p.id === id(newbie))).toMatchObject({ onFocusTime: false });
    expect(await t.as(lead).fail("send.create", { ...feature(), toId: guest.personId })).toMatchObject({ status: 403 });
    expect(await t.as(lead).fail("send.create", { ...feature(), toId: bot.personId })).toMatchObject({ status: 403 });
    expect(await t.as(lead).fail("send.create", { ...feature(), toId: newbie.personId })).toMatchObject({ status: 403, error: "They aren't on FocusTime yet" });
    expect(await t.as(guest).fail("send.create", { ...feature(), toId: dana.personId })).toMatchObject({ status: 403 });
    expect(await t.as(bot).fail("send.create", { ...feature(), toId: dana.personId })).toMatchObject({ status: 403 });
    // Someone on another client isn't on this one.
    expect(await t.as(lead).fail("send.create", { ...feature(), toId: fay.personId })).toMatchObject({ status: 403 });
    expect(await t.as(fay).fail("send.create", { ...feature(), toId: dana.personId })).toMatchObject({ status: 403 });
    // Only this week or next.
    expect(await t.as(lead).fail("send.create", { ...feature({ weekStart: "2026-11-16" }), toId: dana.personId })).toMatchObject({ status: 400 });
  });

  it("an unaccepted Must counts zero; Accept puts it on the recipient's week as a must, and the sender sees Accepted", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana, { kind: "must", askTake: true });
    // Not on Dana's list until accepted, so it counts nowhere (Commit and the Board read the same list).
    expect((await t.as(dana).plan.weekPlan(THIS_WEEK)).features).toEqual([]);
    expect(await incoming(t.as(dana))).toEqual([expect.objectContaining({ id: s.id, canAnswer: true, kind: "must" })]);
    const a = await t.as(dana).run<{ send: SendView; assign: { ticked: boolean } }>("send.accept", { id: s.id });
    expect(a.assign).toMatchObject({ clientKey: ADATUM, itemId: 701, ticked: true });
    expect((await t.as(dana).plan.weekPlan(THIS_WEEK)).features).toEqual([expect.objectContaining({ itemId: 701, tier: "must", level: "feature" })]);
    expect(await incoming(t.as(dana))).toEqual([]);
    expect((await sent(t.as(lead)))[0]).toMatchObject({ shown: "accepted", words: "Accepted" });
    // Without "Ask them to take it in DevOps", Accept offers the assign unticked.
    const b = await sendTo(t.as(sam), dana, { itemId: 703 });
    expect((await t.as(dana).run<{ assign: { ticked: boolean } }>("send.accept", { id: b.id })).assign.ticked).toBe(false);
  });

  it("Accept and schedule opens the client's first block; planning it shows the sender Scheduled", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana);
    const a = await t.as(dana).run<{ open: { date: string; half: string } | null }>("send.accept", { id: s.id, schedule: true });
    expect(a.open).toEqual({ date: "2026-11-04", half: "AM" });
    await markScheduled(t.as(dana).ctx, ADATUM, 701);
    expect((await sent(t.as(lead)))[0]).toMatchObject({ shown: "scheduled", words: "Scheduled" });
  });

  it("Pass to keeps the original sender; the sender sees Passed to <name>", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana, { kind: "must" });
    await t.as(dana).run("send.pass", { id: s.id, toId: sam.personId });
    expect(await incoming(t.as(dana))).toEqual([]);
    expect(await incoming(t.as(sam))).toEqual([expect.objectContaining({ from: { id: id(lead), name: "Lee Lead" }, by: { id: id(dana), name: "Dana Reyes" }, kind: "must" })]);
    expect((await sent(t.as(lead)))[0]).toMatchObject({ shown: "passed", words: "Passed to Sam Park" });
    // Only the recipient passes it on.
    expect(await t.as(dana).fail("send.pass", { id: s.id, toId: lead2.personId })).toMatchObject({ status: 409 });
  });

  it("Can't needs a reason; a Must stays as a conflict for both until sorted, and the other leads are told", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana, { kind: "must" });
    expect(await t.as(dana).fail("send.cant", { id: s.id, reason: "  " })).toMatchObject({ status: 400 });
    const c = await t.as(dana).run<{ told: { sender: string; leads: string[] } }>("send.cant", { id: s.id, reason: "Out Thursday and Friday" });
    expect(c.told).toEqual({ sender: id(lead), leads: [id(lead2)] });
    expect(await incoming(t.as(dana))).toEqual([expect.objectContaining({ conflict: true, canAnswer: true, words: "Can't: Out Thursday and Friday" })]);
    expect((await sent(t.as(lead)))[0]).toMatchObject({ conflict: true, canWithdraw: true, words: "Can't: Out Thursday and Friday" });
    // The other lead hears about it, quietly; the sender only through their own answer, never twice.
    expect((await teamNotices(t.as(lead2).ctx, THIS_WEEK, "2026-11-01T00:00:00Z")).map((n) => n.kind)).toEqual(["send_cant_lead"]);
    expect((await teamNotices(t.as(lead).ctx, THIS_WEEK, "2026-11-01T00:00:00Z")).map((n) => n.kind)).toEqual(["send_answered"]);
    // Sorted: the sender withdraws it, and it leaves both sides.
    await t.as(lead).run("send.withdraw", { id: s.id });
    expect(await incoming(t.as(dana))).toEqual([]);
    expect((await sent(t.as(lead)))[0]).toMatchObject({ shown: "withdrawn", conflict: false });
  });

  it("a Suggested's Can't leaves the recipient; a conflict can be accepted after all", async () => {
    const t = world();
    const s = await sendTo(t.as(sam), dana);
    await t.as(dana).run("send.cant", { id: s.id, reason: "Full week" });
    expect(await incoming(t.as(dana))).toEqual([]);
    const m = await sendTo(t.as(lead), dana, { kind: "must", itemId: 702 });
    await t.as(dana).run("send.cant", { id: m.id, reason: "Full week" });
    await t.as(dana).run("send.accept", { id: m.id });
    expect((await sent(t.as(lead))).find((x) => x.id === m.id)).toMatchObject({ shown: "accepted", conflict: false });
  });

  it("Done when the item resolves in DevOps; Cancel only while Waiting; Not answered once the week ended", async () => {
    const t = world({ states: { 702: "Completed" } });
    const done = await sendTo(t.as(lead), dana, { itemId: 702 });
    expect((await sent(t.as(lead))).find((x) => x.id === done.id)).toMatchObject({ shown: "done", words: "Done" });
    expect(await incoming(t.as(dana))).toEqual([]);

    const c = await sendTo(t.as(lead), dana, { itemId: 703 });
    await t.as(lead).run("send.cancel", { id: c.id });
    expect(await incoming(t.as(dana))).toEqual([]);
    const a = await sendTo(t.as(lead), dana, { itemId: 704 });
    await t.as(dana).run("send.accept", { id: a.id });
    expect(await t.as(lead).fail("send.cancel", { id: a.id })).toMatchObject({ status: 409 });
    expect(await t.as(dana).fail("send.cancel", { id: a.id })).toMatchObject({ status: 409 });

    await sendTo(t.as(lead), dana, { itemId: 705 });
    t.setClock("2026-11-10T14:00:00Z");
    expect((await sent(t.as(lead), THIS_WEEK)).find((x) => x.itemId === 705)).toMatchObject({ shown: "not_answered", words: "Not answered", canCancel: false });
  });

  it("Today's line names the sender and a Must", async () => {
    const t = world();
    await sendTo(t.as(lead), dana, { kind: "must" });
    expect(await t.as(dana).run("send.today")).toMatchObject({ line: "Lee sent you Order history export (Must)", count: 1 });
    expect(await t.as(sam).run("send.today")).toMatchObject({ line: null, count: 0 });
  });

  it("tells the recipient once there's work for them, and the sender when it's answered", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana);
    expect((await teamNotices(t.as(dana).ctx, THIS_WEEK, "2026-11-01T00:00:00Z")).map((n) => n.kind)).toEqual(["sent_to_you"]);
    await t.as(dana).run("send.accept", { id: s.id });
    expect((await teamNotices(t.as(lead).ctx, THIS_WEEK, "2026-11-01T00:00:00Z"))[0]).toMatchObject({ kind: "send_answered", words: "Dana Reyes accepted it" });
  });
});

describe("The Team view (SW-1)", () => {
  it("shows each teammate's committed features only: no picks, focus, notes, estimates or hours", async () => {
    const t = world({ moved: [801] });
    const d = t.as(dana);
    await d.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: ADATUM, itemId: 701, title: "Order history export", itemType: "Feature", url: null, level: "feature", tier: "must", estimate: 600 });
    await d.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: ADATUM, itemId: 711, title: "Export orders to CSV", itemType: "User Story", url: null, level: "story", tier: "must", size: "L", parentId: 701 });
    await d.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: ADATUM, itemId: 720, title: "Date filter", itemType: "Feature", url: null, level: "feature", tier: "nice" });
    await d.plan.addWatch({ weekStart: THIS_WEEK, clientKey: ADATUM, itemId: 801, title: "Carrier alerts", itemType: "Feature", url: null, why: "chosen", checkin: null });
    // Personal things that must never show.
    const pick = await d.plan.addPick({ date: "2026-11-04", half: "AM", clientKey: ADATUM, kind: "intention", title: "Private pick text", size: "M" });
    await d.plan.addFocus({ pickId: pick.id, label: "Private focus label", startedAt: "2026-11-04T09:00:00-05:00[America/New_York]", endedAt: "2026-11-04T10:00:00-05:00[America/New_York]", seconds: 3600 });
    await d.plan.setResumeNote(ADATUM, "2026-11-03", "Private resume note");
    await d.plan.commitWeek(THIS_WEEK);
    await publishWeek(d.ctx, THIS_WEEK);

    const v = await t.as(sam).run<TeamData>("team.view", { weekStart: THIS_WEEK });
    const adatum = v.clients.find((c) => c.clientKey === ADATUM)!;
    const danaRow = adatum.people.find((p) => p.id === id(dana))!;
    expect(danaRow).toMatchObject({ state: "committed", features: [{ itemId: 701, tier: "must" }, { itemId: 720, tier: "nice" }], watching: [{ itemId: 801, moved: true }] });
    const json = JSON.stringify(v);
    for (const leak of ["Private pick text", "Private focus label", "Private resume note", "Export orders to CSV", "estimate", "minutes", "hours", "size", "pins", "seconds"]) expect(json).not.toContain(leak);
    // A teammate who hasn't committed: "Not committed yet"; one who never signed in: not on FocusTime.
    expect(adatum.people.find((p) => p.id === id(sam))).toMatchObject({ state: "draft", features: [] });
    expect(adatum.people.find((p) => p.id === id(newbie))).toMatchObject({ state: "not_on_focustime" });
    expect(adatum.people.map((p) => p.id)).not.toContain(id(guest));
    expect(adatum.people.map((p) => p.id)).not.toContain(id(bot));
  });

  it("is scoped per client: someone on another client sees none of it", async () => {
    const t = world();
    const d = t.as(dana);
    await d.plan.addWeekItem({ weekStart: THIS_WEEK, clientKey: ADATUM, itemId: 701, title: "Order history export", itemType: "Feature", url: null, level: "feature", tier: "must" });
    await d.plan.commitWeek(THIS_WEEK);
    await publishWeek(d.ctx, THIS_WEEK);
    await sendTo(t.as(lead), sam);
    const v = await t.as(fay).run<TeamData>("team.view", { weekStart: THIS_WEEK });
    expect(v.clients.map((c) => c.clientKey)).toEqual([FABRIKAM]);
    expect(JSON.stringify(v)).not.toContain("Order history export");
    // A guest on the client sees nothing either.
    expect((await t.as(guest).run<TeamData>("team.view", { weekStart: THIS_WEEK })).clients).toEqual([]);
  });

  it("shows the client's sends with their states", async () => {
    const t = world();
    const s = await sendTo(t.as(lead), dana, { kind: "must" });
    await t.as(dana).run("send.cant", { id: s.id, reason: "Out Friday" });
    const v = await t.as(sam).run<TeamData>("team.view", { weekStart: THIS_WEEK });
    expect(v.clients.find((c) => c.clientKey === ADATUM)!.sends).toEqual([expect.objectContaining({ role: "teammate", words: "Can't: Out Friday", conflict: true, canAnswer: false })]);
  });
});

describe("Client priorities (SW-1)", () => {
  it("only a lead flags; everyone on the client sees it with Add to my week; resolved drops off", async () => {
    const t = world();
    const flag = { clientKey: ADATUM, itemId: 701, title: "Order history export", itemType: "Feature", note: "The client's ask for this month" };
    expect(await t.as(sam).fail("priority.flag", flag)).toMatchObject({ status: 403 });
    await t.as(lead).run("priority.flag", flag);
    const c = (await t.as(sam).run<CommitData>("team.commit", { weekStart: THIS_WEEK })).clients.find((x) => x.clientKey === ADATUM)!;
    expect(c.priorities).toEqual([expect.objectContaining({ itemId: 701, note: "The client's ask for this month", onMyWeek: false, canUnflag: false, flaggedBy: { id: id(lead), name: "Lee Lead" } })]);
    await t.as(sam).run("priority.add_to_week", { clientKey: ADATUM, itemId: 701, weekStart: THIS_WEEK });
    expect((await t.as(sam).plan.weekPlan(THIS_WEEK)).features).toEqual([expect.objectContaining({ itemId: 701, tier: "must" })]);
    expect((await t.as(sam).run<CommitData>("team.commit", { weekStart: THIS_WEEK })).clients.find((x) => x.clientKey === ADATUM)!.priorities[0]).toMatchObject({ onMyWeek: true });
    // Someone on another client doesn't see it.
    expect(JSON.stringify(await t.as(fay).run("team.commit", { weekStart: THIS_WEEK }))).not.toContain("Order history export");
    expect(await t.as(sam).fail("priority.unflag", { clientKey: ADATUM, itemId: 701 })).toMatchObject({ status: 403 });
    t.w.states = { 701: "Resolved" };
    expect((await t.as(sam).run<CommitData>("team.commit", { weekStart: THIS_WEEK })).clients.find((x) => x.clientKey === ADATUM)!.priorities).toEqual([]);
  });
});

describe("Ask <lead> to look (SW-1)", () => {
  it("asks one of the client's leads, who replies; the reply shows on my Commit", async () => {
    const t = world();
    expect(await t.as(dana).fail("look.ask", { clientKey: ADATUM, weekStart: NEXT_WEEK, toId: sam.personId })).toMatchObject({ status: 403 });
    const a = (await t.as(dana).run<{ look: { id: number } }>("look.ask", { clientKey: ADATUM, weekStart: NEXT_WEEK, toId: lead.personId, note: "Is this too much?" })).look;
    expect((await teamNotices(t.as(lead).ctx, THIS_WEEK, "2026-11-01T00:00:00Z")).map((n) => n.kind)).toEqual(["look_ask"]);
    expect(await t.as(sam).fail("look.reply", { id: a.id, reply: "Fine" })).toMatchObject({ status: 403 });
    await t.as(lead).run("look.reply", { id: a.id, reply: "Looks right. Drop the date filter if the export slips." });
    const c = (await t.as(dana).run<CommitData>("team.commit", { weekStart: NEXT_WEEK })).clients.find((x) => x.clientKey === ADATUM)!;
    expect(c.looks).toEqual([expect.objectContaining({ to: { id: id(lead), name: "Lee Lead" }, reply: "Looks right. Drop the date filter if the export slips." })]);
    expect(c.leads.map((l) => l.name).sort()).toEqual(["Lee Lead", "Lou Lead"]);
  });
});
