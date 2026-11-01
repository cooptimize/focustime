import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import { createPlanStore, type NewPick } from "../store/plan-store.ts";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { CloseOutState, WeekLoadData } from "./types.ts";

const NY = "America/New_York";
const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

const MON = "2026-11-02";
const item = (over: Partial<WorkItem> = {}): WorkItem => ({ id: 101, title: "Export report", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: "2026-11-01T12:00:00Z", url: "https://dev.azure.com/cscsteel/P/_workitems/edit/101", tags: [], blocked: false, ...over });
const csc = (items: WorkItem[], watched: WorkItem[] = []): ClientWork => ({ clientKey: "CSC", clientName: "CSC", status: "ok", fetchedAt: "x", fromCache: false, items, children: [], watched });

function setup(start = "2026-11-02T15:00:00Z") {
  let clock = start;
  const dir = mkdtempSync(join(tmpdir(), "c-close-"));
  const dv = fakeFetch("ok");
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock).toZonedDateTimeISO(NY) });
  // DevOps as a stub: what each load returns is set by the test; every load's watch list is kept.
  let next: ClientWork[] = [];
  let last: ClientWork[] = [];
  const watches: unknown[] = [];
  const devops = {
    load: async (_c: unknown, o?: { watch?: unknown }) => {
      watches.push(o?.watch ?? null);
      last = next;
      return next;
    },
    lookup: (k: string, id: number) => last.find((w) => w.clientKey === k)?.items.find((i) => i.id === id) ?? null,
    orgOf: () => "cscsteel",
    last: (k: string) => last.find((w) => w.clientKey === k) ?? null,
  } as unknown as DevOpsSource;
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, cacheDir: dir, log: () => {} }),
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => devops,
    saveSystemUserId: async () => {},
    now: () => clock,
    plan,
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const fail = async (action: string, input: unknown) => {
    const r = await dispatch(c, { action, input });
    if (r.ok) throw new Error("expected failure");
    return r;
  };
  const add = (p: Partial<NewPick> = {}) => plan.addPick({ date: MON, half: "PM", clientKey: "CSC", kind: "intention", title: "Review the mapping", size: "M", ...p });
  return { run, fail, plan, add, watches, setDevOps: (w: ClientWork[]) => void (next = w), at: (t: string) => void (clock = t) };
}

