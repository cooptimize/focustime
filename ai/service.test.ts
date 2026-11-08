// AI-0: the service in front of every AI request. Both switches are needed (Use AI, and Allow AI for the task's client;
// only Use AI for client "none"); no key is "AI isn't set up"; the guards refuse before anything is sent; the person's
// and the app's monthly caps stop requests and a new month starts again; an answer that doesn't fit the schema is a
// typed error and is never retried; a transient failure is retried once (Retry-After on 429); and neither the request
// log nor the logger ever holds the instructions, the input or the answer.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import { aClientEntry, anAiApp, anAiRules } from "../test/builders/index.ts";
import { createAi, MAX_RETRY_WAIT_MS, TEST_SCHEMA, type AiAppSettings, type AiDeps } from "./service.ts";
import { stubProvider } from "./stub.ts";
import type { AiLogEntry, AiRules, JsonSchema, ProviderCall, ProviderReply, ToolSpec } from "./types.ts";

const SCHEMA: JsonSchema = { type: "object", properties: { title: { type: "string" }, urgency: { type: "string", enum: ["now", "later"] } }, required: ["title", "urgency"], additionalProperties: false };
const TASK = { name: "draft_title", client: "fabrikam", instructions: "Write a short title for this request." };
const INPUT = "The export button does nothing on the March report";
const ANSWER = { title: "Export button broken on March report", urgency: "now" };

function setup(o: { internal?: string; person?: Partial<AiRules>; app?: Partial<AiAppSettings>; replies?: (string | ProviderReply)[]; noKey?: boolean; now?: string } = {}) {
  const log: AiLogEntry[] = [];
  const records: LogRecord[] = [];
  const spend = new Map<string, number>();
  const calls: ProviderCall[] = [];
  const slept: number[] = [];
  const replies = [...(o.replies ?? [JSON.stringify(ANSWER)])];
  let now = o.now ?? "2026-11-04T15:00:00Z";
  const person = anAiRules(o.person);
  const provider = stubProvider({
    respond: (c) => {
      calls.push(c);
      return replies.shift() ?? JSON.stringify(ANSWER);
    },
  });
  const deps: AiDeps = {
    provider: async () => (o.noKey ? null : provider),
    app: anAiApp(o.app),
    rules: async () => person,
    guard: async (client) => ({ directory: [aClientEntry({ key: "fabrikam", names: [], projects: [], itemIds: [] }), aClientEntry({ key: "northwind", names: ["Northwind Traders"], projects: [], itemIds: [5150] })], homeDomains: ["cooptimize.example"], forbidden: [], ...(o.internal && client === o.internal ? { internal: true } : {}) }),
    log: {
      add: async (e) => void log.push(e),
      spentMicros: async (from, to) => log.filter((e) => e.at >= from && e.at < to).reduce((n, e) => n + e.costMicros, 0),
      recent: async (n) => log.slice(-n).reverse(),
    },
    appSpend: { get: async (m) => spend.get(m) ?? 0, add: async (m, n) => void spend.set(m, (spend.get(m) ?? 0) + n) },
    now: () => now,
    sleep: async (ms) => void slept.push(ms),
    random: () => 0,
    logger: (r) => void records.push(r),
  };
  return { ai: createAi(deps), log, records, spend, calls, slept, setNow: (t: string) => void (now = t) };
}

