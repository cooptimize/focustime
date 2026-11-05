// AI-0: the OpenAI adapter against a fake fetch. The request is the Responses API with strict structured output and
// store: false, the key only in the Authorization header; the answer is the output_text parts; usage becomes cost at the
// app's prices; 429 is a rate limit (with Retry-After) or a quota (never retried); 5xx is transient; a timeout aborts.
import { describe, expect, it } from "vitest";
import { anAiApp, anOpenAiResponse } from "../test/builders/index.ts";
import { costMicros } from "./cost.ts";
import { openAiProvider, retryAfterMs, usageOf } from "./openai.ts";
import { createAi } from "./service.ts";
import type { ProviderCall } from "./types.ts";

const KEY = `sk-test-${"k".repeat(24)}`;
const CALL: ProviderCall = {
  model: "test-model",
  instructions: "Answer with ok.",
  input: "Say ok.",
  schemaName: "test_ai",
  schema: { type: "object", properties: { reply: { type: "string", enum: ["ok"] } }, required: ["reply"], additionalProperties: false },
  maxOutputTokens: 300,
  timeoutMs: 1000,
  reasoningEffort: "low",
};
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

function fake(...responses: (Response | ((init: RequestInit) => Promise<Response>))[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init! });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return typeof r === "function" ? r(init!) : r;
  }) as typeof fetch;
  return { f, seen };
}

describe("the request", () => {
  it("CV-4: with images, one user message: the input text, then each image after its label, as a data URL at high detail; store false", async () => {
    const { f, seen } = fake(json(anOpenAiResponse({ reply: "ok" })));
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    await openAiProvider({ key: async () => KEY, fetch: f }).call({ ...CALL, images: [{ label: "Image i1, in message m2:", dataUrl }] });
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Say ok." }, { type: "input_text", text: "Image i1, in message m2:" }, { type: "input_image", image_url: dataUrl, detail: "high" }] }]);
    expect(body.store).toBe(false);
  });

  it("CV-4: the service refuses images that aren't a PNG, JPEG or GIF data URL, or too many, before anything is sent", async () => {
    const { f, seen } = fake();
    const ai = createAi({ provider: async () => openAiProvider({ key: async () => KEY, fetch: f }), app: anAiApp({ provider: "openai" }), rules: async () => ({ on: true, allowedClients: [], personCapUsd: 10, appCapUsd: 10 }), guard: async () => ({ directory: [], homeDomains: [], forbidden: [] }), log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] }, appSpend: { get: async () => 0, add: async () => {} }, now: () => "2026-11-05T10:00:00Z" });
    const task = { name: "test_ai", client: "none", instructions: "x" };
    expect(await ai.run(task, "y", CALL.schema, { images: [{ label: "Image i1", dataUrl: "https://example.com/a.png" }] })).toMatchObject({ ok: false, error: { kind: "bad_task" } });
    expect(await ai.run(task, "y", CALL.schema, { images: Array.from({ length: 11 }, () => ({ label: "Image", dataUrl: "data:image/png;base64,AA==" })) })).toMatchObject({ ok: false, error: { kind: "bad_task" } });
    expect(seen).toEqual([]);
  });

  it("Responses API, strict JSON schema, store false, max output tokens, reasoning effort; the key only in Authorization", async () => {
    const { f, seen } = fake(json(anOpenAiResponse({ reply: "ok" })));
    const r = await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL);
    expect(r).toEqual({ ok: true, text: '{"reply":"ok"}', model: "test-model", usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 20 } });
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body).toEqual({
      model: "test-model",
      instructions: "Answer with ok.",
      input: "Say ok.",
      store: false,
      max_output_tokens: 300,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "test_ai", schema: CALL.schema, strict: true } },
    });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(String(seen[0]!.init.body)).not.toContain(KEY);
  });
  it("no reasoning field when the effort is the model's default", async () => {
    const { f, seen } = fake(json(anOpenAiResponse({ reply: "ok" })));
    await openAiProvider({ key: async () => KEY, fetch: f }).call({ ...CALL, reasoningEffort: null });
    expect(JSON.parse(String(seen[0]!.init.body))).not.toHaveProperty("reasoning");
  });
  it("no key: nothing is sent", async () => {
    const { f, seen } = fake();
    expect(await openAiProvider({ key: async () => null, fetch: f }).call(CALL)).toEqual({ ok: false, kind: "unavailable" });
    expect(seen).toHaveLength(0);
  });
});

