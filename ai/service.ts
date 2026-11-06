// AI-0: the AI service, one per person per request: run(task, input, schema) gives a validated value or a typed error.
// In order: the admins' switches (AI for FocusTime, and Allow AI for the task's client; ADM-1: no per-person switch), a provider with a key, the guards (ai/guard.ts),
// the month's budget (the person's and the app's), then one provider call, one retry on a transient error (Retry-After
// on 429), and the schema check (no retry). Every attempt that got past the switches is logged without its text
// (ai_requests: task, client, model, tokens, cost, latency, outcome), and its cost is added to the app's month.
export { DEFAULT_AI_PERSON, DEFAULT_AI_RULES, type AiPersonSettings, type AiRules } from "./types.ts";
import type { Logger } from "../log/logger.ts";
import { costMicros, micros, monthBounds, monthOf, type Prices } from "./cost.ts";
import { guard, otherClientMatch, redactValue, type GuardHit, type GuardInput, type Redaction } from "./guard.ts";
import { strictProblems, validate } from "./schema.ts";
import { AI_MESSAGES, AiError, NO_CLIENT, type ProviderCall, type ToolRound, type ToolSpec, type AiImageInput, type AiFail, type AiRules, type AiStatus, type AiErrorKind, type AiLogEntry, type AiOutcome, type AiProvider, type AiResult, type JsonSchema, type ProviderReply, type Usage } from "./types.ts";

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
  /** AS-1: speech to text: the model and its price per minute of audio (gpt-transcribe, $0.0045, Nov 5). */
  transcribe?: { model: string; perMinuteUsd: number };
};

/** AS-1: speech-to-text defaults (developers.openai.com/api/docs/pricing, Nov 5). */
export const DEFAULT_TRANSCRIBE = { model: "gpt-transcribe", perMinuteUsd: 0.0045 };


/** The person's request log (a user table) and the app's monthly total (an app table). */
export type AiLogStore = { add(e: AiLogEntry): Promise<void>; spentMicros(fromIso: string, toIso: string): Promise<number>; recent(limit: number): Promise<AiLogEntry[]> };
export type AppSpendStore = { get(month: string): Promise<number>; add(month: string, micros: number): Promise<void> };

export type AiDeps = {
  /** The provider, or null when it has no key (or AI is off for the app): "AI isn't set up". */
  provider: () => Promise<AiProvider | null>;
  app: AiAppSettings;
  /** ADM-1: the admins' AI rules (global on, the clients allowed, the caps, the model). No per-person switch. */
  rules: () => Promise<AiRules>;
  /**
   * What the guard needs besides the task's client: every client's names, projects and items, home domains, the VM,
   * and (GD-1) whether the task's client is Cooptimize Internal. Given the task's client.
   */
  guard: (client: string) => Promise<Omit<GuardInput, "client">>;
  log: AiLogStore;
  appSpend: AppSpendStore;
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Logger;
  /**
   * CV-1: whose cap a request counts against. "person" (the default): the person's monthly cap and the app's. "app":
   * the shared pipeline (conversations.update, anything the poller runs on its own): only the app's cap, logged in the
   * app's request log; the switches are still a person's (Use AI and the client's Allow AI).
   */
  cap?: "person" | "app";
};

export type AiTaskSpec = { name: string; client: string; instructions: string };
/** AS-1: runTools' result: what run() gives, plus the calls that ran and the names refused (not allowed). */
export type ToolsResult<T> = (AiResult<T>) & { refused: string[]; calls: { name: string; args: unknown }[] };

/** CV-4: images in one request at most (conversations.update sends 10). */
export const MAX_IMAGES = 10;
/** The longest Retry-After worth waiting for inside one request; longer fails as busy. */
export const MAX_RETRY_WAIT_MS = 20_000;
/** Backoff before the one retry when the provider gave no Retry-After: about a second, with jitter. */
export const BASE_BACKOFF_MS = 1_000;

