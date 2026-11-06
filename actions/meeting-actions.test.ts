// MC-1: registering, uploading and reviewing a client's weekly call. Registration is an admin's and keeps only what
// the registrant's calendar shows; a client-hosted meeting is never asked of Graph. Uploads are a reviewer's, for
// a call they can see; .vtt and .docx land the same. Confirm makes each kept proposal through the existing writes
// (the DevOps write framework for gaps and comments; a shared commitment for promises), and skipped ones write nothing.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
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
import { transcriptDocx, transcriptVtt } from "../test/docx.ts";
import type { ActionResponse } from "./types.ts";
import { meetingAction, uploadTranscript, type MeetingAction, type MeetingContext } from "./meeting-actions.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const MATE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-11-10T17:00:00Z";
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
  const devopsCalls: { action: string; input: unknown }[] = [];
  let seq = 0;
  const users = [
    { id: ADMIN, name: "Sam Admin", emails: ["sam@cooptimize.example"] },
    { id: LEAD, name: "Kim Lead", emails: ["kim@cooptimize.example"] },
    { id: MATE, name: "Lee Mate", emails: ["lee@cooptimize.example"] },
    { id: OUTSIDER, name: "Out Sider", emails: ["out@cooptimize.example"] },
  ];
  const ctxAs = (me: string, o: { admin?: boolean; write?: boolean } = {}): MeetingContext => ({
    meetings, conversations, plan: planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC"), userId: me }),
    me: async () => me, isAdmin: async () => !!o.admin, config: async () => cfg.config, now: () => NOW, homeDomains: async () => ["cooptimize.example"],
    graph: () => graph, users: async () => users, leads: async () => [LEAD],
    capture: async (_c, k) => (k === "contoso" ? { clientName: "Contoso", internal: false, items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" })], model: buildProcessModel(aClientProcess()), directory: [aClientEntry({ key: "contoso", names: ["Contoso"], itemIds: [1201] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], itemIds: [4410] })] } : null),
    ai: async () => ai,
    devops: async (action, input): Promise<ActionResponse> => {
      devopsCalls.push({ action, input });
      if (action === "devops.preview") {
        const changes = (input as { changes: { key: string }[] }).changes;
        return { ok: true, data: { previews: changes.map((c) => ({ previewId: `pv-${++seq}`, key: c.key })), refused: [], nothing: [] } };
      }
      const pids = (input as { previewIds: string[] }).previewIds;
      return { ok: true, data: { results: pids.map((p, i) => ({ entry: { id: 100 + i }, confirmed: true, message: `Done ${p}`, itemId: 9000 + i })) } };
    },
    canWrite: async () => o.write ?? true,
    log: () => {},
  });
  const act = (me: string, action: MeetingAction, input: unknown, o?: { admin?: boolean; write?: boolean }) => meetingAction(ctxAs(me, o), action, input);
  return { db, meetings, conversations, graphCalls, providerCalls, devopsCalls, act, ctxAs };
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
    expect(await uploadTranscript(ctxAs(MATE), { seriesId: m.id, date: "2026-11-10", name: "t.docx", bytes: docx })).toMatchObject({ ok: false, status: 403 });
    expect(await uploadTranscript(ctxAs(OUTSIDER), { seriesId: m.id, date: "2026-11-10", name: "t.docx", bytes: docx })).toMatchObject({ ok: false, status: 404 });
    expect(await uploadTranscript(ctxAs(ADMIN), { seriesId: 999, date: "2026-11-10", name: "t.docx", bytes: docx })).toMatchObject({ ok: false, status: 404 });
    const a = data<{ occurrenceId: number; outcome: string; proposals: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", name: "t.docx", bytes: docx }));
    expect(a).toMatchObject({ outcome: "done", proposals: 4 });
    const fromDocx = await meetings.transcript(a.occurrenceId);
    const b = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(LEAD), { seriesId: m.id, date: "2026-11-10", name: "t.vtt", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    expect(b.occurrenceId).toBe(a.occurrenceId);
    expect(await meetings.transcript(b.occurrenceId)).toEqual(fromDocx);
    expect(providerCalls.every((c) => !/Fabrikam|4410/.test(c.input))).toBe(true);
    expect(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", name: "t.pdf", bytes: new TextEncoder().encode("%PDF") })).toMatchObject({ ok: false, status: 422 });
  });

  it("confirms each kept kind through the right write and writes nothing for skipped ones", async () => {
    const { act, ctxAs, conversations, devopsCalls, meetings } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", name: "t.vtt", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    const r = data<{ proposals: { id: number; kind: string; body: { side?: string } }[]; canConfirm: boolean }>(await act(ADMIN, "meeting.review", { occurrenceId }));
    expect(r.canConfirm).toBe(true);
    const [gap, mateP, clientP, comment] = r.proposals;
    expect([gap!.kind, mateP!.kind, clientP!.kind, comment!.kind]).toEqual(["gap", "commitment", "commitment", "comment"]);
    // Attendees view; they can't confirm.
    expect(data<{ canConfirm: boolean }>(await act(MATE, "meeting.review", { occurrenceId })).canConfirm).toBe(false);
    expect(await act(MATE, "meeting.prepare", { occurrenceId, keep: [comment!.id] })).toMatchObject({ ok: false, status: 403 });
    expect(await act(OUTSIDER, "meeting.review", { occurrenceId })).toMatchObject({ ok: false, status: 404 });

    // Keep the gap, both commitments; skip the comment.
    const keep = [gap!.id, mateP!.id, clientP!.id];
    const prep = data<{ previews: { previewId: string; key: string }[]; commitments: unknown[] }>(await act(ADMIN, "meeting.prepare", { occurrenceId, keep }));
    expect(devopsCalls[0]).toMatchObject({ action: "devops.preview", input: { clientKey: "contoso", changes: [{ kind: "create", type: "User Story", key: `p${gap!.id}` }] } });
    expect(prep.commitments).toHaveLength(2);
    const c = data<{ results: { ok: boolean }[]; left: number }>(await act(ADMIN, "meeting.confirm", { occurrenceId, keep, previews: prep.previews.map((p) => ({ proposalId: Number(p.key.slice(1)), previewId: p.previewId })) }));
    expect(c.results.every((x) => x.ok)).toBe(true);
    expect(c.left).toBe(0);
    expect(devopsCalls.map((x) => x.action)).toEqual(["devops.preview", "devops.confirm"]);
    expect(devopsCalls.some((x) => JSON.stringify(x.input).includes('"comment"'))).toBe(false);
    const after = await meetings.proposals(occurrenceId);
    expect(after.find((p) => p.id === gap!.id)).toMatchObject({ state: "confirmed", result: { writeId: 100, itemId: 9000 } });
    expect(after.find((p) => p.id === comment!.id)?.state).toBe("skipped");
    expect((await meetings.occurrence(occurrenceId))?.state).toBe("reviewed");

    // The Cooptimizer's promise is in their own Promises; the client's is my Waiting on. Nobody's plan was written.
    const chat = `${MEETING_CHAT}${m.id}`;
    const theirs = await conversations.viewer(MATE).commitmentsBy([chat]);
    expect(theirs.map((k) => k.what)).toEqual(["Send the export spec"]);
    expect(theirs[0]).toMatchObject({ dueDate: "2026-11-13", state: "open" });
    expect((await conversations.viewer(ADMIN).commitmentsTo([chat])).map((k) => k.what)).toEqual(["Send sample rates"]);
    expect(await conversations.viewer(OUTSIDER).commitmentsBy([chat])).toEqual([]);
    expect(await conversations.viewer(OUTSIDER).commitment(theirs[0]!.id)).toBeNull();
  });

  it("asks for DevOps write access before a DevOps change, and dismisses with No transcript this week", async () => {
    const { act, ctxAs, meetings } = await setup();
    const m = data<{ meeting: { id: number } }>(await act(ADMIN, "meeting.register", { clientKey: "contoso", role: "status", eventId: "E-contoso" }, { admin: true })).meeting;
    const { occurrenceId } = data<{ occurrenceId: number }>(await uploadTranscript(ctxAs(ADMIN), { seriesId: m.id, date: "2026-11-10", name: "t.vtt", bytes: new TextEncoder().encode(transcriptVtt(cues)) }));
    const comment = (await meetings.proposals(occurrenceId)).find((p) => p.kind === "comment")!;
    expect(await act(ADMIN, "meeting.prepare", { occurrenceId, keep: [comment.id] }, { write: false })).toMatchObject({ ok: false, status: 409 });
    const o2 = await meetings.ensureOccurrence(m.id, "2026-11-17", "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z", "needs_upload", null);
    expect(await act(MATE, "meeting.no_transcript", { occurrenceId: o2.id })).toMatchObject({ ok: false, status: 403 });
    expect(data<{ occurrence: { state: string } }>(await act(LEAD, "meeting.no_transcript", { occurrenceId: o2.id })).occurrence.state).toBe("no_transcript");
  });
});
