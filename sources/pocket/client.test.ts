// PK-2: the Pocket client makes one call (list recordings between two dates) and refuses everything else before the
// key is read or the network is used; one try with a time limit; each failure in its own words; the log lines hold
// the call's kind, status and time only; nothing of a recording comes out. Pretend Pocket only: no real key.
import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import type { LogRecord } from "../../log/logger.ts";
import { createDemoPocketFetch, DEMO_POCKET_KEYS, DEMO_POCKET_OTHER, type PocketCall } from "../demo/pocket.ts";
import { allowedPocketCall, createPocketClient, POCKET_MAX_PAGES, POCKET_RECORDING_MAX_BYTES, keyProblem, POCKET_FAILURE_TEXT, POCKET_LIST_PATH, POCKET_ORIGIN, PocketError, PocketKey } from "./client.ts";

const KEY = "pk_test_0123456789abcdef";
const NOW = Date.parse("2026-11-17T15:00:00Z");
const LIST = `${POCKET_ORIGIN}${POCKET_LIST_PATH}`;

function setup(o: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
  const calls: PocketCall[] = [];
  const logs: LogRecord[] = [];
  let keyReads = 0;
  const pretend = createDemoPocketFetch({ now: () => NOW, calls });
  let netCalls = 0;
  const f = (async (u: string | URL | Request, i?: RequestInit) => (netCalls++, (o.fetch ?? pretend)(u, i))) as typeof fetch;
  const client = createPocketClient({ fetch: f, log: (r) => logs.push(r), timeoutMs: o.timeoutMs ?? 200 });
  const key = (v = KEY) => async () => (keyReads++, new PocketKey(v));
  return { client, calls, logs, key, keyReads: () => keyReads, netCalls: () => netCalls };
}

