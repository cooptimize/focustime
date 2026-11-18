// MC-2c: a call started in a client's registered delivery chat, in Calls once Teams said its transcript is ready, and
// Review fetching it. On a real SQLite store with the real Teams store, the real port, the real press and the real ad hoc
// client on a fake fetch (Microsoft's documented shapes, fake ids, demo words). Who sees a row (in the chat now, following
// its client, a Cooptimizer), what isn't listed (no event, live), the checks before a press, each outcome in plain words,
// the hand-off to MC-2's kept call, Hide with Undo and the Pocket fit, nothing by itself, and logs with no id or name.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { callRows } from "../plan/call-list.ts";
import { pocketRows } from "../plan/call-list-pocket.ts";
import { CHAT_NO_SPEAKERS, CHAT_WAY_ON, FETCH_WORDS } from "../plan/call-words.ts";
import { chatCallKey } from "../plan/cowork.ts";
import type { OccurrenceView, OtherCallView, SeriesView } from "../plan/meeting-views.ts";
import { createAdhocCallsClient, UNNAMED_FORMAT } from "../sources/graph/adhoc-calls.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { createConversationStore, MEETING_CHAT } from "../store/conversation-store.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aChatMember } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { createChatCallPresses } from "./chat-call-press.ts";
import { chatCallsPort } from "./chat-calls-port.ts";
import { meetingAction, type MeetingAction, type MeetingContext } from "./meeting-actions.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const MATE = "33333333-3333-4333-8333-333333333333";
const GUEST = "55555555-5555-4555-8555-555555555555";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOTIN = "77777777-7777-4777-8777-777777777777";
const CHAT = "19:demo-contoso-delivery@thread.v2";
const CHAT_NAME = "Contoso delivery";
const NOW = "2026-11-10T17:00:00Z";
const CALL_A = "aaaaaaaa-0000-4000-8000-00000000000a"; // ended, transcript ready
const CALL_B = "bbbbbbbb-0000-4000-8000-00000000000b"; // ended, no transcript event
const CALL_C = "cccccccc-0000-4000-8000-00000000000c"; // still live, transcript event
const CALL_D = "dddddddd-0000-4000-8000-00000000000d"; // no end event seen, transcript ready (start alone)
const VTT = "WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n<v Alex Rivera>Rates export is first.</v>\n\n00:00:40.000 --> 00:00:44.000\n<v Jordan Lee>I'll send the export spec by Friday.</v>\n";

type Teams = { list?: "ok" | "empty" | 403 | "off" | 404 | 503; names?: "on" | "off"; token?: "ok" | "consent" | "expired" };