describe("loops through week.load (step 7)", () => {
  it("a done pick whose item is still open opens 'Update DevOps'; a later fetch of the item by id closes it", async () => {
    const t = setup();
    const p = t.add({ kind: "item", itemId: 101, title: "Export report" });
    t.plan.commit(MON);
    t.plan.setDone(p.id, true);
    t.setDevOps([csc([item()])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openLoops().map((l) => [l.kind, l.who, l.what, l.itemId])).toEqual([["devops_update", "CSC", "Update DevOps #101: Export report", 101]]);
    expect((await t.run<WeekLoadData>("week.load", { weekStart: MON })).openLoops).toBe(1);
    // The next load asks DevOps for #101 by id; it is now Closed.
    t.at("2026-11-02T23:00:00Z");
    t.setDevOps([csc([], [item({ state: "Closed", stateCategory: "Completed", changedAt: "2026-11-02T22:30:00Z" })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.watches.at(-1)).toEqual({ CSC: [101] });
    expect(t.plan.openLoops()).toEqual([]);
    expect(t.plan.allLoops()[0]).toMatchObject({ closedBy: "signal", closeNote: "DevOps #101 is Closed" });
  });

  it("a blocked item assigned to me opens 'Nudge on blocker'; unblocked, it closes", async () => {
    const t = setup();
    t.setDevOps([csc([item({ id: 202, title: "Waiting on API keys", tags: ["Blocked"], blocked: true })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openLoops().map((l) => l.what)).toEqual(["Nudge on blocker for #202: Waiting on API keys"]);
    t.setDevOps([csc([item({ id: 202, title: "Waiting on API keys" })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openLoops()).toEqual([]);
  });
});

describe("Close out (step 7)", () => {
  it("carries over to the next plannable day, moves to a chosen slot, and the slip opens a heads-up loop with a draft", async () => {
    const t = setup("2026-11-02T22:15:00Z"); // Mon 5:15 PM
    const a = t.add({ kind: "item", itemId: 101, title: "Export report" });
    const b = t.add({ title: "Review the mapping", size: "S" });
    const done = t.add({ title: "Standup notes", size: "S" });
    t.plan.commit(MON);
    t.plan.setDone(done.id, true);
    t.plan.addFocus({ pickId: a.id, label: "Export report", startedAt: "x", endedAt: "y", seconds: 45 * 60 });
    let st = await t.run<CloseOutState>("closeout.load", { date: MON });
    expect(st).toMatchObject({ date: MON, today: MON, access: "today", carryTo: "2026-11-03", closedOutAt: null });
    expect(st.focused[a.id]).toBe(2700);
    expect(st.worked).toEqual([{ clientKey: "CSC", clientName: "CSC" }]);

    await t.run("pick.move", { id: a.id, date: st.carryTo, half: "PM" });
    await t.run("pick.move", { id: b.id, date: "2026-11-04", half: "AM" });
    st = await t.run<CloseOutState>("closeout.load", { date: MON });
    expect(st.movedTo[a.id]).toEqual({ date: "2026-11-03", half: "PM" });
    const slip = st.loops.find((l) => l.kind === "slip")!;
    expect(slip).toMatchObject({ who: "CSC", what: "Heads-up to CSC about the slip (2 items)", isNew: true });
    expect(slip.draft).toContain("- #101 Export report: moving to Tue, Nov 3 (afternoon)");
    expect(slip.draft).toContain("- Review the mapping: moving to Wed, Nov 4 (morning)");
    // Mark as told closes it by hand.
    await t.run("loop.close", { id: slip.id, note: "Posted in Teams" });
    expect(t.plan.allLoops().find((l) => l.id === slip.id)).toMatchObject({ closedBy: "me", closeNote: "Posted in Teams" });

    st = await t.run<CloseOutState>("closeout.commit", { date: MON });
    expect(st.closedOutAt).toMatch(/^2026-11-02T17:15/);
    expect((await t.run<WeekLoadData>("week.load", { weekStart: MON })).closeOut).toEqual({ date: MON, done: true });
  });

  it("is for today or an earlier day; a past day carries over to today", async () => {
    const t = setup("2026-11-04T15:00:00Z"); // Wed
    expect((await t.fail("closeout.load", { date: "2026-11-05" })).status).toBe(422);
    const st = await t.run<CloseOutState>("closeout.load", { date: MON });
    expect(st).toMatchObject({ access: "past", carryTo: "2026-11-04", committedAt: null });
    // An unplanned day can still be closed out; nothing blocks.
    expect((await t.run<CloseOutState>("closeout.commit", { date: MON })).closedOutAt).not.toBeNull();
  });
});

describe("borrowed time (step 7)", () => {
  it("'make it up tonight' moves the pick to the evening, records what's owed and offers a flex session; a done payback pick pays it", async () => {
    const t = setup("2026-11-02T22:15:00Z");
    const p = t.add({ title: "Export report", size: "M" });
    t.plan.commit(MON);
    t.plan.addFocus({ pickId: p.id, label: "x", startedAt: "x", endedAt: "y", seconds: 45 * 60 });
    const r = await t.run<{ pick: { id: number; date: string; half: string }; borrowed: { minutes: number; payback: string; paidAt: string | null }; flexOffer: unknown }>("pick.make_up", { id: p.id, when: "tonight" });
    expect(r.pick).toMatchObject({ id: p.id, date: MON, half: "EVE" });
    expect(r.borrowed).toMatchObject({ minutes: 75, payback: "tonight", paidAt: null });
    expect(r.flexOffer).toEqual({ date: MON, start: "20:00", end: "21:15" });
    let w = await t.run<WeekLoadData>("week.load", { weekStart: MON });
    expect(w.borrowed.map((b) => [b.title, b.minutes, b.paidAt])).toEqual([["Export report", 75, null]]);
    // Tonight is the same day: no heads-up is owed.
    expect(t.plan.openLoops().filter((l) => l.kind === "slip")).toEqual([]);
    await t.run("pick.mark_done", { id: p.id, done: true });
    w = await t.run<WeekLoadData>("week.load", { weekStart: MON });
    expect(w.borrowed[0]).toMatchObject({ paidBy: "picks" });
    expect(w.borrowed[0]!.paidAt).not.toBeNull();
  });

  it("Friday or another day moves it there (the slip owes a heads-up); paying by hand works; refusals are plain", async () => {
    const t = setup("2026-11-02T22:15:00Z");
    const p = t.add({ title: "Export report", size: "S" });
    const q = t.add({ title: "Load test", size: "S" });
    t.plan.commit(MON);
    const r = await t.run<{ pick: { id: number; date: string; half: string }; borrowed: { id: number; minutes: number }; flexOffer: unknown }>("pick.make_up", { id: p.id, when: "friday" });
    expect(r.pick).toMatchObject({ date: "2026-11-06", half: "AM" });
    expect(r.borrowed.minutes).toBe(60);
    expect(r.flexOffer).toBeNull();
    const sat = await t.run<{ flexOffer: unknown }>("pick.make_up", { id: q.id, when: "day", date: "2026-11-07", half: "AM", minutes: 45 });
    expect(sat.flexOffer).toEqual({ date: "2026-11-07", start: "10:00", end: "10:45" });
    await t.run("borrow.pay", { id: r.borrowed.id });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: MON });
    expect(w.borrowed.map((b) => [b.title, b.paidBy])).toEqual([["Export report", "me"], ["Load test", null]]);
    expect(t.plan.openLoops().map((l) => l.kind)).toContain("slip");
    expect((await t.fail("pick.make_up", { id: p.id, when: "tonight" })).status).toBe(409);
    expect((await t.fail("pick.make_up", { id: 999, when: "tonight" })).status).toBe(404);
    expect((await t.fail("pick.make_up", { id: q.id, when: "someday" })).status).toBe(400);
    expect((await t.fail("borrow.pay", { id: r.borrowed.id })).status).toBe(409);
  });
});

describe("resume notes (step 7)", () => {
  it("one line per client and day; the latest wins and shows in Plan the day and the week; history is kept", async () => {
    const t = setup("2026-11-02T22:15:00Z");
    await t.run("note.set", { clientKey: "CSC", date: "2026-10-29", note: "Started the export" });
    await t.run("note.set", { clientKey: "CSC", date: MON, note: "Mapping half done" });
    await t.run("note.set", { clientKey: "CSC", date: MON, note: "Mapping half done, next: lookups" });
    t.at("2026-11-03T14:00:00Z");
    const pd = await t.run<{ resumeNotes: Record<string, { note: string; date: string }> }>("planday.start", { date: "2026-11-03" });
    expect(pd.resumeNotes.CSC).toEqual({ clientKey: "CSC", date: MON, note: "Mapping half done, next: lookups" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: MON });
    expect(w.resumeNotes.CSC?.note).toBe("Mapping half done, next: lookups");
    expect(t.plan.noteHistory("CSC").map((n) => n.date)).toEqual([MON, "2026-10-29"]);
    // Planning an earlier day shows the note that was latest then.
    expect(t.plan.latestNotes("2026-10-30").CSC?.note).toBe("Started the export");
    // An empty note removes that day's; the earlier one is latest again.
    await t.run("note.set", { clientKey: "CSC", date: MON, note: "" });
    expect(t.plan.latestNotes().CSC?.note).toBe("Started the export");
    expect((await t.fail("note.set", { clientKey: "CSC", date: "2026-11-09", note: "x" })).status).toBe(422);
    expect((await t.fail("note.set", { clientKey: "CSC", date: MON, note: "x".repeat(201) })).status).toBe(400);
  });
});

describe("Add a loop (step 7)", () => {
  it("takes who, what and an optional due date; it is listed newest first and marked as told by hand", async () => {
    const t = setup();
    await t.run("loop.add", { who: "Dana at CSC", what: "Send the mapping notes", due: "2026-11-04" });
    t.at("2026-11-02T16:00:00Z");
    await t.run("loop.add", { who: "W&C", what: "Answer the pump question" });
    const { loops } = await t.run<{ loops: { who: string; what: string; due: string | null; kind: string; isNew: boolean }[] }>("loops.list", {});
    expect(loops.map((l) => [l.who, l.kind, l.due, l.isNew])).toEqual([
      ["W&C", "manual", null, true],
      ["Dana at CSC", "manual", "2026-11-04", true],
    ]);
    expect((await t.fail("loop.add", { who: "", what: "x" })).status).toBe(400);
    expect((await t.fail("loop.add", { who: "x", what: "y", due: "soon" })).status).toBe(400);
  });
});
