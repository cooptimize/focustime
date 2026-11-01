import { describe, expect, it, beforeEach } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { WriteEntry } from "../plan/timebox.ts";
import { fakeGraph, FAKE_WRITE_TOKEN } from "../sources/graph/test-fakes.ts";
import { createGraphWriter, MARKER_PROP } from "../sources/graph/write.ts";
import type { WriteAccess } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearPreviews } from "./timebox-actions.ts";
import type { WriteLogView, WritePreview, WriteResult, WriteState } from "./types.ts";

const NOW = "2026-11-02T14:00:00Z"; // Mon 9:00 New York
const D = "2026-11-03";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');

function setup(opts: { access?: WriteAccess["status"]; toml?: string } = {}) {
  clearPreviews();
  const g = fakeGraph();
  let access: WriteAccess = opts.access && opts.access !== "write" ? { status: opts.access, message: "no" } as WriteAccess : { status: "write" };
  const writer = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log: () => {} });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(opts.toml ?? base) }),
    makeDataverse: () => { throw new Error("n/a"); },
    makeOutlook: () => ({ id: "outlook", load: async () => { throw new Error("n/a"); }, connect: async () => ({ status: "connected" }), disconnect: async () => {}, write: { access: async () => access, writer } }) as never,
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: () => NOW,
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
  const box = (over: Record<string, unknown> = {}) =>
    run<{ timebox: { id: number; uid: string }; sync: string | null }>("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:30:00-05:00`, clientKey: "CSC", title: "#4512 Import mapping", url: "https://dev.azure.com/csc/p/_workitems/edit/4512", outlook: true, ...over });
  const preview = (input: Record<string, unknown>) => run<{ preview?: WritePreview; nothing?: true }>("write.preview", input);
  const confirm = (p: WritePreview) => run<WriteResult>("write.confirm", { previewId: p.previewId });
  const put = async (uid: string) => confirm((await preview({ uid })).preview!);
  return { g, plan, run, fail, box, preview, confirm, put, setAccess: (a: WriteAccess) => void (access = a) };
}

