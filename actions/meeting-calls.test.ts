// MC-2: Calls, review any call you were on. Your other calls come from my own calendar only and are kept nowhere; a
// hand-added call is its adder's only; nothing goes to the AI before a client is chosen; Get it from Teams is one try
// per press, through the gate, with each refusal in plain words; an unregistered call has the same page and rules as a
// client call; only its presser acts; no transcript words reach a log or an error.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { LogRecord } from "../log/logger.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { buildProcessModel } from "../plan/process.ts";
import type { CalendarMeeting } from "../plan/calls.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { MeetingRefused, type MeetingsClient } from "../sources/graph/meetings.ts";
import { createConversationStore, MEETING_CHAT } from "../store/conversation-store.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { transcriptVtt } from "../test/docx.ts";
import { FETCH_WORDS } from "../plan/call-words.ts";
import { createPressGrants } from "./call-press.ts";
import { meetingAction, uploadTranscript, type MeetingAction, type MeetingContext } from "./meeting-actions.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const MATE = "33333333-3333-4333-8333-333333333333";
const GUEST = "55555555-5555-4555-8555-555555555555";
const BOT = "66666666-6666-4666-8666-666666666666";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-11-10T17:00:00Z";
const REGISTERED = "https://teams.microsoft.com/l/meetup-join/19%3aregistered%40thread.v2/0";
const link = (k: string) => `https://teams.microsoft.com/l/meetup-join/19%3a${k}%40thread.v2/0`;
const SAID = [
  { speaker: "Sam Me", at: "0:05", text: "Rates export is first." },
  { speaker: "Dana Client", at: "0:40", text: "We also need a holiday calendar import." },
  { speaker: "Lee Mate", at: "1:10", text: "I'll send the export spec by Friday." },
];
const ANSWER = {
  gaps: [{ type: "User Story", parentId: 1201, title: "Holiday calendar import", description: "Import the client's holidays.", lines: [2] }],
  commitments: [{ who: "Lee Mate", what: "Send the export spec", toName: "Dana Client", due: null, lines: [3] }],
  comments: [],
  summary: ["Rates export comes first.", "Fabrikam asked for the same import.", "Dana asked for a holiday calendar import.", "Lee sends the export spec.", "Five."],
};

function aMeeting(p: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return { key: "ical-1", subject: "Contoso data review", startAt: "2026-11-09T15:00:00Z", endAt: "2026-11-09T15:45:00Z", isAllDay: false, isCancelled: false, isOrganizer: false, response: "accepted", others: 3, joinUrl: link("call-1"), organizerEmail: "kat@cooptimize.example", homeAttendees: ["sam@cooptimize.example", "lee@cooptimize.example", "guest@cooptimize.example", "bot@cooptimize.example"], ...p };
}

