// AI-0: the OpenAI adapter. The Responses API (POST /v1/responses, recommended for new projects), strict structured
// output (text.format json_schema, strict: true), store: false so OpenAI keeps no application state (abuse monitoring
// logs are still kept up to 30 days, docs/decisions.md D495). One call per request; retries are the service's.
// Verified Nov 4 against developers.openai.com/api/docs (guides/migrate-to-responses, structured-outputs, rate-limits,
// error-codes, your-data, reasoning, pricing). The key is read per call from the host's secret path and only ever
// goes into the Authorization header; no header, body or answer text is logged.
import type { AiProvider, ProviderCall, ProviderReply, Usage } from "./types.ts";

export type OpenAiOptions = {
  /** The API key, or null when none is set up (the service then says "AI isn't set up" before calling). */
  key: () => Promise<string | null>;
  fetch?: typeof fetch;
  baseUrl?: string;
};

/** 429 codes that mean billing or a spend limit: retrying won't help (error-codes guide). */
const QUOTA_CODES = new Set(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "billing_hard_limit_reached"]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
export function usageOf(body: unknown): Usage {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  return { inputTokens: num(u.input_tokens), cachedTokens: num((u.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens), outputTokens: num(u.output_tokens) };
}

/** Retry-After in ms: seconds or an HTTP date; null when absent or not valid. */
export function retryAfterMs(h: string | null, now = Date.now()): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** The answer's text: every output_text part of the message items (the raw API has no output_text field; that is the SDK's). */
function outputOf(body: Record<string, unknown>): { text: string } | { refusal: true } {
  let text = "";
  for (const item of (body.output as Record<string, unknown>[] | undefined) ?? []) {
    if (item?.type !== "message") continue;
    for (const part of (item.content as Record<string, unknown>[] | undefined) ?? []) {
      if (part?.type === "refusal") return { refusal: true };
      if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  return { text };
}

export function openAiProvider(o: OpenAiOptions): AiProvider {
  const f = o.fetch ?? fetch;
  const base = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    name: "openai",
    async call(c: ProviderCall): Promise<ProviderReply> {
      const key = await o.key();
      if (!key) return { ok: false, kind: "unavailable" };
      const body = {
        model: c.model,
        instructions: c.instructions,
        input: c.input,
        store: false,
        max_output_tokens: c.maxOutputTokens,
        ...(c.reasoningEffort ? { reasoning: { effort: c.reasoningEffort } } : {}),
        text: { format: { type: "json_schema", name: c.schemaName, schema: c.schema, strict: true } },
      };
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), c.timeoutMs);
      let r: Response;
      try {
        r = await f(`${base}/responses`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      } catch {
        clearTimeout(timer);
        // A network failure is worth one retry; a timeout isn't (the person has already waited the whole time).
        return { ok: false, kind: ac.signal.aborted ? "timeout" : "unavailable" };
      }
      let json: Record<string, unknown> | null = null;
      try {
        json = (await r.json()) as Record<string, unknown>;
      } catch {
        json = null;
      } finally {
        clearTimeout(timer);
      }
      if (ac.signal.aborted && !json) return { ok: false, kind: "timeout" };
      if (!r.ok) {
        const err = (json?.error ?? {}) as { code?: unknown; type?: unknown };
        const code = typeof err.code === "string" ? err.code : "";
        const type = typeof err.type === "string" ? err.type : "";
        const after = retryAfterMs(r.headers.get("retry-after"));
        if (r.status === 429) {
          if (QUOTA_CODES.has(code) || type === "insufficient_quota") return { ok: false, kind: "quota", status: 429 };
          return { ok: false, kind: "rate_limited", status: 429, ...(after !== null ? { retryAfterMs: after } : {}) };
        }
        if (r.status === 408 || r.status === 409 || r.status >= 500) return { ok: false, kind: "unavailable", status: r.status, ...(after !== null ? { retryAfterMs: after } : {}) };
        return { ok: false, kind: "provider", status: r.status };
      }
      if (!json) return { ok: false, kind: "provider", status: r.status };
      const usage = usageOf(json);
      if (json.status === "incomplete") return { ok: false, kind: "incomplete", usage };
      const out = outputOf(json);
      if ("refusal" in out) return { ok: false, kind: "refusal", usage };
      return { ok: true, text: out.text, usage, model: typeof json.model === "string" ? json.model : c.model };
    },
  };
}