describe("timeboxes (local)", () => {
  it("validates times and takes a pick's client, title and link from the pick", async () => {
    const t = setup();
    const p = t.plan.addPick({ date: D, half: "AM", clientKey: "CSC", kind: "item", itemId: 4512, title: "Import mapping", itemType: "User Story", itemUrl: "https://dev.azure.com/csc/p/_workitems/edit/4512", size: "M" });
    const r = await t.run<{ timebox: { clientKey: string; title: string; url: string; outlook: boolean } }>("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:00:00-05:00`, pickId: p.id });
    expect(r.timebox).toMatchObject({ clientKey: "CSC", title: "Import mapping", url: p.itemUrl, outlook: false });
    expect((await t.fail("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T09:05:00-05:00`, pickId: p.id })).error).toMatch(/at least 15/);
    expect((await t.fail("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:00:00-05:00`, pickId: p.id, title: "x" })).error).toMatch(/from the pick/);
    expect((await t.fail("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:00:00-05:00`, clientKey: "CSC", title: "x", url: "https://evil.example/" })).error).toMatch(/DevOps link/);
  });

  it("Put on Outlook follows Settings by default", async () => {
    const off = setup();
    expect((await off.box({ outlook: undefined })).timebox).toMatchObject({ outlook: false });
    const on = setup({ toml: `${base}\n[timebox]\noutlook_default = true\n` });
    expect((await on.box({ outlook: undefined })).timebox).toMatchObject({ outlook: true });
  });

  it("works with no write permission: stored, moved and removed locally; the toggle explains how to enable", async () => {
    const t = setup({ access: "read_only" });
    const { timebox, sync } = await t.box();
    expect(sync).toBe("create");
    await t.run("timebox.update", { id: timebox.id, start: `${D}T10:00:00-05:00`, end: `${D}T11:00:00-05:00` });
    const st = await t.run<WriteState>("write.status", {});
    expect(st.access).toBe("read_only");
    expect(st.message).toMatch(/Reconnect Outlook in Settings > Connections/);
    const r = await t.fail("write.preview", { uid: timebox.uid });
    expect([r.status, r.error]).toEqual([409, expect.stringMatching(/Reconnect Outlook in Settings > Connections.*still work locally/)]);
    expect(t.g.calls).toEqual([]);
    expect(await t.run("timebox.remove", { id: timebox.id })).toMatchObject({ timebox: null });
  });
});

describe("write framework: preview", () => {
  it("shows target system, account, calendar, exact fields and who can see it; writes nothing", async () => {
    const t = setup();
    const { timebox } = await t.box();
    const { preview } = await t.preview({ uid: timebox.uid });
    expect(preview).toMatchObject({ op: "create", system: "Outlook", account: "tanner@cooptimize.example", calendar: "Calendar", summary: "Create an Outlook event", auto: false });
    expect(preview!.fields.map((f) => [f.label, f.after])).toEqual([
      ["Title", "CSC: #4512 Import mapping"],
      ["When", "Tue, Nov 3, 9:00 AM to 10:30 AM"],
      ["Show as", "Busy"],
      ["Reminder", "None"],
      ["Attendees", "None"],
      ["Body", "https://dev.azure.com/csc/p/_workitems/edit/4512\n\nTimebox planned in Coopilot."],
    ]);
    expect(preview!.visibility).toMatch(/nobody is invited/);
    expect(t.g.events.size).toBe(0);
    expect(t.plan.writeLog()).toEqual([]);
  });

  it("an update preview shows before and after and marks what changes", async () => {
    const t = setup();
    const { timebox } = await t.box();
    await t.put(timebox.uid);
    await t.run("timebox.update", { id: timebox.id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    const { preview } = await t.preview({ uid: timebox.uid });
    const when = preview!.fields.find((f) => f.label === "When")!;
    expect(when).toEqual({ label: "When", before: "Tue, Nov 3, 9:00 AM to 10:30 AM", after: "Tue, Nov 3, 1:00 PM to 2:00 PM", changed: true });
    expect(preview!.fields.find((f) => f.label === "Title")!.changed).toBe(false);
  });

  it("a confirm needs a live preview, once; a timebox changed after the preview needs a new one", async () => {
    const t = setup();
    const { timebox } = await t.box();
    const { preview } = await t.preview({ uid: timebox.uid });
    await t.run("timebox.update", { id: timebox.id, start: `${D}T09:30:00-05:00` });
    expect((await t.fail("write.confirm", { previewId: preview!.previewId })).error).toMatch(/changed since the preview/);
    expect((await t.fail("write.confirm", { previewId: preview!.previewId })).status).toBe(410);
    expect((await t.fail("write.confirm", { previewId: "made-up" })).status).toBe(410);
    expect(t.g.events.size).toBe(0);
  });
});

describe("write framework: write, read back, log", () => {
  it("creates the marked event, reads it back, and logs it confirmed", async () => {
    const t = setup();
    const { timebox } = await t.box();
    const r = await t.put(timebox.uid);
    expect(r).toMatchObject({ confirmed: true, message: "On Outlook" });
    const [ev] = [...t.g.events.values()];
    expect(ev).toMatchObject({ subject: "CSC: #4512 Import mapping", showAs: "busy", isReminderOn: false, marker: timebox.uid });
    expect(t.g.calls.filter((c) => c.method === "POST")[0]!.body).toMatchObject({ attendees: [], singleValueExtendedProperties: [{ id: MARKER_PROP, value: timebox.uid }] });
    // Read back after writing.
    const posted = t.g.calls.findIndex((c) => c.method === "POST");
    expect(t.g.calls.slice(posted + 1).some((c) => c.method === "GET" && c.path.includes(`me/events/${ev!.id}`))).toBe(true);
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.entries).toMatchObject([{ op: "create", uid: timebox.uid, eventId: ev!.id, status: "confirmed", account: "tanner@cooptimize.example", calendar: "Calendar", before: null, undoable: true }]);
    expect((await t.run<{ sync: string | null }>("timebox.set_outlook", { id: timebox.id, on: true })).sync).toBeNull();
  });

  it("says so when it can't confirm, and Retry fixes it without a duplicate", async () => {
    const t = setup();
    const { timebox } = await t.box();
    await t.put(timebox.uid);
    await t.run("timebox.update", { id: timebox.id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    t.g.sw.ignorePatch = true;
    const r = await t.put(timebox.uid);
    expect(r.confirmed).toBe(false);
    expect(r.entry.status).toBe("unconfirmed");
    expect(r.message).toMatch(/didn't show the change yet \(start, end\)/);
    t.g.sw.ignorePatch = false;
    const again = await t.run<WriteResult>("write.retry", { id: r.entry.id });
    expect(again).toMatchObject({ confirmed: true, entry: { attempts: 2, status: "confirmed" } });
    expect(t.g.events.size).toBe(1);
  });

  it("idempotent retry: a create whose answer was lost is found by its marker, not made twice", async () => {
    const t = setup();
    const { timebox } = await t.box();
    t.g.sw.loseCreateResponse = true;
    const r = await t.put(timebox.uid);
    expect(r).toMatchObject({ confirmed: false, entry: { status: "unconfirmed" } });
    expect(r.message).toMatch(/won't make a duplicate/);
    const again = await t.run<WriteResult>("write.retry", { id: r.entry.id });
    expect(again.confirmed).toBe(true);
    expect(t.g.events.size).toBe(1);
    expect(t.g.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("refuses to touch an event without the Coopilot marker", async () => {
    const t = setup();
    const { timebox } = await t.box();
    await t.put(timebox.uid);
    // Someone swaps the recorded event for one Coopilot didn't create (or the record is wrong).
    const foreign = t.g.seed({ start: "2026-11-03T14:00:00Z", end: "2026-11-03T15:00:00Z" });
    const own = t.plan.ownEvent(timebox.uid)!;
    t.plan.recordOwnEvent(timebox.uid, timebox.id, foreign, own.fields);
    const before = structuredClone(t.g.events.get(foreign));
    await t.run("timebox.set_outlook", { id: timebox.id, on: false });
    const r = await t.fail("write.preview", { uid: timebox.uid });
    expect(r.error).toMatch(/wasn't created by Coopilot/);
    expect(t.g.events.get(foreign)).toEqual(before);
    expect(t.g.calls.some((c) => (c.method === "PATCH" || c.method === "DELETE") && c.path.includes(foreign))).toBe(false);
  });

  it("an Outlook error is logged as failed with nothing claimed; 403 points at Reconnect", async () => {
    const t = setup();
    const { timebox } = await t.box();
    const { preview } = await t.preview({ uid: timebox.uid });
    t.g.sw.failNext = { method: "POST", status: 403 };
    const r = await t.confirm(preview!);
    expect(r).toMatchObject({ confirmed: false, entry: { status: "failed" } });
    expect(r.message).toMatch(/Reconnect Outlook/);
    expect(JSON.stringify(t.plan.writeLog())).not.toContain(FAKE_WRITE_TOKEN);
  });
});

describe("write framework: undo", () => {
  let t: ReturnType<typeof setup>;
  let uid: string;
  let id: number;
  beforeEach(async () => {
    t = setup();
    ({ uid, id } = (await t.box()).timebox);
    await t.put(uid);
  });
  const latest = async () => (await t.run<WriteLogView>("write.log", {})).entries[0]! as WriteEntry & { undoable: boolean };

  it("undo of a create deletes the event Coopilot created and turns Put on Outlook off", async () => {
    const e = await latest();
    const { preview } = await t.preview({ undo: e.id });
    expect(preview).toMatchObject({ op: "delete", undo: true, summary: "Undo: delete an outlook event coopilot created" });
    expect((await t.confirm(preview!)).confirmed).toBe(true);
    expect(t.g.events.size).toBe(0);
    expect(t.plan.timebox(id)).toMatchObject({ outlook: false, removedAt: null });
    const log = (await t.run<WriteLogView>("write.log", {})).entries;
    expect(log.map((x) => [x.op, x.status, x.undoOf, x.undoneBy])).toEqual([["delete", "confirmed", e.id, null], ["create", "confirmed", null, log[0]!.id]]);
  });

  it("undo of a move puts the prior times back on Outlook and on the timebox", async () => {
    await t.run("timebox.update", { id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    await t.put(uid);
    const e = await latest();
    expect(e.before).toMatchObject({ start: "2026-11-03T14:00:00Z", end: "2026-11-03T15:30:00Z" });
    await t.confirm((await t.preview({ undo: e.id })).preview!);
    expect([...t.g.events.values()][0]).toMatchObject({ start: "2026-11-03T14:00:00Z", end: "2026-11-03T15:30:00Z" });
    expect(t.plan.timebox(id)).toMatchObject({ start: `${D}T09:00:00-05:00`, end: `${D}T10:30:00-05:00` });
    expect((await t.preview({ uid })).nothing).toBe(true);
  });

  it("undo of a removal recreates the event (same marker) and brings the timebox back", async () => {
    await t.run("timebox.remove", { id });
    await t.put(uid);
    expect(t.g.events.size).toBe(0);
    await t.confirm((await t.preview({ undo: (await latest()).id })).preview!);
    expect([...t.g.events.values()]).toMatchObject([{ marker: uid, subject: "CSC: #4512 Import mapping" }]);
    expect(t.plan.timebox(id)).toMatchObject({ removedAt: null, outlook: true });
  });

  it("undo is a stack: undo the move, then the create, and the calendar is as before", async () => {
    await t.run("timebox.update", { id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    await t.put(uid);
    await t.confirm((await t.preview({ undo: (await latest()).id })).preview!);
    const log = (await t.run<WriteLogView>("write.log", {})).entries;
    const create = log.find((e) => e.op === "create" && e.undoOf === null)!;
    expect(log.filter((e) => e.undoable).map((e) => e.id)).toEqual([create.id]);
    await t.confirm((await t.preview({ undo: create.id })).preview!);
    expect(t.g.events.size).toBe(0);
    expect((await t.run<WriteLogView>("write.log", {})).entries.some((e) => e.undoable)).toBe(false);
  });

  it("only the latest change not undone can be undone", async () => {
    const first = await latest();
    await t.run("timebox.update", { id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    await t.put(uid);
    expect((await t.fail("write.preview", { undo: first.id })).error).toMatch(/latest change/);
  });
});

describe("don't ask again for my own timeboxes (confirm_own = false)", () => {
  it("updates and deletes are flagged auto; creating still asks", async () => {
    const t = setup({ toml: `${base}\n[timebox]\nconfirm_own = false\n` });
    const { timebox } = await t.box();
    expect((await t.preview({ uid: timebox.uid })).preview!.auto).toBe(false);
    await t.put(timebox.uid);
    await t.run("timebox.update", { id: timebox.id, start: `${D}T13:00:00-05:00`, end: `${D}T14:00:00-05:00` });
    const { preview } = await t.preview({ uid: timebox.uid });
    expect(preview!.auto).toBe(true);
    const r = await t.confirm(preview!);
    expect(r.entry).toMatchObject({ auto: true, status: "confirmed" });
    expect((await t.run<WriteLogView>("write.log", {})).entries[0]!.undoable).toBe(true);
  });
});

describe("reset leaves Coopilot's events findable", () => {
  it("an event whose timebox is gone is listed for removal and can be removed", async () => {
    const t = setup();
    const { timebox } = await t.box();
    await t.put(timebox.uid);
    t.plan.reset();
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.orphans).toMatchObject([{ uid: timebox.uid, title: "CSC: #4512 Import mapping" }]);
    const { preview } = await t.preview({ uid: timebox.uid });
    expect(preview!.op).toBe("delete");
    await t.confirm(preview!);
    expect(t.g.events.size).toBe(0);
  });
});

describe("de-duplication in the week view", () => {
  it("week.load drops Coopilot's own Outlook events (by recorded id) and returns the timebox instead", async () => {
    const t = setup();
    const { timebox } = await t.box();
    await t.put(timebox.uid);
    const eventId = t.plan.ownEvent(timebox.uid)!.eventId;
    const ev = (id: string, subject: string) => ({ id: `outlook:${id}`, source: "outlook", title: subject, start: "2026-11-03T09:00:00-05:00", end: "2026-11-03T10:30:00-05:00", allDay: false, showAs: "busy", responseStatus: "organizer", kind: "meeting", isCancelled: false });
    const outlook = { source: "outlook", status: "ok", fetchedAt: "x", fromCache: false, items: [ev(eventId, "CSC: #4512 Import mapping"), ev("OTHER", "Standup")] };
    const ctx: ActionContext = {
      loadConfig: async () => ({ path: "/x", parsed: parseConfig(base) }),
      makeDataverse: () => ({ resolveUserId: async () => ({ ok: false, message: "n/a" }) }) as never,
      makeOutlook: () => ({ load: async () => outlook }) as never,
      makeGoogle: () => { throw new Error("n/a"); },
      makeDevOps: () => { throw new Error("n/a"); },
      saveSystemUserId: async () => {},
      now: () => NOW,
      plan: t.plan,
    };
    const r = await dispatch(ctx, { action: "week.load", input: { weekStart: "2026-11-02" } });
    if (!r.ok) throw new Error(r.error);
    const data = r.data as { week: { days: { date: string; am: { events: { id: string }[] } }[] }; timeboxes: { uid: string; onOutlook: boolean; sync: string | null }[] };
    const tue = data.week.days.find((d) => d.date === D)!;
    const ids = JSON.stringify(data.week).match(/outlook:[A-Z0-9]+/g) ?? [];
    expect(ids).not.toContain(`outlook:${eventId}`);
    expect(ids).toContain("outlook:OTHER");
    expect(tue).toBeTruthy();
    expect(data.timeboxes).toMatchObject([{ uid: timebox.uid, onOutlook: true, sync: null }]);
  });
});

describe("focus timer from a timebox", () => {
  it("starts on the timebox's pick, default length its duration", async () => {
    const t = setup();
    const p = t.plan.addPick({ date: D, half: "AM", clientKey: "CSC", kind: "item", itemId: 4512, title: "Import mapping", itemType: "User Story", itemUrl: "https://dev.azure.com/csc/p/_workitems/edit/4512", size: "S" });
    const { timebox } = await t.run<{ timebox: { id: number } }>("timebox.add", { date: D, start: `${D}T09:00:00-05:00`, end: `${D}T10:30:00-05:00`, pickId: p.id });
    const r = await t.run<{ timer: { pickId: number | null; plannedMinutes: number } }>("timer.start", { timeboxId: timebox.id });
    expect(r.timer).toMatchObject({ pickId: p.id, plannedMinutes: 90 });
    const plain = await t.box({ outlook: false });
    const r2 = await t.run<{ timer: { pickId: number | null; label: string; plannedMinutes: number } }>("timer.start", { timeboxId: plain.timebox.id, minutes: 25 });
    expect(r2.timer).toMatchObject({ pickId: null, label: "#4512 Import mapping", plannedMinutes: 25 });
  });
});
