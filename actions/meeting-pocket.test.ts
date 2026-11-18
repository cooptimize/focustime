// MC-2b: my own Pocket recordings in Calls. Get my Pocket recordings lists only mine (others' dropped and counted)
// and holds the list 5 minutes for me; a recording is brought in only by an id from my own held list, onto a call I
// review that it goes with; its transcript is kept as any transcript is (the call's reviewers and attendees only, 30
// days, never in Export or a log); a long recording brings in its part during the call or, chosen, all of it; with no
// line times the setup is asked first; nothing goes to the AI before Continue or with the client's Allow AI off; a
// recording with no call becomes a call only I see. A fake Pocket with invented recordings; no real key.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { LogRecord } from "../log/logger.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { buildProcessModel } from "../plan/process.ts";
import type { CalendarMeeting } from "../plan/calls.ts";
import type { MeetingsClient } from "../sources/graph/meetings.ts";
import { createPocketClient, POCKET_LIST_PATH, POCKET_ORIGIN } from "../sources/pocket/client.ts";
import { createConversationStore, MEETING_CHAT } from "../store/conversation-store.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { purgeRetention } from "../store/retention.ts";
import { createAccountStore } from "../store/accounts.ts";
import { exportUser } from "../store/user-data.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { POCKET_CALL_WORDS, POCKET_FAILURE_TEXT } from "../plan/pocket-words.ts";
import { createPocketHold } from "./meeting-pocket.ts";
import { pocketPort } from "./pocket-actions.ts";
import { meetingAction, type MeetingAction, type MeetingContext } from "./meeting-actions.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const MATE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-11-10T17:00:00Z";
const link = (k: string) => `https://teams.microsoft.com/l/meetup-join/19%3a${k}%40thread.v2/0`;
const SECRET_WORDS = "pallet rate cards";

function aMeeting(p: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return { key: "ical-1", subject: "Contoso data review", startAt: "2026-11-09T15:00:00Z", endAt: "2026-11-09T15:45:00Z", isAllDay: false, isCancelled: false, isOrganizer: false, response: "accepted", others: 3, joinUrl: link("call-1"), organizerEmail: "pm@contoso.example", homeAttendees: ["sam@cooptimize.example", "lee@cooptimize.example"], ...p };
}

type Seg = { start: number | null; end: number | null; speaker: string; speakerName: string; text: string };
type Rec = { id: string; title: string; at: string; minutes: number; by: string; segs: Seg[] };
const seg = (start: number | null, speaker: string, text: string): Seg => ({ start, end: start === null ? null : start + 30, speaker, speakerName: "Dana Client", text });

/** Invented recordings: mine on the call, a teammate's under the same key, a long one, one with no call, one with no times. */
const RECS: Rec[] = [
  { id: "r-mine", title: `Data review ${SECRET_WORDS}`, at: "2026-11-09T14:58:00Z", minutes: 47, by: "sam@cooptimize.example", segs: [seg(10, "SPEAKER_1", "Rates export is first."), seg(60, "SPEAKER_0", `We also need a holiday calendar import for ${SECRET_WORDS}.`)] },
  { id: "r-mate", title: "Lee's private chat", at: "2026-11-09T15:00:00Z", minutes: 45, by: "lee@cooptimize.example", segs: [seg(0, "SPEAKER_0", "Lee's own words.")] },
  { id: "r-long", title: "All morning", at: "2026-11-09T14:00:00Z", minutes: 150, by: "sam@cooptimize.example", segs: [seg(60, "SPEAKER_0", "Coffee first."), seg(3400, "SPEAKER_1", "During the call."), seg(8000, "SPEAKER_0", "Lunch after.")] },
  { id: "r-lone", title: "Call with the carrier", at: "2026-11-08T12:00:00Z", minutes: 20, by: "sam@cooptimize.example", segs: [seg(5, "SPEAKER_0", "Pallet labels look odd.")] },
  { id: "r-notimes", title: "Old recorder", at: "2026-11-09T14:30:00Z", minutes: 120, by: "SAM@cooptimize.example", segs: [seg(null, "SPEAKER_0", "No times here.")] },
];