async function setup(calendar: CalendarMeeting[] = [aMeeting()], teams: { transcripts?: "one" | "none" | 403; meetingId?: string | null } = {}) {
  const db = sqliteDb();
  await addUsers(db.conn, ME, MATE, GUEST, BOT, OUTSIDER);
  const instant = () => Temporal.Instant.from(NOW);
  const meetings = createMeetingStore(db.conn, instant);
  const teamsStore = createTeamsStore(db.conn, instant);
  const conversations = createConversationStore(db.conn, instant, teamsStore, async (chatId, uid) => {
    const s = await meetings.series(Number(chatId.slice(MEETING_CHAT.length)));
    return !!s && [...s.reviewers, ...s.attendees].includes(uid.toLowerCase());
  });
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "sam@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n`);
  if (!cfg.ok) throw new Error("config");
  const press = createPressGrants();
  const graphCalls: { who: string; op: string }[] = [];
  // Each person's own Graph client, behind the gate the hosted app builds: a registered call, or their open press.
  const graphFor = (who: string): MeetingsClient => {
    const allowed = async (q: { joinUrl?: string; onlineMeetingId?: string }) => press.allowed(who, q) || q.joinUrl === REGISTERED;
    const log = (op: string) => graphCalls.push({ who, op });
    return {
      recentCalls: async () => (log("recentCalls"), who === ME ? calendar : calendar.map((c) => ({ ...c }))),
      callAt: async (key: string) => (log("callAt"), calendar.find((c) => c.key === key) ?? null),
      onlineMeetingId: async (joinUrl: string) => {
        if (!(await allowed({ joinUrl }))) throw new MeetingRefused();
        log("onlineMeetingId");
        return teams.meetingId === undefined ? "om-1" : teams.meetingId;
      },
      transcripts: async (id: string) => {
        if (!(await allowed({ onlineMeetingId: id }))) throw new MeetingRefused();
        log("transcripts");
        if (teams.transcripts === 403) throw new HttpError(403);
        return teams.transcripts === "none" ? [] : [{ id: "t1", createdAt: "2026-11-09T15:50:00Z", endAt: null }];
      },
      transcriptVtt: async (id: string) => {
        if (!(await allowed({ onlineMeetingId: id }))) throw new MeetingRefused();
        log("transcriptVtt");
        return transcriptVtt(SAID);
      },
    } as unknown as MeetingsClient;
  };
  const providerCalls: ProviderCall[] = [];
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => (providerCalls.push(c), JSON.stringify(ANSWER)) }),
    app: anAiApp(),
    rules: async () => anAiRules({ allowedClients: ["contoso", "Cooptimize"] }),
    guard: async (client) => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], itemIds: [4410] })], homeDomains: ["cooptimize.example"], forbidden: [], internal: client === "Cooptimize" }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
    sleep: async () => {},
  });
  const users = [
    { id: ME, name: "Sam Me", emails: ["sam@cooptimize.example"] },
    { id: MATE, name: "Lee Mate", emails: ["lee@cooptimize.example"] },
    { id: GUEST, name: "A Guest", emails: ["guest@cooptimize.example"] },
    { id: BOT, name: "Robot", emails: ["bot@cooptimize.example"] },
    { id: OUTSIDER, name: "Out Sider", emails: ["out@cooptimize.example"] },
  ];
  const logs: LogRecord[] = [];
  const directory = [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], itemIds: [4410] })];
  const ctxAs = (me: string, o: { cooptimizer?: boolean; press?: boolean } = {}): MeetingContext => ({
    meetings, conversations, plan: planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC"), userId: me }),
    me: async () => me, isAdmin: async () => false, config: async () => cfg.config, now: () => NOW, homeDomains: async () => ["cooptimize.example"],
    graph: () => graphFor(me), users: async () => users,
    client: async (k) => (["contoso", "Cooptimize"].find((c) => c.toLowerCase() === k.toLowerCase()) ? { key: ["contoso", "Cooptimize"].find((c) => c.toLowerCase() === k.toLowerCase())!, name: k } : null),
    leads: async () => [],
    capture: async (_c, k) => (k === "contoso" ? { clientName: "Contoso", internal: false, items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })], model: buildProcessModel(aClientProcess()), directory } : k === "Cooptimize" ? { clientName: "Cooptimize", internal: true, items: [], model: buildProcessModel(aClientProcess()), directory } : null),
    ai: async () => ai,
    canWrite: async () => true,
    log: (r) => logs.push(r),
    ...(o.press === false ? {} : { press }),
    // The people rule: guests and automation accounts aren't Cooptimizers.
    cooptimizer: async (uid) => (o.cooptimizer ?? true) && uid !== GUEST && uid !== BOT,
  });
  const act = (me: string, action: MeetingAction, input: unknown, o?: Parameters<typeof ctxAs>[1]) => meetingAction(ctxAs(me, o), action, input);
  const data = <T,>(r: Awaited<ReturnType<typeof act>>) => {
    if (!r.ok) throw new Error(`${r.status}: ${r.error}`);
    return r.data as T;
  };
  const start = async (me = ME, key = "ical-1", clientKey: string | null = "contoso") => {
    const c = calendar.find((x) => x.key === key)!;
    return act(me, "meeting.call_start", { key, startAt: c.startAt, endAt: c.endAt, ...(clientKey ? { clientKey } : {}) });
  };
  return { db, meetings, conversations, ctxAs, act, data, start, graphCalls, providerCalls, logs, press, graphFor };
}

