// MC-2c: the chat call transcript client on fake fetches (Microsoft's documented shapes; fake ids, demo words). Only the
// two requests under /me pass, only while that person's press for that call id is open; the transcript's id is found
// from the list, or from the chat's event when the list isn't a thing; several transcripts are read in time order inside
// the size limit; speaker names off asks once more without them; logs carry no id, name or text.
import { describe, expect, it } from "vitest";
import { createChatCallPresses, PRESS_MS } from "../../actions/chat-call-press.ts";
import { joinTranscriptParts } from "../../plan/transcript.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";
import { allowedAdhocRequest, createAdhocCallsClient, readChatTranscript, UNNAMED_FORMAT, type AdhocGate } from "./adhoc-calls.ts";
import { MAX_TRANSCRIPT_BYTES, TranscriptsOff } from "./meetings.ts";

const G = "https://graph.microsoft.com/v1.0";
const CALL = "5f3640e7-a59c-4bec-82ca-e66251f795b7";
const OTHER = "11111111-2222-4333-8444-555555555555";
const ME = "00000000-0000-4000-8000-0000000000a1";
const vtt = (who: string, words: string, at = "00:00:01.000") => `WEBVTT\n\n${at} --> 00:00:04.000\n<v ${who}>${words}</v>\n`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const inner = (code: string) => json({ error: { code: "Forbidden", message: "fake", innerError: { code } } }, 403);

type Answer = Response | ((url: string, accept: string) => Response);
function fake(answers: Record<string, Answer>, gate?: AdhocGate) {
  const sent: { url: string; accept: string }[] = [];
  const logs: Record<string, unknown>[] = [];
  const presses = createChatCallPresses();
  const press = presses.open(ME, CALL);
  const client = createAdhocCallsClient({
    fetch: (async (u: string, init?: RequestInit) => {
      const url = String(u);
      const accept = String((init?.headers as Record<string, string>).accept);
      sent.push({ url, accept });
      const key = Object.keys(answers).find((k) => url.includes(k)) ?? "";
      const a = answers[key];
      if (!a) return json({ error: { code: "NotFound" } }, 404);
      if (typeof a === "function") return a(url, accept);
      // A fresh Response each time (a clone's body can't be cancelled until the original is read).
      const body = await a.clone().text();
      return new Response(body, { status: a.status, headers: a.headers });
    }) as typeof fetch,
    token: async () => "fake-token",
    invalidate: () => {},
    gate: gate ?? { allowed: (callId) => presses.allowed(ME, callId) },
    log: (r) => void logs.push(r as Record<string, unknown>),
  });
  return { client, sent, logs, press, presses };
}