/** A fake Pocket that answers the list and one recording from RECS, in the docs' shape, and records each request. */
function fakePocket(reqs: string[], recs: Rec[] = RECS): typeof fetch {
  const listed = (r: Rec) => ({ id: r.id, title: r.title, recording_at: r.at, duration: r.minutes * 60, recorded_by: { email: r.by, display_name: r.by }, transcript: { segments: r.segs }, summarizations: { s: "summary words" }, speakers: { SPEAKER_0: { name: "Dana Client" } }, tags: [] });
  return (async (input: string | URL | Request) => {
    const url = String(input);
    reqs.push(url);
    const u = new URL(url);
    if (u.origin !== POCKET_ORIGIN) return new Response("{}", { status: 404 });
    if (u.pathname === POCKET_LIST_PATH) return Response.json({ success: true, data: recs.map(listed), pagination: { page: 1, limit: 100, total: recs.length, total_pages: 1, has_more: false } });
    const r = recs.find((x) => `${POCKET_LIST_PATH}/${x.id}` === u.pathname);
    return r ? Response.json({ success: true, data: listed(r) }) : Response.json({ success: false, error: "Not found" }, { status: 404 });
  }) as typeof fetch;
}

async function setup(o: { allowAi?: boolean; pocketStatus?: number } = {}) {
  const db = sqliteDb();
  await addUsers(db.conn, ME, MATE, OUTSIDER);
  let nowMs = Date.parse(NOW);
  const instant = () => Temporal.Instant.fromEpochMilliseconds(nowMs);
  const meetings = createMeetingStore(db.conn, instant);
  const teamsStore = createTeamsStore(db.conn, instant);
  const conversations = createConversationStore(db.conn, instant, teamsStore, async (chatId, uid) => {
    const s = await meetings.series(Number(chatId.slice(MEETING_CHAT.length)));
    return !!s && [...s.reviewers, ...s.attendees].includes(uid.toLowerCase());
  });
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "sam@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n`);
  if (!cfg.ok) throw new Error("config");
  const calendar = [aMeeting()];
  const graph: MeetingsClient = { recentCalls: async () => calendar, callAt: async (key: string) => calendar.find((c) => c.key === key) ?? null } as unknown as MeetingsClient;
  const providerCalls: ProviderCall[] = [];
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => (providerCalls.push(c), JSON.stringify({ gaps: [], commitments: [], comments: [], summary: ["Rates export first."] })) }),
    app: anAiApp(),
    rules: async () => anAiRules({ allowedClients: o.allowAi === false ? ["Cooptimize"] : ["contoso", "Cooptimize"] }),
    guard: async (client) => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] })], homeDomains: ["cooptimize.example"], forbidden: [], internal: client === "Cooptimize" }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => instant().toString(),
    sleep: async () => {},
  });
  const users = [
    { id: ME, name: "Sam Me", emails: ["sam@cooptimize.example"] },
    { id: MATE, name: "Lee Mate", emails: ["lee@cooptimize.example"] },
    { id: OUTSIDER, name: "Out Sider", emails: ["out@cooptimize.example"] },
  ];
  const logs: LogRecord[] = [];
  const reqs: Record<string, string[]> = { [ME]: [], [MATE]: [], [OUTSIDER]: [] };
  const keyReads: Record<string, number> = { [ME]: 0, [MATE]: 0, [OUTSIDER]: 0 };
  const hold = createPocketHold(() => nowMs);
  const connected = new Set([ME, MATE]);
  const portOf = (who: string) => {
    const secrets = new Map<string, string>(connected.has(who) ? [["pocket-key", `pk_test_${who.slice(0, 4)}`]] : []);
    return pocketPort({
      secrets: { get: async (a) => (keyReads[who]!++, secrets.get(a)!), set: async (a, v) => void secrets.set(a, v), delete: async (a) => void secrets.delete(a), has: async (a) => secrets.has(a) },
      client: createPocketClient({ fetch: o.pocketStatus ? ((async (u: string) => (reqs[who]!.push(String(u)), new Response("{}", { status: o.pocketStatus }))) as unknown as typeof fetch) : fakePocket(reqs[who]!), log: (r) => logs.push(r), timeoutMs: 500 }),
      now: () => nowMs,
    });
  };
  const ports = { [ME]: portOf(ME), [MATE]: portOf(MATE), [OUTSIDER]: portOf(OUTSIDER) };
  const ctxAs = (me: string): MeetingContext => ({
    meetings, conversations, plan: planStoreOn(db.conn, { now: () => instant().toZonedDateTimeISO("UTC"), userId: me }),
    me: async () => me, isAdmin: async () => false, config: async () => cfg.config, now: () => instant().toString(), homeDomains: async () => ["cooptimize.example"],
    graph: () => graph, users: async () => users,
    client: async (k) => (k.toLowerCase() === "contoso" ? { key: "contoso", name: "Contoso" } : null),
    leads: async () => [],
    capture: async () => ({ clientName: "Contoso", internal: false, items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })], model: buildProcessModel(aClientProcess()), directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] })] }),
    ai: async () => ai,
    canWrite: async () => true,
    log: (r) => logs.push(r),
    cooptimizer: async (uid) => uid !== OUTSIDER,
    pocket: { port: ports[me]!, hold, myEmails: async () => users.find((u) => u.id === me)!.emails },
  });
  const act = (me: string, action: MeetingAction, input: unknown) => meetingAction(ctxAs(me), action, input);
  const data = <T,>(r: Awaited<ReturnType<typeof act>>) => {
    if (!r.ok) throw new Error(`${r.status}: ${r.error}`);
    return r.data as T;
  };
  const keep = async () => data<{ occurrenceId: number }>(await act(ME, "meeting.call_start", { key: "ical-1", startAt: calendar[0]!.startAt, endAt: calendar[0]!.endAt, clientKey: "contoso" })).occurrenceId;
  return { db, meetings, act, data, keep, logs, reqs, keyReads, providerCalls, hold, advance: (ms: number) => (nowMs += ms), connected };
}

