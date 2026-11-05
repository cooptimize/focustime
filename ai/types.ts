// AI-0: the one way FocusTime asks a model for anything. A task names itself and its client (or "none" for an
// internal-only task), gives instructions and input, and a JSON schema the answer must fit. The service (ai/service.ts)
// checks the switches, the guards and the budget, calls the provider, validates the answer and logs the request
// without its text. Callers never talk to a provider directly.

/** The JSON Schema subset FocusTime uses: what OpenAI's strict structured outputs accept, and what ai/schema.ts checks. */
export type JsonSchema = {
  type?: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  enum?: (string | number | boolean | null)[];
  anyOf?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

/** "none": an internal-only task that carries no client's data (Test AI, for one). */
export type AiClient = string | "none";
export const NO_CLIENT = "none";

export type AiTask = {
  /** A short fixed name for the log (test_ai, classify_ask, ...). Never the input. */
  name: string;
  client: AiClient;
  /** The system instructions: fixed text written in the code, never anyone's data. */
  instructions: string;
  /** What the task is about: the only place data goes. Scanned by the guards. */
  input: string;
};

/** Every way a run can fail, each with a plain message the UI can show as is. */
export type AiErrorKind =
  | "off" // the person's Use AI switch is off
  | "client_off" // the task's client hasn't Allow AI on
  | "not_set_up" // no provider key
  | "refused_client" // another client's name, project or item in the payload
  | "refused_secret" // a token, key, secret or VM detail in the payload
  | "refused_email" // an email address outside Cooptimize in the payload
  | "over_budget" // this month's cap (the person's or the app's) is reached
  | "zero_budget" // CV-1: the cap that applies is set to $0 (not "reached")
  | "invalid_output" // the answer didn't fit the schema (or was a refusal or cut short)
  | "rate_limited" // the provider asked to slow down, and the one retry didn't help
  | "quota" // the provider's billing or spend limit
  | "timeout"
  | "provider" // anything else the provider said no to
  | "bad_task"; // a programming error: a schema strict mode can't take, an empty task

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

/** Plain words for each kind (no em dashes; never carries the input or the answer). */
export const AI_MESSAGES: Record<AiErrorKind, string> = {
  off: "AI is off. Turn on Use AI in Settings › AI.",
  client_off: "AI isn't allowed for this client. Turn on Allow AI in Settings › Clients.",
  not_set_up: "AI isn't set up",
  refused_client: "Not sent: it mentions another client",
  refused_secret: "Not sent: it contains something that looks like a key, token or secret",
  refused_email: "Not sent: it contains an email address from outside Cooptimize",
  over_budget: "AI budget reached for this month",
  zero_budget: "AI budget is set to $0",
  invalid_output: "The AI's answer wasn't usable",
  rate_limited: "The AI service is busy. Try again in a minute.",
  quota: "The AI service's account is out of credit or over its limit",
  timeout: "The AI service didn't answer in time",
  provider: "The AI service couldn't answer",
  bad_task: "This AI request isn't valid",
};

export type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number };

export type AiOk<T> = { ok: true; value: T; usage: Usage; costUsd: number; latencyMs: number; model: string };
export type AiFail = { ok: false; error: AiError };
export type AiResult<T> = AiOk<T> | AiFail;

/** What one provider call returns, before validation. */
export type ProviderReply =
  | { ok: true; text: string; usage: Usage; model: string }
  | { ok: false; kind: "rate_limited" | "quota" | "timeout" | "provider" | "unavailable" | "refusal" | "incomplete"; status?: number; retryAfterMs?: number; usage?: Usage };

export type ProviderCall = { model: string; instructions: string; input: string; schemaName: string; schema: JsonSchema; maxOutputTokens: number; timeoutMs: number; reasoningEffort: string | null };

/** One provider (OpenAI, or the stub). */
export type AiProvider = { name: "openai" | "stub"; call(c: ProviderCall): Promise<ProviderReply> };

/** A person's AI settings (Settings › AI and Settings › Clients): both switches off by default, a 10 dollar cap. */
export type AiPersonSettings = { use: boolean; monthlyCapUsd: number; allowedClients: string[]; /** DS-1: how far back Draft stories looks for examples, in months (12 when unset). */ draftMonths?: number };
export const DEFAULT_AI_PERSON: AiPersonSettings = { use: false, monthlyCapUsd: 10, allowedClients: [] };

/** The outcomes the log keeps (D497). */
export type AiOutcome = "ok" | "refused" | "invalid" | "provider_error" | "over_budget";

/** One row of a person's AI request log: never the instructions, the input or the answer. */
export type AiLogEntry = {
  at: string;
  task: string;
  clientKey: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated, in millionths of a US dollar. */
  costMicros: number;
  latencyMs: number;
  outcome: AiOutcome;
  /** The error kind when not ok (refused_client, timeout, ...). */
  detail: string | null;
  /** CV-1: whose cap the request counted against: the person's own, or the app's (the shared conversations pipeline). */
  cap?: "person" | "app";
};

/** What Settings › AI reads: setup, the switch, the month's spend against the cap, the last 20 requests. */
export type AiStatus = {
  setUp: boolean;
  provider: "openai" | "stub" | "off";
  model: string;
  use: boolean;
  allowedClients: string[];
  capMicros: number;
  spentMicros: number;
  /** The app's cap is reached (everyone's requests stop until next month). */
  appReached: boolean;
  recent: AiLogEntry[];
};