describe("switches", () => {
  it("AI off for FocusTime (the emergency off): nothing is sent or logged", async () => {
    const s = setup({ person: { on: false } });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("off");
    expect([s.calls.length, s.log.length]).toEqual([0, 0]);
  });
  it("Allow AI off for the task's client: refused before anything is sent", async () => {
    const s = setup({ person: { allowedClients: ["northwind"] } });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("client_off");
    expect(s.calls).toHaveLength(0);
  });
  it('client "none" needs only Use AI', async () => {
    const s = setup({ person: { allowedClients: [] } });
    const r = await s.ai.run({ ...TASK, client: "none" }, "Write a title for: the export fails", SCHEMA);
    expect(r.ok).toBe(true);
  });
  it("both on: the value, its usage, cost and latency", async () => {
    const s = setup();
    const r = await s.ai.run<typeof ANSWER>(TASK, INPUT, SCHEMA);
    expect(r.ok && r.value).toEqual(ANSWER);
    expect(r.ok && r.costUsd).toBeGreaterThan(0);
    expect(s.calls[0]).toMatchObject({ model: "test-model", schemaName: "draft_title", maxOutputTokens: 500, timeoutMs: 5_000 });
    expect(s.log).toEqual([expect.objectContaining({ task: "draft_title", clientKey: "fabrikam", outcome: "ok", detail: null })]);
  });
  it("no key: AI isn't set up", async () => {
    const s = setup({ noKey: true });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : [r.error.kind, r.error.message]).toEqual(["not_set_up", "AI isn't set up"]);
    expect((await s.ai.status()).setUp).toBe(false);
  });
  it("provider off for the app: AI isn't set up", async () => {
    const s = setup({ app: { provider: "off" } });
    expect((await s.ai.test()).ok).toBe(false);
  });
});