type List = { recordings: { id: string; startAt: string; endAt: string; minutes: number; title: string }[]; others: number; more: boolean; days: number };
const recCalls = (urls: string[]) => urls.filter((u) => new URL(u).pathname !== POCKET_LIST_PATH);

describe("Get my Pocket recordings (MC-2b)", () => {
  it("lists only my own recordings of the last 14 days; another person's is dropped and counted", async () => {
    const t = await setup();
    const l = t.data<List>(await t.act(ME, "meeting.pocket_list", {}));
    expect(l.recordings.map((r) => r.id).sort()).toEqual(["r-lone", "r-long", "r-mine", "r-notimes"]);
    expect(l.others).toBe(1);
    expect(l.days).toBe(14);
    for (const r of l.recordings) expect(Object.keys(r).sort()).toEqual(["endAt", "id", "minutes", "startAt", "title"]);
    // Nothing of the transcript, summaries, speakers or the other person's recording comes out.
    expect(JSON.stringify(l)).not.toMatch(/Rates export|holiday|summary|Dana|Lee's|lee@|r-mate/);
    // One list request, and nothing went to the AI.
    expect(t.reqs[ME]).toEqual([`${POCKET_ORIGIN}${POCKET_LIST_PATH}?start_date=2026-10-28&end_date=2026-11-10&page=1&limit=100`]);
    expect(t.providerCalls).toEqual([]);
  });

  it("logs only the outcome: never a title, an id, a count, a date or a word", async () => {
    const t = await setup();
    await t.act(ME, "meeting.pocket_list", {});
    const occ = await t.keep();
    await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ });
    const all = JSON.stringify(t.logs);
    expect(all).not.toMatch(/r-mine|r-mate|Data review|pallet|Rates export|holiday|2026-11|@|pk_/i);
    for (const l of t.logs.filter((x) => x.source === "pocket")) expect(Object.keys(l).every((k) => ["source", "op", "status", "durationMs", "kind"].includes(k))).toBe(true);
    expect(t.logs.filter((x) => String(x.op).startsWith("meeting_pocket")).every((x) => x.count === undefined)).toBe(true);
  });

  it("someone without Pocket connected gets the words to connect, and Pocket isn't asked", async () => {
    const t = await setup();
    expect(await t.act(OUTSIDER, "meeting.pocket_list", {})).toMatchObject({ ok: false, status: 409, code: "pocket_not_connected", error: POCKET_CALL_WORDS.notConnected });
    expect(t.reqs[OUTSIDER]).toEqual([]);
  });

  it.each([[401, "not_accepted", 422], [429, "busy", 502], [500, "no_answer", 502]] as const)("a Pocket answer of %s is said in PK-2's words", async (status, kind, code) => {
    const t = await setup({ pocketStatus: status });
    expect(await t.act(ME, "meeting.pocket_list", {})).toEqual({ ok: false, status: code, error: `${POCKET_FAILURE_TEXT[kind]}.`, code: `pocket_${kind}` });
    // One try.
    expect(t.reqs[ME]).toHaveLength(1);
  });
});

