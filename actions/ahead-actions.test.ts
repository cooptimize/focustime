// AH-1: Ahead's change set on the server (D656 to D659): who may stage what, values checked against the process,
// assignees limited to the client's Cooptimizers, pending changes surviving a reload, reconciling against DevOps
// (landed changes leave, a field changed in DevOps is a conflict, other changes don't count), Keep mine and Take
// theirs, Discard all with a confirm, the old local drags moved in once, and filters remembered per person.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { anAheadClient, anAheadItem, anAssignee } from "../test/builders/index.ts";
import { aheadAction, checkFilters, type AheadContext } from "./ahead-actions.ts";
import { FIXED_KEY, SKIPS_KEY } from "../plan/readiness.ts";
import type { AheadClient, AheadLoad } from "./types.ts";

const NOW = "2026-11-02T14:00:00Z";
const ME = "you@cooptimize.example";
const DANA = anAssignee("Dana Reyes");

function setup(o: { lead?: boolean; automation?: boolean; /** AH-5: the project's team members (null: unread). */ project?: { email: string; name: string }[] | null; projectOf?: (clientKey: string) => { email: string; name: string }[] | null } = {}) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const epic = anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, assignee: { name: "Alex Rivera", email: ME } });
  const mine = anAheadItem({ id: 110, parentId: 100, assignee: { name: "Dana Reyes", email: DANA.email }, target: "2026-12-04" });
  const lone = anAheadItem({ id: 120, assignee: DANA });
  const story = anAheadItem({ id: 111, type: "User Story", level: "child", rung: 2, parentId: 110, assignee: DANA });
  let client: AheadClient = anAheadClient({ me: ME, items: [epic, mine, lone, story] });
  const reads: { refresh?: boolean; whole?: boolean }[] = [];
  const ctx: AheadContext = {
    plan,
    config: async () => {
      const r = parseConfig(STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "you@cooptimize.example"'));
      return r.ok ? r.config : null;
    },
    clients: async () => [{ clientKey: "Northwind", clientName: "Northwind Foods" } as never],
    devops: () => ({ aheadItems: async (_refs, opts) => (reads.push(opts ?? {}), [client]), projectPeople: async (k) => (o.projectOf ? o.projectOf(k) : o.project === undefined ? null : o.project) }),
    people: async () => ({ cooptimizers: [{ email: DANA.email, name: "Dana Reyes" }], isCooptimizer: (e) => e.endsWith("@cooptimize.example"), myName: "Alex Rivera" }),
    isLead: async () => o.lead ?? false,
    automation: async () => o.automation ?? false,
    canWrite: async () => true,
    assignable: async (_k, email) => email === DANA.email || email === ME,
    now: () => NOW,
  };
  const run = async <T = unknown>(action: Parameters<typeof aheadAction>[1], input: unknown = {}) => {
    const r = await aheadAction(ctx, action, input);
    if (!r.ok) throw Object.assign(new Error(r.error), { status: r.status });
    return r.data as T;
  };
  const fail = async (action: Parameters<typeof aheadAction>[1], input: unknown) => {
    const r = await aheadAction(ctx, action, input);
    if (r.ok) throw new Error("expected a refusal");
    return r;
  };
  const edit = (f: (c: AheadClient) => AheadClient) => void (client = f(client));
  const setItem = (id: number, patch: Partial<AheadClient["items"][number]>) => edit((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  return { plan, run, fail, setItem, edit, reads };
}
type S = ReturnType<typeof setup>;
const load = (s: S) => s.run<AheadLoad>("ahead.load");

describe("ahead.stage and who may change what (D656)", () => {
  let s: S;
  beforeEach(() => void (s = setup()));
  it("the owner one level up may change it; two levels up or someone else's may not", async () => {
    const l = await load(s);
    expect(l.clients[0]!.editable.sort()).toEqual([100, 110]);
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-11" });
    expect(await s.fail("ahead.stage", { clientKey: "Northwind", itemId: 111, field: "size", value: 3 })).toMatchObject({ status: 403, error: "Only Northwind Foods's leads and the owner can change this." });
    expect(await s.fail("ahead.stage", { clientKey: "Northwind", itemId: 120, field: "target", value: "2026-12-11" })).toMatchObject({ status: 403 });
  });
  it("a lead may change any item of the client; an automation account none", async () => {
    const lead = setup({ lead: true });
    expect((await load(lead)).clients[0]!.editable.sort()).toEqual([100, 110, 111, 120]);
    const bot = setup({ lead: true, automation: true });
    expect((await load(bot)).clients[0]!.editable).toEqual([]);
  });
  it("a field the type doesn't have is refused; values are checked; assignees are the client's Cooptimizers, or Nobody", async () => {
    const lead = setup({ lead: true });
    expect(await lead.fail("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "size", value: 3 })).toMatchObject({ status: 409 });
    expect(await lead.fail("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-02-30" })).toMatchObject({ status: 400 });
    expect(await lead.fail("ahead.stage", { clientKey: "Northwind", itemId: 111, field: "size", value: -1 })).toMatchObject({ status: 400 });
    expect(await lead.fail("ahead.stage", { clientKey: "Northwind", itemId: 111, field: "assignee", value: { email: "lee@other.example", name: "Lee" } })).toMatchObject({ status: 403 });
    await lead.run("ahead.stage", { clientKey: "Northwind", itemId: 111, field: "assignee", value: null });
    await lead.run("ahead.stage", { clientKey: "Northwind", itemId: 111, field: "size", value: 5 });
    expect((await load(lead)).changes.map((c) => [c.itemId, c.field, c.value])).toEqual(expect.arrayContaining([[111, "assignee", null], [111, "size", 5]]));
  });
});

describe("the change set (D657, D658)", () => {
  let s: S;
  beforeEach(() => void (s = setup()));
  it("survives a reload; the base is kept from when editing started; back to DevOps's value is no change", async () => {
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-11", half: "AM" });
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-18" });
    const l = await load(s);
    expect(l.changes).toEqual([expect.objectContaining({ itemId: 110, field: "target", value: "2026-12-18", half: "PM", baseRev: 3, baseValue: "2026-12-04" })]);
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-04", half: "AM" });
    expect((await load(s)).changes).toEqual([]);
    // The half on DevOps's own day is FocusTime's alone, kept.
    expect((await load(s)).halves).toEqual([expect.objectContaining({ itemId: 110, field: "target", day: "2026-12-04", half: "AM" })]);
  });
  it("against DevOps on each load: landed changes leave, a changed field is a conflict, any other change isn't", async () => {
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-11" });
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "start", value: "2026-11-16" });
    // Someone renamed it and moved the rev: nothing to resolve.
    s.setItem(110, { rev: 4, title: "Renamed" });
    expect((await load(s)).changes.every((c) => c.theirs === undefined)).toBe(true);
    // Someone moved the target: a conflict on that field only.
    s.setItem(110, { rev: 5, target: "2027-01-08" });
    const l = await load(s);
    expect(l.changes.find((c) => c.field === "target")).toMatchObject({ theirs: "2027-01-08" });
    expect(l.changes.find((c) => c.field === "start")!.theirs).toBeUndefined();
    // Keep mine: editing goes on from DevOps's rev and value now.
    await s.run("ahead.resolve", { clientKey: "Northwind", itemId: 110, keep: "mine" });
    expect((await load(s)).changes.find((c) => c.field === "target")).toMatchObject({ baseRev: 5, baseValue: "2027-01-08", value: "2026-12-11" });
    // DevOps shows my start now (it landed): it leaves the set, its half stays.
    s.setItem(110, { rev: 6, start: "2026-11-16" });
    const after = await load(s);
    expect(after.changes.map((c) => c.field)).toEqual(["target"]);
    expect(after.halves).toEqual([expect.objectContaining({ field: "start", day: "2026-11-16", half: "AM" })]);
  });
  it("Take theirs drops mine; Discard all needs its confirm", async () => {
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "target", value: "2026-12-11" });
    s.setItem(110, { rev: 5, target: "2027-01-08" });
    await load(s);
    await s.run("ahead.resolve", { clientKey: "Northwind", itemId: 110, keep: "theirs" });
    expect((await load(s)).changes).toEqual([]);
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 100, field: "start", value: "2026-11-09" });
    expect(await s.fail("ahead.discard", {})).toMatchObject({ status: 400 });
    await s.run("ahead.discard", { confirm: true });
    expect((await load(s)).changes).toEqual([]);
  });
  it("dates dragged before AH-1 come in once as pending changes, where I may change them", async () => {
    await s.plan.setRoadmapDates("Northwind", 110, { start: "2026-11-09", end: "2026-12-11" });
    await s.plan.setRoadmapDates("Northwind", 120, { start: "2026-11-09", end: "2026-12-11" });
    const l = await load(s);
    expect(l.changes.map((c) => [c.itemId, c.field, c.value])).toEqual(expect.arrayContaining([[110, "start", "2026-11-09"], [110, "target", "2026-12-11"]]));
    expect(l.changes.some((c) => c.itemId === 120)).toBe(false);
    expect((await s.plan.roadmapDates()).size).toBe(0);
  });
  it("filters are remembered per person and checked", async () => {
    await s.run("ahead.set_filters", { filters: { owner: { Northwind: "all" }, gaps: true } });
    expect(await s.run("ahead.filters")).toEqual({ filters: expect.objectContaining({ owner: { Northwind: "all" }, gaps: true }) });
    expect(await s.fail("ahead.set_filters", { filters: { owner: { Northwind: "everyone" } } })).toMatchObject({ status: 400 });
  });
});