async function setup() {
  const db = sqliteDb();
  await addUsers(db.conn, ME, MATE, GUEST, OUTSIDER, NOTIN);
  const instant = () => Temporal.Instant.from(NOW);
  const meetings = createMeetingStore(db.conn, instant);
  const teams = createTeamsStore(db.conn, instant);
  const conversations = createConversationStore(db.conn, instant, teams, async (chatId, uid) => {
    const s = await meetings.series(Number(chatId.slice(MEETING_CHAT.length)));
    return !!s && [...s.reviewers, ...s.attendees].includes(uid.toLowerCase());
  });
  // The chat: me and a teammate at Cooptimize, a guest on our tenant, someone outside.
  await teams.addChat({
    chatId: CHAT, clientKey: "contoso", kind: "delivery", displayName: CHAT_NAME, webUrl: null, by: ME,
    members: [aChatMember({ userId: ME, displayName: "Alex Rivera" }), aChatMember({ userId: MATE, displayName: "Jordan Lee" }), aChatMember({ userId: GUEST, displayName: "A Guest" }), aChatMember({ userId: OUTSIDER, displayName: "Out Sider", external: true })],
  });
  const started = (callId: string, at: string) => ({ chatId: CHAT, callId, kind: "started" as const, at, startedAt: at, initiatorId: ME, initiatorTenant: "home" });
  await teams.saveCalls(CHAT, [
    started(CALL_A, "2026-11-10T14:00:00.000Z"), { ...started(CALL_A, "2026-11-10T14:00:00.000Z"), kind: "ended", at: "2026-11-10T14:40:00.000Z" },
    started(CALL_B, "2026-11-10T12:00:00.000Z"), { ...started(CALL_B, "2026-11-10T12:00:00.000Z"), kind: "ended", at: "2026-11-10T12:30:00.000Z" },
    started(CALL_C, "2026-11-10T16:30:00.000Z"),
    started(CALL_D, "2026-11-09T15:00:00.000Z"),
  ]);
  await teams.saveTranscriptEvents(CHAT, [
    { chatId: CHAT, callId: CALL_A, at: "2026-11-10T14:42:00.000Z", transcriptId: "tr-a" },
    { chatId: CHAT, callId: CALL_C, at: "2026-11-10T16:50:00.000Z", transcriptId: "tr-c" },
    { chatId: CHAT, callId: CALL_D, at: "2026-11-10T03:00:00.000Z", transcriptId: "tr-d" },
  ]);
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "alex@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n`);
  if (!cfg.ok) throw new Error("config");
  const presses = createChatCallPresses();
  const sent: { who: string; url: string; accept: string }[] = [];
  const answers: { teams: Teams } = { teams: {} };
  const follows = new Map<string, ReadonlySet<string> | null>();
  const users = [ME, MATE, GUEST, OUTSIDER, NOTIN].map((id, i) => ({ id, name: ["Alex Rivera", "Jordan Lee", "A Guest", "Out Sider", "Sam Notin"][i]!, emails: [] }));
  // The people rule: guests and anyone outside aren't Cooptimizers.
  const cooptimizer = async (uid: string) => uid !== GUEST && uid !== OUTSIDER;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchFor = (who: string) => (async (u: string, init?: RequestInit) => {
    const url = String(u);
    const accept = String((init?.headers as Record<string, string>).accept);
    sent.push({ who, url, accept });
    const t = answers.teams;
    if (url.includes("/transcripts?")) {
      if (t.list === 403) return json({ error: { code: "Forbidden" } }, 403);
      if (t.list === "off") return json({ error: { code: "Forbidden", innerError: { code: "GraphAccessToTranscriptsDisabled" } } }, 403);
      if (t.list === 404) return json({ error: { code: "NotFound" } }, 404);
      if (t.list === 503) return json({}, 503);
      return json({ value: t.list === "empty" ? [] : [{ id: "tr-a", createdDateTime: "2026-11-10T14:00:30Z" }] });
    }
    if (t.names === "off" && accept !== UNNAMED_FORMAT) return json({ error: { code: "Forbidden", innerError: { code: "SpeakerAttributionNotAllowed" } } }, 403);
    return new Response(accept === UNNAMED_FORMAT ? "00:00:05.000 --> 00:00:08.000 \n\nRates export is first. \n" : VTT);
  }) as typeof fetch;
  const adhocFor = (who: string) =>
    createAdhocCallsClient({
      fetch: fetchFor(who),
      token: async () => {
        if (answers.teams.token === "consent") throw new AuthFailure("consent", "needs consent");
        if (answers.teams.token === "expired") throw new AuthFailure("expired", "signed out");
        return "fake-token";
      },
      invalidate: () => {},
      gate: { allowed: (callId) => presses.allowed(who, callId) },
      log: () => {},
    });
  const logs: LogRecord[] = [];
  const ctxAs = (me: string, o: { noPort?: boolean } = {}): MeetingContext => ({
    meetings, conversations, plan: planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC"), userId: me }),
    me: async () => me, isAdmin: async () => false, config: async () => cfg.config, now: () => NOW, homeDomains: async () => ["cooptimize.example"],
    graph: () => ({ recentCalls: async () => [] }) as unknown as NonNullable<ReturnType<MeetingContext["graph"]>>,
    users: async () => users,
    client: async (k) => (k.toLowerCase() === "contoso" ? { key: "contoso", name: "Contoso" } : k.toLowerCase() === "fabrikam" ? { key: "fabrikam", name: "Fabrikam" } : null),
    leads: async () => [], capture: async () => null, ai: async () => null, canWrite: async () => false,
    log: (r) => logs.push(r), cooptimizer,
    chatPress: presses,
    adhoc: () => adhocFor(me),
    ...(o.noPort ? {} : {
      chatCalls: chatCallsPort({
        teams, me: async () => me, now: () => NOW, cooptimizer,
        clientKeys: async () => (follows.has(me) ? follows.get(me)! : new Set(["contoso"])),
        users: async () => users.map((u) => ({ id: u.id, name: u.name, deleted: false })),
      }),
    }),
  });
  const act = (me: string, action: MeetingAction, input: unknown, o?: { noPort?: boolean }) => meetingAction(ctxAs(me, o), action, input);
  const data = <T,>(r: Awaited<ReturnType<typeof act>>) => {
    if (!r.ok) throw new Error(`${r.status}: ${r.error}`);
    return r.data as T;
  };
  const others = async (me: string) => data<{ calls: OtherCallView[] }>(await act(me, "meeting.calls", {})).calls;
  const chatRows = async (me: string) => (await others(me)).filter((c) => c.chat);
  const start = (me: string, callId = CALL_A, clientKey = "contoso") => act(me, "meeting.call_start", { key: chatCallKey(callId), startAt: "2026-11-10T14:00:00Z", endAt: "2026-11-10T14:40:00Z", clientKey });
  const fetchIt = (me: string, occurrenceId: number) => act(me, "meeting.call_fetch", { occurrenceId });
  return { db, teams, meetings, act, data, others, chatRows, start, fetchIt, sent, answers, follows, logs, presses };
}