describe("the answer", () => {
  it("joins the output_text parts of message items, skipping reasoning items", async () => {
    const body = anOpenAiResponse({}, {}, { output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: '{"reply":' }, { type: "output_text", text: '"ok"}' }] }] });
    const { f } = fake(json(body));
    const r = await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL);
    expect(r.ok && r.text).toBe('{"reply":"ok"}');
  });
  it("a refusal part is a refusal, with its usage", async () => {
    const { f } = fake(json(anOpenAiResponse({}, { input: 50, output: 5 }, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })));
    expect(await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL)).toEqual({ ok: false, kind: "refusal", usage: { inputTokens: 50, cachedTokens: 0, outputTokens: 5 } });
  });
  it("status incomplete (max_output_tokens) is cut short", async () => {
    const { f } = fake(json(anOpenAiResponse({}, {}, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })));
    const r = await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL);
    expect(!r.ok && r.kind).toBe("incomplete");
  });
  it("usage to cost: cached input at its own price, reasoning inside output", () => {
    const u = usageOf({ usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } } });
    expect(u).toEqual({ inputTokens: 1000, cachedTokens: 400, outputTokens: 300 });
    // 600 × $0.10 + 400 × $0.01 + 300 × $0.50 per million = 60 + 4 + 150 millionths.
    expect(costMicros(u, { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 })).toBe(214);
    expect(usageOf({})).toEqual({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 });
  });
});

describe("errors", () => {
  it("429 rate limit with Retry-After", async () => {
    const { f } = fake(json({ error: { type: "requests", code: "rate_limit_exceeded", message: "slow down" } }, 429, { "retry-after": "2" }));
    expect(await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL)).toEqual({ ok: false, kind: "rate_limited", status: 429, retryAfterMs: 2000 });
  });
  it.each(["insufficient_quota", "project_spend_limit_exceeded", "credit_balance_exhausted"])("429 %s is a quota", async (code) => {
    const { f } = fake(json({ error: { type: "insufficient_quota", code, message: "x" } }, 429));
    expect(await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL)).toEqual({ ok: false, kind: "quota", status: 429 });
  });
  it("5xx is transient; 400 isn't", async () => {
    const { f } = fake(json({ error: { message: "x" } }, 503), json({ error: { message: "bad" } }, 400));
    const p = openAiProvider({ key: async () => KEY, fetch: f });
    expect(await p.call(CALL)).toEqual({ ok: false, kind: "unavailable", status: 503 });
    expect(await p.call(CALL)).toEqual({ ok: false, kind: "provider", status: 400 });
  });
  it("a timeout aborts the request", async () => {
    const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const { f } = fake(hang);
    expect(await openAiProvider({ key: async () => KEY, fetch: f }).call({ ...CALL, timeoutMs: 20 })).toEqual({ ok: false, kind: "timeout" });
  });
  it("a network failure is transient", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await openAiProvider({ key: async () => KEY, fetch: f }).call(CALL)).toEqual({ ok: false, kind: "unavailable" });
  });
  it("Retry-After in seconds or as a date", () => {
    expect(retryAfterMs("1.5")).toBe(1500);
    expect(retryAfterMs(new Date(Date.parse("2026-11-04T15:00:05Z")).toUTCString(), Date.parse("2026-11-04T15:00:00Z"))).toBe(5000);
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });
});

