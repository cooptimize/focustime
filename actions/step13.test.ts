// Step 13: calendar editing tiers, two-way sync (with conflicts), Q69 rebuild, and the collaboration finder's invite.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { fakeGraph, FAKE_WRITE_TOKEN } from "../sources/graph/test-fakes.ts";
import { createGraphWriter } from "../sources/graph/write.ts";
import { createScheduleReader } from "../sources/graph/schedule.ts";
import type { WriteAccess } from "../sources/oauth/oauth.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearPreviews } from "./timebox-actions.ts";
import { clearSyncMemo, syncWeek } from "./outlook-sync.ts";
import type { CandidatesData, SuggestData, WriteLogView, WritePreview, WriteResult } from "./types.ts";

const NOW = "2026-11-06T15:00:00Z"; // Fri Nov 6, 9:00 Chicago
const WEEK = "2026-11-09";
const D = "2026-11-10"; // Tue
const ME_ID = "00000000-0000-4000-8000-000000000001";
const toml = STARTER_TOML
  .replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"')
  .replace('my_email = ""', 'my_email = "avery@cooptimize.org"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${ME_ID}"`)
  .replace(/time_zone = "[^"]*"/, 'time_zone = "America/Chicago"');

function setup() {
  clearPreviews();
  clearSyncMemo();
  const g = fakeGraph({ owner: "avery@cooptimize.org" });
  const logs: LogRecord[] = [];
  const log = (r: LogRecord) => void logs.push(r);
  const access: WriteAccess = { status: "write" };
  const writer = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log });
  const schedule = createScheduleReader({ fetch: g.fetch, token: async () => "FAKE-READ-TOKEN", invalidate: () => {}, log });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/Chicago") });
  const parsed = parseConfig(toml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const team = [
    { id: ME_ID, name: "Avery", email: "avery@cooptimize.org" },
    { id: "00000000-0000-4000-8000-0000000000a1", name: "Ana", email: "ana@cooptimize.org" },
    { id: "00000000-0000-4000-8000-0000000000b2", name: "Ben", email: "ben@cooptimize.org" },
  ];
  const dv = {
    myClients: async () => [{ clientKey: "T&S", clientName: "T&S", devops: true, devopsEmail: null }],
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
  const sync = () => syncWeek({ plan, ow: { access: async () => access, writer }, cfg: parsed.config, weekStart: WEEK, refresh: true, now: () => NOW, clients: [{ key: "T&S", name: "T&S" }] });
  const box = async (s = "09:00", e = "10:30") => {
    const r = await run<{ timebox: { id: number; uid: string } }>("timebox.add", { date: D, start: `${D}T${s}:00-06:00`, end: `${D}T${e}:00-06:00`, clientKey: "T&S", title: "#4512 Import mapping", url: "https://dev.azure.com/wc/p/_workitems/edit/4512", outlook: true });
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

  it("refuses meetings with others, events organized by someone else, repeating and all-day ones, and Coopilot's own (nothing sent)", async () => {
    const t = setup();
    const meeting = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", attendees: [{ address: "ana@cooptimize.org", name: "Ana" }] });
    const theirs = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", isOrganizer: false });
    const series = t.g.seed({ start: "2026-11-10T20:00:00Z", end: "2026-11-10T21:00:00Z", type: "occurrence" });
    const allDay = t.g.seed({ start: "2026-11-10T00:00:00Z", end: "2026-11-11T00:00:00Z", isAllDay: true });
    for (const [id, why] of [[meeting, /Others are on this meeting/], [theirs, /Others are on this meeting/], [series, /repeating/], [allDay, /all-day/]] as const) {
      const r = await t.fail("write.preview", { event: { id, start: `${D}T15:30:00-06:00`, end: `${D}T16:30:00-06:00` } });
      expect([r.status, r.error]).toEqual([409, expect.stringMatching(why)]);
    }
    const tb = await t.box();
    const mine = t.plan.ownEvent(tb.uid)!.eventId;
    expect((await t.fail("write.preview", { event: { id: mine, start: `${D}T15:30:00-06:00`, end: `${D}T16:30:00-06:00` } })).error).toMatch(/Coopilot's: change its timebox/);
    expect(t.g.calls.filter((c) => c.method === "PATCH")).toEqual([]);
  });
});

describe("editing tier: Coopilot events (the event and its timebox are one thing)", () => {
  it("retitles and changes show as through the timebox; the preview shows both", async () => {
    const t = setup();
    const tb = await t.box();
    const r = await t.run<{ sync: string }>("timebox.update", { id: tb.id, title: "Import mapping, part 2", showAs: "tentative" });
    expect(r.sync).toBe("update");
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: tb.uid })).preview;
    expect(p.fields.find((f) => f.label === "Title")).toMatchObject({ before: "T&S: #4512 Import mapping", after: "T&S: Import mapping, part 2", changed: true });
    expect(p.fields.find((f) => f.label === "Show as")).toMatchObject({ before: "Busy", after: "Tentative", changed: true });
    expect((await t.confirm(p)).confirmed).toBe(true);
    expect(t.g.events.get(t.plan.ownEvent(tb.uid)!.eventId)).toMatchObject({ subject: "T&S: Import mapping, part 2", showAs: "tentative" });
    expect((await t.fail("timebox.update", { id: tb.id, showAs: "invisible" })).error).toMatch(/showAs/);
  });
});