type Others = { calls: { key: string; name: string; people: number; teams: boolean; outside: boolean; occurrenceId: number | null }[]; days: number };

describe("Calls › Your other calls (MC-2)", () => {
  it("lists only my calls with someone else on them, not declined, cancelled, all day, a hold, older than 14 days, not started or registered", async () => {
    const t = await setup([
      aMeeting({ key: "ok", subject: "Contoso data review" }),
      aMeeting({ key: "declined", response: "declined" }),
      aMeeting({ key: "cancelled", isCancelled: true }),
      aMeeting({ key: "allday", isAllDay: true }),
      aMeeting({ key: "hold", isOrganizer: true, others: 0 }),
      aMeeting({ key: "old", startAt: "2026-10-27T15:00:00Z", endAt: "2026-10-27T15:30:00Z" }),
      aMeeting({ key: "later", startAt: "2026-11-10T19:00:00Z", endAt: "2026-11-10T19:30:00Z" }),
      aMeeting({ key: "registered", joinUrl: REGISTERED }),
      aMeeting({ key: "outside", subject: "Fabrikam intake", organizerEmail: "pm@fabrikam.example", startAt: "2026-11-10T14:00:00Z", endAt: "2026-11-10T14:30:00Z" }),
      aMeeting({ key: "phone", joinUrl: null, startAt: "2026-11-05T14:00:00Z", endAt: "2026-11-05T14:30:00Z" }),
    ]);
    await t.meetings.addSeries({ clientKey: "contoso", name: "Weekly", role: "status", source: "automatic", detected: "automatic", organizer: "home", joinUrl: REGISTERED, eventId: "E", registrantId: ME, weekday: 1, start: "10:00", minutes: 30, zone: "America/New_York", interval: 1, reviewers: [ME], attendees: [] });
    const r = t.data<Others>(await t.act(ME, "meeting.calls", {}));
    // Newest first; how many people (me included); Teams only for an online one organized at Cooptimize.
    expect(r.calls.map((c) => c.key)).toEqual(["outside", "ok", "phone"]);
    expect(r.calls.find((c) => c.key === "ok")).toMatchObject({ people: 4, teams: true, outside: false, occurrenceId: null });
    expect(r.calls.find((c) => c.key === "outside")).toMatchObject({ teams: false, outside: true });
    expect(r.calls.find((c) => c.key === "phone")).toMatchObject({ teams: false, outside: false });
    expect(r.days).toBe(14);
    // Names and counts only: never a link or an address; nothing kept; only my own calendar read.
    expect(JSON.stringify(r)).not.toMatch(/meetup-join|@/);
    expect(await t.meetings.callsSince("2026-10-01")).toEqual([]);
    expect(t.graphCalls).toEqual([{ who: ME, op: "recentCalls" }]);
  });

  it("says to sign in when there's no Microsoft sign-in", async () => {
    const t = await setup();
    const r = await meetingAction({ ...t.ctxAs(ME), graph: () => null }, "meeting.calls", {});
    expect(r).toMatchObject({ ok: false, status: 409, code: "signin" });
  });
});

