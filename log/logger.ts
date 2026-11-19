// Structured logging with a closed set of fields: source, operation, status, duration, count, kind, and (HK-1) the
// client a record is about. There is deliberately no field for headers, bodies, tokens or free-form objects. VM-7: a
// refused Azure answer's challenge, failure cause and body shape, each only one word from its fixed list below.
import { clientRef } from "./operation.ts";

/** VM-7: a Bearer WWW-Authenticate's error word; any other word "other"; no header (or no error word) "none". */
export const CHALLENGE_WORDS = ["invalid_token", "insufficient_claims", "insufficient_scope", "other", "none"] as const;
/** VM-7: x-ms-failure-cause; any other value "other"; no header "none". */
export const CAUSE_WORDS = ["gateway", "service", "other", "none"] as const;
/** VM-7: the shape of a refused answer's body; never any of it. */
export const BODY_WORDS = ["json_with_code", "json_no_code", "not_json", "empty"] as const;
export type ChallengeWord = (typeof CHALLENGE_WORDS)[number];
export type CauseWord = (typeof CAUSE_WORDS)[number];
export type BodyWord = (typeof BODY_WORDS)[number];

export type LogRecord = {
  source: "dataverse" | "outlook" | "google" | "devops" | "azure" | "server" | "config" | "plan" | "auth" | "database" | "ai" | "ics" | "pocket";
  op: string;
  status?: number | string;
  durationMs?: number;
  count?: number;
  kind?: string;
  /** HK-1: a client key. Printed and sent only as its one-way ref (log/operation.ts clientRef), never as is. */
  client?: string;
  /** VM-4: a registered action's name (actions/registry.ts), for an action that failed unexpectedly. */
  action?: string;
  /** VM-4: the short reference the person was shown for that failure (random; nothing about them or their data). */
  ref?: string;
  /** VM-7: a refused Azure answer's challenge, failure cause and body shape (closed words; a yes has none). */
  challenge?: ChallengeWord;
  cause?: CauseWord;
  body?: BodyWord;
};

/** The closed set: every field a log record may carry, in the order a line prints them (log/logger.test.ts). */
export const LOG_FIELDS = ["source", "op", "status", "durationMs", "count", "kind", "client", "action", "ref", "challenge", "cause", "body"] as const;

/** VM-7: a closed field's word as printed or sent: on its list, else "other" (challenge, cause) or nothing (body). */
export function closedWords(r: LogRecord): { challenge?: string; cause?: string; body?: string } {
  const out: { challenge?: string; cause?: string; body?: string } = {};
  if (r.challenge !== undefined) out.challenge = (CHALLENGE_WORDS as readonly string[]).includes(r.challenge) ? r.challenge : "other";
  if (r.cause !== undefined) out.cause = (CAUSE_WORDS as readonly string[]).includes(r.cause) ? r.cause : "other";
  if (r.body !== undefined && (BODY_WORDS as readonly string[]).includes(r.body)) out.body = r.body;
  return out;
}

export type Logger = (r: LogRecord) => void;

export const stderrLogger: Logger = (r) => {
  const parts = [new Date().toISOString(), r.source, r.op];
  if (r.status !== undefined) parts.push(`status=${r.status}`);
  if (r.durationMs !== undefined) parts.push(`ms=${Math.round(r.durationMs)}`);
  if (r.count !== undefined) parts.push(`count=${r.count}`);
  if (r.kind !== undefined) parts.push(`kind=${r.kind}`);
  if (r.client !== undefined) parts.push(`client=${clientRef(r.client)}`);
  if (r.action !== undefined) parts.push(`action=${r.action}`);
  if (r.ref !== undefined) parts.push(`ref=${r.ref}`);
  for (const [k, v] of Object.entries(closedWords(r))) parts.push(`${k}=${v}`);
  process.stderr.write(parts.join(" ") + "\n");
};