describe("two-way sync for Coopilot events", () => {
  it("follows a move made in Outlook, notes it, and logs it as from Outlook (not undoable from the log)", async () => {
    const t = setup();
    const tb = await t.box();
    const ev = t.g.events.get(t.plan.ownEvent(tb.uid)!.eventId)!;
    ev.start = "2026-11-10T19:00:00Z"; // 1:00 PM Chicago
    ev.end = "2026-11-10T20:00:00Z";
    ev.subject = "T&S: Import mapping (moved)";
    const r = await t.sync();
    expect(r.changed).toBe(1);
    const now = t.plan.timebox(tb.id)!;
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
    t.g.events.delete(t.plan.ownEvent(tb.uid)!.eventId);
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    await t.sync();
    expect(t.plan.timebox(tb.id)).toMatchObject({ removedAt: null, outlook: false, outlookNote: "Removed in Outlook", conflict: null });
    expect(t.plan.ownEvent(tb.uid)!.deletedAt).not.toBeNull();
    await t.sync();
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
    // Keep: the note goes, the timebox stays local.
    await t.run("timebox.resolve", { id: tb.id, keep: "local" });
    expect(t.plan.timebox(tb.id)).toMatchObject({ removedAt: null, outlook: false, outlookNote: null });
    // Remove (on another one): the timebox goes, nothing is written.
    const tb2 = await t.box("13:00", "14:00");
    t.g.events.delete(t.plan.ownEvent(tb2.uid)!.eventId);
    await t.sync();
    await t.run("timebox.resolve", { id: tb2.id, keep: "remove" });
    expect(t.plan.timebox(tb2.id)!.removedAt).not.toBeNull();
    expect((await t.fail("timebox.resolve", { id: tb.id, keep: "local" })).status).toBe(409);
  });

  it("removing or changing a timebox whose event is already gone is done, logged as already gone, never an error (step 13.5)", async () => {
    const t = setup();
    // Gone before the preview: a remove has nothing to do.
    const a = await t.box();
    t.g.events.delete(t.plan.ownEvent(a.uid)!.eventId);
    await t.run("timebox.remove", { id: a.id });
    expect(await t.run("write.preview", { uid: a.uid })).toEqual({ nothing: true, alreadyGone: true });
    // Gone before the preview of a change: kept here with Put on Outlook off, never re-created.
    const b = await t.box("11:00", "12:00");
    t.g.events.delete(t.plan.ownEvent(b.uid)!.eventId);
    await t.run("timebox.update", { id: b.id, start: `${D}T11:30:00-06:00`, end: `${D}T12:30:00-06:00` });
    expect(await t.run("write.preview", { uid: b.uid })).toEqual({ nothing: true, alreadyGone: true });
    expect(t.plan.timebox(b.id)).toMatchObject({ outlook: false, outlookNote: "Removed in Outlook", removedAt: null });
    // Gone between preview and confirm (a 404): confirmed as already gone.
    const c = await t.box("13:00", "14:00");
    await t.run("timebox.remove", { id: c.id });
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: c.uid })).preview;
    t.g.events.delete(t.plan.ownEvent(c.uid)!.eventId);
    expect(await t.confirm(p)).toMatchObject({ confirmed: true, message: "Already gone from Outlook; nothing to remove" });
    const log = t.plan.writeLog(20).map((e) => e.message);
    expect(log.filter((m) => m?.startsWith("Already gone from Outlook"))).toHaveLength(3);
    expect(t.g.events.size).toBe(0);
  });

  it("both changed: keeps both, writes nothing, blocks the push until I choose; Use Outlook's or Keep Coopilot's", async () => {
    const t = setup();
    const tb = await t.box();
    const id = t.plan.ownEvent(tb.uid)!.eventId;
    await t.run("timebox.update", { id: tb.id, start: `${D}T10:00:00-06:00`, end: `${D}T11:00:00-06:00` });
    t.g.events.get(id)!.subject = "T&S: renamed in Outlook";
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    const r = await t.sync();
    expect(r.conflicts).toBe(1);
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
    const c = t.plan.timebox(tb.id)!;
    expect(c).toMatchObject({ start: `${D}T10:00:00-06:00`, conflict: { changed: ["title"], outlook: { subject: "T&S: renamed in Outlook" } } });
    expect(t.g.events.get(id)!.subject).toBe("T&S: renamed in Outlook");
    expect((await t.fail("write.preview", { uid: tb.uid })).error).toMatch(/choose which version/);
    // A second sync doesn't log the same conflict again.
    const before = (await t.run<WriteLogView>("write.log", {})).entries.length;
    await t.sync();
    expect((await t.run<WriteLogView>("write.log", {})).entries.length).toBe(before);

    // Keep Coopilot's: the push is offered (preview shows Outlook's title as "Now").
    const k = await t.run<{ sync: string; timebox: { conflict: unknown } }>("timebox.resolve", { id: tb.id, keep: "coopilot" });
    expect(k).toMatchObject({ sync: "update", timebox: { conflict: null } });
    const p = (await t.run<{ preview: WritePreview }>("write.preview", { uid: tb.uid })).preview;
    expect(p.fields.find((f) => f.label === "Title")).toMatchObject({ before: "T&S: renamed in Outlook", after: "T&S: #4512 Import mapping" });
  });

  it("Use Outlook's: the timebox takes Outlook's version, nothing is written", async () => {
    const t = setup();
    const tb = await t.box();
    const id = t.plan.ownEvent(tb.uid)!.eventId;
    await t.run("timebox.update", { id: tb.id, start: `${D}T10:00:00-06:00`, end: `${D}T11:00:00-06:00` });
    Object.assign(t.g.events.get(id)!, { start: "2026-11-10T21:00:00Z", end: "2026-11-10T22:00:00Z" });
    await t.sync();
    const writes = t.g.calls.filter((c) => c.method !== "GET").length;
    const r = await t.run<{ sync: string | null; timebox: { start: string; conflict: unknown } }>("timebox.resolve", { id: tb.id, keep: "outlook" });
    expect(r).toMatchObject({ sync: null, timebox: { start: `${D}T15:00:00-06:00`, conflict: null } });
    expect(t.g.calls.filter((c) => c.method !== "GET").length).toBe(writes);
  });
});