describe("Review on a call that isn't registered (MC-2)", () => {
  it("keeps nothing and sends nothing to AI before a client is chosen; the presser reviews, the Cooptimizers on the invite look", async () => {
    const t = await setup();
    expect(await t.start(ME, "ical-1", null)).toMatchObject({ ok: false, status: 400 });
    expect(await t.meetings.callsSince("2026-10-01")).toEqual([]);
    const s = t.data<{ occurrenceId: number; existed: boolean }>(await t.start());
    expect(s.existed).toBe(false);
    expect(t.providerCalls).toEqual([]);
    const [call] = await t.meetings.callsSince("2026-10-01");
    // Guests and automation accounts on the invite are never attendees; neither is anyone not a FocusTime user.
    expect(call).toMatchObject({ callKind: "calendar", clientKey: "contoso", reviewers: [ME], attendees: [MATE], source: "upload" });
    // The mate who was on it sees it (its mark, its row) but can't act; a mate pressing Review gets the same call.
    expect(t.data<{ meetings: { call: string }[] }>(await t.act(MATE, "meeting.mine", {})).meetings.map((m) => m.call)).toEqual(["calendar"]);
    expect(t.data<{ occurrenceId: number; existed: boolean }>(await t.start(MATE))).toEqual({ occurrenceId: s.occurrenceId, existed: true });
    expect(await t.act(MATE, "meeting.call_fetch", { occurrenceId: s.occurrenceId })).toMatchObject({ ok: false, status: 403 });
    for (const who of [GUEST, BOT, OUTSIDER]) expect(t.data<{ meetings: unknown[] }>(await t.act(who, "meeting.mine", {})).meetings).toEqual([]);
    expect(await t.act(OUTSIDER, "meeting.review", { occurrenceId: s.occurrenceId })).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a press by someone the call isn't on the calendar of, or who isn't a Cooptimizer", async () => {
    const t = await setup([aMeeting({ key: "declined", response: "declined" }), aMeeting()]);
    expect(await t.start(ME, "declined")).toMatchObject({ ok: false, status: 403, code: "not_on_invite" });
    expect(await t.act(ME, "meeting.call_start", { key: "ical-gone", startAt: "2026-11-09T15:00:00Z", endAt: "2026-11-09T15:45:00Z", clientKey: "contoso" })).toMatchObject({ ok: false, status: 403, code: "not_on_invite" });
    expect(await meetingAction(t.ctxAs(GUEST), "meeting.call_start", { key: "ical-1", startAt: "2026-11-09T15:00:00Z", endAt: "2026-11-09T15:45:00Z", clientKey: "contoso" })).toMatchObject({ ok: false, status: 403, code: "not_cooptimizer" });
    expect(await t.meetings.callsSince("2026-10-01")).toEqual([]);
  });

  it("Get it from Teams: one try per press, through the gate; the transcript lands in the chosen client's plan with a summary", async () => {
    const t = await setup();
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start());
    // Before any press the gate refuses this call, for me and for everyone.
    await expect(t.graphFor(ME).onlineMeetingId(link("call-1"))).rejects.toBeInstanceOf(MeetingRefused);
    const r = t.data<{ outcome: string; message: string; lines: number }>(await t.act(ME, "meeting.call_fetch", { occurrenceId }));
    expect(r).toMatchObject({ outcome: "found", lines: 3 });
    expect(r.message).toMatch(/^Got the transcript from Teams \(3 lines\)/);
    expect(t.graphCalls.filter((c) => c.op !== "callAt").map((c) => c.op)).toEqual(["onlineMeetingId", "transcripts", "transcriptVtt"]);
    // The press is over: nothing more passes for it.
    await expect(t.graphFor(ME).onlineMeetingId(link("call-1"))).rejects.toBeInstanceOf(MeetingRefused);
    await expect(t.graphFor(ME).transcripts("om-1")).rejects.toBeInstanceOf(MeetingRefused);
    // One AI request, for Contoso only, with no role said for a call that isn't registered.
    expect(t.providerCalls).toHaveLength(1);
    expect(t.providerCalls[0]!.input).toMatch(/^Client: Contoso\nMeeting: Contoso data review, 2026-11-09 \(Monday\)/);
    const review = t.data<{ proposals: { body: { kind: string } }[]; summary: string[]; canConfirm: boolean; meeting: { call: string; clientKey: string } }>(await t.act(ME, "meeting.review", { occurrenceId }));
    expect(review.meeting).toMatchObject({ call: "calendar", clientKey: "contoso" });
    expect(review.canConfirm).toBe(true);
    expect(review.proposals.map((p) => p.body.kind).sort()).toEqual(["commitment", "gap"]);
    // The summary: at most 5 lines (the schema says so), another client's name replaced.
    expect(review.summary).toHaveLength(5);
    expect(review.summary.join(" ")).not.toMatch(/Fabrikam/);
    expect(review.summary[1]).toBe("another client asked for the same import.");
    // A promise kept lands in the chosen client's Promises, from this call.
    const promise = (await t.meetings.proposals(occurrenceId)).find((p) => p.body.kind === "commitment")!;
    t.data(await t.act(ME, "meeting.keep", { proposalId: promise.id }));
    expect((await t.meetings.proposals(occurrenceId)).find((p) => p.id === promise.id)?.state).toBe("confirmed");
    // An attendee sees the same page, summary and transcript, and can't act.
    const theirs = t.data<{ canConfirm: boolean; summary: string[] }>(await t.act(MATE, "meeting.review", { occurrenceId }));
    expect(theirs).toMatchObject({ canConfirm: false, summary: review.summary });
    expect(t.data<{ lines: unknown[] }>(await t.act(MATE, "meeting.transcript", { occurrenceId })).lines).toHaveLength(3);
    expect(await t.act(MATE, "meeting.rerun", { occurrenceId })).toMatchObject({ ok: false, status: 403 });
    expect(await t.act(MATE, "meeting.keep", { proposalId: promise.id })).toMatchObject({ ok: false });
    // Propose again by the presser runs the step once more on the stored transcript.
    expect(t.data<{ outcome: string }>(await t.act(ME, "meeting.rerun", { occurrenceId })).outcome).toBe("done");
    expect(t.providerCalls).toHaveLength(2);
  });

  it("says each refusal plainly and points to the upload, asking Teams at most once", async () => {
    for (const [cal, teams, outcome, asked] of [
      [aMeeting({ organizerEmail: "pm@fabrikam.example" }), {}, "outside", []],
      [aMeeting({ joinUrl: null }), {}, "not_online", []],
      [aMeeting(), { transcripts: "none" }, "none", ["onlineMeetingId", "transcripts"]],
      [aMeeting(), { meetingId: null }, "none", ["onlineMeetingId"]],
      [aMeeting(), { transcripts: 403 }, "not_allowed", ["onlineMeetingId", "transcripts"]],
    ] as const) {
      const t = await setup([cal], teams);
      const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start());
      const r = t.data<{ outcome: string; message: string }>(await t.act(ME, "meeting.call_fetch", { occurrenceId }));
      expect(r).toEqual({ outcome, message: FETCH_WORDS[outcome] });
      expect(r.message).toMatch(/upload|Upload/);
      expect(t.graphCalls.filter((c) => c.op !== "callAt").map((c) => c.op)).toEqual(asked);
      expect(t.providerCalls).toEqual([]);
      // Still waiting for its transcript: the upload is there.
      expect((await t.meetings.occurrence(occurrenceId))?.state).toBe("needs_upload");
    }
  });

  it("refuses a press once the call isn't on my calendar, and without the press here", async () => {
    const cal = [aMeeting()];
    const t = await setup(cal);
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start());
    expect(await meetingAction(t.ctxAs(ME, { press: false }), "meeting.call_fetch", { occurrenceId })).toEqual({ ok: true, data: { outcome: "unavailable", message: FETCH_WORDS.unavailable } });
    cal[0] = aMeeting({ response: "declined" });
    expect(await t.act(ME, "meeting.call_fetch", { occurrenceId })).toMatchObject({ ok: false, status: 403, code: "not_on_invite" });
    expect(t.graphCalls.map((c) => c.op)).not.toContain("onlineMeetingId");
  });

  it("takes an upload from the presser only, on the same page as a client call", async () => {
    const t = await setup([aMeeting({ joinUrl: null })]);
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start());
    const [s] = await t.meetings.callsSince("2026-10-01");
    const bytes = new TextEncoder().encode(transcriptVtt(SAID));
    // The mate on the invite can look at it, never upload to it.
    expect(await uploadTranscript(t.ctxAs(MATE), { seriesId: s!.id, date: "2026-11-09", bytes })).toMatchObject({ ok: false, status: 403 });
    expect(await uploadTranscript(t.ctxAs(OUTSIDER), { seriesId: s!.id, date: "2026-11-09", bytes })).toMatchObject({ ok: false, status: 404 });
    const up = await uploadTranscript(t.ctxAs(ME), { seriesId: s!.id, date: "2026-11-09", bytes });
    expect(up).toMatchObject({ ok: true, data: { occurrenceId, lines: 3, outcome: "done" } });
    expect(t.providerCalls).toHaveLength(1);
  });

  it("lets me choose Internal for a call about our own work", async () => {
    const t = await setup();
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME, "ical-1", "Cooptimize"));
    t.data(await t.act(ME, "meeting.call_fetch", { occurrenceId }));
    expect(t.providerCalls[0]!.input).toMatch(/^Client: Cooptimize\n/);
    expect((await t.meetings.callsSince("2026-10-01"))[0]?.clientKey).toBe("Cooptimize");
  });
});

