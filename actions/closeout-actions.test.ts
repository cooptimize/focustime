import { createSnapshotStore } from "../host/local/snapshots.ts";
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
const item = (over: Partial<WorkItem> = {}): WorkItem => ({ id: 101, title: "Export report", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: "2026-11-01T12:00:00Z", url: "https://dev.azure.com/contoso/P/_workitems/edit/101", tags: [], blocked: false, ...over });
const adatum = (items: WorkItem[], watched: WorkItem[] = []): ClientWork => ({ clientKey: "Adatum", clientName: "Adatum", status: "ok", fetchedAt: "x", fromCache: false, items, children: [], watched });

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
    orgOf: () => "contoso",
    last: (k: string) => last.find((w) => w.clientKey === k) ?? null,
  } as unknown as DevOpsSource;
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} }),
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
  const add = (p: Partial<NewPick> = {}) => plan.addPick({ date: MON, half: "PM", clientKey: "Adatum", kind: "intention", title: "Review the mapping", size: "M", ...p });
  return { run, fail, plan, add, watches, setDevOps: (w: ClientWork[]) => void (next = w), at: (t: string) => void (clock = t) };
}

describe("follow-ups through week.load (step 7)", () => {
  it("a done pick whose item is still open opens 'Update DevOps'; a later fetch of the item by id closes it", async () => {
    const t = setup();
    const p = t.add({ kind: "item", itemId: 101, title: "Export report" });
    t.plan.commit(MON);
    t.plan.setDone(p.id, true);
    t.setDevOps([adatum([item()])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openFollowUps().map((l) => [l.kind, l.who, l.what, l.itemId])).toEqual([["devops_update", "Adatum", "Update DevOps #101: Export report", 101]]);
    expect((await t.run<WeekLoadData>("week.load", { weekStart: MON })).openFollowUps).toBe(1);
    // The next load asks DevOps for #101 by id; it is now Closed.
    t.at("2026-11-02T23:00:00Z");
    t.setDevOps([adatum([], [item({ state: "Closed", stateCategory: "Completed", changedAt: "2026-11-02T22:30:00Z" })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.watches.at(-1)).toEqual({ Adatum: [101] });
    expect(t.plan.openFollowUps()).toEqual([]);
    expect(t.plan.allFollowUps()[0]).toMatchObject({ closedBy: "signal", closeNote: "DevOps #101 is Closed" });
  });

  it("a blocked item assigned to me opens 'Nudge on blocker'; unblocked, it closes", async () => {
    const t = setup();
    t.setDevOps([adatum([item({ id: 202, title: "Waiting on API keys", tags: ["Blocked"], blocked: true })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openFollowUps().map((l) => l.what)).toEqual(["Nudge on blocker for #202: Waiting on API keys"]);
    t.setDevOps([adatum([item({ id: 202, title: "Waiting on API keys" })])]);
    await t.run("week.load", { weekStart: MON });
    expect(t.plan.openFollowUps()).toEqual([]);
  });
});

describe("Close out (step 7)", () => {
  it("carries over to the next plannable day, moves to a chosen slot, and the slip opens a heads-up follow-up with a draft", async () => {
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
    expect(st.worked).toEqual([{ clientKey: "Adatum", clientName: "Adatum" }]);

    await t.run("pick.move", { id: a.id, date: st.carryTo, half: "PM" });
    await t.run("pick.move", { id: b.id, date: "2026-11-04", half: "AM" });
    st = await t.run<CloseOutState>("closeout.load", { date: MON });
    expect(st.movedTo[a.id]).toEqual({ date: "2026-11-03", half: "PM" });
    const slip = st.followUps.find((l) => l.kind === "slip")!;
    expect(slip).toMatchObject({ who: "Adatum", what: "Heads-up to Adatum about the slip (2 items)", isNew: true });
    expect(slip.draft).toContain("- #101 Export report: moving to Tue, Nov 3 (afternoon)");
    expect(slip.draft).toContain("- Review the mapping: moving to Wed, Nov 4 (morning)");
    // Mark as told closes it by hand.
    await t.run("followup.close", { id: slip.id, note: "Posted in Teams" });
    expect(t.plan.allFollowUps().find((l) => l.id === slip.id)).toMatchObject({ closedBy: "me", closeNote: "Posted in Teams" });

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
    expect(t.plan.openFollowUps().filter((l) => l.kind === "slip")).toEqual([]);
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
    expect(t.plan.openFollowUps().map((l) => l.kind)).toContain("slip");
    expect((await t.fail("pick.make_up", { id: p.id, when: "tonight" })).status).toBe(409);
    expect((await t.fail("pick.make_up", { id: 999, when: "tonight" })).status).toBe(404);
    expect((await t.fail("pick.make_up", { id: q.id, when: "someday" })).status).toBe(400);
    expect((await t.fail("borrow.pay", { id: r.borrowed.id })).status).toBe(409);
  });
});

describe("resume notes (step 7)", () => {
  it("one line per client and day; the latest wins and shows in Plan the day and the week; history is kept", async () => {
    const t = setup("2026-11-02T22:15:00Z");
    await t.run("note.set", { clientKey: "Adatum", date: "2026-10-29", note: "Started the export" });
    await t.run("note.set", { clientKey: "Adatum", date: MON, note: "Mapping half done" });
    await t.run("note.set", { clientKey: "Adatum", date: MON, note: "Mapping half done, next: lookups" });
    t.at("2026-11-03T14:00:00Z");
    const pd = await t.run<{ resumeNotes: Record<string, { note: string; date: string }> }>("planday.start", { date: "2026-11-03" });
    expect(pd.resumeNotes.Adatum).toEqual({ clientKey: "Adatum", date: MON, note: "Mapping half done, next: lookups" });
    const w = await t.run<WeekLoadData>("week.load", { weekStart: MON });
    expect(w.resumeNotes.Adatum?.note).toBe("Mapping half done, next: lookups");
    expect(t.plan.noteHistory("Adatum").map((n) => n.date)).toEqual([MON, "2026-10-29"]);
    // Planning an earlier day shows the note that was latest then.
    expect(t.plan.latestNotes("2026-10-30").Adatum?.note).toBe("Started the export");
    // An empty note removes that day's; the earlier one is latest again.
    await t.run("note.set", { clientKey: "Adatum", date: MON, note: "" });
    expect(t.plan.latestNotes().Adatum?.note).toBe("Started the export");
    expect((await t.fail("note.set", { clientKey: "Adatum", date: "2026-11-09", note: "x" })).status).toBe(422);
    expect((await t.fail("note.set", { clientKey: "Adatum", date: MON, note: "x".repeat(201) })).status).toBe(400);
  });
});

describe("follow-ups (step 7, step 13.5)", () => {
  it("adds one with an optional who and client; lists overdue and due soon first", async () => {
    const t = setup();
    await t.run("followup.add", { who: "Dana at Adatum", what: "Send the mapping notes", due: "2026-11-04", clientKey: "Adatum", channel: "teams" });
    t.at("2026-11-02T16:00:00Z");
    await t.run("followup.add", { what: "Answer the pump question" });
    await t.run("followup.add", { what: "Late one", due: "2026-10-30" });
    const { followUps } = await t.run<{ followUps: { who: string; hasWho: boolean; what: string; due: string | null; kind: string; byHand: boolean; channel: string | null; dueState: { text: string } | null }[] }>("followups.list", {});
    expect(followUps.map((l) => [l.what, l.dueState?.text ?? null])).toEqual([
      ["Late one", "Overdue 3 days"],
      ["Send the mapping notes", "Due Wed, Nov 4"],
      ["Answer the pump question", null],
    ]);
    expect(followUps[1]).toMatchObject({ who: "Dana at Adatum", kind: "manual", byHand: true, channel: "teams" });
    expect(followUps[2]).toMatchObject({ hasWho: false });
    expect((await t.fail("followup.add", { what: "" })).status).toBe(400);
    expect((await t.fail("followup.add", { what: "y", due: "soon" })).status).toBe(400);
    expect((await t.fail("followup.add", { what: "y", channel: "fax" })).status).toBe(400);
  });

  it("links a DevOps item by id on add and edit; a new client clears it (step 15.2)", async () => {
    const t = setup();
    const a = (await t.run<{ followUp: { id: number; itemId: number | null } }>("followup.add", { what: "Send the spec", clientKey: "Adatum", itemId: 101 })).followUp;
    expect(a.itemId).toBe(101);
    expect((await t.run<{ followUp: { itemId: number | null } }>("followup.edit", { id: a.id, itemId: null })).followUp.itemId).toBeNull();
    expect((await t.run<{ followUp: { itemId: number | null } }>("followup.edit", { id: a.id, itemId: 102 })).followUp.itemId).toBe(102);
    expect((await t.run<{ followUp: { itemId: number | null } }>("followup.edit", { id: a.id, clientKey: "T&W" })).followUp.itemId).toBeNull();
    expect((await t.fail("followup.add", { what: "y", itemId: "abc" })).status).toBe(400);
    expect((await t.fail("followup.add", { what: "y", itemId: 5 })).status).toBe(400); // no client to own the item
  });

  it("Close the loop records how and a note; Not needed closes quietly and isn't counted done", async () => {
    const t = setup();
    const a = (await t.run<{ followUp: { id: number } }>("followup.add", { what: "Send notes" })).followUp;
    const b = (await t.run<{ followUp: { id: number } }>("followup.add", { what: "Ask about pumps" })).followUp;
    expect((await t.run<{ followUp: unknown }>("followup.close", { id: a.id, how: "email", note: "Sent" })).followUp).toMatchObject({ outcome: "done", closeHow: "email", closeNote: "Sent", closedBy: "me", dueState: null });
    expect((await t.run<{ followUp: unknown }>("followup.not_needed", { id: b.id })).followUp).toMatchObject({ outcome: "not_needed", closeHow: null });
    expect((await t.fail("followup.close", { id: b.id, how: "pigeon" })).status).toBe(400);
    expect((await t.run<{ followUps: unknown[] }>("followups.list", {})).followUps).toEqual([]);
    const all = (await t.run<{ followUps: { what: string; outcome: string }[] }>("followups.list", { includeClosed: true })).followUps;
    expect(all.map((l) => l.outcome).sort()).toEqual(["done", "not_needed"]);
  });

  it("Snooze hides one until the chosen day; it must be after today", async () => {
    const t = setup(); // Mon Nov 2
    const a = (await t.run<{ followUp: { id: number } }>("followup.add", { what: "Check back" })).followUp;
    expect((await t.fail("followup.snooze", { id: a.id, until: "2026-11-02" })).status).toBe(400);
    await t.run("followup.snooze", { id: a.id, until: "2026-11-04" });
    expect(await t.run("followups.list", {})).toMatchObject({ followUps: [], snoozed: 1 });
    expect((await t.run<{ followUps: { snoozedUntil: string }[] }>("followups.list", { includeSnoozed: true })).followUps[0]).toMatchObject({ snoozedUntil: "2026-11-04" });
    t.at("2026-11-04T15:00:00Z");
    expect((await t.run<{ followUps: unknown[] }>("followups.list", {})).followUps).toHaveLength(1);
  });

  it("Delete is only for ones I added; FocusTime's own say to use Not needed", async () => {
    const t = setup();
    const a = (await t.run<{ followUp: { id: number } }>("followup.add", { what: "Mine" })).followUp;
    const rule = t.plan.openRuleFollowUp({ kind: "slip", ruleKey: "slip:x", clientKey: "Adatum", who: "Adatum", what: "Heads-up to Adatum" })!;
    await t.run("followup.delete", { id: a.id });
    const r = await t.fail("followup.delete", { id: rule.id });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/Not needed/);
    expect((await t.run<{ followUps: { id: number }[] }>("followups.list", {})).followUps.map((l) => l.id)).toEqual([rule.id]);
  });

  it("Edit changes client, who, what, channel and due", async () => {
    const t = setup();
    const a = (await t.run<{ followUp: { id: number } }>("followup.add", { what: "Send notes" })).followUp;
    expect((await t.run<{ followUp: unknown }>("followup.edit", { id: a.id, clientKey: "Adatum", who: "Dana", channel: "call", due: "2026-11-03" })).followUp).toMatchObject({ clientKey: "Adatum", who: "Dana", channel: "call", due: "2026-11-03", what: "Send notes", dueState: { text: "Due tomorrow" } });
  });
});