describe("MC-2c: who sees a chat call in Calls", () => {
  it("a Cooptimizer in the chat who follows its client sees the call; a guest, someone outside, someone not in it or not following doesn't", async () => {
    const t = await setup();
    const mine = await t.chatRows(ME);
    expect(mine.map((c) => c.key)).toEqual([chatCallKey(CALL_A), chatCallKey(CALL_D)]);
    expect(mine[0]).toMatchObject({ name: `Call in ${CHAT_NAME}`, startAt: "2026-11-10T14:00:00Z", endAt: "2026-11-10T14:40:00Z", endKnown: true, chat: { name: CHAT_NAME, clientKey: "contoso" }, occurrenceId: null, seriesKey: null });
    // No end event: its start alone (the end stands in as when the transcript was ready, never shown).
    expect(mine[1]).toMatchObject({ endKnown: false });
    expect((await t.chatRows(MATE)).length).toBe(2);
    for (const who of [GUEST, OUTSIDER, NOTIN]) expect(await t.chatRows(who), who).toEqual([]);
    // Not following its client, or following that can't be read now (fails closed): nothing.
    t.follows.set(ME, new Set(["fabrikam"]));
    expect(await t.chatRows(ME)).toEqual([]);
    t.follows.set(ME, null);
    expect(await t.chatRows(ME)).toEqual([]);
    // Unregistered: gone with its chat.
    t.follows.delete(ME);
    await t.teams.removeChat(CHAT, ME);
    expect(await t.chatRows(ME)).toEqual([]);
  });

  it("a call with no transcript event and a live call aren't listed; the row has the mark, the source words, the client, no people count", async () => {
    const t = await setup();
    const listed = await t.others(ME);
    expect(listed.map((c) => c.key)).not.toContain(chatCallKey(CALL_B));
    expect(listed.map((c) => c.key)).not.toContain(chatCallKey(CALL_C));
    const rows = callRows({ meetings: [], occurrences: [], others: listed, today: "2026-11-10", zone: "America/Chicago", check: {} });
    const a = rows.find((r) => r.key === `c${chatCallKey(CALL_A)}`)!;
    expect(a).toMatchObject({ mark: "teams", check: "yes", source: "From a chat", people: null, suggested: "contoso", place: "week", bucket: "open" });
    // Not in Needs you; nothing counts toward the tab.
    expect(a.state.needsMe).toBe(false);
    // Listing asked Microsoft nothing.
    expect(t.sent).toEqual([]);
  });
});