describe("Add a call (MC-2)", () => {
  it("keeps a hand-added call for its adder only, with no attendees, from the last 14 days", async () => {
    const t = await setup();
    const r = t.data<{ occurrenceId: number }>(await t.act(ME, "meeting.call_add", { name: "Teammates' Contoso huddle", date: "2026-11-06", start: "11:00", minutes: 30, clientKey: "contoso" }));
    const [s] = await t.meetings.callsSince("2026-10-01");
    expect(s).toMatchObject({ callKind: "hand", reviewers: [ME], attendees: [], eventId: null });
    expect(t.data<{ meetings: unknown[] }>(await t.act(MATE, "meeting.mine", {})).meetings).toEqual([]);
    expect(await t.act(MATE, "meeting.review", { occurrenceId: r.occurrenceId })).toMatchObject({ ok: false, status: 404 });
    expect(t.data<{ meeting: { call: string; teams: boolean } }>(await t.act(ME, "meeting.review", { occurrenceId: r.occurrenceId })).meeting).toMatchObject({ call: "hand", teams: false });
    // Never asked of Teams.
    expect(await t.act(ME, "meeting.call_fetch", { occurrenceId: r.occurrenceId })).toMatchObject({ ok: false, status: 409 });
    expect(await t.act(ME, "meeting.call_add", { name: "Old", date: "2026-10-20", start: "11:00", minutes: 30, clientKey: "contoso" })).toMatchObject({ ok: false, status: 422 });
    expect(await t.act(ME, "meeting.call_add", { name: "Later", date: "2026-11-10", start: "23:00", minutes: 30, clientKey: "contoso" })).toMatchObject({ ok: false, status: 422 });
    expect(await t.act(ME, "meeting.call_add", { name: "No client", date: "2026-11-06", start: "11:00", minutes: 30, clientKey: "nobody" })).toMatchObject({ ok: false, status: 404 });
    expect(t.graphCalls).toEqual([]);
  });
});

describe("no transcript words outside the call (MC-2)", () => {
  it("logs outcomes and counts only, never a name, link, line or summary; errors are fixed words", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.calls", {}));
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start());
    t.data(await t.act(ME, "meeting.call_fetch", { occurrenceId }));
    const all = JSON.stringify(t.logs);
    expect(all).not.toMatch(/Contoso data review|meetup-join|ical-1|holiday|export spec|Rates|\bDana\b|\bLee\b|\bSam\b|cooptimize\.example|another client/i);
    expect(t.logs.map((l) => l.op)).toEqual(expect.arrayContaining(["meeting_other_calls", "meeting_call_start", "meeting_call_fetch"]));
    const refused = await t.act(OUTSIDER, "meeting.call_fetch", { occurrenceId });
    expect(JSON.stringify(refused)).not.toMatch(/Contoso data review|holiday/);
  });
});