describe("PK-2: the Pocket client", () => {
  it("counts the last 7 days with one GET for one item, and returns only the count", async () => {
    const t = setup();
    const r = await t.client.countLastWeek(t.key(), NOW);
    expect(r).toEqual({ recordings: 1 });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ method: "GET", authorized: true, url: `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=1` });
    // Nothing of a recording comes out: not a title, a date or a word.
    expect(JSON.stringify(r)).not.toMatch(/Invented|rec-demo|2026-11-1[0-9]T/);
  });

  it.each([
    ["POST", LIST],
    ["DELETE", LIST],
    ["PATCH", LIST],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/rec-1`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/rec-1/audio`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings/../search`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/recordings%2Frec-1`],
    ["POST", `${POCKET_ORIGIN}/api/v1/public/search`],
    ["POST", `${POCKET_ORIGIN}/api/v1/public/recordings/upload-url`],
    ["GET", `${POCKET_ORIGIN}/api/v1/public/tags`],
    ["GET", `${POCKET_ORIGIN}/api/v1/organization/org-1/api-keys`],
    ["GET", `https://evil.example/api/v1/public/recordings`],
    ["GET", `http://public.heypocketai.com/api/v1/public/recordings`],
    ["GET", `https://user:pw@public.heypocketai.com/api/v1/public/recordings`],
    ["GET", `${LIST}?include=transcript`],
    ["GET", `${LIST}?limit=500`],
    ["GET", `${LIST}?tag_ids=1`],
    ["GET", `${LIST}?page=1&page=2`],
    ["GET", `${LIST}#x`],
    ["GET", `${LIST}?start_date=2026-11-11%0A`],
    ["GET", LIST],
    ["GET", `${LIST}?constructor=1`],
    ["GET", `${LIST}?__proto__=1`],
    // MC-2b: the list's pages are 1 to 3 of 100; the count is page 1 of 1; nothing between or beyond.
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=4&limit=100`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=0&limit=100`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=50`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=01&limit=100`],
    ["GET", `${LIST}?end_date=2026-11-17&start_date=2026-11-11&page=1&limit=100`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=100&include=transcript`],
    // MC-2b: one recording only with exactly its two parameters, an id of the accepted form, no other path below it.
    ["GET", `${LIST}/rec-1?include_transcript=true`],
    ["GET", `${LIST}/rec-1?include_transcript=true&include_summarizations=true`],
    ["GET", `${LIST}/rec-1?include_summarizations=false&include_transcript=true`],
    ["GET", `${LIST}/rec-1?include_transcript=true&include_summarizations=false&summarization_id=s1`],
    ["GET", `${LIST}/rec-1/?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/rec-1/audio?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/rec%2D1?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/rec.1?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/..?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/-rec?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/${"a".repeat(129)}?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}/rec%201?include_transcript=true&include_summarizations=false`],
    ["DELETE", `${LIST}/rec-1?include_transcript=true&include_summarizations=false`],
    ["PATCH", `${LIST}/rec-1?include_transcript=true&include_summarizations=false`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=2&limit=1`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&lim%69t=1`],
    ["GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=1&`],
  ])("refuses %s %s before the key is read or the network is used", async (method, url) => {
    const t = setup();
    await expect(t.client.request(method, url, t.key())).rejects.toMatchObject({ kind: "refused" });
    expect(t.keyReads()).toBe(0);
    expect(t.netCalls()).toBe(0);
    expect(t.logs).toEqual([{ source: "pocket", op: "refused", kind: "refused" }]);
  });

  it("allows only the three calls, each in its exact form", () => {
    expect(allowedPocketCall("GET", `${LIST}?start_date=2026-11-11&end_date=2026-11-17&page=1&limit=1`)).toBe("count");
    for (const p of [1, 2, 3]) expect(allowedPocketCall("GET", `${LIST}?start_date=2026-11-04&end_date=2026-11-17&page=${p}&limit=100`)).toBe("list");
    expect(allowedPocketCall("GET", `${LIST}/rec-demo_1?include_transcript=true&include_summarizations=false`)).toBe("recording");
    expect(allowedPocketCall("HEAD", LIST)).toBeNull();
  });

  it.each([
    [DEMO_POCKET_KEYS.wrong, "not_accepted", 401],
    [DEMO_POCKET_KEYS.busy, "busy", 429],
    [DEMO_POCKET_KEYS.slow, "no_answer", 0],
    [DEMO_POCKET_KEYS.odd, "unexpected", 200],
  ] as const)("a failure says its own words: %s → %s", async (key, kind, status) => {
    const t = setup();
    const e = (await t.client.countLastWeek(t.key(key), NOW).catch((x) => x)) as PocketError;
    expect(e).toBeInstanceOf(PocketError);
    expect(e).toMatchObject({ kind, status, message: POCKET_FAILURE_TEXT[kind] });
    // Tried once.
    expect(t.calls).toHaveLength(1);
    expect(e.message).not.toContain(key);
  });

  it("a server error is 'didn't answer', a 503 is busy, and an unknown 4xx is unexpected", async () => {
    for (const [status, kind] of [[500, "no_answer"], [503, "busy"], [404, "unexpected"]] as const) {
      const t = setup({ fetch: (async () => new Response("{}", { status })) as typeof fetch });
      await expect(t.client.countLastWeek(t.key(), NOW)).rejects.toMatchObject({ kind, status });
    }
  });

  it("logs the call's kind, status and time, never the key, a count or any of Pocket's answer", async () => {
    const t = setup();
    await t.client.countLastWeek(t.key(), NOW);
    await t.client.countLastWeek(t.key(DEMO_POCKET_KEYS.wrong), NOW).catch(() => null);
    await t.client.countLastWeek(t.key(DEMO_POCKET_KEYS.odd), NOW).catch(() => null);
    for (const l of t.logs) {
      expect(Object.keys(l).every((k) => ["source", "op", "status", "durationMs", "kind"].includes(k)), JSON.stringify(l)).toBe(true);
      expect(l.source).toBe("pocket");
    }
    const all = JSON.stringify(t.logs);
    expect(all).not.toMatch(/pk_|Invented|rec-demo|"count":/);
  });

  it("the key never prints, serializes or inspects as itself", () => {
    const k = new PocketKey(KEY);
    expect(String(k)).toBe("[Pocket key]");
    expect(JSON.stringify({ k })).toBe('{"k":"[Pocket key]"}');
    expect(inspect(k)).toBe("[Pocket key]");
    expect(k.bearer()).toBe(`Bearer ${KEY}`);
  });

  it("checks a pasted key's shape without echoing it", () => {
    expect(keyProblem("")).toMatch(/Paste/);
    expect(keyProblem("not a key")).toMatch(/one line/);
    expect(keyProblem("sk_abcdefgh")).toMatch(/start with pk_/);
    expect(keyProblem(KEY)).toBeNull();
    for (const v of ["not a key", "sk_abcdefgh"]) expect(keyProblem(v)).not.toContain(v);
  });
});