describe("AH-2: Show the whole project", () => {
  it("is remembered with my filters and asks the read for the whole project; staging can reach any item of the project", async () => {
    const s = setup({ lead: true });
    await load(s);
    expect(s.reads.at(-1)?.whole).toBeUndefined();
    await s.run("ahead.set_filters", { filters: { whole: true } });
    await expect(s.run<{ filters: { whole?: boolean } }>("ahead.filters")).resolves.toMatchObject({ filters: { whole: true } });
    await load(s);
    expect(s.reads.at(-1)?.whole).toBe(true);
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 120, field: "target", value: "2026-12-11" });
    expect(s.reads.at(-1)?.whole).toBe(true);
    await expect(s.fail("ahead.set_filters", { filters: { whole: "yes" } })).resolves.toMatchObject({ status: 400 });
  });
});

describe("BH-1: ahead.stage_bulk and Backlog's reads", () => {
  it("push by 2 weeks stages one change per item I may change; the rest are skipped with a reason", async () => {
    const s = setup();
    s.setItem(120, { target: "2026-12-01" });
    const r = await s.run<{ staged: unknown[]; skipped: { itemId: number; reason: string }[] }>("ahead.stage_bulk", { items: [110, 120, 111, 999].map((itemId) => ({ clientKey: "Northwind", itemId })), op: { kind: "push", weeks: 2 } });
    expect(r.staged).toEqual([{ clientKey: "Northwind", itemId: 110 }]);
    expect(r.skipped).toEqual([
      { clientKey: "Northwind", itemId: 120, reason: "Only Northwind Foods's leads and the owner can change this." },
      { clientKey: "Northwind", itemId: 111, reason: "Only Northwind Foods's leads and the owner can change this." },
      { clientKey: "Northwind", itemId: 999, reason: "#999 isn't in Northwind Foods's DevOps items here" },
    ]);
    expect(await s.plan.aheadChanges()).toEqual([expect.objectContaining({ itemId: 110, field: "target", value: "2026-12-18", baseValue: "2026-12-04", half: "PM" })]);
    // Pushing again goes on from my pending date; the base stays what DevOps had.
    await s.run("ahead.stage_bulk", { items: [{ clientKey: "Northwind", itemId: 110 }], op: { kind: "push", weeks: 4 } });
    expect(await s.plan.aheadChanges()).toEqual([expect.objectContaining({ itemId: 110, value: "2027-01-15", baseValue: "2026-12-04" })]);
  });
  it("a lead: set a target where there's none, a chosen date, assign to me; a story's type has no target date here", async () => {
    const s = setup({ lead: true });
    const set = await s.run<{ staged: { itemId: number }[]; skipped: { itemId: number; reason: string }[] }>("ahead.stage_bulk", { items: [110, 120, 111].map((itemId) => ({ clientKey: "Northwind", itemId })), op: { kind: "set_missing", date: "2027-02-05" } });
    expect(set.staged.map((x) => x.itemId)).toEqual([120]);
    expect(set.skipped.map((x) => [x.itemId, x.reason])).toEqual([[110, "Already has a target date (Dec 4)"], [111, "User Story has no target date in Portal's process"]]);
    const me = await s.run<{ staged: { itemId: number }[]; skipped: { itemId: number; reason: string }[] }>("ahead.stage_bulk", { items: [100, 120].map((itemId) => ({ clientKey: "Northwind", itemId })), op: { kind: "assign_me" } });
    expect([me.staged.map((x) => x.itemId), me.skipped.map((x) => x.reason)]).toEqual([[120], ["Already yours"]]);
    expect((await s.plan.aheadChanges()).find((x) => x.field === "assignee")).toMatchObject({ itemId: 120, value: { email: ME } });
    await s.run("ahead.stage_bulk", { items: [{ clientKey: "Northwind", itemId: 110 }], op: { kind: "move", date: "2027-03-05" } });
    expect((await s.plan.aheadChanges()).find((x) => x.itemId === 110)).toMatchObject({ value: "2027-03-05" });
  });
  it("refuses a bad op or list; ahead.load says the stale weeks and, when asked, the change log's last change", async () => {
    const s = setup();
    for (const op of [{ kind: "push", weeks: 3 }, { kind: "move", date: "2027-02-30" }, { kind: "assign_me", x: 1 }, { kind: "delete" }]) await expect(s.fail("ahead.stage_bulk", { items: [{ clientKey: "Northwind", itemId: 110 }], op })).resolves.toMatchObject({ status: 400 });
    await expect(s.fail("ahead.stage_bulk", { items: [], op: { kind: "assign_me" } })).resolves.toMatchObject({ status: 400 });
    const l = await load(s);
    expect([l.staleWeeks, l.clients[0]!.last]).toEqual([6, undefined]);
  });
});

