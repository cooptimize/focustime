// MC-1: registering, uploading and reviewing a client's weekly call. Registration is an admin's and keeps only what
// the registrant's calendar shows; a client-hosted meeting is never asked of Graph. Uploads are a reviewer's, for
// a call they can see; .vtt and .docx land the same. Confirm makes each kept proposal through the existing writes
// (the DevOps write framework for gaps and comments; a shared commitment for promises), and skipped ones write nothing.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import type { LogRecord } from "../log/logger.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { buildProcessModel } from "../plan/process.ts";
import type { MeetingsClient, SeriesCandidate } from "../sources/graph/meetings.ts";
import { createConversationStore, MEETING_CHAT } from "../store/conversation-store.ts";
import { createMeetingStore } from "../store/meeting-store.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { transcriptDocx, transcriptVtt, zipOf } from "../test/docx.ts";
import { pocketPdf } from "../test/pdf.ts";
import type { ReadPdf } from "./transcript-file.ts";
import { pdfReader } from "../server/pdf-text.ts";
import { CALL_ROW } from "../plan/call-words.ts";
import type { ActionResponse } from "./types.ts";
import { meetingAction, meetingWrites, uploadTranscript, type MeetingAction, type MeetingContext } from "./meeting-actions.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const MATE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOW0 = "2026-11-10T17:00:00Z";
let NOW = NOW0;
const readPdf = pdfReader();
const JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_contoso%40thread.v2/0";
const CLIENT_HOSTED = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_fabrikamhosted%40thread.v2/0";

const cues = [
  { speaker: "Sam Admin", at: "0:05", text: "Rates export is first." },
  { speaker: "Dana Client", at: "0:40", text: "We also need a holiday calendar import." },
  { speaker: "Lee Mate", at: "1:10", text: "I'll send the export spec by Friday." },
  { speaker: "Dana Client", at: "1:35", text: "Decided: CSV only for now. I'll send sample rates." },
];
const ANSWER = {
  gaps: [{ type: "User Story", parentId: 1201, title: "Holiday calendar import", description: "Import the client's holidays.", lines: [2] }],
  commitments: [
    { who: "Lee Mate", what: "Send the export spec", toName: "Dana Client", due: "2026-11-13", lines: [3] },
    { who: "Dana Client", what: "Send sample rates", toName: null, due: null, lines: [4] },
  ],
  comments: [{ itemId: 1201, note: "decision", text: "CSV only for now; Excel later.", lines: [4] }],
  // MC-2: the answer has a summary now (the schema requires one).
  summary: ["Decided CSV only for now."],
};

async function setup() {
  const db = sqliteDb();
  await addUsers(db.conn, ADMIN, LEAD, MATE, OUTSIDER);
  const instant = () => Temporal.Instant.from(NOW);
  const meetings = createMeetingStore(db.conn, instant);
  const teams = createTeamsStore(db.conn, instant);
  const conversations = createConversationStore(db.conn, instant, teams, async (chatId, uid) => {
    const s = await meetings.series(Number(chatId.slice(MEETING_CHAT.length)));
    return !!s && [...s.reviewers, ...s.attendees].includes(uid.toLowerCase());
  });
  const cfg = parseConfig(`${STARTER_TOML.replace('my_email = ""', 'my_email = "sam@cooptimize.example"')}\n[clients.contoso]\nname = "Contoso"\n\n[clients.fabrikam]\nname = "Fabrikam"\n`);
  if (!cfg.ok) throw new Error("config");
  const graphCalls: string[] = [];
  const candidate = (p: Partial<SeriesCandidate> = {}): SeriesCandidate => ({ eventId: "E-contoso", subject: "Contoso / Cooptimize sync", organizerName: "Sam Admin", organizerEmail: "sam@cooptimize.example", joinUrl: JOIN, weekday: 2, start: "10:00", minutes: 60, zone: "America/New_York", interval: 1, outside: 3, homeAttendees: ["sam@cooptimize.example", "lee@cooptimize.example"], ...p });
  const graph = {
    seriesOnMyCalendar: async () => (graphCalls.push("seriesOnMyCalendar"), [candidate()]),
    series: async (eventId: string) => (graphCalls.push("series"), eventId === "E-contoso" ? candidate() : null),
    seriesByJoinUrl: async (url: string) => (graphCalls.push("seriesByJoinUrl"), url === CLIENT_HOSTED ? candidate({ eventId: "E-fab", subject: "Fabrikam weekly", organizerEmail: "pm@fabrikam.example", joinUrl: CLIENT_HOSTED, weekday: 4, start: "14:00", minutes: 30 }) : null),
    instances: async () => (graphCalls.push("instances"), []),
    onlineMeetingId: async () => (graphCalls.push("onlineMeetingId"), "om"),
    transcripts: async () => (graphCalls.push("transcripts"), []),
    transcriptVtt: async () => (graphCalls.push("transcriptVtt"), ""),
  } as unknown as MeetingsClient;
  const providerCalls: ProviderCall[] = [];
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => (providerCalls.push(c), JSON.stringify(ANSWER)) }),
    app: anAiApp(),
    rules: async () => anAiRules({ allowedClients: ["contoso"] }),
    guard: async () => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], itemIds: [4410] })], homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
    sleep: async () => {},
  });
  const users = [
    { id: ADMIN, name: "Sam Admin", emails: ["sam@cooptimize.example"] },
    { id: LEAD, name: "Kim Lead", emails: ["kim@cooptimize.example"] },
    { id: MATE, name: "Lee Mate", emails: ["lee@cooptimize.example"] },
    { id: OUTSIDER, name: "Out Sider", emails: ["out@cooptimize.example"] },
  ];
  // MC-1c: the organization's clients (Admin › Clients' list), whatever the admin's own settings hold.
  const orgClients = ["contoso", "fabrikam", "Northwind"];
  const ctxAs = (me: string, o: { admin?: boolean; write?: boolean; graph?: MeetingsClient | null; log?: (r: LogRecord) => void; clientsDown?: boolean; usersFail?: boolean; readPdf?: ReadPdf } = {}): MeetingContext => ({
    meetings, conversations, plan: planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC"), userId: me }),
    me: async () => me, isAdmin: async () => !!o.admin, config: async () => cfg.config, now: () => NOW, homeDomains: async () => ["cooptimize.example"],
    graph: () => (o.graph === undefined ? graph : o.graph), users: async () => { if (o.usersFail) throw new Error("db down"); return users; },
    client: async (k) => {
      if (o.clientsDown) return "unavailable"; const hit = orgClients.find((c) => c.toLowerCase() === k.trim().toLowerCase()); return hit ? { key: hit, name: hit } : null; }, leads: async () => [LEAD],
    capture: async (_c, k) => (k === "contoso" ? { clientName: "Contoso", internal: false, items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })], model: buildProcessModel(aClientProcess()), directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], itemIds: [4410] })] } : null),
    ai: async () => ai,
    canWrite: async () => o.write ?? true,
    log: o.log ?? (() => {}),
    readPdf: o.readPdf ?? readPdf,
  });
  const act = (me: string, action: MeetingAction, input: unknown, o?: Parameters<typeof ctxAs>[1]) => meetingAction(ctxAs(me, o), action, input);
  return { db, meetings, conversations, graphCalls, providerCalls, act, ctxAs, graph, candidate };
}