describe("MC-2c: Review and the press", () => {
  it("Review keeps it as MC-2's call: the presser reviews, the other Cooptimizers in the chat are on it; the chat row gives way", async () => {
    const t = await setup();
    const s = t.data<{ occurrenceId: number; existed: boolean }>(await t.start(ME));
    expect(s.existed).toBe(false);
    const kept = (await t.meetings.callByKey(chatCallKey(CALL_A)))!;
    expect(kept.series).toMatchObject({ callKind: "chat", clientKey: "contoso", name: `Call in ${CHAT_NAME}`, reviewers: [ME], attendees: [MATE], joinUrl: `chat:${CHAT}`, eventId: chatCallKey(CALL_A) });
    // Only what Review needed: no guest, nobody outside, nobody not in the chat.
    expect(JSON.stringify(kept.series)).not.toMatch(/55555555|44444444|77777777/);
    // A second press (by a teammate) is the same call.
    expect(t.data<{ occurrenceId: number; existed: boolean }>(await t.start(MATE))).toEqual({ occurrenceId: s.occurrenceId, existed: true });
    // The chat row gives way to the kept call's row.
    const listed = await t.others(ME);
    expect(listed.find((c) => c.key === chatCallKey(CALL_A))!.occurrenceId).toBe(s.occurrenceId);
    // Pressing Review asked Microsoft nothing.
    expect(t.sent).toEqual([]);
    // The client can be changed in the setup: another call kept for another client.
    expect((await t.start(ME, CALL_D, "fabrikam")).ok).toBe(true);
    expect((await t.meetings.callByKey(chatCallKey(CALL_D)))!.series.clientKey).toBe("fabrikam");
  });

  it("refused before anything is kept: not a Cooptimizer, not in the chat, not following, a call with no event, a live one", async () => {
    const t = await setup();
    for (const who of [GUEST, OUTSIDER]) expect(await t.start(who), who).toMatchObject({ ok: false, status: 403 });
    expect(await t.start(NOTIN)).toMatchObject({ ok: false, status: 403, code: "not_in_chat" });
    t.follows.set(ME, new Set(["fabrikam"]));
    expect(await t.start(ME)).toMatchObject({ ok: false, status: 403, code: "not_in_chat" });
    t.follows.delete(ME);
    for (const id of [CALL_B, CALL_C]) expect(await t.start(ME, id), id).toMatchObject({ ok: false, code: "not_in_chat" });
    expect(await t.meetings.callByKey(chatCallKey(CALL_A))).toBeNull();
  });

  it("Get it from Teams: the two requests under /me, only with the presser's own press for this one call, then the review", async () => {
    const t = await setup();
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME));
    // A teammate on it can look but not fetch (only its reviewer acts).
    expect((await t.fetchIt(MATE, occurrenceId)).ok).toBe(false);
    expect(t.sent).toEqual([]);
    const r = t.data<{ outcome: string; lines: number; noSpeakers: boolean; message: string }>(await t.fetchIt(ME, occurrenceId));
    expect(r).toMatchObject({ outcome: "found", lines: 2, noSpeakers: false });
    expect(t.sent.map((x) => [x.who, x.url.replace("https://graph.microsoft.com/v1.0", ""), x.accept])).toEqual([
      [ME, `/me/adhocCalls/${CALL_A}/transcripts?$select=id,createdDateTime,endDateTime`, "application/json"],
      [ME, `/me/adhocCalls/${CALL_A}/transcripts/tr-a/content`, "text/vtt"],
    ]);
    // The press is over: nothing more passes for it.
    expect(t.presses.allowed(ME, CALL_A)).toBe(false);
    // MC-2 shows it from here: its reviewer and the teammate in the chat see the transcript; it is kept as from Teams.
    const rv = t.data<{ transcript: { lines: number }; noSpeakers: boolean; meeting: SeriesView; occurrence: OccurrenceView }>(await t.act(MATE, "meeting.review", { occurrenceId }));
    expect(rv.transcript.lines).toBe(2);
    expect(rv.noSpeakers).toBe(false);
    expect(rv.meeting.call).toBe("chat");
    // The teammate stops following the client (or leaves the chat): they don't see it any more; its reviewer still does.
    t.follows.set(MATE, new Set(["fabrikam"]));
    expect(await t.act(MATE, "meeting.review", { occurrenceId })).toMatchObject({ ok: false, status: 404 });
    expect(await t.act(MATE, "meeting.transcript", { occurrenceId })).toMatchObject({ ok: false, status: 404 });
    const mine = t.data<{ meetings: SeriesView[] }>(await t.act(MATE, "meeting.mine", {}));
    expect(mine.meetings).toEqual([]);
    expect(t.data<{ meetings: SeriesView[] }>(await t.act(ME, "meeting.mine", {})).meetings.map((m) => m.call)).toEqual(["chat"]);
  });

  it("the checks come again at the press: unregistered, not following, the port missing: refused before any request", async () => {
    const t = await setup();
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME));
    t.follows.set(ME, new Set(["fabrikam"]));
    expect(await t.fetchIt(ME, occurrenceId)).toMatchObject({ ok: false, status: 403, code: "not_in_chat" });
    t.follows.delete(ME);
    expect(t.data<{ outcome: string }>(await t.act(ME, "meeting.call_fetch", { occurrenceId }, { noPort: true })).outcome).toBe("unavailable");
    await t.teams.removeChat(CHAT, ME);
    expect(await t.fetchIt(ME, occurrenceId)).toMatchObject({ ok: false, status: 403, code: "not_in_chat" });
    expect(t.sent).toEqual([]);
  });
});