describe("Q69: a Coopilot-marked event without a local record", () => {
  it("is rebuilt from its marker (record and timebox), hidden as a meeting, and logged from Outlook", async () => {
    const t = setup();
    const uid = "tb-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";
    const id = t.g.seed({ subject: "T&S: #4512 Import mapping", start: "2026-11-10T15:00:00Z", end: "2026-11-10T16:00:00Z", marker: uid, isReminderOn: false });
    const r = await t.sync();
    expect(r.rebuilt).toBe(1);
    expect(t.plan.ownEvent(uid)).toMatchObject({ eventId: id, deletedAt: null });
    expect(t.plan.timeboxByUid(uid)).toMatchObject({ clientKey: "T&S", title: "#4512 Import mapping", date: D, start: `${D}T09:00:00-06:00`, outlook: true, outlookNote: "Rebuilt from Outlook" });
    expect(r.facts[`outlook:${id}`]).toMatchObject({ marker: uid });
    // A second scan finds it in step.
    expect((await t.sync()).rebuilt).toBe(0);
  });
});

describe("the collaboration finder", () => {
  const body = (view: string) => ({
    value: ["ana@cooptimize.org", "ben@cooptimize.org"].map((id) => ({
      scheduleId: id, availabilityView: view,
      scheduleItems: [{ status: "busy", subject: "SECRET-SUBJECT pay review", location: "SECRET-ROOM", isPrivate: false, start: { dateTime: "2026-11-10T15:00:00", timeZone: "UTC" }, end: { dateTime: "2026-11-10T16:00:00", timeZone: "UTC" } }],
      workingHours: { daysOfWeek: ["monday", "tuesday", "wednesday", "thursday"], startTime: "08:00:00.0000000", endTime: "17:00:00.0000000", timeZone: { name: "Central Standard Time" } },
    })),
  });

  it("ranks candidates in tiers, Cooptimize staff only, PTO as away", async () => {
    const t = setup();
    const c = await t.run<CandidatesData>("collab.candidates", { clientKey: "T&S", from: "2026-11-10", to: "2026-11-11" });
    expect(c.candidates.map((x) => [x.name, x.tier, x.away])).toEqual([["Ana", 1, []], ["Ben", 2, ["2026-11-11"]]]);
    expect(JSON.stringify(c)).not.toMatch(/0000000000a1/); // no user ids out
    expect((await t.fail("collab.candidates", { clientKey: "Adatum" })).status).toBe(403);
  });

  it("suggests slots from free/busy without keeping or logging any event details", async () => {
    const t = setup();
    t.g.sw.schedule = body("0".repeat(500));
    const s = await t.run<SuggestData>("collab.suggest", { clientKey: "T&S", from: "2026-11-10", to: "2026-11-10", minutes: 30 });
    expect(s.slots.length).toBeGreaterThan(0);
    expect(s.slots[0]).toMatchObject({ date: "2026-11-10", tier: 1, people: [{ name: "Ana" }] });
    const sched = t.g.calls.find((c) => c.path.includes("getSchedule"))!;
    expect(sched.auth).toBe("Bearer FAKE-READ-TOKEN");
    expect(JSON.stringify(s)).not.toMatch(/SECRET/);
    expect(JSON.stringify(t.logs)).not.toMatch(/SECRET|FAKE-READ-TOKEN|FAKE-WRITE/);
    expect(JSON.stringify(t.plan.exportJson())).not.toMatch(/SECRET/);
    expect((await t.fail("collab.suggest", { clientKey: "T&S", minutes: 30, people: ["pat@client.example"] })).status).toBe(422);
  });

  it("previews an invite naming every attendee, sends it only on confirm, reads it back, tracks it and opens a follow-up", async () => {
    const t = setup();
    const r = await t.run<{ preview: WritePreview }>("collab.preview_invite", { clientKey: "T&S", title: "#4512 Import mapping", itemId: 4512, url: "https://dev.azure.com/wc/p/_workitems/edit/4512", start: `${D}T13:00:00-06:00`, end: `${D}T13:30:00-06:00`, people: ["ana@cooptimize.org", "ben@cooptimize.org"], note: "Stuck on the lookup" });
    const p = r.preview;
    expect(p).toMatchObject({ kind: "invite", op: "create", summary: "Send a help invite", attendees: [{ name: "Ana", email: "ana@cooptimize.org" }, { name: "Ben", email: "ben@cooptimize.org" }] });
    expect(p.visibility).toMatch(/Ana, Ben will each receive an invite by email from you/);
    expect(p.fields.find((f) => f.label === "Attendees")!.after).toBe("Ana <ana@cooptimize.org>, Ben <ben@cooptimize.org>");
    expect(p.fields.find((f) => f.label === "Teams meeting")!.after).toBe("Yes");
    expect(p.fields.find((f) => f.label === "Title")!.after).toBe("T&S: help on #4512 Import mapping");
    expect(p.fields.find((f) => f.label === "Body")!.after).toMatch(/_workitems\/edit\/4512\n\nStuck on the lookup/);
    expect(t.g.calls.some((c) => c.method === "POST" && c.path === "/v1.0/me/events")).toBe(false);
    const done = await t.confirm(p);
    expect(done).toMatchObject({ confirmed: true, message: "Invite sent to Ana, Ben", entry: { kind: "invite" } });
    const post = t.g.calls.find((c) => c.method === "POST" && c.path === "/v1.0/me/events")!.body as Record<string, unknown>;
    expect(post).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", attendees: [{ emailAddress: { address: "ana@cooptimize.org", name: "Ana" }, type: "required" }, { emailAddress: { address: "ben@cooptimize.org" } }] });
    const inv = t.plan.invitesFrom("2026-11-01")[0]!;
    expect(inv).toMatchObject({ status: "sent", itemId: 4512, clientKey: "T&S", eventId: done.entry.eventId });
    const followUp = t.plan.getFollowUp(inv.followUpId!)!;
    expect(followUp).toMatchObject({ kind: "help", what: "Help session with Ana and Ben on #4512 Import mapping", closedAt: null });
    // The follow-up closes once the meeting is over.
    expect(t.plan.closeHelpFollowUps(Temporal.Instant.from("2026-11-10T19:29:00Z"))).toBe(0);
    expect(t.plan.closeHelpFollowUps(Temporal.Instant.from("2026-11-10T19:31:00Z"))).toBe(1);
  });

  it("limits attendee domains at preview and in the writer", async () => {
    const t = setup();
    const r = await t.fail("collab.preview_invite", { clientKey: "T&S", title: "x", start: `${D}T13:00:00-06:00`, end: `${D}T13:30:00-06:00`, people: ["pat@wc-client.example"] });
    expect([r.status, r.error]).toEqual([422, "Invites go only to Cooptimize addresses"]);
    const w = createGraphWriter({ fetch: t.g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log: () => {} });
    await expect(w.createInvite({ subject: "s", body: "", start: "2026-11-10T19:00:00Z", end: "2026-11-10T19:30:00Z", showAs: "busy", reminder: false, attendees: [{ name: "P", email: "pat@evil.example" }] }, "inv-x", "t", ["cooptimize.org"])).rejects.toThrow(/Cooptimize addresses/);
    expect(t.g.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a test invite to myself only, then undo cancels it after a preview that says attendees get a cancellation", async () => {
    const t = setup();
    const p = (await t.run<{ preview: WritePreview }>("collab.preview_invite", { clientKey: "T&S", title: "Invite path check", start: `${D}T13:00:00-06:00`, end: `${D}T13:15:00-06:00`, people: ["avery@cooptimize.org"], teams: false })).preview;
    expect(p.attendees).toEqual([{ name: "You", email: "avery@cooptimize.org" }]);
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
    const inv = t.plan.invitesFrom("2026-11-01")[0]!;
    expect(inv.status).toBe("cancelled");
    expect(t.plan.getFollowUp(inv.followUpId!)!.closedAt).not.toBeNull();
    // A cancelled invite isn't sent again by another undo.
    expect((await t.run<WriteLogView>("write.log", {})).entries.every((e) => !e.undoable)).toBe(true);
  });
});