describe("guards in the service", () => {
  it("another client's name in the input refuses, is logged as refused with no tokens, and sends nothing", async () => {
    const s = setup();
    const r = await s.ai.run(TASK, `${INPUT}, same as Northwind Traders had`, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("refused_client");
    expect(s.calls).toHaveLength(0);
    expect(s.log).toEqual([expect.objectContaining({ outcome: "refused", detail: "refused_client", inputTokens: 0, costMicros: 0 })]);
  });
  it("logs which rule refused and the matched client as its ref, never the text", async () => {
    const s = setup();
    await s.ai.run(TASK, `${INPUT}, same as Northwind Traders had`, SCHEMA);
    expect(s.records).toContainEqual({ source: "ai", op: "guard", kind: "draft_title:input:client_name", status: "refused_client", client: "northwind" });
    expect(JSON.stringify(s.records)).not.toContain("Traders");
  });

  // GD-1: the answer goes through the same guard.
  it("an answer naming another client is refused after the call: logged as refused with its tokens, never shown", async () => {
    const s = setup({ replies: [JSON.stringify({ title: "Same fix as Northwind Traders", urgency: "now" })] });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : [r.error.kind, r.error.message]).toEqual(["refused_client", "The AI's answer mentions another client, so nothing is shown"]);
    expect(s.calls).toHaveLength(1);
    expect(s.log).toEqual([expect.objectContaining({ outcome: "refused", detail: "refused_client" })]);
    expect(s.records).toContainEqual(expect.objectContaining({ op: "guard", kind: "draft_title:output:client_name" }));
  });

  // GD-2: a task may take words that name a client (mentions.input "words") and have its answer checked after
  // (mentions.answer "scrub": each other client's name becomes "another client", counted for the draft's notice).
  it("GD-2: words in: another client's name in the input is sent; secrets and outside addresses still refuse", async () => {
    const s = setup();
    const r = await s.ai.run({ ...TASK, mentions: { input: "words", answer: "scrub" } }, `${INPUT}, same as Northwind Traders`, SCHEMA);
    expect(r.ok).toBe(true);
    expect(s.calls[0]!.input).toContain("Northwind Traders");
    const key = await s.ai.run({ ...TASK, mentions: { input: "words" } }, `${INPUT} sk-${"Ab3".repeat(10)}`, SCHEMA);
    expect(key.ok ? null : key.error.kind).toBe("refused_secret");
  });
  it("GD-2: scrub: the answer's other-client names are replaced, the result says how many, the log has only a count", async () => {
    const s = setup({ replies: [JSON.stringify({ title: "Same fix as Northwind Traders, see #5150", urgency: "now" })] });
    const r = await s.ai.run<typeof ANSWER>({ ...TASK, mentions: { input: "words", answer: "scrub" } }, INPUT, SCHEMA);
    expect(r.ok && r.value.title).toBe("Same fix as another client, see another client");
    expect(r.ok && r.namesRemoved).toBe(2);
    expect(s.records).toContainEqual(expect.objectContaining({ op: "scrub", count: 2 }));
    expect(JSON.stringify(s.records)).not.toContain("Northwind");
  });
  it("GD-2: allow keeps the names (an internal chat's sorting); without a rule the answer still refuses", async () => {
    const s = setup({ replies: [JSON.stringify({ title: "Same fix as Northwind Traders", urgency: "now" })] });
    const r = await s.ai.run<typeof ANSWER>({ ...TASK, mentions: { input: "words", answer: "allow" } }, INPUT, SCHEMA);
    expect(r.ok && r.value.title).toBe("Same fix as Northwind Traders");
    const t = setup({ replies: [JSON.stringify({ title: "Same fix as Northwind Traders", urgency: "now" })] });
    expect(((await t.ai.run(TASK, INPUT, SCHEMA)) as { ok: false; error: { kind: string } }).error.kind).toBe("refused_client");
  });

  // HK-4: per-span redaction. A batch with one secret-shaped item keeps every other item and blanks only the span.
  const BATCH: JsonSchema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, summary: { type: "string" } }, required: ["ref", "summary"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };
  it("a batch answer with one secret-shaped item and one outside address: only those spans become [removed], every item is kept", async () => {
    const key = `sk-${"Ab3".repeat(10)}`;
    const answer = { items: [
      { ref: "m1", summary: "Export fails on the March report" },
      { ref: "m2", summary: `Screenshot shows the key ${key} in the config` },
      { ref: "m3", summary: "Ask pat@outside.example and ana@cooptimize.example about it" },
    ] };
    const s = setup({ replies: [JSON.stringify(answer)] });
    const r = await s.ai.run<typeof answer>(TASK, INPUT, BATCH);
    expect(r.ok && r.value.items).toEqual([
      { ref: "m1", summary: "Export fails on the March report" },
      { ref: "m2", summary: "Screenshot shows the key [removed] in the config" },
      { ref: "m3", summary: "Ask [removed] and ana@cooptimize.example about it" },
    ]);
    expect(s.log).toEqual([expect.objectContaining({ outcome: "ok", detail: null })]);
    // Logged as a count and a kind only, never the text.
    expect(s.records).toContainEqual({ source: "ai", op: "redact", kind: "draft_title:secret", count: 1 });
    expect(s.records).toContainEqual({ source: "ai", op: "redact", kind: "draft_title:email", count: 1 });
    expect(JSON.stringify(s.records)).not.toContain(key);
    expect(JSON.stringify(s.records)).not.toContain("outside.example");
  });
  it("redaction never stands in for the client rule: another client named anywhere still refuses the whole answer", async () => {
    const s = setup({ replies: [JSON.stringify({ items: [{ ref: "m1", summary: "Fine" }, { ref: "m2", summary: `Same as Northwind Traders, key sk-${"Ab3".repeat(10)}` }] })] });
    const r = await s.ai.run(TASK, INPUT, BATCH);
    expect(r.ok ? null : r.error.kind).toBe("refused_client");
  });
  it("a span whose replacement breaks the schema (an enum) makes the answer unusable rather than wrong", async () => {
    const ENUM: JsonSchema = { type: "object", properties: { who: { type: "string", enum: ["pat@outside.example", "nobody"] } }, required: ["who"], additionalProperties: false };
    const s = setup({ replies: [JSON.stringify({ who: "pat@outside.example" })] });
    const r = await s.ai.run(TASK, INPUT, ENUM);
    expect(r.ok ? null : r.error.kind).toBe("invalid_output");
  });

  it("Internal: a request and an answer naming two clients are sent and accepted", async () => {
    const s = setup({ internal: "coop", person: { allowedClients: ["coop"] }, replies: [JSON.stringify({ title: "Northwind Traders and fabrikam exports", urgency: "now" })] });
    const r = await s.ai.run({ ...TASK, client: "coop" }, `${INPUT} for Northwind Traders, item 5150, and fabrikam`, SCHEMA);
    expect(r.ok && r.value).toEqual({ title: "Northwind Traders and fabrikam exports", urgency: "now" });
    expect(s.calls).toHaveLength(1);
  });

  it("Internal: secrets still refuse in the request", async () => {
    const s = setup({ internal: "coop", person: { allowedClients: ["coop"] } });
    const sent = await s.ai.run({ ...TASK, client: "coop" }, `${INPUT} sk-${"Ab3".repeat(10)}`, SCHEMA);
    expect(sent.ok ? null : sent.error.kind).toBe("refused_secret");
    expect(s.calls).toHaveLength(0);
  });

  it("a token shape in the instructions refuses too", async () => {
    const s = setup();
    const r = await s.ai.run({ ...TASK, instructions: `Use key sk-${"Ab3".repeat(10)}` }, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("refused_secret");
    expect(s.calls).toHaveLength(0);
  });
  it("a task with a schema strict mode can't take is refused as a programming error", async () => {
    const s = setup();
    const loose: JsonSchema = { type: "object", properties: { title: { type: "string" } }, required: [] };
    const r = await s.ai.run(TASK, INPUT, loose);
    expect(r.ok ? null : r.error.kind).toBe("bad_task");
  });
});

