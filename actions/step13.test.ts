// Step 13: calendar editing tiers, two-way sync (with conflicts), Q69 rebuild, and the collaboration finder's invite.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { fakeGraph, FAKE_WRITE_TOKEN } from "../sources/graph/test-fakes.ts";
import { createGraphWriter } from "../sources/graph/write.ts";
import { createScheduleReader } from "../sources/graph/schedule.ts";
import type { WriteAccess } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearPreviews } from "./timebox-actions.ts";
import { clearSyncMemo, syncWeek } from "./outlook-sync.ts";
import { eventEdit } from "../plan/caltier.ts";
import type { CandidatesData, SuggestData, WriteLogView, WritePreview, WriteResult } from "./types.ts";

const NOW = "2026-11-06T15:00:00Z"; // Fri Nov 6, 9:00 Chicago
const WEEK = "2026-11-09";
const D = "2026-11-10"; // Tue
const ME_ID = "00000000-0000-4000-8000-000000000001";
const toml = STARTER_TOML
  .replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"')
  .replace('my_email = ""', 'my_email = "avery@cooptimize.example"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${ME_ID}"`)
  .replace(/time_zone = "[^"]*"/, 'time_zone = "America/Chicago"');

function setup() {
  clearPreviews();
  clearSyncMemo();
  const g = fakeGraph({ owner: "avery@cooptimize.example" });
  const logs: LogRecord[] = [];
  const log = (r: LogRecord) => void logs.push(r);
  const access: WriteAccess = { status: "write" };
  const writer = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log });
  const schedule = createScheduleReader({ fetch: g.fetch, token: async () => "FAKE-READ-TOKEN", invalidate: () => {}, log });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/Chicago") });
  const parsed = parseConfig(toml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const team = [
    { id: ME_ID, name: "Avery", email: "avery@cooptimize.example" },
    { id: "00000000-0000-4000-8000-0000000000a1", name: "Ana", email: "ana@cooptimize.example" },
    { id: "00000000-0000-4000-8000-0000000000b2", name: "Ben", email: "ben@cooptimize.example" },
  ];
  const dv = {
    myClients: async () => [{ clientKey: "T&W", clientName: "T&W", devops: true, devopsEmail: null }],
    teammates: async () => ({ ok: true as const, people: team }),
    clientTeam: async () => ({ ok: true as const, accountId: "x", patterns: [{ userId: team[1]!.id, startDate: "2026-01-01", endDate: null, days: { Tue: "AM" as const } }], workers: [team[2]!.id] }),
    teamPto: async () => ({ ok: true as const, away: [{ userId: team[2]!.id, date: "2026-11-11" }] }),
    pto: async () => ({ source: "pto", status: "ok", fetchedAt: null, fromCache: false, items: [] }),
  };
  const outlookSource = { id: "outlook", load: async () => ({ source: "outlook", status: "ok", fetchedAt: null, fromCache: false, items: [] }), connect: async () => ({ status: "connected" }), disconnect: async () => {}, write: { access: async () => access, writer }, schedule };
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed }),
    makeDataverse: () => dv as never,
    makeOutlook: () => outlookSource as never,
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
  const confirm = (p: WritePreview) => run<WriteResult>("write.confirm", { previewId: p.previewId });
  const sync = () => syncWeek({ plan, ow: { access: async () => access, writer }, cfg: parsed.config, weekStart: WEEK, refresh: true, now: () => NOW, clients: [{ key: "T&W", name: "T&W" }] });
  const box = async (s = "09:00", e = "10:30") => {
    const r = await run<{ timebox: { id: number; uid: string } }>("timebox.add", { date: D, start: `${D}T${s}:00-06:00`, end: `${D}T${e}:00-06:00`, clientKey: "T&W", title: "#4512 Import mapping", url: "https://dev.azure.com/tw/p/_workitems/edit/4512", outlook: true });
    const p = (await run<{ preview: WritePreview }>("write.preview", { uid: r.timebox.uid })).preview;
    expect((await confirm(p)).confirmed).toBe(true);
    return r.timebox;
  };
  return { g, plan, run, fail, confirm, sync, box, logs };
}