describe("Bringing one in (MC-2b)", () => {
  it("only by an id from my own list of the last 5 minutes: not one I never listed, not a teammate's, not after 5 minutes", async () => {
    const t = await setup();
    const occ = await t.keep();
    // Never listed.
    expect(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ })).toMatchObject({ ok: false, status: 410, code: "pocket_get_again" });
    // A teammate's list holds theirs, not mine.
    t.data(await t.act(MATE, "meeting.pocket_list", {}));
    expect(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mate", occurrenceId: occ })).toMatchObject({ ok: false, status: 410 });
    // Mine, then 5 minutes pass.
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    expect(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mate", occurrenceId: occ })).toMatchObject({ ok: false, status: 410 });
    t.advance(5 * 60_000 + 1);
    expect(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ })).toMatchObject({ ok: false, status: 410 });
    expect(recCalls(t.reqs[ME]!)).toEqual([]);
  });

  it("keeps the transcript as an upload's: seen by the call's reviewers and attendees only, gone after 30 days, never in Export", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const occ = await t.keep();
    expect(t.providerCalls).toEqual([]);
    const r = t.data<{ occurrenceId: number; part: string }>(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ }));
    expect(r).toMatchObject({ occurrenceId: occ, part: "all" });
    expect(recCalls(t.reqs[ME]!)).toEqual([`${POCKET_ORIGIN}${POCKET_LIST_PATH}/r-mine?include_transcript=true&include_summarizations=false`]);
    const lines = (await t.meetings.transcript(occ))!;
    expect(lines.map((l) => [l.speaker, l.at])).toEqual([["Speaker 2", 10], ["Speaker 1", 60]]);
    expect(JSON.stringify(lines)).not.toMatch(/Dana/);
    // The AI ran once, now, told the labels aren't people.
    expect(t.providerCalls).toHaveLength(1);
    expect(t.providerCalls[0]!.input).toMatch(/Speaker 1/);
    // Me and the Cooptimizer on the invite (Lee) see it, each told whose recording it was; nobody else does.
    expect(t.data<{ pocket: boolean; pocketFrom: string }>(await t.act(ME, "meeting.review", { occurrenceId: occ }))).toMatchObject({ pocket: true, pocketFrom: "mine" });
    expect(t.data<{ pocketFrom: string }>(await t.act(MATE, "meeting.review", { occurrenceId: occ }))).toMatchObject({ pocketFrom: "reviewer" });
    expect(await t.act(OUTSIDER, "meeting.review", { occurrenceId: occ })).toMatchObject({ ok: false, status: 404 });
    expect(await t.act(OUTSIDER, "meeting.transcript", { occurrenceId: occ })).toMatchObject({ ok: false });
    // Not in my Export.
    const user = (await createAccountStore(t.db.conn, () => Temporal.Instant.from(NOW)).users.get(ME))!;
    expect(JSON.stringify(await exportUser(t.db.conn, user, Temporal.Instant.from(NOW)))).not.toMatch(/holiday|Rates export|pallet/);
    // Gone after 30 days.
    await purgeRetention(t.db.conn, Temporal.Instant.from(NOW).add({ hours: 24 * 31 }));
    expect(await t.meetings.transcript(occ)).toBeNull();
  });

  it("only a reviewer of a call it goes with; a call that has a transcript asks before replacing", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const occ = await t.keep();
    expect(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-lone", occurrenceId: occ })).toMatchObject({ ok: false, status: 422, code: "pocket_not_this_call" });
    t.data(await t.act(MATE, "meeting.pocket_list", {}));
    expect(await t.act(MATE, "meeting.pocket_bring", { recordingId: "r-mate", occurrenceId: occ })).toMatchObject({ ok: false, status: 403 });
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ }));
    const before = t.reqs[ME]!.length;
    expect(t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ }))).toEqual({ ask: "replace" });
    expect(t.reqs[ME]!.length).toBe(before);
    expect(t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ, replace: true }))).toMatchObject({ part: "all" });
  });

  it("a recording much longer than its call: only the part during it, or all of it when chosen", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const occ = await t.keep();
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-long", occurrenceId: occ }));
    expect((await t.meetings.transcript(occ))!.map((l) => l.text)).toEqual(["During the call."]);
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-long", occurrenceId: occ, part: "all", replace: true }));
    expect((await t.meetings.transcript(occ))!.map((l) => l.text)).toEqual(["Coffee first.", "During the call.", "Lunch after."]);
  });

  it("with no line times, says the whole comes in and keeps nothing until all of it is chosen", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const occ = await t.keep();
    expect(t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-notimes", occurrenceId: occ }))).toEqual({ ask: "whole", length: "2 h" });
    expect(await t.meetings.transcript(occ)).toBeNull();
    expect(t.providerCalls).toEqual([]);
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-notimes", occurrenceId: occ, part: "all" }));
    expect((await t.meetings.transcript(occ))!.map((l) => [l.text, l.at])).toEqual([["No times here.", null]]);
  });

  it("nothing goes to the AI with the client's Allow AI off", async () => {
    const t = await setup({ allowAi: false });
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const occ = await t.keep();
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-mine", occurrenceId: occ }));
    expect(await t.meetings.transcript(occ)).not.toBeNull();
    expect(t.providerCalls).toEqual([]);
  });
});