describe("budget", () => {
  // 100 input + 20 output tokens at $1 and $2 per million: 140 millionths of a dollar a request.
  const usage = (input: number, output: number): ProviderReply => ({ ok: true, text: JSON.stringify(ANSWER), model: "test-model", usage: { inputTokens: input, cachedTokens: 0, outputTokens: output } });
  it("the person's cap: over it, AI budget reached for this month (logged), until the month turns", async () => {
    const s = setup({ person: { personCapUsd: 0.00028 }, replies: [usage(100, 20), usage(100, 20), usage(100, 20), usage(100, 20)] });
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : [r.error.kind, r.error.message]).toEqual(["over_budget", "AI budget reached for this month"]);
    expect(s.calls).toHaveLength(2);
    expect(s.log.at(-1)).toMatchObject({ outcome: "over_budget", costMicros: 0 });
    expect((await s.ai.status()).spentMicros).toBe(280);
    s.setNow("2026-12-01T00:00:00Z");
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    expect((await s.ai.status()).spentMicros).toBe(140);
  });
  it("the app's cap stops everyone; its total is per month and adds every cost", async () => {
    const s = setup({ app: { appCapUsd: 0.0002 }, replies: [usage(100, 20), usage(100, 20), usage(100, 20)] });
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    expect(s.spend.get("2026-11")).toBe(140);
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("over_budget");
    expect((await s.ai.status()).appReached).toBe(true);
    s.setNow("2026-12-01T00:00:00Z");
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    expect(s.spend.get("2026-12")).toBe(140);
  });
});

