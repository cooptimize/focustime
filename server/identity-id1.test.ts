// ID-1: an upload knows who you are, as every request does. On production a transcript dropped on a call failed its AI
// step at once, and Propose again a moment later worked. The upload's route (server/app.ts) built its context without
// the step that gives every dispatched action the signed-in person's identity, so a hosted person (their Dataverse
// user kept with their sign-in, not in their settings) had no Dataverse user there: DevOps couldn't be read for the
// client, the pass ended "no_context" before the AI was asked, and Propose again (a dispatched action) worked on the
// same lines. The same gap was in the assistant's voice and a chat's image. Through the real routes and the real
// context builders, with fictional people, sources and AI. Never a transcript's words in a log.
import { describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import type { ProviderCall, TranscribeCall } from "../ai/types.ts";
import type { LogRecord } from "../log/logger.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { transcriptVtt } from "../test/docx.ts";
import { aChatMember, aTeamsMessage, HOME_TENANT } from "../test/builders/index.ts";
import { jpegWithMetadata } from "../test/images.ts";
import { aCall, ANA, BEN, hostedPerson, NOW, type Reads } from "../test/hosted-person.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createAssistantHub } from "./assistant.ts";
import { meetingJobPerson, pollJobPerson } from "./job-people.ts";
import { meetingJob } from "./meeting-job.ts";
import { CSRF_COOKIE } from "./auth/cookies.ts";
import { ASSISTANT_VOICE_PATH, MEETING_UPLOAD_PATH } from "./app.ts";
import { startTestApp } from "./test-app.ts";

const VTT = transcriptVtt([
  { speaker: "Ana Example", at: "0:05", text: "Rates export is first." },
  { speaker: "Dana Client", at: "0:40", text: "We also need a holiday calendar import." },
]);

type Upload = { ok: true; data: { occurrenceId: number; outcome: string; proposals: number } } | { ok: false; status: number; error: string };
type Rerun = { ok: true; data: { outcome: string; proposals: number } };

async function world(o: { inSettings?: boolean } = {}) {
  const db = sqliteDb();
  await addUsers(db.conn, ANA.oid, BEN.oid);
  const { port, series } = await aCall(db.conn, [ANA, BEN]);
  const calls: Record<string, ProviderCall[]> = { [ANA.oid]: [], [BEN.oid]: [] };
  const heard: Record<string, TranscribeCall[]> = { [ANA.oid]: [], [BEN.oid]: [] };
  const reads: Record<string, Reads> = { [ANA.oid]: { devops: [], myClients: [] }, [BEN.oid]: { devops: [], myClients: [] } };
  const people = {
    [ANA.oid]: (await hostedPerson(db.conn, ANA, { ...o, meetings: port, calls: calls[ANA.oid]!, heard: heard[ANA.oid]!, reads: reads[ANA.oid]! })).ctx,
    [BEN.oid]: (await hostedPerson(db.conn, BEN, { ...o, meetings: port, calls: calls[BEN.oid]!, heard: heard[BEN.oid]!, reads: reads[BEN.oid]! })).ctx,
  };
  const logs: LogRecord[] = [];
  // As server/main.ts: each session's own runtime, by the session's user id.
  const app = await startTestApp({ ctx: (s) => people[s.userId]!, log: (r) => logs.push(r) });
  const as = async (who: typeof ANA) => {
    const b = app.browser();
    await b.signIn(who.oid);
    const upload = async (): Promise<Upload> => JSON.parse((await b.send(`${MEETING_UPLOAD_PATH}?series=${series.id}&date=2026-11-17`, { origin: app.publicUrl, "content-type": "text/vtt", "x-csrf": b.jar.get(CSRF_COOKIE) ?? "" }, "POST", VTT)).body) as Upload;
    const rerun = async (occurrenceId: number): Promise<Rerun> => JSON.parse((await b.action("meeting.rerun", { occurrenceId })).body) as Rerun;
    const voice = async (client: string) => JSON.parse((await b.send(`${ASSISTANT_VOICE_PATH}?seconds=4&client=${client}`, { origin: app.publicUrl, "content-type": "audio/webm", "x-csrf": b.jar.get(CSRF_COOKIE) ?? "" }, "POST", Buffer.from("not-really-audio"))).body) as { ok: boolean; reason?: string; message?: string };
    return { upload, rerun, voice };
  };
  return { app, as, calls, heard, reads, logs, series };
}

describe("ID-1: a transcript upload knows who is asking", () => {
  it("a hosted person's upload runs the pass with the AI asked, and ends as Propose again does on the same lines", async () => {
    const w = await world();
    try {
      const ana = await w.as(ANA);
      const up = await ana.upload();
      if (!up.ok) throw new Error(up.error);
      // On main: "no_context" at once, the AI never asked, because DevOps was read without Ana's Dataverse user.
      expect({ outcome: up.data.outcome, asked: w.calls[ANA.oid]!.length, readAs: w.reads[ANA.oid]!.devops }).toEqual({ outcome: "done", asked: 1, readAs: [ANA.dv] });
      // Propose again on the same stored lines: the same outcome, the same proposals (nothing new: they're the same).
      const again = await ana.rerun(up.data.occurrenceId);
      expect(again.data.outcome).toBe(up.data.outcome);
      expect(again.data.proposals).toBe(up.data.proposals);
      expect(w.calls[ANA.oid]!.length).toBe(2);
      // Never a transcript's words in a log.
      const said = JSON.stringify(w.logs);
      expect(said).not.toContain("holiday calendar");
      expect(said).not.toContain("Rates export");
    } finally {
      await w.app.close();
    }
  });

  it("Propose again (a dispatched action) on the stored lines reads DevOps as the person and asks the AI", async () => {
    // True on main too: the dispatcher gives every action the signed-in identity. The upload is what lacked it.
    const w = await world();
    try {
      const ana = await w.as(ANA);
      const up = await ana.upload();
      if (!up.ok) throw new Error(up.error);
      const before = w.calls[ANA.oid]!.length;
      const again = await ana.rerun(up.data.occurrenceId);
      expect(again.data.outcome).toBe("done");
      expect(w.calls[ANA.oid]!.length).toBe(before + 1);
      expect(w.reads[ANA.oid]!.devops.at(-1)).toBe(ANA.dv);
    } finally {
      await w.app.close();
    }
  });

  it("a person whose own settings hold their Dataverse user (the local app) uploads as before", async () => {
    const w = await world({ inSettings: true });
    try {
      const up = await (await w.as(ANA)).upload();
      if (!up.ok) throw new Error(up.error);
      expect(up.data.outcome).toBe("done");
      expect(w.reads[ANA.oid]!.devops).toEqual([ANA.dv]);
      expect(w.calls[ANA.oid]!.length).toBe(1);
    } finally {
      await w.app.close();
    }
  });

  it("two people's uploads at once each run with their own identity, never the other's", async () => {
    const w = await world();
    try {
      const [ana, ben] = await Promise.all([w.as(ANA), w.as(BEN)]);
      const [a, b] = await Promise.all([ana.upload(), ben.upload()]);
      expect(a.ok && b.ok).toBe(true);
      expect(w.reads[ANA.oid]!.devops).toEqual([ANA.dv]);
      expect(w.reads[BEN.oid]!.devops).toEqual([BEN.dv]);
      expect(w.calls[ANA.oid]!.length).toBe(1);
      expect(w.calls[BEN.oid]!.length).toBe(1);
    } finally {
      await w.app.close();
    }
  });
});

describe("ID-1: the assistant's voice knows who is asking", () => {
  it("a client that is the person's in Dataverse only, without Allow AI, turns voice off while it is in focus", async () => {
    // Fabrikam is Ana's in Dataverse (not in her settings) and isn't allowed AI. On main the voice route didn't know her
    // Dataverse user, so Fabrikam wasn't among her clients, the gate didn't see it in focus, and the recording went out.
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const heard: TranscribeCall[] = [];
    const reads: Reads = { devops: [], myClients: [] };
    const { ctx } = await hostedPerson(db.conn, ANA, { heard, reads, allowed: ["contoso"] });
    const app = await startTestApp({ ctx: () => ctx });
    try {
      const b = app.browser();
      await b.signIn(ANA.oid);
      const r = JSON.parse((await b.send(`${ASSISTANT_VOICE_PATH}?seconds=4&client=fabrikam`, { origin: app.publicUrl, "content-type": "audio/webm", "x-csrf": b.jar.get(CSRF_COOKIE) ?? "" }, "POST", Buffer.from("not-really-audio"))).body) as { ok: boolean; reason?: string; message?: string };
      expect(r).toEqual({ ok: false, reason: "client_off", message: "Voice is off while Fabrikam is in focus" });
      expect(heard).toEqual([]);
      expect(reads.myClients).toContain(ANA.dv);
    } finally {
      await app.close();
    }
  });
});

describe("ID-1: the Teams bot's voice knows who is asking", () => {
  it("the assistant hub's transcription sees the person's Dataverse clients, so a client without Allow AI turns voice off", async () => {
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const heard: TranscribeCall[] = [];
    const { ctx } = await hostedPerson(db.conn, ANA, { heard, allowed: ["contoso"] });
    // As server/main.ts builds the hub: the person's runtime by their id.
    const hub = createAssistantHub({ ctxFor: async () => ctx });
    const r = await hub.transcribe({ person: { userId: ANA.oid }, audio: new Uint8Array([1, 2, 3]), mime: "audio/webm", seconds: 3, context: { clientKey: "fabrikam" } });
    expect(r).toEqual({ ok: false, reason: "client_off", message: "Voice is off while Fabrikam is in focus" });
    expect(heard).toEqual([]);
  });
});

describe("ID-1: a chat's image knows who is asking", () => {
  it("is served for a chat of a client the person follows in Dataverse, and refused for a client they don't follow", async () => {
    // On main the image route didn't know Ana's Dataverse user, so her followed clients were unknown and the client
    // check let every chat she is a member of through: Northwind's image was served though she doesn't follow it.
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const teams = createTeamsStore(db.conn, () => Temporal.Instant.from(NOW));
    const me = aChatMember({ userId: ANA.oid, displayName: ANA.name, tenantId: HOME_TENANT });
    const ids: Record<string, number> = {};
    for (const clientKey of ["fabrikam", "northwind"]) {
      const chatId = `19:${clientKey}-id1@thread.v2`;
      await teams.addChat({ chatId, clientKey, kind: "delivery", displayName: `${clientKey} team`, webUrl: null, members: [me, aChatMember()], by: ANA.oid });
      const messageId = clientKey === "fabrikam" ? "1731850000001" : "1731850000002";
      const src = `https://graph.microsoft.com/v1.0/chats/${chatId}/messages/${messageId}/hostedContents/aWQ9MQ==/$value`;
      await teams.saveMessages([aTeamsMessage({ chatId, clientKey, messageId, createdAt: NOW, modifiedAt: NOW, fetchedAt: NOW, text: "See this", html: `<p>See this</p><p><img src="${src}" itemtype="http://schema.skype.com/AMSImage"></p>`, hasImage: true })]);
      ids[clientKey] = (await teams.images(chatId, [messageId]))[0]!.id;
    }
    const reader: ChatMessagesClient = { messagesSince: async () => ({ messages: [], newest: null }), hostedContent: async () => ({ bytes: jpegWithMetadata() }) };
    const { ctx } = await hostedPerson(db.conn, ANA, { more: { requests: { teams, refresh: async () => { throw new Error("no refresh here"); } }, account: () => ({ chatMessages: reader }) as never } as Partial<ActionContext> });
    const app = await startTestApp({ ctx: () => ctx });
    try {
      const b = app.browser();
      await b.signIn(ANA.oid);
      expect((await b.send(`/media/chat-images/${ids.fabrikam}`)).status).toBe(200);
      expect((await b.send(`/media/chat-images/${ids.northwind}`)).status).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe("ID-1: the jobs that run a person's work know who the person is", () => {
  it("the meeting job's pass after it fetches a transcript reads DevOps as the reviewer and asks the AI", async () => {
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const { port, series } = await aCall(db.conn, [ANA]);
    // An Automatic call whose transcript is there to fetch.
    await port.store.updateSeries(series.id, { source: "automatic" });
    const s = (await port.store.series(series.id))!;
    const occ = await port.store.ensureOccurrence(s.id, "2026-11-17", "2026-11-17T14:00:00Z", "2026-11-17T14:30:00Z", "waiting", "2026-11-17T14:45:00Z");
    const calls: ProviderCall[] = [];
    const reads: Reads = { devops: [], myClients: [] };
    const vtt = `WEBVTT\n\n00:00:05.000 --> 00:00:06.000\n<v Ana Example>Rates export is first.</v>\n\n00:00:40.000 --> 00:00:41.000\n<v Dana Client>We also need a holiday calendar import.</v>\n`;
    const graph = { onlineMeetingId: async () => "om", transcripts: async () => [{ id: "t1", createdAt: "2026-11-17T14:31:00Z" }], transcriptVtt: async () => vtt, instances: async () => [] };
    const { ctx } = await hostedPerson(db.conn, ANA, { calls, reads, meetings: port, more: { account: () => ({ meetings: graph }) as never } as Partial<ActionContext> });
    const job = meetingJob({ store: port.store, now: () => Temporal.Instant.from(NOW), log: () => {}, users: port.users, person: async () => meetingJobPerson(ctx) });
    await job.run();
    expect(reads.devops).toEqual([ANA.dv]);
    expect(calls).toHaveLength(1);
    expect(await port.store.occurrence(occ.id)).toMatchObject({ state: "ready", aiOutcome: "done" });
  });

  it("the meeting job's own retry of a failed pass reads DevOps as the reviewer", async () => {
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const { port, series } = await aCall(db.conn, [ANA]);
    const occ = await port.store.ensureOccurrence(series.id, "2026-11-17", "2026-11-17T14:00:00Z", "2026-11-17T14:30:00Z", "needs_upload", null);
    await port.store.saveTranscript(occ.id, [{ n: 1, speaker: "Ana Example", at: 0, text: "Rates export is first." }], "upload", ANA.oid);
    await port.store.updateOccurrence(occ.id, { state: "failed", aiOutcome: "provider", checks: 0, nextCheckAt: "2026-11-17T14:45:00Z" });
    const calls: ProviderCall[] = [];
    const reads: Reads = { devops: [], myClients: [] };
    const { ctx } = await hostedPerson(db.conn, ANA, { calls, reads, meetings: port });
    const job = meetingJob({ store: port.store, now: () => Temporal.Instant.from(NOW), log: () => {}, users: port.users, person: async () => meetingJobPerson(ctx) });
    await job.run();
    expect(reads.devops).toEqual([ANA.dv]);
    expect(calls).toHaveLength(1);
    expect(await port.store.occurrence(occ.id)).toMatchObject({ state: "ready", aiOutcome: "done" });
  });

  it("the shared chat poll's follower reads the client's items and knows the other clients as the person does", async () => {
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const reads: Reads = { devops: [], myClients: [] };
    const { ctx } = await hostedPerson(db.conn, ANA, { reads });
    const p = await pollJobPerson(ANA.name, ctx);
    expect(p.config?.dataverse.mySystemUserId).toBe(ANA.dv);
    expect((await p.openItems(p.config!, "contoso"))?.map((i) => i.id)).toEqual([1201]);
    // GD-2: a Contoso chat's boundary knows Fabrikam (Ana's in Dataverse only), so its name is masked in Contoso's text.
    expect((await p.boundary!("contoso")).directory.map((c) => c.key)).toContain("fabrikam");
  });

  it("a person whose own settings hold their Dataverse user (the local app): the jobs behave as before", async () => {
    const db = sqliteDb();
    await addUsers(db.conn, ANA.oid);
    const reads: Reads = { devops: [], myClients: [] };
    const { ctx } = await hostedPerson(db.conn, ANA, { reads, inSettings: true });
    const p = await pollJobPerson(ANA.name, ctx);
    expect(p.config?.dataverse.mySystemUserId).toBe(ANA.dv);
    expect((await p.openItems(p.config!, "contoso"))?.map((i) => i.id)).toEqual([1201]);
    expect((await (await meetingJobPerson(ctx))!.capture("contoso"))?.items.map((i) => i.id)).toEqual([1201]);
  });
});