describe("A recording with no call (MC-2b)", () => {
  it("becomes a call only I see, without asking Pocket; then its transcript comes in", async () => {
    const t = await setup();
    t.data(await t.act(ME, "meeting.pocket_list", {}));
    const before = t.reqs[ME]!.length;
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.act(ME, "meeting.pocket_add", { recordingId: "r-lone", name: "Carrier call", clientKey: "contoso" }));
    expect(t.reqs[ME]!.length).toBe(before);
    expect(await t.act(MATE, "meeting.review", { occurrenceId })).toMatchObject({ ok: false, status: 404 });
    const occ = (await t.meetings.occurrence(occurrenceId))!;
    expect([occ.startAt, occ.endAt]).toEqual(["2026-11-08T12:00:00Z", "2026-11-08T12:20:00Z"]);
    t.data(await t.act(ME, "meeting.pocket_bring", { recordingId: "r-lone", occurrenceId }));
    expect((await t.meetings.transcript(occurrenceId))!.map((l) => l.text)).toEqual(["Pallet labels look odd."]);
    // Only a client FocusTime knows, and only from my own list.
    expect(await t.act(ME, "meeting.pocket_add", { recordingId: "r-lone", name: "x", clientKey: "nobody" })).toMatchObject({ ok: false });
    expect(await t.act(MATE, "meeting.pocket_add", { recordingId: "r-lone", name: "x", clientKey: "contoso" })).toMatchObject({ ok: false, status: 410 });
  });
});