describe("validation and retries", () => {
  it("an answer that doesn't fit the schema is a typed error, costs what it cost, and is not retried", async () => {
    const s = setup({ replies: [JSON.stringify({ title: "x", urgency: "someday" })] });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("invalid_output");
    expect(s.calls).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ outcome: "invalid", detail: "invalid_output" });
    expect(s.log[0]!.costMicros).toBeGreaterThan(0);
  });
  it("text that isn't JSON, a refusal or a cut-short answer are invalid too, never retried", async () => {
    for (const reply of ["not json", { ok: false, kind: "refusal" } as ProviderReply, { ok: false, kind: "incomplete" } as ProviderReply]) {
      const s = setup({ replies: [reply] });
      const r = await s.ai.run(TASK, INPUT, SCHEMA);
      expect(r.ok ? null : r.error.kind).toBe("invalid_output");
      expect(s.calls).toHaveLength(1);
    }
  });
  it("429 with Retry-After: waits exactly that long, retries once", async () => {
    const s = setup({ replies: [{ ok: false, kind: "rate_limited", status: 429, retryAfterMs: 3000 }, JSON.stringify(ANSWER)] });
    expect((await s.ai.run(TASK, INPUT, SCHEMA)).ok).toBe(true);
    expect(s.slept).toEqual([3000]);
    expect(s.calls).toHaveLength(2);
  });
  it("a transient failure without Retry-After: backoff, one retry, then the typed error", async () => {
    const s = setup({ replies: [{ ok: false, kind: "unavailable", status: 503 }, { ok: false, kind: "unavailable", status: 503 }, JSON.stringify(ANSWER)] });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("provider");
    expect(s.slept).toEqual([1000]);
    expect(s.calls).toHaveLength(2);
    expect(s.log[0]).toMatchObject({ outcome: "provider_error", detail: "provider" });
  });
  it("a Retry-After longer than is worth waiting fails as busy without a retry", async () => {
    const s = setup({ replies: [{ ok: false, kind: "rate_limited", status: 429, retryAfterMs: MAX_RETRY_WAIT_MS + 1 }] });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("rate_limited");
    expect([s.slept, s.calls.length]).toEqual([[], 1]);
  });
  it.each(["quota", "timeout", "provider"] as const)("%s is not retried", async (kind) => {
    const s = setup({ replies: [{ ok: false, kind }] });
    const r = await s.ai.run(TASK, INPUT, SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe(kind);
    expect(s.calls).toHaveLength(1);
  });
});

describe("no prompt or answer text is kept or logged", () => {
  it("across ok, refused, invalid and failed requests: the log rows and the logger hold none of it", async () => {
    const secretish = "UNIQUE-PROMPT-WORDS-41";
    const answerWords = "UNIQUE-ANSWER-WORDS-77";
    const s = setup({
      replies: [JSON.stringify({ title: answerWords, urgency: "now" }), JSON.stringify({ title: answerWords, urgency: "bad" }), { ok: false, kind: "provider" }, JSON.stringify({ reply: "ok" })],
    });
    await s.ai.run({ ...TASK, instructions: `Instructions ${secretish}` }, `Input ${secretish}`, SCHEMA);
    await s.ai.run(TASK, `Input ${secretish}`, SCHEMA);
    await s.ai.run(TASK, `Input ${secretish}`, SCHEMA);
    await s.ai.run(TASK, `Input ${secretish} Northwind Traders`, SCHEMA);
    await s.ai.test();
    const kept = JSON.stringify([s.log, s.records, await s.ai.status()]);
    expect(s.log.map((e) => e.outcome)).toEqual(["ok", "invalid", "provider_error", "refused", "ok"]);
    for (const w of [secretish, answerWords, "Instructions", "Write a short title", "Reply with ok", "checking that FocusTime"]) expect(kept).not.toContain(w);
    expect(s.records.every((r) => r.source === "ai" && (r.op === "request" || r.op === "guard"))).toBe(true);
  });
});

describe("Test AI", () => {
  it('a fixed request with client "none", checked against its schema', async () => {
    const s = setup({ person: { allowedClients: [] }, replies: [JSON.stringify({ reply: "ok" })] });
    const r = await s.ai.test();
    expect(r.ok && r.value).toEqual({ reply: "ok" });
    expect(s.calls[0]).toMatchObject({ schemaName: "test_ai", schema: TEST_SCHEMA });
    expect(s.log[0]).toMatchObject({ task: "test_ai", clientKey: null, outcome: "ok" });
  });
});