const fail = (kind: AiErrorKind): { ok: false; error: AiError } => ({ ok: false, error: new AiError(kind, AI_MESSAGES[kind]) });
/** GD-1: an answer naming another client was sent and paid for, but is never shown. */
const OUTPUT_REFUSED = "The AI's answer mentions another client, so nothing is shown";
const ZERO: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export function createAi(d: AiDeps) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = d.random ?? Math.random;
  const logger = d.logger ?? (() => {});
  const scope = d.cap ?? "person";

  async function record(task: AiTaskSpec, outcome: AiOutcome, detail: AiErrorKind | null, usage: Usage, latencyMs: number, model: string): Promise<number> {
    const cost = costMicros(usage, d.app.prices);
    const at = d.now();
    await d.log.add({ at, task: task.name, clientKey: task.client === NO_CLIENT ? null : task.client, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros: cost, latencyMs: Math.round(latencyMs), outcome, detail, cap: scope });
    if (cost > 0) await d.appSpend.add(monthOf(at), cost);
    // App Insights: counts and outcomes only, and whose cap it counted against.
    logger({ source: "ai", op: "request", kind: scope === "app" ? `${task.name}:${outcome}:app` : `${task.name}:${outcome}`, ...(detail ? { status: detail } : {}), durationMs: latencyMs, count: usage.inputTokens + usage.outputTokens });
    return cost;
  }

  /**
   * HK-4: an answer's secret-shaped spans and outside email addresses become "[removed]"; logged as a count per kind,
   * never the text. A replacement that no longer fits the schema (an enum, a pattern) makes the answer unusable.
   */
  function redactAnswer(task: AiTaskSpec, value: unknown, schema: JsonSchema, g: Pick<GuardInput, "homeDomains" | "forbidden">): { ok: true; value: unknown } | { ok: false } {
    const r = redactValue(value, g);
    if (!r.removed.length) return { ok: true, value };
    for (const kind of ["secret", "email"] as const) {
      const n = r.removed.filter((x: Redaction) => x.kind === kind).length;
      if (n) logger({ source: "ai", op: "redact", kind: `${task.name}:${kind}`, count: n });
    }
    return validate(r.value, schema).length ? { ok: false } : { ok: true, value: r.value };
  }

  /** GD-1: which rule refused, and for a client rule the matched entry as its one-way ref (never the text). */
  function refusedLine(task: AiTaskSpec, hit: GuardHit, side: "input" | "output") {
    logger({ source: "ai", op: "guard", kind: `${task.name}:${side}:${hit.rule}`, status: hit.kind, ...(hit.entry ? { client: hit.entry } : {}) });
  }

  /**
   * CV-3: whether a request for this client could run at all, without one: "off" (AI for FocusTime), "client_off"
   * (Allow AI) or "not_set_up" (no provider key). Caps and provider trouble aren't known until a request is tried.
   */
  async function availability(client: string): Promise<"ok" | "off" | "client_off" | "not_set_up"> {
    const me = await d.rules();
    if (!me.on) return "off";
    if (client !== NO_CLIENT && !me.allowedClients.includes(client)) return "client_off";
    const provider = d.app.provider === "off" ? null : await d.provider();
    return provider ? "ok" : "not_set_up";
  }

  /** CV-4: `images` go after the input, each with its label (only the labels are guarded: images can't be read by the guards). */
  async function run<T>(task: AiTaskSpec, input: string, schema: JsonSchema, o: { images?: readonly AiImageInput[] } = {}): Promise<AiResult<T>> {
    if ((o.images?.length ?? 0) > MAX_IMAGES || o.images?.some((i) => !/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(i.dataUrl) || i.label.length > 80)) return fail("bad_task");
    if (!task.name || !/^[a-z][a-z0-9_]{0,30}(\.[a-z][a-z0-9_]{0,30})?$/.test(task.name) || !task.client || !task.instructions.trim() || !input.trim() || strictProblems(schema).length) return fail("bad_task");
    const me = await d.rules();
    if (!me.on) return fail("off");
    if (task.client !== NO_CLIENT && !me.allowedClients.includes(task.client)) return fail("client_off");
    const model = me.model || d.app.model;
    const appCap = me.appCapUsd ?? d.app.appCapUsd;
    const provider = d.app.provider === "off" ? null : await d.provider();
    if (!provider) return fail("not_set_up");

    const g = { ...(await d.guard(task.client)), client: task.client };
    const hit = guard(`${task.instructions}\n${input}${(o.images ?? []).map((i) => `\n${i.label}`).join("")}`, g);
    if (hit) {
      refusedLine(task, hit, "input");
      await record(task, "refused", hit.kind, ZERO, 0, model);
      return fail(hit.kind);
    }

    const { from, to } = monthBounds(monthOf(d.now()));
    // CV-1: the app's pipeline counts only against the app's cap; a person's own request against theirs and the app's.
    // ADM-1: both caps are the team's (Admin › AI). A cap of $0 says so ("AI budget is set to $0"), not that it was reached.
    const personCap = scope === "app" ? null : micros(me.personCapUsd);
    const appMicros = micros(appCap);
    if (appMicros <= 0 || personCap === 0) {
      await record(task, "over_budget", "zero_budget", ZERO, 0, model);
      return fail("zero_budget");
    }
    const [mine, app] = await Promise.all([personCap === null ? 0 : d.log.spentMicros(from, to), d.appSpend.get(monthOf(d.now()))]);
    if ((personCap !== null && mine >= personCap) || app >= appMicros) {
      await record(task, "over_budget", "over_budget", ZERO, 0, model);
      return fail("over_budget");
    }

    const call = {
      model,
      instructions: task.instructions,
      input,
      // OpenAI's schema names take letters, digits, _ and - only: "asks.classify" is sent as "asks_classify".
      schemaName: task.name.replace(/\./g, "_"),
      schema,
      maxOutputTokens: d.app.maxOutputTokens[task.name.replace(/\./g, "_")] ?? d.app.maxOutputTokens.default,
      timeoutMs: d.app.timeoutMs,
      reasoningEffort: d.app.reasoningEffort,
      ...(o.images?.length ? { images: [...o.images] } : {}),
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
      await record(task, kind === "invalid_output" ? "invalid" : "provider_error", kind, spent, latency, model);
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
    // GD-1: the answer may not name another client either (Internal may): refused whole, as before.
    const named = g.internal ? null : otherClientMatch(reply.text, g.client, g.directory);
    if (named) {
      refusedLine(task, { kind: "refused_client", rule: named.rule, entry: named.key }, "output");
      await record(task, "refused", "refused_client", spent, latency, reply.model);
      return { ok: false, error: new AiError("refused_client", OUTPUT_REFUSED) };
    }
    // HK-4: a secret shape or an outside email address in an answer (it can only come from an image) is replaced by
    // "[removed]" where it stands; the rest of the answer, every other item of a batch included, is kept.
    const clean = redactAnswer(task, value, schema, g);
    if (!clean.ok) {
      await record(task, "invalid", "invalid_output", spent, latency, reply.model);
      return fail("invalid_output");
    }
    const cost = await record(task, "ok", null, spent, latency, reply.model);
    return { ok: true, value: clean.value as T, usage: spent, costUsd: cost / 1_000_000, latencyMs: latency, model: reply.model };
  }

  /**
   * AS-1: a request that may call tools. Each round goes through the same checks as run(): the switches once, then per
   * round the guard over everything that would be sent (the instructions, the input and every tool output so far), the
   * caps, one provider call (one retry on a transient error) and a log row. The model may call only `allowed` (also
   * enforced here: any other name is refused without running and reported in `refused`); arguments must fit the tool's
   * schema. `execute` runs a call and returns its output, which goes back as data. The final answer must fit `schema`.
   */
  async function runTools<T>(task: AiTaskSpec, input: string, schema: JsonSchema, o: { tools: ToolSpec[]; allowed: readonly string[]; execute: (name: string, args: unknown) => Promise<string>; maxRounds?: number }): Promise<ToolsResult<T>> {
    const max = Math.max(1, Math.min(o.maxRounds ?? 4, 6));
    if (!task.name || !/^[a-z][a-z0-9_]{0,30}(\.[a-z][a-z0-9_]{0,30})?$/.test(task.name) || !task.client || !task.instructions.trim() || !input.trim() || strictProblems(schema).length || o.tools.some((t) => strictProblems(t.parameters).length)) return { ...fail("bad_task"), refused: [], calls: [] };
    const me = await d.rules();
    if (!me.on) return { ...fail("off"), refused: [], calls: [] };
    if (task.client !== NO_CLIENT && !me.allowedClients.includes(task.client)) return { ...fail("client_off"), refused: [], calls: [] };
    const model = me.model || d.app.model;
    const appCap = me.appCapUsd ?? d.app.appCapUsd;
    const provider = d.app.provider === "off" ? null : await d.provider();
    if (!provider) return { ...fail("not_set_up"), refused: [], calls: [] };
    const allowed = new Set(o.allowed);
    const byName = new Map(o.tools.map((t) => [t.name, t]));
    const rounds: ToolRound[] = [];
    const refused: string[] = [];
    const ran: { name: string; args: unknown }[] = [];
    let spent: Usage = ZERO;
    let cost = 0;
    let latency = 0;
    for (let round = 0; round < max; round++) {
      const sent = `${task.instructions}\n${input}${rounds.flatMap((r) => r.outputs.map((x) => `\n${x.output}`)).join("")}`;
      const g = await d.guard(task.client);
      const hit = guard(sent, { ...g, client: task.client });
      if (hit) {
        await record(task, "refused", hit.kind, ZERO, 0, model);
        return { ...fail(hit.kind), refused, calls: ran };
      }
      const { from, to } = monthBounds(monthOf(d.now()));
      const personCap = scope === "app" ? null : micros(me.personCapUsd);
      const appMicros = micros(appCap);
      if (appMicros <= 0 || personCap === 0) {
        await record(task, "over_budget", "zero_budget", ZERO, 0, model);
        return { ...fail("zero_budget"), refused, calls: ran };
      }
      const [mine, app] = await Promise.all([personCap === null ? 0 : d.log.spentMicros(from, to), d.appSpend.get(monthOf(d.now()))]);
      if ((personCap !== null && mine >= personCap) || app >= appMicros) {
        await record(task, "over_budget", "over_budget", ZERO, 0, model);
        return { ...fail("over_budget"), refused, calls: ran };
      }
      const last = round === max - 1;
      const call: ProviderCall = {
        model, instructions: task.instructions, input, schemaName: task.name.replace(/\./g, "_"), schema,
        maxOutputTokens: d.app.maxOutputTokens[task.name.replace(/\./g, "_")] ?? d.app.maxOutputTokens.default, timeoutMs: d.app.timeoutMs, reasoningEffort: d.app.reasoningEffort,
        tools: o.tools, allowedTools: last ? [] : [...allowed], rounds: [...rounds],
      };
      const started = Date.now();
      let reply: ProviderReply = await provider.call(call);
      let used: Usage = reply.usage ?? ZERO;
      if (!reply.ok && (reply.kind === "rate_limited" || reply.kind === "unavailable")) {
        const wait = reply.retryAfterMs ?? Math.round(BASE_BACKOFF_MS * (1 + random() * 0.5));
        if (wait <= MAX_RETRY_WAIT_MS) {
          await sleep(wait);
          reply = await provider.call(call);
          if (reply.usage) used = add(used, reply.usage);
        }
      }
      const ms = Date.now() - started;
      latency += ms;
      spent = add(spent, used);
      if (!reply.ok) {
        const kind: AiErrorKind = reply.kind === "unavailable" ? "provider" : reply.kind === "refusal" || reply.kind === "incomplete" ? "invalid_output" : reply.kind;
        cost += await record(task, kind === "invalid_output" ? "invalid" : "provider_error", kind, used, ms, model);
        return { ...fail(kind), refused, calls: ran };
      }
      if (reply.calls?.length) {
        cost += await record(task, "ok", null, used, ms, reply.model);
        const outputs: { callId: string; output: string }[] = [];
        for (const c of reply.calls.slice(0, 8)) {
          const spec = byName.get(c.name);
          if (!spec || !allowed.has(c.name)) {
            refused.push(c.name);
            outputs.push({ callId: c.callId, output: JSON.stringify({ refused: "That tool isn't allowed for this request. Only what the person asked for runs." }) });
            continue;
          }
          let args: unknown;
          try {
            args = JSON.parse(c.arguments);
          } catch {
            args = undefined;
          }
          if (args === undefined || validate(args, spec.parameters).length) {
            outputs.push({ callId: c.callId, output: JSON.stringify({ error: "The arguments don't fit the tool" }) });
            continue;
          }
          ran.push({ name: c.name, args });
          outputs.push({ callId: c.callId, output: await o.execute(c.name, args) });
        }
        rounds.push({ items: reply.items ?? [], outputs });
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(reply.text);
      } catch {
        value = undefined;
      }
      if (value === undefined || validate(value, schema).length) {
        cost += await record(task, "invalid", "invalid_output", used, ms, reply.model);
        return { ...fail("invalid_output"), refused, calls: ran };
      }
      // HK-4: the same span redaction as run() (the input side was guarded each round).
      const clean = redactAnswer(task, value, schema, g);
      if (!clean.ok) {
        cost += await record(task, "invalid", "invalid_output", used, ms, reply.model);
        return { ...fail("invalid_output"), refused, calls: ran };
      }
      cost += await record(task, "ok", null, used, ms, reply.model);
      return { ok: true, value: clean.value as T, usage: spent, costUsd: cost / 1_000_000, latencyMs: latency, model: reply.model, refused, calls: ran };
    }
    return { ...fail("invalid_output"), refused, calls: ran };
  }

  /**
   * AS-1: one recording to text. The switches (AI for FocusTime; and the client in focus, when there is one, must have
   * Allow AI), a provider that transcribes, the caps; then one call, logged without its text, at the minute price.
   * The audio isn't guarded (it can't be read): the transcript only goes back to the person, who edits and sends it.
   */
  async function transcribe(audio: Uint8Array, mime: string, seconds: number, client: string): Promise<{ ok: true; text: string; costUsd: number } | AiFail> {
    const task: AiTaskSpec = { name: "assistant_transcribe", client, instructions: "transcribe" };
    const me = await d.rules();
    if (!me.on) return fail("off");
    if (client !== NO_CLIENT && !me.allowedClients.includes(client)) return fail("client_off");
    const t = d.app.transcribe ?? DEFAULT_TRANSCRIBE;
    const provider = d.app.provider === "off" ? null : await d.provider();
    if (!provider?.transcribe) return fail("not_set_up");
    const { from, to } = monthBounds(monthOf(d.now()));
    const personCap = scope === "app" ? null : micros(me.personCapUsd);
    const appMicros = micros(me.appCapUsd ?? d.app.appCapUsd);
    if (appMicros <= 0 || personCap === 0) return fail("zero_budget");
    const [mine, app] = await Promise.all([personCap === null ? 0 : d.log.spentMicros(from, to), d.appSpend.get(monthOf(d.now()))]);
    if ((personCap !== null && mine >= personCap) || app >= appMicros) return fail("over_budget");
    const started = Date.now();
    const r = await provider.transcribe({ model: t.model, audio, mime, language: "en", timeoutMs: d.app.timeoutMs });
    const ms = Date.now() - started;
    // Billed by the second of audio (rounded up), at the minute price.
    const cost = r.ok ? Math.round((Math.ceil(Math.max(1, seconds)) / 60) * t.perMinuteUsd * 1_000_000) : 0;
    const at = d.now();
    await d.log.add({ at, task: task.name, clientKey: client === NO_CLIENT ? null : client, model: t.model, inputTokens: 0, outputTokens: 0, costMicros: cost, latencyMs: ms, outcome: r.ok ? "ok" : "provider_error", detail: r.ok ? null : r.kind, cap: scope });
    if (cost > 0) await d.appSpend.add(monthOf(at), cost);
    logger({ source: "ai", op: "request", kind: `${task.name}:${r.ok ? "ok" : "provider_error"}`, durationMs: ms });
    if (!r.ok) return fail(r.kind === "unavailable" || r.kind === "format" ? "provider" : r.kind);
    return { ok: true, text: r.text.trim(), costUsd: cost / 1_000_000 };
  }

  /** Test AI: a fixed harmless request, client "none". */
  function test(): Promise<AiResult<{ reply: string }>> {
    return run<{ reply: string }>(TEST_TASK, "Reply with ok.", TEST_SCHEMA);
  }

  async function status(): Promise<AiStatus> {
    const me = await d.rules();
    const appCap = me.appCapUsd ?? d.app.appCapUsd;
    const month = monthOf(d.now());
    const { from, to } = monthBounds(month);
    const provider = d.app.provider === "off" ? null : await d.provider();
    const [spent, app, recent] = await Promise.all([d.log.spentMicros(from, to), d.appSpend.get(month), d.log.recent(20)]);
    return { setUp: !!provider, provider: d.app.provider, model: me.model || d.app.model, on: me.on, allowedClients: [...me.allowedClients], capMicros: micros(me.personCapUsd), appCapMicros: micros(appCap), spentMicros: spent, appReached: micros(appCap) > 0 && app >= micros(appCap), recent };
  }

  return { run, runTools, transcribe, test, status, availability };
}
export type AiService = ReturnType<typeof createAi>;

const add = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, cachedTokens: a.cachedTokens + b.cachedTokens, outputTokens: a.outputTokens + b.outputTokens });

export const TEST_TASK: AiTaskSpec = { name: "test_ai", client: NO_CLIENT, instructions: "You are checking that FocusTime can reach the AI service. Answer with the word ok." };
export const TEST_SCHEMA: JsonSchema = { type: "object", properties: { reply: { type: "string", enum: ["ok"] } }, required: ["reply"], additionalProperties: false };