describe("editing tier: my own events with nobody else on them", () => {
  it("moves and changes show as after a preview, sends only time and show as, reads back, never marks it, and undoes", async () => {
    const t = setup();
    const id = t.g.seed({ subject: "Dentist (mine)", body: "private notes", start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", showAs: "busy" });
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { event: { id, start: `${D}T15:30:00-06:00`, end: `${D}T16:30:00-06:00`, showAs: "tentative" } })).preview;
    expect(p).toMatchObject({ kind: "event", op: "update", summary: "Change your own Outlook event", attendees: [] });
    expect(p.visibility).toMatch(/nobody is notified.*title and body stay.*isn't marked/);
    expect(p.fields.map((f) => f.label)).toEqual(["Title", "When", "Show as"]);
    expect(t.g.calls.some((c) => c.method === "PATCH")).toBe(false);
    const r = await t.confirm(p);
    expect(r).toMatchObject({ confirmed: true, entry: { kind: "event", status: "confirmed" } });
    const patch = t.g.calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["end", "showAs", "start"]);
    const ev = t.g.events.get(id)!;
    expect(ev).toMatchObject({ subject: "Dentist (mine)", body: "private notes", marker: null, showAs: "tentative", start: "2026-11-10T21:30:00Z" });
    // Undo puts it back, again through preview and confirm.
    const u = (await t.run<{ preview: WritePreview }>("write.preview", { undo: r.entry.id })).preview;
    expect((await t.confirm(u)).confirmed).toBe(true);
    expect(t.g.events.get(id)).toMatchObject({ start: "2026-11-10T20:00:00Z", showAs: "busy", marker: null });
  });

  it("refuses meetings with others, events organized by someone else, repeating and all-day ones, and FocusTime's own (nothing sent)", async () => {
    const t = setup();
    const meeting = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", attendees: [{ address: "ana@cooptimize.example", name: "Ana" }] });
    const theirs = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", isOrganizer: false });
    const series = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", type: "occurrence" });
    const allDay = t.g.seed({ start: "2026-11-10T00:00:00Z", end: "2026-11-11T00:00:00Z", isAllDay: true });
    for (const [id, why] of [[meeting, /Others are on this meeting/], [theirs, /Others are on this meeting/], [series, /repeating/], [allDay, /all-day/]] as const) {
      const r = await t.fail("write.preview", { event: { id, start: `${D}T15:30:00-06:00`, end: `${D}T16:30:00-06:00` } });
      expect([r.status, r.error]).toEqual([409, expect.stringMatching(why)]);
    }
    const tb = await t.box();
    const mine = (await t.plan.ownEvent(tb.uid))!.eventId;
    expect((await t.fail("write.preview", { event: { id: mine, start: `${D}T15:30:00-06:00`, end: `${D}T16:30:00-06:00` } })).error).toMatch(/FocusTime's: change its timebox/);
    expect(t.g.calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });
});

describe("editing tier: FocusTime events (the event and its timebox are one thing)", () => {
  it("retitles and changes show as through the timebox; the preview shows both", async () => {
    const t = setup();
    const tb = await t.box();
    const r = await t.run<{ sync: string }>("timebox.update", { id: tb.id, title: "Import mapping, part 2", showAs: "tentative" });
    expect(r.sync).toBe("update");
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: tb.uid })).preview;
    expect(p.fields.find((f) => f.label === "Title")).toMatchObject({ before: "T&W: #4512 Import mapping", after: "T&W: Import mapping, part 2", changed: true });
    expect(p.fields.find((f) => f.label === "Show as")).toMatchObject({ before: "Busy", after: "Tentative", changed: true });
    expect((await t.confirm(p)).confirmed).toBe(true);
    expect(t.g.events.get((await t.plan.ownEvent(tb.uid))!.eventId)).toMatchObject({ subject: "T&W: Import mapping, part 2", showAs: "tentative" });
    expect((await t.fail("timebox.update", { id: tb.id, showAs: "invisible" })).error).toMatch(/showAs/);
  });
});