describe("MC-2c: each outcome in plain words, with the way on", () => {
  const cases: [Teams, string][] = [
    [{ token: "consent" }, "chat_not_granted"],
    [{ list: "off" }, "tenant_off"],
    [{ list: 403 }, "chat_refused"],
    [{ list: "empty" }, "chat_none"],
    [{ token: "expired" }, "signin"],
    [{ list: 503 }, "busy"],
  ];
  for (const [teams, outcome] of cases)
    it(`${JSON.stringify(teams)} is ${outcome}`, async () => {
      const t = await setup();
      const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME));
      t.answers.teams = teams;
      const r = t.data<{ outcome: string; message: string }>(await t.fetchIt(ME, occurrenceId));
      expect(r.outcome).toBe(outcome);
      expect(r.message).toBe(FETCH_WORDS[outcome as keyof typeof FETCH_WORDS]);
      if (outcome.startsWith("chat_")) expect(r.message.endsWith(CHAT_WAY_ON)).toBe(true);
      // Nothing kept; Upload is still there (the call waits for a file).
      expect(await t.meetings.transcript(occurrenceId)).toBeNull();
      expect((await t.meetings.occurrence(occurrenceId))!.state).toBe("needs_upload");
    });

  it("the words are the brief's", () => {
    expect(FETCH_WORDS.chat_not_granted).toContain("Cooptimize's Microsoft setup hasn't allowed FocusTime to read transcripts of calls started in chats yet. An admin allows it once.");
    expect(FETCH_WORDS.chat_refused).toContain("Microsoft didn't let your sign-in read this call's transcript. Teams lets the people who were on a call read it. If you weren't on it, ask someone who was to review it here.");
    expect(FETCH_WORDS.chat_none).toContain("Teams doesn't have this transcript, or it isn't ready yet. Try again in a few minutes.");
    for (const w of Object.values(FETCH_WORDS)) expect(w).not.toMatch(/—/);
  });

  it("speaker names off: asked once more without them; the review says so", async () => {
    const t = await setup();
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME));
    t.answers.teams = { names: "off" };
    const r = t.data<{ outcome: string; noSpeakers: boolean; message: string }>(await t.fetchIt(ME, occurrenceId));
    expect(r).toMatchObject({ outcome: "found", noSpeakers: true });
    expect(r.message).toContain(CHAT_NO_SPEAKERS);
    expect(t.sent.slice(1).map((x) => x.accept)).toEqual(["text/vtt", UNNAMED_FORMAT]);
    const rv = t.data<{ noSpeakers: boolean; pocket: boolean }>(await t.act(ME, "meeting.review", { occurrenceId }));
    expect(rv).toMatchObject({ noSpeakers: true, pocket: false });
    expect(CHAT_NO_SPEAKERS).toBe("Teams gave this transcript without speaker names.");
  });
});