describe("AH-5: State in the change set, and whom I may assign", () => {
  const STATES = { Feature: [{ name: "New", category: "Proposed", color: "b2b2b2" }, { name: "Active", category: "InProgress", color: "007acc" }, { name: "Closed", category: "Completed", color: "339933" }] };
  it("a state is one of the type's states from the process model (its own spelling); none listed: no state edits", async () => {
    const s = setup({ lead: true });
    expect(await s.fail("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "state", value: "Active" })).toMatchObject({ status: 409, error: expect.stringContaining("A state isn't in") });
    s.edit((c) => ({ ...c, states: STATES }));
    expect((await s.fail("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "state", value: "Doing" })).error).toBe("Doing isn't a state of Feature in Portal's process");
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "state", value: "closed" });
    expect((await load(s)).changes).toEqual([expect.objectContaining({ itemId: 110, field: "state", value: "Closed", baseValue: "Active" })]);
    // Back to what DevOps has: no change.
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 110, field: "state", value: "Active" });
    expect((await load(s)).changes).toEqual([]);
  });

  it("ahead.people lists this client's project only, me first, then people assigned here, then everyone by name, with domains and who's outside", async () => {
    const s = setup({ lead: true, projectOf: (k) => (k === "Northwind" ? [{ email: "zoe.park@northwind.example", name: "Zoe Park" }, { email: "ari.bell@northwind.example", name: "Ari Bell" }, { email: ME, name: "Alex Rivera" }] : [{ email: "other@fabrikam.example", name: "Other Client Person" }]) });
    const r = await s.run<{ people: { email: string; name: string; domain: string; external: boolean; me: boolean; assigned: boolean }[]; problem: string | null }>("ahead.people", { clientKey: "Northwind" });
    expect(r.problem).toBeNull();
    expect(r.people.map((p) => [p.name, p.domain, p.external, p.me, p.assigned])).toEqual([
      ["Alex Rivera", "cooptimize.example", false, true, true],
      ["Dana Reyes", "cooptimize.example", false, false, true],
      ["Ari Bell", "northwind.example", true, false, false],
      ["Zoe Park", "northwind.example", true, false, false],
    ]);
    expect(r.people.some((p) => p.email.includes("fabrikam"))).toBe(false);
    expect(await s.fail("ahead.people", { clientKey: "Northwind", extra: 1 })).toMatchObject({ status: 400 });
  });

  it("anyone on the project can be assigned, nobody else; an unread project falls back with a reason", async () => {
    const s = setup({ lead: true, project: [{ email: "zoe.park@northwind.example", name: "Zoe Park" }] });
    await s.run("ahead.stage", { clientKey: "Northwind", itemId: 120, field: "assignee", value: { email: "zoe.park@northwind.example", name: "Zoe Park" } });
    expect((await load(s)).changes).toEqual([expect.objectContaining({ itemId: 120, field: "assignee", value: { email: "zoe.park@northwind.example", name: "Zoe Park" } })]);
    expect((await s.fail("ahead.stage", { clientKey: "Northwind", itemId: 120, field: "assignee", value: { email: "lee@fabrikam.example", name: "Lee" } })).error).toBe("Only people on Northwind Foods's DevOps project can be assigned here");
    const unread = setup({ lead: true });
    expect((await unread.run<{ problem: string | null }>("ahead.people", { clientKey: "Northwind" })).problem).toMatch(/couldn't be read/);
  });
});

describe("AH-6: the filter check", () => {
  it("keeps the Dates quick pick and the readiness kinds, leaves out a key it doesn't know, refuses a wrong value", () => {
    expect(checkFilters({ range: "next4", kinds: ["unsized", "unsized", "needs_stories"], q: "x" })).toMatchObject({ range: "next4", kinds: ["unsized", "needs_stories"], q: "x" });
    expect(checkFilters({ q: "x", someday: true })).toEqual(checkFilters({ q: "x" }));
    expect(checkFilters({ range: "soon" })).toBeNull();
    expect(checkFilters({ kinds: ["late"] })).toBeNull();
  });
});

describe("AH-7: Readiness's skips and progress, kept on the server", () => {
  it("Skip and Unskip are kept in my plan store, so another device (a new session on the same store) has them", async () => {
    const s = setup();
    await expect(s.run("ahead.skip", { clientKey: "Northwind", itemId: 120 })).resolves.toEqual({ skips: { "Northwind:120": "2026-11-02" } });
    await expect(s.plan.getState(SKIPS_KEY)).resolves.toEqual({ "Northwind:120": "2026-11-02" });
    expect((await load(s)).skips).toEqual({ "Northwind:120": "2026-11-02" });
    await expect(s.run("ahead.unskip", { clientKey: "Northwind", itemId: 120 })).resolves.toEqual({ skips: {} });
    expect((await load(s)).skips).toEqual({});
    await s.fail("ahead.skip", { clientKey: "Northwind" });
    await s.fail("ahead.skip", { clientKey: "Northwind", itemId: -1, extra: 1 });
  });
  it("a skip lasts 2 weeks: one from Oct 19 is gone on Nov 2, one from Oct 20 still on", async () => {
    const s = setup();
    await s.plan.setState(SKIPS_KEY, { "Northwind:110": "2026-10-19", "Northwind:120": "2026-10-20", junk: 3 });
    expect((await load(s)).skips).toEqual({ "Northwind:120": "2026-10-20" });
    // The next skip writes back only what's still on.
    await s.run("ahead.skip", { clientKey: "Northwind", itemId: 111 });
    await expect(s.plan.getState(SKIPS_KEY)).resolves.toEqual({ "Northwind:120": "2026-10-20", "Northwind:111": "2026-11-02" });
  });
  it("fixed this week counts the pieces saved since Monday in my zone", async () => {
    const s = setup();
    await s.plan.setState(FIXED_KEY, [
      { k: "Northwind:110", g: "no_dates", at: "2026-11-02T06:00:00Z" }, // Mon 1:00 AM in New York: this week
      { k: "Northwind:111", g: "unsized", at: "2026-11-02T04:00:00Z" }, // Sun 11:00 PM in New York: last week
      { k: "Northwind:120", g: "unassigned", at: "2026-11-02T13:00:00Z" },
    ]);
    expect((await load(s)).fixedWeek).toBe(2);
  });
});

describe("ED-2: a title and a parent in the change set, by ED-1's rules", () => {
  const K = "Northwind";
  // An epic with two features; stories under the first; a closed feature; a second epic.
  function world(o: Parameters<typeof setup>[0] = { lead: true }) {
    const s = setup(o);
    const story = (id: number, parentId: number, more: Partial<AheadClient["items"][number]> = {}) => anAheadItem({ id, type: "User Story", level: "child", rung: 2, parentId, title: `Story ${id}`, ...more });
    s.edit((c) => ({
      ...c,
      states: { "User Story": [{ name: "New", category: "Proposed", color: null }, { name: "Active", category: "InProgress", color: null }, { name: "Closed", category: "Completed", color: null }], Feature: [{ name: "New", category: "Proposed", color: null }, { name: "Active", category: "InProgress", color: null }, { name: "Done", category: "Completed", color: null }] },
      items: [
        anAheadItem({ id: 100, type: "Epic", level: "top", rung: 0, title: "Platform", assignee: { name: "Alex Rivera", email: ME } }),
        anAheadItem({ id: 110, parentId: 100, title: "Import", assignee: { name: "Alex Rivera", email: ME } }),
        anAheadItem({ id: 120, parentId: 100, title: "Export", assignee: DANA }),
        anAheadItem({ id: 130, parentId: 100, title: "Old feature", state: "Done", stateCategory: "Completed" }),
        story(111, 110, { assignee: DANA }),
        story(112, 110, { assignee: { name: "Alex Rivera", email: ME } }),
        story(113, 120, { assignee: DANA }),
      ],
    }));
    return s;
  }
  const changes = async (s: S) => (await s.plan.aheadChanges()).map((c) => ({ itemId: c.itemId, field: c.field, value: c.value, baseValue: c.baseValue }));

  it("a rename is staged trimmed with the title it started from, and goes when typed back; nothing is written", async () => {
    const s = world();
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: "  Import   column mapping " });
    expect(await changes(s)).toEqual([{ itemId: 111, field: "title", value: "Import column mapping", baseValue: "Story 111" }]);
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: "Story 111" });
    expect(await changes(s)).toEqual([]);
  });
  it("an empty or too-long title is refused; someone without the right can't start one", async () => {
    const s = world();
    expect(await s.fail("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: "   " })).toMatchObject({ status: 400, error: "Type a title" });
    expect((await s.fail("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: "x".repeat(256) })).error).toMatch(/at most 255 characters/);
    expect(await s.fail("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: 7 })).toMatchObject({ status: 400 });
    const other = world({});
    expect(await other.fail("ahead.stage", { clientKey: K, itemId: 113, field: "title", value: "Not mine" })).toMatchObject({ status: 403, error: "Only Northwind Foods's leads and the owner can change this." });
    expect(await other.fail("ahead.stage", { clientKey: K, itemId: 113, field: "parent", value: { id: 110 } })).toMatchObject({ status: 403 });
    expect(await changes(other)).toEqual([]);
  });
  it("a move is staged with the parent's own title read here, and No parent is allowed", async () => {
    const s = world();
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "parent", value: { id: 120, title: "whatever the page said" } });
    expect(await changes(s)).toEqual([{ itemId: 111, field: "parent", value: { id: 120, title: "Export" }, baseValue: { id: 110, title: "Import" } }]);
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "parent", value: null });
    expect((await changes(s))[0]).toMatchObject({ value: null, baseValue: { id: 110, title: "Import" } });
    // Back under where DevOps has it: no change.
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "parent", value: { id: 110 } });
    expect(await changes(s)).toEqual([]);
  });
  it("forced through the action: itself, a wrong level (which is every loop), a closed parent, an id from anywhere else and the top level are refused", async () => {
    const s = world();
    const no = async (itemId: number, id: number) => (await s.fail("ahead.stage", { clientKey: K, itemId, field: "parent", value: { id } })).error;
    expect(await no(110, 110)).toMatch(/doesn't go under a Feature|own parent/);
    expect(await no(111, 100)).toMatch(/User Story doesn't go under an Epic in Portal's process$/);
    // A feature under its own story would be a loop: the level rule refuses it.
    expect(await no(110, 111)).toMatch(/^A Feature doesn't go under an? User Story in Portal's process$/);
    expect(await no(111, 113)).toMatch(/User Story doesn't go under an? User Story in Portal's process$/);
    expect(await no(111, 130)).toBe("#130 is Done; FocusTime moves items only under open parents");
    // Another client's item id (or any id not among this client's items) is simply not found.
    expect(await no(111, 4242)).toBe("#4242 isn't in Northwind Foods's DevOps items here");
    expect(await no(100, 110)).toMatch(/no level above it/);
    expect(await s.fail("ahead.stage", { clientKey: K, itemId: 111, field: "parent", value: { id: "120" } })).toMatchObject({ status: 400 });
    expect(await s.fail("ahead.stage", { clientKey: "Adatum", itemId: 111, field: "parent", value: { id: 120 } })).toMatchObject({ status: 404 });
    expect(await changes(s)).toEqual([]);
  });
  it("a story card edit while changes are staged loses none: another field changed leaves them ready; the same field is a conflict; the same value lands", async () => {
    const s = world();
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "title", value: "Mine" });
    await s.run("ahead.stage", { clientKey: K, itemId: 111, field: "parent", value: { id: 120 } });
    await s.run("ahead.stage", { clientKey: K, itemId: 112, field: "title", value: "Also mine" });
    // The card saved a description on 111 (a new revision, same title and parent) and a new title on 112.
    s.setItem(111, { rev: 9 });
    s.setItem(112, { rev: 4, title: "The card's title" });
    let l = await load(s);
    expect(l.changes.filter((c) => c.itemId === 111).map((c) => [c.field, c.theirs]).sort()).toEqual([["parent", undefined], ["title", undefined]]);
    expect(l.changes.find((c) => c.itemId === 112)).toMatchObject({ value: "Also mine", theirs: "The card's title" });
    // Keep mine: the change stays, now based on what DevOps has.
    await s.run("ahead.resolve", { clientKey: K, itemId: 112, keep: "mine" });
    l = await load(s);
    expect(l.changes.find((c) => c.itemId === 112)).toMatchObject({ value: "Also mine", baseValue: "The card's title" });
    expect(l.changes.find((c) => c.itemId === 112)!.theirs).toBeUndefined();
    // The card moved 111 under the same parent I staged: that change landed, the rename is still mine.
    s.setItem(111, { rev: 10, parentId: 120 });
    l = await load(s);
    expect(l.changes.filter((c) => c.itemId === 111).map((c) => c.field)).toEqual(["title"]);
  });

  describe("bulk", () => {
    const items = (...ids: number[]) => ids.map((itemId) => ({ clientKey: K, itemId }));
    type Bulk = { staged: { itemId: number }[]; skipped: { itemId: number; reason: string }[] };
    it("Assign to… stages for the rows it fits and skips the rest with the reason; only this client's people", async () => {
      const s = world();
      const r = await s.run<Bulk>("ahead.stage_bulk", { items: items(111, 112, 113), op: { kind: "assign", email: DANA.email, name: "Dana Reyes" } });
      expect(r.staged.map((x) => x.itemId)).toEqual([112]);
      expect(r.skipped).toEqual([{ clientKey: K, itemId: 111, reason: "Already assigned to Dana Reyes" }, { clientKey: K, itemId: 113, reason: "Already assigned to Dana Reyes" }]);
      const out = await s.run<Bulk>("ahead.stage_bulk", { items: items(112), op: { kind: "assign", email: "someone@elsewhere.example", name: "Someone" } });
      expect(out.skipped[0]!.reason).toBe("Only people on Northwind Foods's DevOps project can be assigned here");
      const none = await s.run<Bulk>("ahead.stage_bulk", { items: items(111), op: { kind: "assign", email: null, name: "" } });
      expect(none.staged.length).toBe(1);
      expect((await changes(s)).find((c) => c.itemId === 111)).toMatchObject({ field: "assignee", value: null });
    });
    it("State… stages only a state the row's own type has, in the process's spelling", async () => {
      const s = world();
      const r = await s.run<Bulk>("ahead.stage_bulk", { items: items(110, 111, 112), op: { kind: "state", state: "closed" } });
      expect(r.staged.map((x) => x.itemId)).toEqual([111, 112]);
      expect(r.skipped).toEqual([{ clientKey: K, itemId: 110, reason: "closed isn't a state of Feature in Portal's process" }]);
      expect((await changes(s)).map((c) => c.value)).toEqual(["Closed", "Closed"]);
      const again = await s.run<Bulk>("ahead.stage_bulk", { items: items(111), op: { kind: "state", state: "Closed" } });
      expect(again.skipped[0]!.reason).toBe("Already Closed");
    });
    it("Size… skips a type with no size field", async () => {
      const s = world();
      const r = await s.run<Bulk>("ahead.stage_bulk", { items: items(110, 111), op: { kind: "size", value: 3 } });
      expect(r.staged.map((x) => x.itemId)).toEqual([111]);
      expect(r.skipped[0]).toMatchObject({ itemId: 110, reason: "Feature has no size in Portal's process" });
    });
    it("Move to… stages the move for the rows that can go there; a row already there, a wrong level and a row I can't change are skipped", async () => {
      const s = world({});
      const r = await s.run<Bulk>("ahead.stage_bulk", { items: items(111, 112, 113, 110), op: { kind: "parent", parentId: 120 } });
      expect(r.staged.map((x) => x.itemId)).toEqual([111, 112]);
      expect(r.skipped).toEqual([
        { clientKey: K, itemId: 113, reason: "Only Northwind Foods's leads and the owner can change this." },
        { clientKey: K, itemId: 110, reason: "A Feature doesn't go under a Feature in Portal's process" },
      ]);
      expect((await changes(s)).every((c) => c.field === "parent" && (c.value as { id: number }).id === 120 && (c.value as { title: string }).title === "Export")).toBe(true);
      const lead = world();
      const there = await lead.run<Bulk>("ahead.stage_bulk", { items: items(113), op: { kind: "parent", parentId: 120 } });
      expect(there.skipped[0]!.reason).toBe("Already under it");
      const far = await lead.run<Bulk>("ahead.stage_bulk", { items: items(111), op: { kind: "parent", parentId: 4242 } });
      expect(far.skipped[0]!.reason).toBe("#4242 isn't in Northwind Foods's DevOps items here");
    });
    it("a malformed new action is refused whole", async () => {
      const s = world();
      for (const op of [{ kind: "state" }, { kind: "size", value: "big" }, { kind: "parent", parentId: "120" }, { kind: "assign", email: "not an address", name: "x" }, { kind: "parent", parentId: 120, order: 1 }]) expect((await s.fail("ahead.stage_bulk", { items: items(111), op })).status).toBe(400);
    });
  });
});