describe("through the service", () => {
  it("429 then success: one retry after Retry-After, the cost from the second answer's usage", async () => {
    const { f, seen } = fake(json({ error: { code: "rate_limit_exceeded" } }, 429, { "retry-after": "1" }), json(anOpenAiResponse({ reply: "ok" }, { input: 1000, output: 100 })));
    const slept: number[] = [];
    const ai = createAi({
      provider: async () => openAiProvider({ key: async () => KEY, fetch: f }),
      app: anAiApp({ provider: "openai" }),
      rules: async () => ({ on: true, personCapUsd: 10, allowedClients: [] }),
      guard: async () => ({ directory: [], homeDomains: [], forbidden: [] }),
      log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
      appSpend: { get: async () => 0, add: async () => {} },
      now: () => "2026-11-04T15:00:00Z",
      sleep: async (ms) => void slept.push(ms),
    });
    const r = await ai.test();
    expect(r.ok && [r.value, r.costUsd]).toEqual([{ reply: "ok" }, 0.0012]);
    expect([seen.length, slept]).toEqual([2, [1000]]);
  });
});

describe("AS-1: tools and speech to text", () => {
  const TOOL = { name: "item", description: "One item", parameters: { type: "object" as const, properties: { id: { type: "integer" as const } }, required: ["id"], additionalProperties: false as const } };
  it("function tools are strict, only the allowed ones usable (allowed_tools); earlier rounds go back with their outputs; store false", async () => {
    const { f, seen } = fake(json({ status: "completed", model: "m", output: [{ type: "reasoning", id: "rs_1", encrypted_content: "x" }, { type: "function_call", id: "fc_1", call_id: "call_1", name: "item", arguments: '{"id":7}' }], usage: { input_tokens: 5, output_tokens: 2 } }));
    const r = await openAiProvider({ key: async () => KEY, fetch: f }).call({ ...CALL, tools: [TOOL], allowedTools: ["item"], rounds: [{ items: [{ type: "function_call", call_id: "call_0", name: "item", arguments: "{}" }], outputs: [{ callId: "call_0", output: "found" }] }] });
    const body = JSON.parse(String(seen[0]!.init.body));
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([{ type: "function", name: "item", description: "One item", parameters: TOOL.parameters, strict: true }]);
    expect(body.tool_choice).toEqual({ type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "item" }] });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.input).toEqual([{ role: "user", content: "Say ok." }, { type: "function_call", call_id: "call_0", name: "item", arguments: "{}" }, { type: "function_call_output", call_id: "call_0", output: "found" }]);
    expect(r).toMatchObject({ ok: true, calls: [{ callId: "call_1", name: "item", arguments: '{"id":7}' }], items: [{ type: "reasoning" }, { type: "function_call" }] });
  });
  it("no allowed tools: tool_choice none (the last round answers)", async () => {
    const { f, seen } = fake(json(anOpenAiResponse({ reply: "ok" })));
    await openAiProvider({ key: async () => KEY, fetch: f }).call({ ...CALL, tools: [TOOL], allowedTools: [] });
    expect(JSON.parse(String(seen[0]!.init.body)).tool_choice).toBe("none");
  });
  it("transcribe: multipart to /audio/transcriptions with the file, gpt-transcribe and languages[]; the key only in the header", async () => {
    const { f, seen } = fake(json({ text: " Move it to Thursday. " }));
    const r = await openAiProvider({ key: async () => KEY, fetch: f }).transcribe!({ model: "gpt-transcribe", audio: new Uint8Array([1, 2, 3]), mime: "audio/webm;codecs=opus", language: "en", timeoutMs: 1000 });
    expect(r).toEqual({ ok: true, text: " Move it to Thursday. " });
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = seen[0]!.init.body as FormData;
    expect([form.get("model"), form.get("languages[]"), (form.get("file") as File).name, (form.get("file") as File).type]).toEqual(["gpt-transcribe", "en", "speech.webm", "audio/webm"]);
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });
  it("transcribe: a rejected format and a busy service are typed", async () => {
    const { f } = fake(json({ error: { code: "invalid_file" } }, 400), json({ error: {} }, 429));
    const p = openAiProvider({ key: async () => KEY, fetch: f });
    const t = { model: "gpt-transcribe", audio: new Uint8Array([1]), mime: "audio/mp4", language: "en", timeoutMs: 1000 };
    expect(await p.transcribe!(t)).toEqual({ ok: false, kind: "format" });
    expect(await p.transcribe!(t)).toEqual({ ok: false, kind: "rate_limited" });
  });
});