describe("two-way sync for FocusTime events", () => {
  it("follows a move made in Outlook, notes it, and logs it as from Outlook (not undoable from the log)", async () => {
    const t = setup();
    const tb = await t.box();
    const ev = t.g.events.get((await t.plan.ownEvent(tb.uid))!.eventId)!;
    ev.start = "2026-11-10T19:00:00Z"; // 1:00 PM Chicago
    ev.end = "2026-11-10T20:00:00Z";
    ev.subject = "T&W: Import mapping (moved)";
    const r = await t.sync();
    expect(r.changed).toBe(1);
    const now = (await t.plan.timebox(tb.id))!;
    expect(now).toMatchObject({ start: `${D}T13:00:00-06:00`, end: `${D}T14:00:00-06:00`, title: "Import mapping (moved)", outlookNote: "Changed in Outlook: time, title", conflict: null });
    // In step: no write is needed, nothing was written.
    expect((await t.run<{ nothing?: true }>("write.preview", { uid: tb.uid })).nothing).toBe(true);
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.entries[0]).toMatchObject({ kind: "sync", status: "confirmed", message: expect.stringMatching(/^From Outlook: time, title changed/), undoable: false });
    expect((await t.fail("write.preview", { undo: log.entries[0]!.id })).error).toMatch(/isn't undone from here/);
  });

  it("deleted in Outlook: keeps the timebox, turns Put on Outlook off, never re-creates it; Keep or Remove (step 13.5)", async () => {
    const t = setup();
    const tb = await t.box();
    t.g.events.delete((await t.plan.ownEvent(tb.uid))!.eventId);
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    await t.sync();
    expect((await t.plan.timebox(tb.id))).toMatchObject({ removedAt: null, outlook: false, outlookNote: "Removed in Outlook", conflict: null });
    expect((await t.plan.ownEvent(tb.uid))!.deletedAt).not.toBeNull();
    await t.sync();
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
    // Keep: the note goes, the timebox stays local.
    await t.run("timebox.resolve", { id: tb.id, keep: "local" });
    expect((await t.plan.timebox(tb.id))).toMatchObject({ removedAt: null, outlook: false, outlookNote: null });
    // Remove (on another one): the timebox goes, nothing is written.
    const tb2 = await t.box("13:00", "14:00");
    t.g.events.delete((await t.plan.ownEvent(tb2.uid))!.eventId);
    await t.sync();
    await t.run("timebox.resolve", { id: tb2.id, keep: "remove" });
    expect((await t.plan.timebox(tb2.id))!.removedAt).not.toBeNull();
    expect((await t.fail("timebox.resolve", { id: tb.id, keep: "local" })).status).toBe(409);
  });

  it("removing or changing a timebox whose event is already gone is done, logged as already gone, never an error (step 13.5)", async () => {
    const t = setup();
    // Gone before the preview: a remove has nothing to do.
    const a = await t.box();
    t.g.events.delete((await t.plan.ownEvent(a.uid))!.eventId);
    await t.run("timebox.remove", { id: a.id });
    expect(await t.run("write.preview", { uid: a.uid })).toEqual({ nothing: true, alreadyGone: true });
    // Gone before the preview of a change: kept here with Put on Outlook off, never re-created.
    const b = await t.box("11:00", "12:00");
    t.g.events.delete((await t.plan.ownEvent(b.uid))!.eventId);
    await t.run("timebox.update", { id: b.id, start: `${D}T11:30:00-06:00`, end: `${D}T12:30:00-06:00` });
    expect(await t.run("write.preview", { uid: b.uid })).toEqual({ nothing: true, alreadyGone: true });
    expect((await t.plan.timebox(b.id))).toMatchObject({ outlook: false, outlookNote: "Removed in Outlook", removedAt: null });
    // Gone between preview and confirm (a 404): confirmed as already gone.
    const c = await t.box("13:00", "14:00");
    await t.run("timebox.remove", { id: c.id });
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: c.uid })).preview;
    t.g.events.delete((await t.plan.ownEvent(c.uid))!.eventId);
    expect(await t.confirm(p)).toMatchObject({ confirmed: true, message: "Already gone from Outlook; nothing to remove" });
    const log = (await t.plan.writeLog(20)).map((e) => e.message);
    expect(log.filter((m) => m?.startsWith("Already gone from Outlook"))).toHaveLength(3);
    expect(t.g.events.size).toBe(0);
  });

  it("both changed: keeps both, writes nothing, blocks the push until I choose; Use Outlook's or Keep FocusTime's", async () => {
    const t = setup();
    const tb = await t.box();
    const id = (await t.plan.ownEvent(tb.uid))!.eventId;
    await t.run("timebox.update", { id: tb.id, start: `${D}T10:00:00-06:00`, end: `${D}T11:00:00-06:00` });
    t.g.events.get(id)!.subject = "T&W: renamed in Outlook";
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    const r = await t.sync();
    expect(r.conflicts).toBe(1);
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
    const c = (await t.plan.timebox(tb.id))!;
    expect(c).toMatchObject({ start: `${D}T10:00:00-06:00`, conflict: { changed: ["title"], outlook: { subject: "T&W: renamed in Outlook" } } });
    expect(t.g.events.get(id)!.subject).toBe("T&W: renamed in Outlook");
    expect((await t.fail("write.preview", { uid: tb.uid })).error).toMatch(/choose which version/);
    // A second sync doesn't log the same conflict again.
    const before = (await t.run<WriteLogView>("write.log", {})).entries.length;
    await t.sync();
    expect((await t.run<WriteLogView>("write.log", {})).entries.length).toBe(before);

    // Keep FocusTime's: the push is offered (preview shows Outlook's title as "Now").
    const k = await t.run<{ sync: string; timebox: { conflict: unknown } }>("timebox.resolve", { id: tb.id, keep: "focustime" });
    expect(k).toMatchObject({ sync: "update", timebox: { conflict: null } });
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: tb.uid })).preview;
    expect(p.fields.find((f) => f.label === "Title")).toMatchObject({ before: "T&W: renamed in Outlook", after: "T&W: #4512 Import mapping" });
  });

  it("Use Outlook's: the timebox takes Outlook's version, nothing is written", async () => {
    const t = setup();
    const tb = await t.box();
    const id = (await t.plan.ownEvent(tb.uid))!.eventId;
    await t.run("timebox.update", { id: tb.id, start: `${D}T10:00:00-06:00`, end: `${D}T11:00:00-06:00` });
    Object.assign(t.g.events.get(id)!, { start: "2026-11-10T21:00:00Z", end: "2026-11-10T22:00:00Z" });
    await t.sync();
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    const r = await t.run<{ sync: string | null; timebox: { start: string; conflict: unknown } }>("timebox.resolve", { id: tb.id, keep: "outlook" });
    expect(r).toMatchObject({ sync: null, timebox: { start: `${D}T15:00:00-06:00`, conflict: null } });
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
  });
});

