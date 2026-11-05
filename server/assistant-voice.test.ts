// AS-1: push-to-talk. The route reads the audio into memory (2 MB at most), passes it with its type, seconds and the
// client in focus to the transcription, and answers with the text; the audio is never stored or logged and a state
// change needs the session's X-CSRF. The gate (actions/dispatch.ts assistantTranscribe): AI for FocusTime, and the
// client in focus must have Allow AI ("Voice is off while <client> is in focus"); 60 seconds at most.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assistantTranscribe, type ActionContext } from "../actions/dispatch.ts";
import { stubProvider } from "../ai/stub.ts";
import type { TranscribeCall } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { anAiApp, withTeam } from "../test/builders/index.ts";
import { CSRF_COOKIE } from "./auth/cookies.ts";
import { ASSISTANT_VOICE_PATH } from "./app.ts";
import { startTestApp } from "./test-app.ts";

const AUDIO = Buffer.from("OggS-not-really-audio-but-bytes".repeat(10));
const logs: LogRecord[] = [];
const got: { mime: string; seconds: number; bytes: number; context: unknown }[] = [];
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp({
    ctx: () => ({}) as ActionContext,
    log: (r) => logs.push(r),
    extra: {
      transcribe: async (_ctx, t) => {
        got.push({ mime: t.mime, seconds: t.seconds, bytes: t.audio.length, context: t.context });
        return { ok: true, text: "Move my export spec to Thursday" };
      },
    },
  });
});
afterAll(() => app.close());

const post = (b: ReturnType<typeof app.browser>, body: Buffer, q = "?seconds=4&client=fabrikam&item=4417", headers: Record<string, string> = {}) =>
  b.send(`${ASSISTANT_VOICE_PATH}${q}`, { origin: app.publicUrl, "content-type": "audio/webm;codecs=opus", "x-csrf": b.jar.get(CSRF_COOKIE) ?? "", ...headers }, "POST", body);

describe("the voice route", () => {
  it("passes the audio, its type, seconds and the client in focus; answers with the text; logs only the outcome", async () => {
    const b = app.browser();
    await b.signIn("me");
    const r = await post(b, AUDIO);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, text: "Move my export spec to Thursday" });
    expect(got.at(-1)).toEqual({ mime: "audio/webm;codecs=opus", seconds: 4, bytes: AUDIO.length, context: { clientKey: "fabrikam", itemId: 4417 } });
    const said = JSON.stringify(logs);
    expect(said).not.toContain("OggS");
    expect(said).not.toContain("Move my export");
    expect(logs.some((l) => l.op === "transcribe" && l.kind === "ok")).toBe(true);
  });
  it("over 2 MB is refused before anything is transcribed", async () => {
    const b = app.browser();
    await b.signIn("me");
    const n = got.length;
    const r = await post(b, Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(r.status).toBe(413);
    expect(got.length).toBe(n);
  });
  it("needs the session's X-CSRF, and a same-site origin", async () => {
    const b = app.browser();
    await b.signIn("me");
    expect((await post(b, AUDIO, undefined, { "x-csrf": "nope" })).status).toBe(403);
    expect((await app.browser().send(ASSISTANT_VOICE_PATH, { origin: app.publicUrl, "content-type": "audio/webm" }, "POST", AUDIO)).status).toBe(401);
  });
});

describe("the gate and limits", () => {
  function ctx(o: { on?: boolean; allowed?: string[]; heard?: TranscribeCall[] } = {}): ActionContext {
    const now = "2026-11-05T15:00:00Z";
    const base = `${STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"')}\n[clients.fabrikam]\nname = "Fabrikam"\n`;
    const parsed = withTeam(parseConfig(base), { ai: { on: o.on ?? true, allowed: o.allowed ?? ["fabrikam"] } });
    const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York") });
    const provider = stubProvider({ transcript: async (t) => (o.heard?.push(t), { ok: true, text: " Confirm today " }) });
    return {
      loadConfig: async () => ({ path: "x", parsed }),
      makeDataverse: () => ({ myClients: async () => [] }) as never,
      makeOutlook: () => { throw new Error("n/a"); },
      makeGoogle: () => { throw new Error("n/a"); },
      makeDevOps: () => ({ last: () => null }) as never,
      saveSystemUserId: async () => {},
      now: () => now,
      plan,
      ai: { app: anAiApp({ transcribe: { model: "gpt-transcribe", perMinuteUsd: 0.0045 } }), provider: async () => provider, appSpend: { get: async () => 0, add: async () => {} } },
    };
  }
  const audio = new Uint8Array([1, 2, 3, 4]);
  it("AI on and the client in focus allowed: the transcript, trimmed, and one log row with cost and no text", async () => {
    const heard: TranscribeCall[] = [];
    const c = ctx({ heard });
    expect(await assistantTranscribe(c, { audio, mime: "audio/webm", seconds: 20, context: { clientKey: "fabrikam" } })).toEqual({ ok: true, text: "Confirm today" });
    expect(heard[0]).toMatchObject({ model: "gpt-transcribe", mime: "audio/webm", language: "en" });
    const rows = await c.plan!.aiRequests(5);
    expect(rows[0]).toMatchObject({ task: "assistant_transcribe", clientKey: "fabrikam", costMicros: 1500 });
    expect(JSON.stringify(rows)).not.toContain("Confirm today");
  });
  it("a client in focus without Allow AI: Voice is off while <client> is in focus, and nothing is sent", async () => {
    const heard: TranscribeCall[] = [];
    expect(await assistantTranscribe(ctx({ allowed: [], heard }), { audio, mime: "audio/webm", seconds: 5, context: { clientKey: "fabrikam" } })).toEqual({ ok: false, reason: "client_off", message: "Voice is off while Fabrikam is in focus" });
    expect(heard).toEqual([]);
  });
  it("no client in focus: AI for FocusTime is enough; AI off says so", async () => {
    expect((await assistantTranscribe(ctx({ allowed: [] }), { audio, mime: "audio/mp4", seconds: 5 })).ok).toBe(true);
    expect(await assistantTranscribe(ctx({ on: false }), { audio, mime: "audio/mp4", seconds: 5 })).toMatchObject({ ok: false, reason: "off" });
  });
  it("over 60 seconds, an empty recording or another format: refused before anything is sent", async () => {
    const heard: TranscribeCall[] = [];
    const c = ctx({ heard });
    expect(await assistantTranscribe(c, { audio, mime: "audio/webm", seconds: 75 })).toMatchObject({ ok: false, reason: "too_long" });
    expect(await assistantTranscribe(c, { audio: new Uint8Array(), mime: "audio/webm", seconds: 3 })).toMatchObject({ ok: false, reason: "format" });
    expect(await assistantTranscribe(c, { audio, mime: "video/mp4", seconds: 3 })).toMatchObject({ ok: false, reason: "format" });
    expect(heard).toEqual([]);
  });
});