const data = <T>(r: ActionResponse): T => {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data as T;
};

describe("meeting capture actions (MC-1)", () => {
  it("lets only admins register, with the registrant and the client's leads as reviewers", async () => {
    const { act } = await setup();
    expect(await act(LEAD, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" })).toMatchObject({ ok: false, status: 403 });
    const m = data<{ meeting: { source: string; reviewers: { id: string }[]; attendees: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    expect(m.source).toBe("automatic");
    expect(m.reviewers.map((r) => r.id)).toEqual([ADMIN, LEAD]);
    expect(m.attendees).toBe(2);
    expect(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).toMatchObject({ ok: false, status: 409 });
  });

  it("registers a client-hosted meeting from calendar fields only, as Upload, and never asks Graph about it", async () => {
    const { act, meetings, graphCalls } = await setup();
    const m = data<{ meeting: { id: number; source: string; organizer: string } }>(await act(ADMIN, "meeting.register", { clientKey: "fabrikam", role: "status", joinUrl: CLIENT_HOSTED }, { admin: true })).meeting;
    expect(m).toMatchObject({ source: "upload", organizer: "other" });
    expect(graphCalls).toEqual(["seriesByJoinUrl"]);
    const stored = (await meetings.series(m.id))!;
    expect(stored).toMatchObject({ name: "Fabrikam weekly", weekday: 4, start: "14:00", minutes: 30, onlineMeetingId: null });
    expect(await act(ADMIN, "meeting.update", { seriesId: m.id, source: "automatic" }, { admin: true })).toMatchObject({ ok: false, status: 409 });
    expect(await act(ADMIN, "meeting.register", { clientKey: "fabrikam", role: "status", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_other%40thread.v2/0", source: "automatic" }, { admin: true })).toMatchObject({ ok: false });
    expect(graphCalls.filter((c) => /online|transcript/i.test(c))).toEqual([]);
  });

  it("takes an upload only from a reviewer of that call; .vtt and .docx give the same transcript", async () => {
    const { act, ctxAs, meetings, providerCalls } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const docx = transcriptDocx(cues);
    expect(await uploadTranscript(ctxAs(MATE), { seriesId: m.id, date: "2026-11-10", bytes: docx })).toMatchObject({ ok: false, status: 403 });
    expect(await uploadTranscript(ctxAs(OUTSIDER), { seriesId: m.id, date: "2026-11-10", bytes: docx })).toMatchObject({ ok: false, status: 404 });
    expect(await uploadTranscript(ctxAs(ADMIN), { seriesId: 999, date: "2026-11-10", bytes: docx })).toMatchObject({ ok: false, status: 404 });
    const a = data<{ occurrenceId: number; outcome: string; proposals: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: docx }));
    // MC-1e: the provider's comment on #1201, a Feature, is never a proposal (comments go on stories only).
    expect(a).toMatchObject({ outcome: "done", proposals: 3 });
    const fromDocx = await meetings.transcript(a.occurrenceId);
    const b = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(LEAD), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    expect(b.occurrenceId).toBe(a.occurrenceId);
    expect(await meetings.transcript(b.occurrenceId)).toEqual(fromDocx);
    expect(providerCalls.every((c) => !/Fabrikam|4410/.test(c.input))).toBe(true);
    expect(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode("%PDF") })).toMatchObject({ ok: false, status: 422 });
  });

  it("MC-6: the server says which promises are mine; mine says \"your Promises\", another person's never does", async () => {
    const { act, ctxAs } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    type R = { proposals: { id: number; body: { kind: string; side?: string; who?: string } }[]; mine: number[] };
    const r = data<R>(await act(ADMIN, "meeting.review", { occurrenceId }));
    const lees = r.proposals.find((p) => p.body.kind === "commitment" && p.body.side === "cooptimize")!;
    // To me (the admin) Lee's promise isn't mine; to Lee it is.
    expect(r.mine).toEqual([]);
    expect(data<R>(await act(MATE, "meeting.review", { occurrenceId })).mine).toEqual([lees.id]);
    // Keep by another reviewer names Lee; Keep by Lee says "your".
    expect(await act(ADMIN, "meeting.update", { seriesId: m.id, reviewers: [ADMIN, LEAD, MATE] }, { admin: true })).toMatchObject({ ok: true });
    const kept = data<{ message: string }>(await act(MATE, "meeting.keep", { proposalId: lees.id })).message;
    expect(kept).toBe("Added to your Promises");
  });

  it("keeps a promise from its row at once, sends DevOps changes only through the write framework, and writes nothing for a skipped one (MC-1e)", async () => {
    const { act, ctxAs, conversations, meetings } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    const r = data<{ proposals: { id: number; kind: string; body: { side?: string } }[]; canConfirm: boolean }>(await act(ADMIN, "meeting.review", { occurrenceId }));
    expect(r.canConfirm).toBe(true);
    // The fake process's stories are User Story; the comment the provider proposed on the Feature never became one.
    expect(r.proposals.map((p) => p.kind)).toEqual(["gap", "commitment", "commitment"]);
    const [gap, mateP, clientP] = r.proposals;
    // Attendees view; they can't keep, skip or send.
    expect(data<{ canConfirm: boolean }>(await act(MATE, "meeting.review", { occurrenceId })).canConfirm).toBe(false);
    expect(await act(MATE, "meeting.keep", { proposalId: mateP!.id })).toMatchObject({ ok: false, status: 403 });
    expect(await act(MATE, "meeting.edit", { proposalId: gap!.id, skip: true })).toMatchObject({ ok: false, status: 403 });
    expect(await meetingWrites(meetings, MATE, () => NOW, () => {}).proposal(gap!.id)).toBeNull();
    expect(await act(OUTSIDER, "meeting.review", { occurrenceId })).toMatchObject({ ok: false, status: 404 });

    // Both promises from their rows, at once; the gap through the write framework's port (the one preview).
    expect(data<{ message: string }>(await act(ADMIN, "meeting.keep", { proposalId: mateP!.id })).message).toBe("Added to Lee's Promises");
    expect(data<{ message: string }>(await act(ADMIN, "meeting.keep", { proposalId: clientP!.id })).message).toBe("Noted with this call: Dana Client");
    expect(await act(ADMIN, "meeting.keep", { proposalId: gap!.id })).toMatchObject({ ok: false, status: 409 });
    const port = meetingWrites(meetings, ADMIN, () => NOW, () => {});
    expect(await port.proposal(gap!.id)).toMatchObject({ clientKey: "contoso", body: { kind: "gap", title: "Holiday calendar import" } });
    await port.written(gap!.id, { ok: true, writeId: 100, itemId: 9000, message: "Created #9000", type: "User Story" });
    const after = await meetings.proposals(occurrenceId);
    expect(after.find((p) => p.id === gap!.id)).toMatchObject({ state: "confirmed", result: { writeId: 100, itemId: 9000 } });
    expect(await port.proposal(gap!.id)).toBeNull();
    expect((await meetings.occurrence(occurrenceId))?.state).toBe("reviewed");

    // The Cooptimizer's promise is in their own Promises; the client's is my Waiting on. Nobody's plan was written.
    const chat = `${MEETING_CHAT}${m.id}`;
    const theirs = await conversations.viewer(MATE).commitmentsBy([chat]);
    expect(theirs.map((k) => k.what)).toEqual(["Send the export spec"]);
    expect(theirs[0]).toMatchObject({ dueDate: "2026-11-13", state: "open" });
    expect((await conversations.viewer(ADMIN).commitmentsTo([chat])).map((k) => k.what)).toEqual(["Send sample rates"]);
    expect(await conversations.viewer(OUTSIDER).commitmentsBy([chat])).toEqual([]);
    expect(await conversations.viewer(OUTSIDER).commitment(theirs[0]!.id)).toBeNull();

    // Undo takes the promise back and opens the row and the call again.
    expect(data<{ proposal: { state: string } }>(await act(ADMIN, "meeting.unkeep", { proposalId: mateP!.id })).proposal.state).toBe("open");
    expect(await conversations.viewer(MATE).commitmentsBy([chat])).toEqual([]);
    expect((await meetings.occurrence(occurrenceId))?.state).toBe("ready");
  });

  it("a failed write is said in plain words on its row, never DevOps's error text (MC-1e)", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    const gap = (await meetings.proposals(occurrenceId)).find((p) => p.kind === "gap")!;
    await meetingWrites(meetings, ADMIN, () => NOW, () => {}).written(gap.id, { ok: false, writeId: 7, itemId: null, message: "DevOps refused the change: TF401320: Rule Error for field Cost Center. Error code: Required, HasValues.", type: "User Story" });
    const p = (await meetings.proposals(occurrenceId)).find((x) => x.id === gap.id)!;
    expect(p.state).toBe("failed");
    expect(p.result?.message).toBe("DevOps says Cost Center is needed on a new User Story. Fill it in on this row and try again, or create this one in DevOps and skip it here.");
    expect(p.result?.message).not.toMatch(/TF4|Error code/);
    // Still to review, and its words are kept: it can be fixed and tried again.
    expect(await meetingWrites(meetings, ADMIN, () => NOW, () => {}).proposal(gap.id)).toMatchObject({ body: { title: "Holiday calendar import" } });
  });

  it("says DevOps is read only without my write PAT, and dismisses with No transcript this week", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    expect(data<{ canWrite: boolean }>(await act(ADMIN, "meeting.review", { occurrenceId }, { write: false })).canWrite).toBe(false);
    const o2 = await meetings.ensureOccurrence(m.id, "2026-11-17", "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z", "needs_upload", null);
    expect(await act(MATE, "meeting.no_transcript", { occurrenceId: o2.id })).toMatchObject({ ok: false, status: 403 });
    expect(data<{ occurrence: { state: string } }>(await act(LEAD, "meeting.no_transcript", { occurrenceId: o2.id })).occurrence.state).toBe("no_transcript");
  });
});

// MC-1c: the two reported errors. An admin registering for a client they keep no personal settings for was told "That
// isn't one of FocusTime's clients"; any refusal from Microsoft while listing or registering escaped as "bad request".
describe("meeting registration fixes (MC-1c)", () => {
  const failing = (e: () => Error) => ({ seriesOnMyCalendar: async () => { throw e(); }, series: async () => { throw e(); }, seriesByJoinUrl: async () => { throw e(); } }) as unknown as MeetingsClient;
  const FAILURES: [string, () => Error, RegExp, string][] = [
    ["400", () => new HttpError(400), /Microsoft didn't accept that request/, "graph_refused"],
    ["401", () => new HttpError(401), /Sign in with Microsoft again/, "signin"],
    ["signed out", () => new AuthFailure("expired", "x"), /Sign in with Microsoft again/, "signin"],
    ["403", () => new HttpError(403), /Calendars\.ReadWrite.*Cooptimize admin grants it once for everyone/, "consent"],
    ["429", () => new HttpError(429, 30), /Microsoft isn't answering right now\. Try again in a minute/, "busy"],
    ["500", () => new HttpError(500), /Microsoft isn't answering right now/, "busy"],
    ["network", () => new NetworkError("network"), /Microsoft isn't answering right now/, "busy"],
  ];

  it("registers for a client in the organization's list that the admin keeps no settings for", async () => {
    const { act } = await setup();
    const r = data<{ meeting: { clientKey: string; name: string } }>(await act(ADMIN, "meeting.register", { clientKey: "Northwind", role: "status", eventId: "E-contoso" }, { admin: true }));
    expect(r.meeting.clientKey).toBe("Northwind");
    expect(data<{ meetings: unknown[] }>(await act(ADMIN, "meeting.list", { clientKey: "Northwind" }, { admin: true })).meetings).toHaveLength(1);
    expect((await act(ADMIN, "meeting.candidates", { clientKey: "Northwind" }, { admin: true })).ok).toBe(true);
  });

  it("matches a client key in another case to the organization's key, and refuses a key that isn't a client", async () => {
    const { act, meetings } = await setup();
    const r = data<{ meeting: { clientKey: string } }>(await act(ADMIN, "meeting.register", { clientKey: "NORTHWIND", role: "status", eventId: "E-contoso" }, { admin: true }));
    expect(r.meeting.clientKey).toBe("Northwind");
    expect(await meetings.seriesOf("Northwind")).toHaveLength(1);
    expect(data<{ meetings: unknown[] }>(await act(ADMIN, "meeting.list", { clientKey: "northwind" }, { admin: true })).meetings).toHaveLength(1);
    for (const action of ["meeting.list", "meeting.candidates", "meeting.register"] as const) {
      const out = await act(ADMIN, action, action === "meeting.register" ? { clientKey: "tailspin", role: "status", eventId: "E-contoso" } : { clientKey: "tailspin" }, { admin: true });
      expect(out).toMatchObject({ ok: false, status: 404, error: "That isn't one of FocusTime's clients" });
    }
  });

  it("names a pasted link's meeting from the organization's name for the client", async () => {
    const { act } = await setup();
    const r = data<{ meeting: { name: string } }>(await act(ADMIN, "meeting.register", { clientKey: "northwind", role: "status", joinUrl: JOIN, weekday: 2, start: "10:00", minutes: 30 }, { admin: true }));
    expect(r.meeting.name).toBe("Northwind weekly call");
  });

  for (const [label, err, words, code] of FAILURES) {
    it(`says why when Microsoft answers ${label} during candidates and register, and logs its kind`, async () => {
      const { act } = await setup();
      const logs: LogRecord[] = [];
      const o = { admin: true, graph: failing(err), log: (r: LogRecord) => void logs.push(r) };
      const c = await act(ADMIN, "meeting.candidates", { clientKey: "contoso" }, o);
      expect(c).toMatchObject({ ok: false, code });
      expect(!c.ok && c.error).toMatch(words);
      expect(!c.ok && c.error).not.toMatch(/bad request/i);
      const r = await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, o);
      expect(r).toMatchObject({ ok: false, code });
      expect(!r.ok && r.error).toMatch(words);
      expect(logs.filter((l) => l.op === "meeting_graph_failed").map((l) => l.kind)).toEqual([code, code]);
      expect(JSON.stringify(logs)).not.toMatch(/Bearer|E-contoso|meetup-join/);
    });
  }

  it("for a pasted link Microsoft couldn't check, says why and asks for the pattern; with the pattern it registers as Upload", async () => {
    const { act } = await setup();
    const o = { admin: true, graph: failing(() => new HttpError(503)) };
    const r = await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", joinUrl: JOIN }, o);
    expect(r).toMatchObject({ ok: false, status: 422, code: "busy" });
    expect(!r.ok && r.error).toMatch(/Microsoft isn't answering right now.*weekday, start time and length/);
    const m = data<{ meeting: { source: string; organizer: string } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", joinUrl: JOIN, weekday: 2, start: "10:00", minutes: 30 }, o)).meeting;
    expect(m).toMatchObject({ source: "upload", organizer: "unknown" });
  });

  it("registers a call a Cooptimize teammate organizes, from my calendar and by pasted link, as Automatic", async () => {
    const { act, graph, candidate } = await setup();
    const mates = candidate({ eventId: "E-mate", organizerName: "Lee Mate", organizerEmail: "lee@cooptimize.example", subject: "Contoso weekly" });
    const g = { ...graph, seriesOnMyCalendar: async () => [mates], series: async (id: string) => (id === "E-mate" ? mates : null), seriesByJoinUrl: async () => mates } as unknown as MeetingsClient;
    const cands = data<{ candidates: { eventId: string; organizer: string }[] }>(await act(ADMIN, "meeting.candidates", { clientKey: "contoso" }, { admin: true, graph: g })).candidates;
    expect(cands).toEqual([expect.objectContaining({ eventId: "E-mate", organizer: "home" })]);
    const a = data<{ meeting: { source: string; organizer: string; reviewers: { id: string }[] } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-mate" }, { admin: true, graph: g })).meeting;
    expect(a).toMatchObject({ source: "automatic", organizer: "home" });
    expect(a.reviewers[0]!.id).toBe(ADMIN);
    const b = data<{ meeting: { source: string } }>(await act(ADMIN, "meeting.register", { clientKey: "fabrikam", role: "status", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_other%40thread.v2/0" }, { admin: true, graph: { ...g, seriesByJoinUrl: async () => ({ ...mates, eventId: "E-mate2", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_other%40thread.v2/0" }) } as unknown as MeetingsClient })).meeting;
    expect(b.source).toBe("automatic");
  });

  // The review pass's findings.
  it("fails closed when the client list can't be read, never falling back to the admin's settings", async () => {
    const { act } = await setup();
    for (const action of ["meeting.list", "meeting.candidates"] as const) expect(await act(ADMIN, action, { clientKey: "contoso" }, { admin: true, clientsDown: true })).toMatchObject({ ok: false, status: 503, error: /couldn't read the client list/ });
  });

  it("refuses a non-admin before looking up the client", async () => {
    const { act } = await setup();
    for (const action of ["meeting.list", "meeting.candidates"] as const) expect(await act(LEAD, action, { clientKey: "tailspin" })).toMatchObject({ ok: false, status: 403 });
    expect(await act(LEAD, "meeting.register", { clientKey: "tailspin", role: "status", eventId: "E-contoso" })).toMatchObject({ ok: false, status: 403 });
  });

  it("never answers bad request for an unexpected failure", async () => {
    const { act } = await setup();
    const r = await act(ADMIN, "meeting.list", { clientKey: "contoso" }, { admin: true, usersFail: true });
    expect(r).toMatchObject({ ok: false, status: 500, code: "failed" });
    expect(!r.ok && r.error).toMatch(/FocusTime couldn't finish that/);
  });

  it("asks a signed-out admin who pasted a link to sign in, or for the pattern", async () => {
    const { act } = await setup();
    const r = await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", joinUrl: JOIN }, { admin: true, graph: null });
    expect(r).toMatchObject({ ok: false, status: 422, code: "signin" });
    expect(!r.ok && r.error).toMatch(/^Sign in with Microsoft again.*weekday, start time and length/);
  });

  it("refuses the same call registered again, however the link was copied, and hides it from another admin's candidates", async () => {
    const { act, meetings, graph, candidate } = await setup();
    data(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true }));
    const variant = JOIN.replace("%3a", "%3A") + "?context=%7b%22Tid%22%7d";
    expect(await act(LEAD, "meeting.register", { clientKey: "contoso", role: "status", joinUrl: variant, weekday: 2, start: "10:00", minutes: 60 }, { admin: true })).toMatchObject({ ok: false, status: 409, error: "That meeting is already registered" });
    // Another admin's own copy of the series has another event id.
    const theirs = { ...graph, seriesOnMyCalendar: async () => [candidate({ eventId: "E-their-copy" })] } as unknown as MeetingsClient;
    expect(data<{ candidates: unknown[] }>(await act(LEAD, "meeting.candidates", { clientKey: "contoso" }, { admin: true, graph: theirs })).candidates).toEqual([]);
    // Two admins at once: the store refuses the second inside its transaction.
    const base = { clientKey: "fabrikam", name: "x", role: "status" as const, source: "upload" as const, detected: "upload" as const, organizer: "unknown" as const, joinUrl: CLIENT_HOSTED, eventId: null, registrantId: ADMIN, weekday: 4, start: "14:00", minutes: 30, zone: "UTC", interval: 1, reviewers: [ADMIN], attendees: [] };
    const both = await Promise.allSettled([meetings.addSeries(base), meetings.addSeries({ ...base, registrantId: LEAD, joinUrl: CLIENT_HOSTED.toUpperCase().replace("HTTPS://TEAMS.MICROSOFT.COM", "https://teams.microsoft.com") })]);
    expect(both.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});

describe("a Pocket export as a call's transcript (PK-1)", () => {
  // Invented words. Line 3 names Lee in its own words; line 4 names nobody.
  const turns = [
    { label: "SPEAKER_00", text: "Rates export is first." },
    { label: "SPEAKER_01", text: "We also need a holiday calendar import." },
    { label: "SPEAKER_02", text: "Lee here. I'll send the export spec by Friday." },
    { label: "SPEAKER_01", text: "Decided: CSV only for now. I'll send sample rates." },
  ];
  const register = async (act: Awaited<ReturnType<typeof setup>>["act"]) => data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;

  it("a recording dated another day asks first and keeps nothing; it is used only on a yes", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = await register(act);
    const logs: LogRecord[] = [];
    const zip = zipOf({ "export.pdf": pocketPdf({ date: "Nov 9, 2026 • 31:10", title: "An invented title", turns }) });
    const asked = data<{ ask: unknown }>(await uploadTranscript(ctxAs(ADMIN, { log: (r) => void logs.push(r) }), { seriesId: m.id, date: "2026-11-10", bytes: zip }));
    expect(asked.ask).toEqual({ recorded: "2026-11-09", length: "31:10", call: "2026-11-10" });
    expect(await meetings.occurrencesOf(m.id)).toEqual([]);
    const used = data<{ occurrenceId: number; kind: string }>(await uploadTranscript(ctxAs(ADMIN, { log: (r) => void logs.push(r) }), { seriesId: m.id, date: "2026-11-10", bytes: zip, dateOk: true }));
    expect(used.kind).toBe("pocket");
    expect((await meetings.occurrence(used.occurrenceId))!.transcriptKind).toBe("pocket");
    // The log: kinds, sizes and counts; never a word, the title, a label or a name.
    expect(logs.filter((l) => l.op.startsWith("meeting_upload")).map((l) => [l.op, l.kind])).toEqual([
      ["meeting_upload_ask", "pocket.zip"],
      ["meeting_upload", "pocket.zip"],
      ["meeting_upload_bytes", "pocket.zip"],
      ["meeting_upload_unpacked", "entries:1"],
      ["meeting_upload_pages", "pocket.zip"],
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/invented|SPEAKER|Speaker|export spec|Rates|Lee|\.pdf/i);
  });

  it("the same day, or no date at all, doesn't ask", async () => {
    const { act, ctxAs } = await setup();
    const m = await register(act);
    expect(data<{ ask?: unknown; kind: string }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ date: "Nov 10, 2026 • 31:10", turns }) }))).toMatchObject({ kind: "pocket" });
    const none = data<{ ask?: unknown; kind: string }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ date: null, turns }) }));
    expect(none.ask).toBeUndefined();
    expect(none.kind).toBe("pocket");
  });

  it("no times anywhere, numbered speakers, and promises that are someone's only when the words say so", async () => {
    const { act, ctxAs, conversations, providerCalls } = await setup();
    const m = await register(act);
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ date: "Nov 10, 2026 • 31:10", turns }) }));
    // The AI was told, and got no times.
    const sent = providerCalls.at(-1)!;
    expect(sent.instructions).toContain("Labels like Speaker 1 are not people");
    expect(sent.input).toContain("L3 Speaker 3: Lee here. I'll send the export spec by Friday.");
    expect(sent.input).not.toMatch(/\[\d+:\d\d\]/);
    const r = data<{ pocket: boolean; transcript: { lines: number }; proposals: { id: number; body: { kind: string; side?: string; who?: string; whoId?: string | null }; quotes: { at: string }[] }[] }>(await act(ADMIN, "meeting.review", { occurrenceId }));
    expect(r.pocket).toBe(true);
    expect(r.proposals.flatMap((p) => p.quotes).every((q) => q.at === "")).toBe(true);
    const promises = r.proposals.filter((p) => p.body.kind === "commitment");
    expect(promises.map((p) => [p.body.side, p.body.who, p.body.whoId])).toEqual([["cooptimize", "Lee Mate", MATE.toLowerCase()], ["unknown", "", null]]);
    // The transcript view: no time on any line.
    const t = data<{ lines: { speaker: string; at: string; sec: number | null }[] }>(await act(MATE, "meeting.transcript", { occurrenceId }));
    expect(t.lines.map((l) => [l.speaker, l.at, l.sec])).toEqual([["Speaker 1", "", null], ["Speaker 2", "", null], ["Speaker 3", "", null], ["Speaker 2", "", null]]);
    // Kept, the one with no owner is noted with the call (Waiting on, "Someone on the call"), in nobody's Promises.
    const nobody = promises.find((p) => p.body.side === "unknown")!;
    const kept = data<{ message: string }>(await act(ADMIN, "meeting.keep", { proposalId: nobody.id }));
    expect(kept.message).toBe(CALL_ROW.keptNobody);
    const chat = `${MEETING_CHAT}${m.id}`;
    expect((await conversations.viewer(ADMIN).commitmentsTo([chat])).map((k) => [k.whoId, k.whoName, k.what])).toEqual([[null, CALL_ROW.someone, "Send sample rates"]]);
    expect(await conversations.viewer(ADMIN).commitmentsBy([chat])).toEqual([]);
    expect(await conversations.viewer(MATE).commitmentsBy([chat])).toEqual([]);
    // An attendee sees the note; anyone else gets no such call.
    expect(data<{ pocket: boolean }>(await act(MATE, "meeting.review", { occurrenceId })).pocket).toBe(true);
    expect(await act(OUTSIDER, "meeting.review", { occurrenceId })).toMatchObject({ ok: false });
    expect(await uploadTranscript(ctxAs(MATE), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ turns }) })).toMatchObject({ ok: false, status: 403 });
  });

  it("a Teams transcript after it is a Teams one again, with its times", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = await register(act);
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ date: null, turns }) }));
    await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) });
    expect((await meetings.occurrence(occurrenceId))!.transcriptKind).toBe("teams");
    expect(data<{ pocket: boolean }>(await act(ADMIN, "meeting.review", { occurrenceId })).pocket).toBe(false);
    const t = data<{ lines: { at: string }[] }>(await act(ADMIN, "meeting.transcript", { occurrenceId }));
    expect(t.lines[0]!.at).toBe("0:05");
  });

  it("a refused file stores nothing and says why in plain words", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = await register(act);
    const logs: LogRecord[] = [];
    const r = await uploadTranscript(ctxAs(ADMIN, { log: (x) => void logs.push(x) }), { seriesId: m.id, date: "2026-11-10", bytes: zipOf({ "secret-a.pdf": pocketPdf({ turns }), "secret-b.pdf": pocketPdf({ turns }) }) });
    expect(r).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("That zip holds 2 PDFs") });
    expect(await meetings.occurrencesOf(m.id)).toEqual([]);
    expect(logs.map((l) => [l.op, l.kind])).toEqual([["meeting_upload_refused", "zip_several"]]);
  });

  it("an error of any other kind is refused in fixed words: nothing from the file reaches the answer or the log", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = await register(act);
    const logs: LogRecord[] = [];
    const readPdf = async () => {
      throw new RangeError("Invalid code point 99999999 secret-word");
    };
    const r = await uploadTranscript(ctxAs(ADMIN, { log: (x) => void logs.push(x), readPdf }), { seriesId: m.id, date: "2026-11-10", bytes: pocketPdf({ turns }) });
    expect(r).toMatchObject({ ok: false, status: 422, error: "FocusTime couldn't read that file. FocusTime reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)" });
    expect(JSON.stringify([r, logs])).not.toMatch(/secret|99999999/);
    expect(await meetings.occurrencesOf(m.id)).toEqual([]);
  });
});