describe("D470: a FocusTime-marked event this person has no record of (made by an earlier FocusTime)", () => {
  it("is an ordinary event: nothing recorded or rebuilt, Open in Outlook only, and sync never changes or deletes it", async () => {
    const t = setup();
    const uid = "tb-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";
    const id = t.g.seed({ subject: "T&W: #4512 Import mapping", start: "2026-11-10T15:00:00Z", end: "2026-11-10T16:00:00Z", marker: uid, isReminderOn: false });
    const writes = () => t.g.calls.filter((c) => c.method !== "GET").length;
    const before = writes();
    const r = await t.sync();
    expect(r.earlier).toBe(1);
    expect(await t.plan.ownEvent(uid)).toBeNull();
    expect(await t.plan.timeboxByUid(uid)).toBeNull();
    const facts = r.facts[`outlook:${id}`]!;
    expect(facts).toMatchObject({ marker: uid, earlier: true });
    const edit = eventEdit({ source: "outlook", allDay: false }, facts, true);
    expect(edit.tier).toBe("earlier");
    expect(edit.actions.filter((a) => a.allowed).map((a) => a.id)).toEqual(["open"]);
    // Twice more, as a refresh would: still nothing written to Outlook, nothing recorded, the event as it was.
    await t.sync();
    expect(writes()).toBe(before);
    expect(t.g.events.get(id)).toMatchObject({ subject: "T&W: #4512 Import mapping", start: "2026-11-10T15:00:00Z", end: "2026-11-10T16:00:00Z" });
    expect(await t.plan.ownEvents()).toEqual([]);
  });
  it("an earlier help invite can't be cancelled from here", async () => {
    const t = setup();
    const uid = "inv-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2c";
    const id = t.g.seed({ subject: "T&W: help on #4512", start: "2026-11-10T15:00:00Z", end: "2026-11-10T16:00:00Z", marker: uid, isReminderOn: false });
    const facts = (await t.sync()).facts[`outlook:${id}`]!;
    expect(eventEdit({ source: "outlook", allDay: false }, facts, true).tier).toBe("earlier");
  });
});