describe("AS-1: runTools", () => {
  const TOOL: ToolSpec = { name: "lookup", description: "Look one up", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } };
  const OTHER: ToolSpec = { name: "send", description: "Send", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } };
  const calls = (...c: [string, string][]): ProviderReply => ({ ok: true, text: "", usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 5 }, model: "m", calls: c.map(([name, args], i) => ({ callId: `c${i}`, name, arguments: args })), items: [{ type: "function_call" }] });
  const R = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false } as JsonSchema;
  it("runs allowed calls, refuses any other name without running it, and sends the outputs back as the next round", async () => {
    const s = setup({ replies: [calls(["lookup", '{"id":7}'], ["send", "{}"]), JSON.stringify({ reply: "ok" })] });
    const ran: unknown[] = [];
    const r = await s.ai.runTools<{ reply: string }>(TASK, INPUT, R, { tools: [TOOL, OTHER], allowed: ["lookup"], execute: async (n, a) => (ran.push([n, a]), "found") });
    expect(r).toMatchObject({ ok: true, value: { reply: "ok" }, refused: ["send"] });
    expect(ran).toEqual([["lookup", { id: 7 }]]);
    expect(s.calls[0]!.allowedTools).toEqual(["lookup"]);
    expect(s.calls[1]!.rounds![0]!.outputs.map((o) => o.output)).toEqual(["found", expect.stringContaining("isn't allowed")]);
    expect(s.log.map((e) => e.outcome)).toEqual(["ok", "ok"]);
  });
  it("arguments that don't fit the tool don't run", async () => {
    const s = setup({ replies: [calls(["lookup", '{"id":"x"}']), JSON.stringify({ reply: "ok" })] });
    const ran: unknown[] = [];
    await s.ai.runTools(TASK, INPUT, R, { tools: [TOOL], allowed: ["lookup"], execute: async (n) => (ran.push(n), "x") });
    expect(ran).toEqual([]);
  });
  it("the guard reads tool outputs too: another client's data in one stops the next round before it is sent", async () => {
    const s = setup({ replies: [calls(["lookup", '{"id":7}']), JSON.stringify({ reply: "ok" })] });
    const r = await s.ai.runTools(TASK, INPUT, R, { tools: [TOOL], allowed: ["lookup"], execute: async () => "Northwind Traders' item" });
    expect(r.ok ? null : r.error.kind).toBe("refused_client");
    expect(s.calls).toHaveLength(1);
  });
  it("the last round offers no tools, and a model that keeps calling ends as unusable", async () => {
    const s = setup({ replies: [calls(["lookup", '{"id":1}']), calls(["lookup", '{"id":2}'])] });
    const r = await s.ai.runTools(TASK, INPUT, R, { tools: [TOOL], allowed: ["lookup"], execute: async () => "x", maxRounds: 2 });
    expect(r.ok ? null : r.error.kind).toBe("invalid_output");
    expect(s.calls[1]!.allowedTools).toEqual([]);
  });
  it("switches and caps as for run(): AI off sends nothing", async () => {
    const s = setup({ person: { on: false } });
    const r = await s.ai.runTools(TASK, INPUT, R, { tools: [TOOL], allowed: ["lookup"], execute: async () => "x" });
    expect(r.ok ? null : r.error.kind).toBe("off");
    expect(s.calls).toEqual([]);
  });
});

describe("AS-1: transcribe", () => {
  it("a minute's price by the second, logged without text; AI off or the client not allowed sends nothing", async () => {
    const s = setup({ app: { transcribe: { model: "gpt-transcribe", perMinuteUsd: 0.0045 } } });
    const r = await s.ai.transcribe(new Uint8Array([1, 2, 3]), "audio/webm", 30, "fabrikam");
    expect(r).toMatchObject({ ok: true, text: "What's next today?" });
    expect(s.log[0]).toMatchObject({ task: "assistant_transcribe", model: "gpt-transcribe", costMicros: 2250, outcome: "ok", clientKey: "fabrikam" });
    expect(JSON.stringify(s.log)).not.toContain("What's next");
    expect((await setup({ person: { on: false } }).ai.transcribe(new Uint8Array([1]), "audio/webm", 3, "none")).ok).toBe(false);
    expect(await setup({ person: { allowedClients: ["northwind"] } }).ai.transcribe(new Uint8Array([1]), "audio/webm", 3, "fabrikam")).toMatchObject({ ok: false, error: { kind: "client_off" } });
  });
});