// MC-4: Skip all and close, its Undo, putting one back, and Hide (TEST 6). Nothing goes to DevOps, no promise is kept.
describe("MC-4: closing a call", () => {
  async function aCall() {
    const s = await setup();
    const m = data<{ meeting: { id: number } }>(await s.act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(s.ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    const review = async () => data<{ occurrence: { state: string; open: number; closedAt?: string | null; done?: unknown }; proposals: { id: number; state: string; decidedBy: string | null; decidedAt: string | null }[] }>(await s.act(ADMIN, "meeting.review", { occurrenceId }));
    return { ...s, occurrenceId, review };
  }

  it("skips every undecided proposal and closes the call, writing nothing; Undo puts each back as it was and opens it again", async () => {
    const { act, occurrenceId, review } = await aCall();
    const before = await review();
    const first = before.proposals[0]!;
    data(await act(ADMIN, "meeting.edit", { proposalId: first.id, skip: true }));
    const r = data<{ calls: { occurrenceId: number; skipped: { id: number; was: string }[] }[] }>(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [occurrenceId] }));
    // Only the ones still undecided: the one skipped by hand isn't in Undo's list.
    expect(r.calls[0]!.skipped.map((x) => x.id)).toEqual(before.proposals.slice(1).map((p) => p.id));
    const closed = await review();
    expect(closed.proposals.every((p) => p.state === "skipped")).toBe(true);
    expect(closed.occurrence.state).toBe("reviewed");
    expect(closed.occurrence.open).toBe(0);
    data(await act(ADMIN, "meeting.unskip_all", { items: r.calls[0]!.skipped }));
    const back = await review();
    expect(back.proposals.map((p) => [p.id, p.state])).toEqual(before.proposals.map((p, i) => [p.id, i === 0 ? "skipped" : "open"]));
    expect(back.proposals.slice(1).every((p) => p.decidedBy === null && p.decidedAt === null)).toBe(true);
    expect(back.occurrence.state).toBe("ready");
  });

  it("Undo leaves alone a proposal decided since", async () => {
    const { act, occurrenceId, review } = await aCall();
    const r = data<{ calls: { skipped: { id: number; was: string }[] }[] }>(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [occurrenceId] }));
    const [a, b] = r.calls[0]!.skipped;
    // Put back by hand, then skipped again by the lead: no longer this Undo's.
    data(await act(ADMIN, "meeting.edit", { proposalId: b!.id, skip: false }));
    data(await act(LEAD, "meeting.edit", { proposalId: b!.id, skip: true }));
    data(await act(ADMIN, "meeting.unskip_all", { items: [a, b] }));
    const ps = (await review()).proposals;
    expect(ps.find((p) => p.id === a!.id)!.state).toBe("open");
    expect(ps.find((p) => p.id === b!.id)!.state).toBe("skipped");
  });

  it("Undo leaves alone a proposal I skipped again myself since, and puts a failed one back with who decided it", async () => {
    const { act, occurrenceId, review } = await aCall();
    try {
      const r = data<{ calls: { skipped: { id: number; was: string; skippedAt: string }[] }[] }>(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [occurrenceId] }));
      const [a, b] = r.calls[0]!.skipped;
      expect(a!.skippedAt).toBe(NOW0);
      NOW = "2026-11-10T17:01:00Z";
      data(await act(ADMIN, "meeting.edit", { proposalId: b!.id, skip: false }));
      data(await act(ADMIN, "meeting.edit", { proposalId: b!.id, skip: true }));
      data(await act(ADMIN, "meeting.unskip_all", { items: [a, b] }));
      const ps = (await review()).proposals;
      expect(ps.find((p) => p.id === a!.id)!.state).toBe("open");
      expect(ps.find((p) => p.id === b!.id)!.state).toBe("skipped");
      // A failed one: Undo restores who decided it and when, as Skip all answered.
      data(await act(ADMIN, "meeting.unskip_all", { items: [{ ...b!, skippedAt: "2026-11-10T17:01:00Z", was: "failed", by: LEAD, decidedAt: NOW0 }] }));
      const f = (await review()).proposals.find((p) => p.id === b!.id)!;
      expect([f.state, f.decidedBy, f.decidedAt]).toEqual(["failed", LEAD, NOW0]);
      expect(await act(ADMIN, "meeting.unskip_all", { items: [{ id: a!.id, was: "open" }] })).toMatchObject({ ok: false, status: 400 });
    } finally {
      NOW = NOW0;
    }
  });

  it("putting one skipped proposal back opens a closed call", async () => {
    const { act, occurrenceId, review } = await aCall();
    data(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [occurrenceId] }));
    expect((await review()).occurrence.state).toBe("reviewed");
    const one = (await review()).proposals[0]!;
    data(await act(ADMIN, "meeting.edit", { proposalId: one.id, skip: false }));
    const after = await review();
    expect(after.occurrence.state).toBe("ready");
    expect(after.occurrence.open).toBe(1);
  });

  it("only a reviewer closes, and a refusal for one call changes none of them", async () => {
    const { act, occurrenceId, review } = await aCall();
    expect(await act(MATE, "meeting.skip_all", { occurrenceIds: [occurrenceId] })).toMatchObject({ ok: false, status: 403 });
    expect(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [occurrenceId, 999_999] })).toMatchObject({ ok: false });
    expect((await review()).proposals.every((p) => p.state === "open")).toBe(true);
    expect(await act(ADMIN, "meeting.skip_all", { occurrenceIds: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it("Hide keeps only which meeting, for me", async () => {
    const { act } = await aCall();
    data(await act(ADMIN, "meeting.call_hide", { keys: ["ical-x"], series: ["series-y"] }));
    expect(data(await act(ADMIN, "meeting.call_hides", {}))).toEqual({ keys: ["ical-x"], series: ["series-y"] });
    expect(data(await act(LEAD, "meeting.call_hides", {}))).toEqual({ keys: [], series: [] });
    data(await act(ADMIN, "meeting.call_unhide", { keys: ["ical-x"] }));
    expect(data(await act(ADMIN, "meeting.call_hides", {}))).toEqual({ keys: [], series: ["series-y"] });
    expect(await act(ADMIN, "meeting.call_hide", { keys: [] })).toMatchObject({ ok: false, status: 400 });
  });
});