describe("MC-2c: the two requests, only under /me, and nothing else", () => {
  it("allows exactly the list and one transcript's content", () => {
    expect(allowedAdhocRequest(`${G}/me/adhocCalls/${CALL}/transcripts?$select=id,createdDateTime,endDateTime`)).toBe(true);
    expect(allowedAdhocRequest(`${G}/me/adhocCalls/${CALL}/transcripts/abc%3D/content`)).toBe(true);
    for (const url of [
      `${G}/users/${ME}/adhocCalls/${CALL}/transcripts?$select=id,createdDateTime,endDateTime`,
      `${G}/users/${ME}/adhocCalls/${CALL}/transcripts/abc/content`,
      `${G}/users/${ME}/adhocCalls/getAllTranscripts`,
      `${G}/me/adhocCalls/getAllTranscripts`,
      `${G}/communications/adhocCalls/${CALL}/transcripts`,
      `${G}/me/adhocCalls/${CALL}/recordings`,
      `${G}/me/adhocCalls/${CALL}/transcripts`,
      `${G}/me/adhocCalls/${CALL}/transcripts?$select=id`,
      `${G}/me/adhocCalls/${CALL}/transcripts/abc`,
      `${G}/me/adhocCalls/${CALL}/transcripts/abc/metadataContent`,
      `${G}/me/adhocCalls/${CALL}/transcripts/abc/content?$format=text/vtt`,
      `${G}/me/adhocCalls/${CALL}`,
      `${G}/subscriptions`,
      `https://graph.microsoft.com/beta/me/adhocCalls/${CALL}/transcripts/abc/content`,
      `${G}/me/onlineMeetings/x/transcripts`,
      // Dot segments fetch would resolve away.
      `${G}/me/adhocCalls/../transcripts?$select=id,createdDateTime,endDateTime`,
      `${G}/me/adhocCalls/./transcripts?$select=id,createdDateTime,endDateTime`,
      `${G}/me/adhocCalls/${CALL}/transcripts/../content`,
      `${G}/me/adhocCalls/${CALL}/transcripts/%2e%2e/content`,
    ])
      expect(allowedAdhocRequest(url), url).toBe(false);
  });

  it("the requests pass only while that person's press for that call id is open; nothing is sent otherwise", async () => {
    const now = { t: 1_000_000 };
    const presses = createChatCallPresses(() => now.t);
    const sent: string[] = [];
    const make = (who: string) =>
      createAdhocCallsClient({
        fetch: (async (u: string) => (sent.push(String(u)), json({ value: [] }))) as typeof fetch,
        token: async () => "fake-token",
        invalidate: () => {},
        gate: { allowed: (id) => presses.allowed(who, id) },
        log: () => {},
      });
    const mine = make(ME);
    const someoneElse = make("00000000-0000-4000-8000-0000000000b2");
    // No press: refused before anything is sent.
    await expect(mine.transcripts(CALL)).rejects.toThrow(/own press/);
    const p = presses.open(ME, CALL);
    await expect(mine.transcripts(CALL)).resolves.toEqual([]);
    // Another person, another call: refused.
    await expect(someoneElse.transcripts(CALL)).rejects.toThrow(/own press/);
    await expect(mine.transcripts(OTHER)).rejects.toThrow(/own press/);
    await expect(mine.content(OTHER, "t1", { named: true })).rejects.toThrow(/own press/);
    // After the press ends, or after two minutes, refused.
    p.done();
    await expect(mine.transcripts(CALL)).rejects.toThrow(/own press/);
    presses.open(ME, CALL);
    now.t += PRESS_MS;
    await expect(mine.content(CALL, "t1", { named: true })).rejects.toThrow(/own press/);
    expect(sent).toEqual([`${G}/me/adhocCalls/${CALL}/transcripts?$select=id,createdDateTime,endDateTime`]);
  });
});

