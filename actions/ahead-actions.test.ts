// AH-1: Ahead's change set on the server (D656 to D659): who may stage what, values checked against the process,
// assignees limited to the client's Cooptimizers, pending changes surviving a reload, reconciling against DevOps
// (landed changes leave, a field changed in DevOps is a conflict, other changes don't count), Keep mine and Take
// theirs, Discard all with a confirm, the old local drags moved in once, and filters remembered per person.
import { beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { anAheadClient, anAheadItem, anAssignee } from "../test/builders/index.ts";
import { aheadAction, type AheadContext } from "./ahead-actions.ts";
import type { AheadClient, AheadLoad } from "./types.ts";

const NOW = "2026-11-02T14:00:00Z";
const ME = "you@cooptimize.example";
const DANA = anAssignee("Dana Reyes");

function setup(o: { lead?: boolean; automation?: boolean } = {}) {
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
    devops: () => ({ aheadItems: async (_refs, opts) => (reads.push(opts ?? {}), [client]) }),
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
  return { plan, run, fail, setItem, reads };
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
