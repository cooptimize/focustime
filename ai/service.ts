// AI-0: the AI service, one per person per request: run(task, input, schema) gives a validated value or a typed error.
// In order: the switches (Use AI, and Allow AI for the task's client), a provider with a key, the guards (ai/guard.ts),
// the month's budget (the person's and the app's), then one provider call, one retry on a transient error (Retry-After
// on 429), and the schema check (no retry). Every attempt that got past the switches is logged without its text
// (ai_requests: task, client, model, tokens, cost, latency, outcome), and its cost is added to the app's month.
export { DEFAULT_AI_PERSON, type AiPersonSettings } from "./types.ts";
import type { Logger } from "../log/logger.ts";
import { costMicros, micros, monthBounds, monthOf, type Prices } from "./cost.ts";
import { guard, type GuardInput } from "./guard.ts";
import { strictProblems, validate } from "./schema.ts";
import { AI_MESSAGES, AiError, NO_CLIENT, type AiPersonSettings, type AiStatus, type AiErrorKind, type AiLogEntry, type AiOutcome, type AiProvider, type AiResult, type JsonSchema, type ProviderReply, type Usage } from "./types.ts";

/** App-level settings (server/appconfig.ts [ai], FOCUSTIME_AI_*): the same for everyone, never per person. */
export type AiAppSettings = {
  /** openai (the hosted default), stub (the developer loop's default: no network) or off. */
  provider: "openai" | "stub" | "off";
  model: string;
  /** Sent as reasoning.effort when set (the model's own default otherwise). */
  reasoningEffort: string | null;
  timeoutMs: number;
  /** Most output tokens per task (reasoning included), by task name, with a default. */
  maxOutputTokens: { default: number } & Record<string, number>;
  prices: Prices;
  /** The whole app's monthly spend cap, in US dollars. */
  appCapUsd: number;
};


/** The person's request log (a user table) and the app's monthly total (an app table). */
export type AiLogStore = { add(e: AiLogEntry): Promise<void>; spentMicros(fromIso: string, toIso: string): Promise<number>; recent(limit: number): Promise<AiLogEntry[]> };
export type AppSpendStore = { get(month: string): Promise<number>; add(month: string, micros: number): Promise<void> };

export type AiDeps = {
  /** The provider, or null when it has no key (or AI is off for the app): "AI isn't set up". */
  provider: () => Promise<AiProvider | null>;
  app: AiAppSettings;
  person: () => Promise<AiPersonSettings>;
  /** What the guard needs besides the task's client: every client's names, projects and items, home domains, the VM. */
  guard: () => Promise<Omit<GuardInput, "client">>;
  log: AiLogStore;
  appSpend: AppSpendStore;
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Logger;
};

export type AiTaskSpec = { name: string; client: string; instructions: string };

/** The longest Retry-After worth waiting for inside one request; longer fails as busy. */
export const MAX_RETRY_WAIT_MS = 20_000;
/** Backoff before the one retry when the provider gave no Retry-After: about a second, with jitter. */
export const BASE_BACKOFF_MS = 1_000;

