// AI-F1: the processing tier per task. Interactive tasks always run on standard; background tasks on Flex, where a 429
// (or a 5xx) retries with backoff and jitter and falls back to standard after the tries or the time limit; the log
// keeps the tier actually used and the cost is read at that tier's price.
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../log/logger.ts";
import { aClientEntry, anAiApp, anAiRules } from "../test/builders/index.ts";
import { createAi, halfPrices, type AiAppSettings, type AiDeps } from "./service.ts";
import { stubProvider } from "./stub.ts";
import { FLEX_TASKS, STANDARD_TASKS, tierFor } from "./tiers.ts";
import type { AiLogEntry, AiRules, JsonSchema, ProviderCall, ProviderReply } from "./types.ts";

const SCHEMA: JsonSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const OK = JSON.stringify({ ok: true });
const BUSY: ProviderReply = { ok: false, kind: "rate_limited", status: 429 };
const task = (name: string) => ({ name, client: "fabrikam", instructions: "Answer ok." });

function setup(o: { rules?: Partial<AiRules>; app?: Partial<AiAppSettings>; replies?: (string | ProviderReply)[]; waiting?: boolean; random?: number } = {}) {
  const log: AiLogEntry[] = [];
  const records: LogRecord[] = [];
  const calls: ProviderCall[] = [];
  const slept: number[] = [];
  const replies = [...(o.replies ?? [])];
  const provider = stubProvider({
    respond: (c) => {
      calls.push(c);
      return replies.shift() ?? OK;
    },
  });
  const deps: AiDeps = {
    provider: async () => provider,
    app: anAiApp({ flex: { maxTries: 3, maxWaitMs: 60_000, timeoutMs: 120_000, baseBackoffMs: 1_000 }, ...o.app }),
    rules: async () => anAiRules(o.rules),
    guard: async () => ({ directory: [aClientEntry({ key: "fabrikam", names: [], projects: [], itemIds: [] })], homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async (e) => void log.push(e), spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => "2026-11-06T15:00:00Z",
    sleep: async (ms) => void slept.push(ms),
    random: () => o.random ?? 0,
    logger: (r) => void records.push(r),
    ...(o.waiting ? { waiting: true } : {}),
  };
  return { ai: createAi(deps), log, records, calls, slept };
}

describe("the tier table", () => {
  it("names each task once, and a task it doesn't name (a new one) is standard", () => {
    const all = [...FLEX_TASKS, ...STANDARD_TASKS];
    expect(new Set(all).size).toBe(all.length);
    expect(tierFor("meetings.new_task")).toBe("standard");
  });
  it("the background tasks are exactly the approved ones", () => {
    expect([...FLEX_TASKS].sort()).toEqual(["asks.classify", "conversations.update", "meeting.capture", "promises.extract"]);
  });
});

describe("interactive tasks always use standard", () => {
  for (const name of STANDARD_TASKS.filter((n) => n !== "assistant_transcribe" && n !== "assistant.answer")) {
    it(name, async () => {
      const s = setup();
      const r = await s.ai.run(task(name), "go", SCHEMA);
      expect(r.ok && r.tier).toBe("standard");
      expect(s.calls.map((c) => c.serviceTier)).toEqual([undefined]);
      expect(s.log.map((e) => e.tier)).toEqual(["standard"]);
    });
  }
  it("assistant.answer (tool rounds)", async () => {
    const s = setup();
    const r = await s.ai.runTools(task("assistant.answer"), "go", SCHEMA, { tools: [], allowed: [], execute: async () => "{}" });
    expect(r.ok && r.tier).toBe("standard");
    expect(s.calls.map((c) => c.serviceTier)).toEqual([undefined]);
  });
  it("assistant_transcribe (no Flex for audio)", async () => {
    const s = setup();
    const r = await s.ai.transcribe(new Uint8Array([1]), "audio/webm", 3, "fabrikam");
    expect(r.ok).toBe(true);
    expect(s.log.map((e) => e.tier)).toEqual(["standard"]);
  });
  it("a standard 429 keeps the one retry it always had, on standard", async () => {
    const s = setup({ replies: [BUSY, OK] });
    const r = await s.ai.run(task("stories.draft"), "go", SCHEMA);
    expect(r.ok && r.tier).toBe("standard");
    expect(s.calls.map((c) => c.serviceTier)).toEqual([undefined, undefined]);
  });
});

describe("background tasks use Flex", () => {
  for (const name of FLEX_TASKS) {
    it(`${name}: service_tier flex with the longer timeout, logged as flex`, async () => {
      const s = setup();
      const r = await s.ai.run(task(name), "go", SCHEMA);
      expect(r.ok && r.tier).toBe("flex");
      expect(s.calls).toEqual([expect.objectContaining({ serviceTier: "flex", timeoutMs: 120_000 })]);
      expect(s.log.map((e) => e.tier)).toEqual(["flex"]);
    });
  }
  it("a 429 retries with exponential backoff and jitter, then answers on Flex", async () => {
    const s = setup({ replies: [BUSY, BUSY, OK] });
    const r = await s.ai.run(task("conversations.update"), "go", SCHEMA);
    expect(r.ok && r.tier).toBe("flex");
    expect(s.calls.map((c) => c.serviceTier)).toEqual(["flex", "flex", "flex"]);
    expect(s.slept).toEqual([1_000, 2_000]);
    expect(s.records).toContainEqual(expect.objectContaining({ op: "tier", kind: "conversations.update:flex", count: 2 }));
  });
  it("jitter adds up to half the backoff", async () => {
    const s = setup({ replies: [BUSY, BUSY, OK], random: 0.99 });
    await s.ai.run(task("conversations.update"), "go", SCHEMA);
    expect(s.slept).toEqual([1_495, 2_990]);
  });
  it("after the tries, falls back to standard; the fallback is counted and priced at standard", async () => {
    const s = setup({ replies: [BUSY, BUSY, BUSY, OK] });
    const r = await s.ai.run(task("promises.extract"), "go", SCHEMA);
    expect(r.ok && r.tier).toBe("standard");
    expect(s.calls.map((c) => c.serviceTier)).toEqual(["flex", "flex", "flex", undefined]);
    expect(s.calls[3]!.timeoutMs).toBe(5_000);
    expect(s.log).toEqual([expect.objectContaining({ outcome: "ok", tier: "standard" })]);
    expect(s.records).toContainEqual(expect.objectContaining({ op: "flex_fallback", kind: "promises.extract:limit", count: 3 }));
  });
  it("after the time limit, falls back without waiting longer", async () => {
    const s = setup({ app: { flex: { maxTries: 10, maxWaitMs: 1_500, timeoutMs: 120_000, baseBackoffMs: 1_000 } }, replies: [BUSY, BUSY, OK] });
    const r = await s.ai.run(task("asks.classify"), "go", SCHEMA);
    expect(r.ok && r.tier).toBe("standard");
    // 1 s waited, then the next wait (2 s) would pass 1.5 s: standard.
    expect(s.slept).toEqual([1_000]);
    expect(s.calls.map((c) => c.serviceTier)).toEqual(["flex", "flex", undefined]);
  });
  it("a longer Retry-After is honoured", async () => {
    const s = setup({ replies: [{ ...BUSY, retryAfterMs: 7_000 }, OK] });
    await s.ai.run(task("asks.classify"), "go", SCHEMA);
    expect(s.slept).toEqual([7_000]);
  });
  it("a 400 on Flex (a model without it) or a timeout falls back at once", async () => {
    for (const bad of [{ ok: false, kind: "provider", status: 400 }, { ok: false, kind: "timeout" }] as ProviderReply[]) {
      const s = setup({ replies: [bad, OK] });
      const r = await s.ai.run(task("asks.classify"), "go", SCHEMA);
      expect(r.ok && r.tier).toBe("standard");
      expect(s.slept).toEqual([]);
      expect(s.calls.map((c) => c.serviceTier)).toEqual(["flex", undefined]);
    }
  });
  it("another error (a 401, 403 or 404) isn't capacity: one attempt, as before", async () => {
    const s = setup({ replies: [{ ok: false, kind: "provider", status: 403 }] });
    const r = await s.ai.run(task("asks.classify"), "go", SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("provider");
    expect(s.calls).toHaveLength(1);
  });
    it("quota is not capacity: no retry and no fallback", async () => {
    const s = setup({ replies: [{ ok: false, kind: "quota", status: 429 }] });
    const r = await s.ai.run(task("asks.classify"), "go", SCHEMA);
    expect(r.ok ? null : r.error.kind).toBe("quota");
    expect(s.calls).toHaveLength(1);
    expect(s.log).toEqual([expect.objectContaining({ outcome: "provider_error", tier: "flex" })]);
  });
  it("an admin's switch puts a background task back on standard", async () => {
    const s = setup({ rules: { standardTasks: ["conversations.update"] } });
    expect((await s.ai.run(task("conversations.update"), "go", SCHEMA)).ok).toBe(true);
    expect((await s.ai.run(task("promises.extract"), "go", SCHEMA)).ok).toBe(true);
    expect(s.calls.map((c) => c.serviceTier)).toEqual([undefined, "flex"]);
  });
  it("a person waiting (Sort again, Sort unsorted) runs a background task on standard", async () => {
    const s = setup({ waiting: true });
    await s.ai.run(task("asks.classify"), "go", SCHEMA);
    expect(s.calls.map((c) => c.serviceTier)).toEqual([undefined]);
  });
});

describe("cost at the tier used", () => {
  const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000 };
  const served = (tier: "flex" | "standard"): ProviderReply => ({ ok: true, text: OK, model: "m", usage, tier });
  it("flex at the Flex prices, standard at standard", async () => {
    const app = { prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 }, flexPrices: { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.25 } };
    const s = setup({ app, replies: [served("flex"), served("standard")] });
    await s.ai.run(task("conversations.update"), "go", SCHEMA);
    await s.ai.run(task("stories.draft"), "go", SCHEMA);
    expect(s.log.map((e) => [e.tier, e.costMicros])).toEqual([["flex", 300_000], ["standard", 600_000]]);
  });
  it("a flex request the provider served on standard is priced at standard", async () => {
    const s = setup({ app: { prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 } }, replies: [served("standard")] });
    await s.ai.run(task("conversations.update"), "go", SCHEMA);
    expect(s.log.map((e) => [e.tier, e.costMicros])).toEqual([["standard", 600_000]]);
  });
  it("without Flex prices configured, half of standard", () => {
    expect(halfPrices({ inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 })).toEqual({ inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.25 });
  });
  it("a fallback's flex 429s cost nothing (not billed) and the answer is priced at standard", async () => {
    const s = setup({ app: { prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 } }, replies: [BUSY, BUSY, BUSY, served("standard")] });
    await s.ai.run(task("conversations.update"), "go", SCHEMA);
    expect(s.log.map((e) => [e.tier, e.costMicros])).toEqual([["standard", 600_000]]);
  });
});
