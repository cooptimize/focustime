// AI-0: what may leave FocusTime for the AI provider, decided here and nowhere else (callers can't skip it). One client
// per request: another client's name, nickname, DevOps project or work item id in the payload refuses it. Never sent:
// tokens, keys, PATs, secrets, Authorization headers, VM details, or email addresses of people outside Cooptimize.
// Deterministic and pure; a hit says only its kind, never the text that matched.
import type { AiErrorKind } from "./types.ts";

/** One client as the guard knows it: its key, the names people call it, its DevOps projects and work item ids. */
export type ClientEntry = { key: string; names: string[]; projects: string[]; itemIds: number[] };

export type GuardInput = {
  /** The task's client key, or "none". */
  client: string;
  /** Every client the person has except the internal one (the guard needs them all to spot the others). */
  directory: readonly ClientEntry[];
  /** Email domains that are Cooptimize's (lowercase); any other address refuses. */
  homeDomains: readonly string[];
  /** Exact strings that must never go: the person's VM name and resource id. */
  forbidden: readonly string[];
};

export type GuardHit = { kind: Extract<AiErrorKind, "refused_client" | "refused_secret" | "refused_email">; rule: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole word or phrase, any case, spaces flexible: "Fabrikam" in "for Fabrikam's" but not in "Fabrikamish". */
const phrase = (p: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(p.trim()).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "iu");

/** Shapes of things that are never sent (name: what the log says). */
export const SECRET_SHAPES: readonly [string, RegExp][] = [
  ["authorization_header", /\bauthorization\s*:/i],
  ["bearer_token", /\bbearer\s+[\w.~+/-]{16,}/i],
  ["jwt", /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/],
  ["openai_key", /\bsk-[\w-]{20,}/],
  ["devops_pat", /(^|[^a-z0-9])[a-z2-7]{52}(?![a-z0-9])/],
  ["devops_pat", /\b[A-Za-z0-9]{70,}AZDO[A-Za-z0-9]{0,10}\b/],
  ["entra_secret", /(^|[^\w.~-])[\w.-]{3}\dQ~[\w.~-]{30,}/],
  ["github_token", /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,})/],
  ["aws_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google_key", /\bAIza[\w-]{35}\b/],
  ["google_refresh_token", /\b1\/\/0[\w-]{20,}/],
  ["slack_token", /\bxox[abprs]-[\w-]{10,}/],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["secret_assignment", /\b(password|passwd|pwd|secret|client_secret|clientsecret|api[_-]?key|access[_-]?token|refresh[_-]?token|accountkey|sharedaccesskey)\s*["']?\s*[=:]\s*["']?[^\s"']{6,}/i],
  ["sas_signature", /[?&]sig=[\w%+/=-]{20,}/i],
  ["azure_resource_id", /\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourcegroups\//i],
  // Long random-looking runs: upper, lower and digits together, 40 or more, no dots (URLs and words don't look like this).
  ["random_key", /(?<![\w/+=-])(?=[\w+/=-]*[A-Z])(?=[\w+/=-]*[a-z])(?=[\w+/=-]*\d)[\w+/-]{40,}={0,2}(?![\w/+=-])/],
];

const EMAIL = /[\w.%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi;

/** The first reason the text may not be sent, or null. */
export function guard(text: string, g: GuardInput): GuardHit | null {
  for (const [rule, re] of SECRET_SHAPES) if (re.test(text)) return { kind: "refused_secret", rule };
  for (const f of g.forbidden) if (f.trim().length >= 3 && phrase(f).test(text)) return { kind: "refused_secret", rule: "vm" };

  const home = g.homeDomains.map((d) => d.toLowerCase());
  for (const m of text.matchAll(EMAIL)) {
    const d = m[1]!.toLowerCase();
    if (!home.some((h) => d === h || d.endsWith(`.${h}`))) return { kind: "refused_email", rule: "external_email" };
  }

  const mine = g.directory.find((c) => c.key === g.client);
  const ownWords = new Set([...(mine?.names ?? []), ...(mine?.projects ?? []), g.client].map((w) => w.trim().toLowerCase()));
  const ownIds = new Set(mine?.itemIds ?? []);
  // Whole numbers that could be work item ids: not part of a date, time, amount, decimal or version (2026-11-06, 10:30,
  // $1,500, 1.5, 15%). Only ids known to be another client's refuse; any other number passes.
  const numbers = new Set([...text.matchAll(/(?<![\w.,$€£/:-])#?(\d{3,})(?![\w%]|[.,/:-]\d)/g)].map((m) => Number(m[1])));
  for (const c of g.directory) {
    if (c.key === g.client) continue;
    for (const w of [c.key, ...c.names]) if (w.trim().length >= 3 && !ownWords.has(w.trim().toLowerCase()) && phrase(w).test(text)) return { kind: "refused_client", rule: "client_name" };
    for (const p of c.projects) if (p.trim().length >= 3 && !ownWords.has(p.trim().toLowerCase()) && phrase(p).test(text)) return { kind: "refused_client", rule: "devops_project" };
    for (const id of c.itemIds) if (!ownIds.has(id) && numbers.has(id)) return { kind: "refused_client", rule: "work_item" };
  }
  return null;
}