describe("MC-2c: Hide, Undo and the Pocket fit", () => {
  it("Hide keeps only this call's key, with Undo and the Hidden filter; a call someone reviewed can't be hidden", async () => {
    const t = await setup();
    const key = chatCallKey(CALL_A);
    expect((await t.act(ME, "meeting.call_hide", { keys: [key] })).ok).toBe(true);
    const h = t.data<{ keys: string[]; series: string[] }>(await t.act(ME, "meeting.call_hides", {}));
    expect(h).toEqual({ keys: [key], series: [] });
    const rows = callRows({ meetings: [], occurrences: [], others: await t.others(ME), today: "2026-11-10", zone: "UTC", check: {}, hides: { keys: new Set(h.keys), series: new Set() } });
    expect(rows.find((r) => r.other?.key === key)!.bucket).toBe("hidden");
    // Only mine: a teammate's list is as it was.
    expect(t.data<{ keys: string[] }>(await t.act(MATE, "meeting.call_hides", {})).keys).toEqual([]);
    expect((await t.act(ME, "meeting.call_unhide", { keys: [key] })).ok).toBe(true);
    expect(t.data<{ keys: string[] }>(await t.act(ME, "meeting.call_hides", {})).keys).toEqual([]);
    await t.start(ME);
    expect(await t.act(ME, "meeting.call_hide", { keys: [key] })).toMatchObject({ ok: false, status: 409 });
  });

  it("a Pocket recording that fits by PK-4's rule goes with the chat call", async () => {
    const t = await setup();
    const rec = { id: "rec-1", startAt: "2026-11-10T14:01:00Z", endAt: "2026-11-10T14:39:00Z", minutes: 38, title: "" };
    const rows = callRows({ meetings: [], occurrences: [], others: await t.others(ME), today: "2026-11-10", zone: "UTC", check: {}, addPocket: pocketRows([rec], "UTC") });
    const a = rows.find((r) => r.other?.key === chatCallKey(CALL_A))!;
    expect(a.pocket.map((p) => p.id)).toEqual(["rec-1"]);
    expect(a.mark).toBe("both");
  });
});

describe("MC-2c: nothing by itself, and logs", () => {
  it("only the press fetches: not the list, Review, meeting.mine, the poll, a job, the assistant or the bot", () => {
    const fromCode = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const f of ["actions/request-poll.ts", "server/meeting-job.ts", "assistant/allowlist.ts", "server/ticks.ts", "server/teams/rhythm.ts"]) {
      let src = "";
      try {
        src = fromCode(f);
      } catch {
        continue;
      }
      expect(src, f).not.toMatch(/adhocCalls|readChatTranscript|call_fetch/);
    }
  });

  it("logs carry the op, kind and count: never a call, chat or transcript id, a name or any text", async () => {
    const t = await setup();
    await t.others(ME);
    const { occurrenceId } = t.data<{ occurrenceId: number }>(await t.start(ME));
    await t.fetchIt(ME, occurrenceId);
    t.answers.teams = { list: 403 };
    await t.fetchIt(ME, occurrenceId);
    expect(t.logs.length).toBeGreaterThan(0);
    const all = JSON.stringify(t.logs);
    for (const bad of [CALL_A, CHAT, "tr-a", CHAT_NAME, "Alex", "Jordan", "Rates export", "Contoso delivery"]) expect(all).not.toContain(bad);
    for (const l of t.logs) expect(Object.keys(l).every((k) => ["source", "op", "kind", "count", "status", "durationMs", "outcome", "proposals", "cost"].includes(k)), JSON.stringify(Object.keys(l))).toBe(true);
  });
});