const fail = (kind: AiErrorKind): { ok: false; error: AiError } => ({ ok: false, error: new AiError(kind, AI_MESSAGES[kind]) });
const ZERO: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export function createAi(d: AiDeps) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = d.random ?? Math.random;
  const logger = d.logger ?? (() => {});

  async function record(task: AiTaskSpec, outcome: AiOutcome, detail: AiErrorKind | null, usage: Usage, latencyMs: number, model: string): Promise<number> {
    const cost = costMicros(usage, d.app.prices);
    const at = d.now();
    await d.log.add({ at, task: task.name, clientKey: task.client === NO_CLIENT ? null : task.client, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros: cost, latencyMs: Math.round(latencyMs), outcome, detail });
    if (cost > 0) await d.appSpend.add(monthOf(at), cost);
    // App Insights: counts and outcomes only.
    logger({ source: "ai", op: "request", kind: `${task.name}:${outcome}`, ...(detail ? { status: detail } : {}), durationMs: latencyMs, count: usage.inputTokens + usage.outputTokens });
    return cost;
  }

  async function run<T>(task: AiTaskSpec, input: string, schema: JsonSchema): Promise<AiResult<T>> {
    if (!task.name || !/^[a-z][a-z0-9_]{0,40}$/.test(task.name) || !task.client || !task.instructions.trim() || !input.trim() || strictProblems(schema).length) return fail("bad_task");
    const me = await d.person();
    if (!me.use) return fail("off");
    if (task.client !== NO_CLIENT && !me.allowedClients.includes(task.client)) return fail("client_off");
    const provider = d.app.provider === "off" ? null : await d.provider();
    if (!provider) return fail("not_set_up");

    const g = await d.guard();
    const hit = guard(`${task.instructions}\n${input}`, { ...g, client: task.client });
    if (hit) {
      await record(task, "refused", hit.kind, ZERO, 0, d.app.model);
      return fail(hit.kind);
    }

    const { from, to } = monthBounds(monthOf(d.now()));
    const [mine, app] = await Promise.all([d.log.spentMicros(from, to), d.appSpend.get(monthOf(d.now()))]);
    if (mine >= micros(me.monthlyCapUsd) || app >= micros(d.app.appCapUsd)) {
      await record(task, "over_budget", "over_budget", ZERO, 0, d.app.model);
      return fail("over_budget");
    }

    const call = {
      model: d.app.model,
      instructions: task.instructions,
      input,
      schemaName: task.name,
      schema,
      maxOutputTokens: d.app.maxOutputTokens[task.name] ?? d.app.maxOutputTokens.default,
      timeoutMs: d.app.timeoutMs,
      reasoningEffort: d.app.reasoningEffort,
    };
    const started = Date.now();
    let reply: ProviderReply = await provider.call(call);
    let spent: Usage = reply.usage ?? ZERO;
    if (!reply.ok && (reply.kind === "rate_limited" || reply.kind === "unavailable")) {
      const wait = reply.retryAfterMs ?? Math.round(BASE_BACKOFF_MS * (1 + random() * 0.5));
      if (wait <= MAX_RETRY_WAIT_MS) {
        await sleep(wait);
        reply = await provider.call(call);
        if (reply.usage) spent = add(spent, reply.usage);
      }
    }
    const latency = Date.now() - started;
    if (!reply.ok) {
      const kind: AiErrorKind = reply.kind === "unavailable" ? "provider" : reply.kind === "refusal" || reply.kind === "incomplete" ? "invalid_output" : reply.kind;
      await record(task, kind === "invalid_output" ? "invalid" : "provider_error", kind, spent, latency, d.app.model);
      return fail(kind);
    }
    let value: unknown;
    try {
      value = JSON.parse(reply.text);
    } catch {
      value = undefined;
    }
    if (value === undefined || validate(value, schema).length) {
      await record(task, "invalid", "invalid_output", spent, latency, reply.model);
      return fail("invalid_output");
    }
    const cost = await record(task, "ok", null, spent, latency, reply.model);
    return { ok: true, value: value as T, usage: spent, costUsd: cost / 1_000_000, latencyMs: latency, model: reply.model };
  }

  /** Test AI: a fixed harmless request, client "none". */
  function test(): Promise<AiResult<{ reply: string }>> {
    return run<{ reply: string }>(TEST_TASK, "Reply with ok.", TEST_SCHEMA);
  }

  async function status(): Promise<AiStatus> {
    const me = await d.person();
    const month = monthOf(d.now());
    const { from, to } = monthBounds(month);
    const provider = d.app.provider === "off" ? null : await d.provider();
    const [spent, app, recent] = await Promise.all([d.log.spentMicros(from, to), d.appSpend.get(month), d.log.recent(20)]);
    return { setUp: !!provider, provider: d.app.provider, model: d.app.model, use: me.use, allowedClients: me.allowedClients, capMicros: micros(me.monthlyCapUsd), spentMicros: spent, appReached: app >= micros(d.app.appCapUsd), recent };
  }

  return { run, test, status };
}
export type AiService = ReturnType<typeof createAi>;

const add = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, cachedTokens: a.cachedTokens + b.cachedTokens, outputTokens: a.outputTokens + b.outputTokens });

export const TEST_TASK: AiTaskSpec = { name: "test_ai", client: NO_CLIENT, instructions: "You are checking that FocusTime can reach the AI service. Answer with the word ok." };
export const TEST_SCHEMA: JsonSchema = { type: "object", properties: { reply: { type: "string", enum: ["ok"] } }, required: ["reply"], additionalProperties: false };