describe("MC-2c: finding the transcript and reading it", () => {
  it("finds the id from the list, and reads each transcript in time order", async () => {
    const f = fake({
      [`${CALL}/transcripts?`]: json({ value: [{ id: "t-late", createdDateTime: "2026-11-18T14:30:00Z" }, { id: "t-early", createdDateTime: "2026-11-18T14:00:00Z" }] }),
      "/t-early/content": new Response(vtt("Person A", "First part.")),
      "/t-late/content": new Response(vtt("Person B", "Second part.")),
    });
    const r = await readChatTranscript(f.client, CALL, "event-id");
    expect(r.named).toBe(true);
    expect(f.sent.map((s) => s.url.replace(G, ""))).toEqual([`/me/adhocCalls/${CALL}/transcripts?$select=id,createdDateTime,endDateTime`, `/me/adhocCalls/${CALL}/transcripts/t-early/content`, `/me/adhocCalls/${CALL}/transcripts/t-late/content`]);
    expect(f.sent.slice(1).map((s) => s.accept)).toEqual(["text/vtt", "text/vtt"]);
    const lines = joinTranscriptParts(r.parts, r.named);
    expect(lines.map((l) => [l.n, l.speaker, l.at, l.text])).toEqual([[1, "Person A", 1, "First part."], [2, "Person B", 1801, "Second part."]]);
  });

  for (const status of [400, 404, 405]) {
    it(`uses the id the chat's event carried when the list answers ${status}`, async () => {
      const f = fake({ [`${CALL}/transcripts?`]: json({ error: { code: "x" } }, status), "/event-id/content": new Response(vtt("Person A", "Hello.")) });
      const r = await readChatTranscript(f.client, CALL, "event-id");
      expect(r.parts).toHaveLength(1);
      expect(f.sent.at(-1)!.url).toBe(`${G}/me/adhocCalls/${CALL}/transcripts/event-id/content`);
    });
  }

  it("not there: an empty list, or no list and no id from the event, is a 404", async () => {
    await expect(readChatTranscript(fake({ [`${CALL}/transcripts?`]: json({ value: [] }) }).client, CALL, "event-id")).rejects.toMatchObject({ status: 404 });
    await expect(readChatTranscript(fake({ [`${CALL}/transcripts?`]: json({}, 404) }).client, CALL, null)).rejects.toMatchObject({ status: 404 });
  });

  it("the size limit holds across the join", async () => {
    const half = "x".repeat(Math.floor(MAX_TRANSCRIPT_BYTES / 2) + 10);
    const f = fake({
      [`${CALL}/transcripts?`]: json({ value: [{ id: "a", createdDateTime: "2026-11-18T14:00:00Z" }, { id: "b", createdDateTime: "2026-11-18T14:30:00Z" }] }),
      "/a/content": new Response(vtt("Person A", half)),
      "/b/content": new Response(vtt("Person A", half)),
    });
    await expect(readChatTranscript(f.client, CALL, null)).rejects.toMatchObject({ status: 413 });
  });

  it("speaker names off: asks once more without them, with Graph's own Accept, and the rest without them", async () => {
    const unnamed = "00:00:01.500 --> 00:00:04.000 \n\nNote: thanks for joining. \n\n00:00:04.000 --> 00:00:07.200 \n\nGlad to be here. \n";
    const f = fake({
      [`${CALL}/transcripts?`]: json({ value: [{ id: "a", createdDateTime: "2026-11-18T14:00:00Z" }, { id: "b", createdDateTime: "2026-11-18T14:10:00Z" }] }),
      "/content": (_u, accept) => (accept === UNNAMED_FORMAT ? new Response(unnamed, { headers: { "content-type": UNNAMED_FORMAT } }) : inner("SpeakerAttributionNotAllowed")),
    });
    const r = await readChatTranscript(f.client, CALL, null);
    expect(r.named).toBe(false);
    expect(f.sent.slice(1).map((s) => s.accept)).toEqual(["text/vtt", UNNAMED_FORMAT, UNNAMED_FORMAT]);
    const lines = joinTranscriptParts(r.parts, false);
    // No speaker is taken from the words ("Note:" stays words).
    expect(lines.every((l) => l.speaker === "Unknown")).toBe(true);
    // Each cue its own line, never joined under one speaker.
    expect(lines).toHaveLength(4);
    expect(lines[0]!.text).toContain("Note: thanks for joining.");
  });

  it("the organization's setting off, refused, signed out and busy come back as their own errors", async () => {
    await expect(readChatTranscript(fake({ [`${CALL}/transcripts?`]: inner("GraphAccessToTranscriptsDisabled") }).client, CALL, null)).rejects.toBeInstanceOf(TranscriptsOff);
    const refused = await readChatTranscript(fake({ [`${CALL}/transcripts?`]: json({ error: { code: "Forbidden" } }, 403) }).client, CALL, null).catch((e) => e);
    expect(refused).toBeInstanceOf(HttpError);
    expect(refused).not.toBeInstanceOf(TranscriptsOff);
    expect(refused.status).toBe(403);
    await expect(readChatTranscript(fake({ [`${CALL}/transcripts?`]: json({}, 503) }).client, CALL, null)).rejects.toMatchObject({ status: 503 });
    const c = createAdhocCallsClient({ fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, token: async () => "t", invalidate: () => {}, gate: { allowed: () => true }, log: () => {} });
    await expect(c.transcripts(CALL)).rejects.toBeInstanceOf(NetworkError);
  });

  it("logs carry the op, status, count and duration: never a call id, a transcript id, a name or any text", async () => {
    const f = fake({
      [`${CALL}/transcripts?`]: json({ value: [{ id: "t-secret-id", createdDateTime: "2026-11-18T14:00:00Z" }] }),
      "/content": new Response(vtt("Person A", "Words nobody should log.")),
    });
    await readChatTranscript(f.client, CALL, null);
    expect(f.logs.length).toBeGreaterThan(0);
    for (const l of f.logs) {
      expect(Object.keys(l).every((k) => ["source", "op", "status", "durationMs", "count", "kind"].includes(k)), JSON.stringify(Object.keys(l))).toBe(true);
      expect(JSON.stringify(l)).not.toMatch(/5f3640e7|t-secret-id|Person A|Words|fake-token/);
    }
  });
});