describe("the collaboration finder", () => {
  const body = (view: string) => ({
    value: ["ana@cooptimize.example", "ben@cooptimize.example"].map((id) => ({
      scheduleId: id, availabilityView: view,
      scheduleItems: [{ status: "busy", subject: "SECRET-SUBJECT pay review", location: "SECRET-ROOM", isPrivate: false, start: { dateTime: "2026-11-10T15:00:00", timeZone: "UTC" }, end: { dateTime: "2026-11-10T16:00:00", timeZone: "UTC" } }],
      workingHours: { daysOfWeek: ["monday", "tuesday", "wednesday", "thursday"], startTime: "08:00:00.0000000", endTime: "17:00:00.0000000", timeZone: { name: "Central Standard Time" } },
    })),
  });

  it("ranks candidates in tiers, Cooptimize staff only, PTO as away", async () => {
    const t = setup();
    const c = await t.run<CandidatesData>("collab.candidates", { clientKey: "T&W", from: "2026-11-10", to: "2026-11-11" });
    expect(c.candidates.map((x) => [x.name, x.tier, x.away])).toEqual([["Ana", 1, []], ["Ben", 2, ["2026-11-11"]]]);
    expect(JSON.stringify(c)).not.toMatch(/0000000000a1/); // no user ids out
    expect((await t.fail("collab.candidates", { clientKey: "Adatum" })).status).toBe(403);
  });

  it("suggests slots from free/busy without keeping or logging any event details", async () => {
    const t = setup();
    t.g.sw.schedule = body("0".repeat(500));
    const s = await t.run<SuggestData>("collab.suggest", { clientKey: "T&W", from: "2026-11-10", to: "2026-11-10", minutes: 30 });
    expect(s.slots.length).toBeGreaterThan(0);
    expect(s.slots[0]).toMatchObject({ date: "2026-11-10", tier: 1, people: [{ name: "Ana" }] });
    const sched = t.g.calls.find((c) => c.path.includes("getSchedule"))!;
    expect(sched.auth).toBe("Bearer FAKE-READ-TOKEN");
    expect(JSON.stringify(s)).not.toMatch(/SECRET/);
    expect(JSON.stringify(t.logs)).not.toMatch(/SECRET|FAKE-READ-TOKEN|FAKE-WRITE/);
    expect(JSON.stringify((await t.plan.exportJson()))).not.toMatch(/SECRET/);
    expect((await t.fail("collab.suggest", { clientKey: "T&W", minutes: 30, people: ["pat@client.example"] })).status).toBe(422);
  });

  it("previews an invite naming every attendee, sends it only on confirm, reads it back, tracks it and opens a follow-up", async () => {
    const t = setup();
    const r = await t.run<{ preview: WritePreview }>("collab.preview_invite", { clientKey: "T&W", title: "#4512 Import mapping", itemId: 4512, url: "https://dev.azure.com/tw/p/_workitems/edit/4512", start: `${D}T13:00:00-06:00`, end: `${D}T13:30:00-06:00`, people: ["ana@cooptimize.example", "ben@cooptimize.example"], note: "Stuck on the lookup" });
    const p = r.preview;
    expect(p).toMatchObject({ kind: "invite", op: "create", summary: "Send a help invite", attendees: [{ name: "Ana", email: "ana@cooptimize.example" }, { name: "Ben", email: "ben@cooptimize.example" }] });
    expect(p.visibility).toMatch(/Ana, Ben will each receive an invite by email from you/);
    expect(p.fields.find((f) => f.label === "Attendees")!.after).toBe("Ana <ana@cooptimize.example>, Ben <ben@cooptimize.example>");
    expect(p.fields.find((f) => f.label === "Teams meeting")!.after).toBe("Yes");
    expect(p.fields.find((f) => f.label === "Title")!.after).toBe("T&W: help on #4512 Import mapping");
    expect(p.fields.find((f) => f.label === "Body")!.after).toMatch(/_workitems\/edit\/4512\n\nStuck on the lookup/);
    expect(t.g.calls.some((c) => c.method === "POST" && c.path === "/v1.0/me/events")).toBe(false);
    const done = await t.confirm(p);
    expect(done).toMatchObject({ confirmed: true, message: "Invite sent to Ana, Ben", entry: { kind: "invite" } });
    const post = t.g.calls.find((c) => c.method === "POST" && c.path === "/v1.0/me/events")!.body as Record<string, unknown>;
    expect(post).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", attendees: [{ emailAddress: { address: "ana@cooptimize.example", name: "Ana" }, type: "required" }, { emailAddress: { address: "ben@cooptimize.example" } }] });
    const inv = (await t.plan.invitesFrom("2026-11-01"))[0]!;
    expect(inv).toMatchObject({ status: "sent", itemId: 4512, clientKey: "T&W", eventId: done.entry.eventId });
    const followUp = (await t.plan.getFollowUp(inv.followUpId!))!;
    expect(followUp).toMatchObject({ kind: "help", what: "Help session with Ana and Ben on #4512 Import mapping", closedAt: null });
    // The follow-up closes once the meeting is over.
    expect((await t.plan.closeHelpFollowUps(Temporal.Instant.from("2026-11-10T19:29:00Z")))).toBe(0);
    expect((await t.plan.closeHelpFollowUps(Temporal.Instant.from("2026-11-10T19:31:00Z")))).toBe(1);
  });

  it("limits attendee domains at preview and in the writer", async () => {
    const t = setup();
    const r = await t.fail("collab.preview_invite", { clientKey: "T&W", title: "x", start: `${D}T13:00:00-06:00`, end: `${D}T13:30:00-06:00`, people: ["pat@tw-client.example"] });
    expect([r.status, r.error]).toEqual([422, "Invites go only to Cooptimize addresses"]);
    const w = createGraphWriter({ fetch: t.g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log: () => {} });
    await expect(w.createInvite({ subject: "s", body: "", start: "2026-11-10T19:00:00Z", end: "2026-11-10T19:30:00Z", showAs: "busy", reminder: false, attendees: [{ name: "P", email: "pat@evil.example" }] }, "inv-x", "t", ["cooptimize.example"])).rejects.toThrow(/Cooptimize addresses/);
    expect(t.g.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a test invite to myself only, then undo cancels it after a preview that says attendees get a cancellation", async () => {
    const t = setup();
    const p = (await t.run<{ preview: WritePreview }>("collab.preview_invite", { clientKey: "T&W", title: "Invite path check", start: `${D}T13:00:00-06:00`, end: `${D}T13:15:00-06:00`, people: ["avery@cooptimize.example"], teams: false })).preview;
    expect(p.attendees).toEqual([{ name: "You", email: "avery@cooptimize.example" }]);
    const done = await t.confirm(p);
    expect(done.confirmed).toBe(true);
    const log = await t.run<WriteLogView>("write.log", {});
    expect(log.entries[0]).toMatchObject({ kind: "invite", undoable: true });
    const u = (await t.run<{ preview: WritePreview }>("write.preview", { undo: done.entry.id })).preview;
    expect(u).toMatchObject({ op: "delete", summary: "Cancel the help invite" });
    expect(u.visibility).toMatch(/Only you are on it: you get the cancellation email/);
    const c = await t.confirm(u);
    expect(c).toMatchObject({ confirmed: true, message: expect.stringMatching(/cancelled/) });
    expect(t.g.calls.some((x) => x.method === "POST" && x.path.endsWith("/cancel"))).toBe(true);
    expect(t.g.calls.some((x) => x.method === "DELETE")).toBe(false);
    const inv = (await t.plan.invitesFrom("2026-11-01"))[0]!;
    expect(inv.status).toBe("cancelled");
    expect((await t.plan.getFollowUp(inv.followUpId!))!.closedAt).not.toBeNull();
    // A cancelled invite isn't sent again by another undo.
    expect((await t.run<WriteLogView>("write.log", {})).entries.every((e) => !e.undoable)).toBe(true);
  });
});