describe("MC-2b: the list of my recordings and one recording", () => {
  const LATER = Date.parse("2026-11-19T22:00:00Z");
  const mineOnly = (rs: readonly (string | null)[]) => rs.map((r) => r === "you@example.com");
  function later(o: { fetch?: typeof fetch } = {}) {
    const calls: PocketCall[] = [];
    const logs: LogRecord[] = [];
    const client = createPocketClient({ fetch: o.fetch ?? createDemoPocketFetch({ now: () => LATER, calls }), log: (r) => logs.push(r), timeoutMs: 200 });
    return { client, calls, logs, key: async () => new PocketKey(KEY) };
  }

  it("lists 100 a page and reads of a kept recording only its id, time, length and title", async () => {
    const t = later();
    const r = await t.client.listRecordings(t.key, "2026-11-05", "2026-11-19", mineOnly);
    expect(t.calls.map((c) => c.url)).toEqual([`${LIST}?start_date=2026-11-05&end_date=2026-11-19&page=1&limit=100`]);
    expect(r.others).toBe(1);
    expect(r.more).toBe(false);
    for (const x of r.recordings) expect(Object.keys(x).sort()).toEqual(["id", "seconds", "startAt", "title"]);
    expect(r.recordings.map((x) => x.id)).toEqual(["rec-demo-carrier", "rec-demo-long", "rec-demo-prop", "rec-demo-weekly"]);
    // The listed transcripts, summaries, speakers and tags never come out; nor anything of the other person's.
    const out = JSON.stringify(r);
    expect(out).not.toMatch(/invented words|summary|SPEAKER|Dana|tag|Someone else|sam\.taylor|rec-demo-other/i);
    expect(JSON.stringify(t.logs)).not.toMatch(/rec-demo|Proposal|2026-11|@/);
  });

  it("a page past 40 MB is refused as too long, and a length past a day is never read as a recording", async () => {
    const big = new Response(new ReadableStream({ start(c) { for (let i = 0; i < 41; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } }), { status: 200 });
    const t = later({ fetch: (async () => big) as typeof fetch });
    await expect(t.client.listRecordings(t.key, "2026-11-05", "2026-11-19", mineOnly)).rejects.toMatchObject({ kind: "too_long" });
    const odd = new Response(JSON.stringify({ success: true, data: [{ id: "r1", recording_at: "2026-11-10T15:00:00Z", duration: 1e15, title: "t", recorded_by: { email: "you@example.com" } }], pagination: { has_more: false } }), { status: 200 });
    const u = later({ fetch: (async () => odd) as typeof fetch });
    const r = await u.client.listRecordings(u.key, "2026-11-05", "2026-11-19", mineOnly).catch((e: unknown) => e);
    expect(JSON.stringify(r)).not.toMatch(/"r1"/);
  });

  it("stops after 3 pages and says more were left", async () => {
    const page = (n: number) => new Response(JSON.stringify({ success: true, data: [{ id: `r${n}`, recording_at: "2026-11-10T15:00:00Z", duration: 60, title: "t", recorded_by: { email: "you@example.com" } }], pagination: { has_more: true } }), { status: 200 });
    let n = 0;
    const t = later({ fetch: (async () => page(++n)) as typeof fetch });
    const r = await t.client.listRecordings(t.key, "2026-11-05", "2026-11-19", mineOnly);
    expect(n).toBe(POCKET_MAX_PAGES);
    expect(r).toMatchObject({ more: true, others: 0 });
    expect(r.recordings).toHaveLength(3);
  });

  it("a list in a shape the docs don't show is unexpected; a kept recording missing a field is left out", async () => {
    const odd = later({ fetch: (async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })) as typeof fetch });
    await expect(odd.client.listRecordings(odd.key, "2026-11-05", "2026-11-19", mineOnly)).rejects.toMatchObject({ kind: "unexpected" });
    const part = later({ fetch: (async () => new Response(JSON.stringify({ success: true, data: [{ id: "a/b", recording_at: "x", duration: 1, recorded_by: { email: "you@example.com" } }], pagination: { has_more: false } }), { status: 200 })) as typeof fetch });
    expect(await part.client.listRecordings(part.key, "2026-11-05", "2026-11-19", mineOnly)).toEqual({ recordings: [], others: 0, more: false });
  });

  it("the keep rule sees only the recorders' addresses", async () => {
    const t = later();
    let seen: readonly (string | null)[] = [];
    await t.client.listRecordings(t.key, "2026-11-05", "2026-11-19", (rs) => ((seen = rs), rs.map(() => false)));
    expect([...new Set(seen)].sort()).toEqual([DEMO_POCKET_OTHER, "you@example.com"]);
  });

  it("reads one recording's segments (start, end, label, text) and its length; never the speaker's name or summaries", async () => {
    const t = later();
    const r = await t.client.recording(t.key, "rec-demo-prop");
    expect(t.calls.map((c) => c.url)).toEqual([`${LIST}/rec-demo-prop?include_transcript=true&include_summarizations=false`]);
    expect(r.seconds).toBe(2820);
    expect(r.segments[0]).toEqual({ start: 0, end: 40, speaker: "SPEAKER_0", text: "Thanks for making time. Let's walk the proposal for the reporting work." });
    expect(JSON.stringify(r)).not.toMatch(/Dana|Guest|summary|originalText/);
    expect(JSON.stringify(t.logs)).not.toMatch(/rec-demo|proposal/i);
  });

  it("refuses an id of another form before the key is read, and an answer past 20 MB", async () => {
    const t = later();
    let reads = 0;
    await expect(t.client.recording(async () => (reads++, new PocketKey(KEY)), "../tags")).rejects.toMatchObject({ kind: "refused" });
    expect(reads).toBe(0);
    expect(t.calls).toHaveLength(0);
    const big = later({ fetch: (async () => new Response(new Uint8Array(POCKET_RECORDING_MAX_BYTES + 10), { status: 200 })) as typeof fetch });
    await expect(big.client.recording(big.key, "rec-1")).rejects.toMatchObject({ kind: "too_long" });
  });

  it("a missing recording or a shape without segments is said in Pocket's words", async () => {
    const t = later();
    await expect(t.client.recording(t.key, "rec-gone")).rejects.toMatchObject({ kind: "unexpected", status: 404 });
    const odd = later({ fetch: (async () => new Response(JSON.stringify({ success: true, data: { transcript: "one text" } }), { status: 200 })) as typeof fetch });
    await expect(odd.client.recording(odd.key, "rec-1")).rejects.toMatchObject({ kind: "unexpected" });
  });
});
