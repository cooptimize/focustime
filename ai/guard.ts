// AI-0: what may leave FocusTime for the AI provider, decided here and nowhere else (callers can't skip it). One client
// per request: another client's name, nickname, DevOps project or work item id in the payload refuses it. Never sent:
// tokens, keys, PATs, secrets, Authorization headers, VM details, or email addresses of people outside Cooptimize.
// Deterministic and pure; a hit says only its kind, never the text that matched.
// GD-1: a request for Cooptimize Internal (`internal`, set from clientAccounts()'s why "internal", never from a name) may
// name clients, their projects and their items: Internal work is about them. Secrets, the VM and outside addresses still
// refuse. Client keys compare without case (a key read as "Fabrikam" in one place and "fabrikam" in another is one client).
import type { AiErrorKind } from "./types.ts";

/** One client as the guard knows it: its key, the names people call it, its DevOps projects and work item ids. */
export type ClientEntry = { key: string; names: string[]; projects: string[]; itemIds: number[]; /** GD-2: other names an admin set for the client (Admin › Clients › Aliases). */ aliases?: string[] };

export type GuardInput = {
  /** The task's client key, or "none". */
  client: string;
  /** Every client the person has except the internal one (the guard needs them all to spot the others). */
  directory: readonly ClientEntry[];
  /** Email domains that are Cooptimize's (lowercase); any other address refuses. */
  homeDomains: readonly string[];
  /** Exact strings that must never go: the person's VM name and resource id. */
  forbidden: readonly string[];
  /** GD-1: the task's client is Cooptimize Internal (clientAccounts() says why "internal"): the client rules don't apply. */
  internal?: boolean;
};

export type GuardHit = {
  kind: Extract<AiErrorKind, "refused_client" | "refused_secret" | "refused_email">;
  rule: string;
  /** GD-1: for a client rule, the key of the client entry that matched (for the one-way client ref in a log; never shown). */
  entry?: string;
};

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

  if (g.internal) return null;
  const m = otherClientMatch(text, g.client, g.directory);
  return m ? { kind: "refused_client", rule: m.rule, entry: m.key } : null;
}

/**
 * GD-1: the first other client this text names (its name, nickname, DevOps project or a work item id known to be its),
 * or null. `client` is the text's own client; its own words and ids never count. Used by the guard and by the DevOps
 * preview before text is written into a client's DevOps. Callers must not log `name`.
 */
export function otherClientMatch(text: string, client: string, directory: readonly ClientEntry[]): { key: string; name: string; rule: "client_name" | "devops_project" | "work_item" } | null {
  const own = (k: string) => k.trim().toLowerCase() === client.trim().toLowerCase();
  const mine = directory.filter((c) => own(c.key));
  const ownWords = new Set([...mine.flatMap((c) => [...c.names, ...(c.aliases ?? []), ...c.projects]), client].map((w) => w.trim().toLowerCase()));
  const ownIds = new Set(mine.flatMap((c) => c.itemIds));
  // Whole numbers that could be work item ids: not part of a date, time, amount, decimal or version (2026-11-06, 10:30,
  // $1,500, 1.5, 15%). Only ids known to be another client's refuse; any other number passes.
  const numbers = new Set([...text.matchAll(/(?<![\w.,$€£/:-])#?(\d{3,})(?![\w%]|[.,/:-]\d)/g)].map((m) => Number(m[1])));
  for (const c of directory) {
    if (own(c.key)) continue;
    const name = c.names[0] ?? c.key;
    for (const w of [c.key, ...c.names, ...(c.aliases ?? [])]) if (w.trim().length >= 3 && !ownWords.has(w.trim().toLowerCase()) && phrase(w).test(text)) return { key: c.key, name, rule: "client_name" };
    for (const p of c.projects) if (p.trim().length >= 3 && !ownWords.has(p.trim().toLowerCase()) && phrase(p).test(text)) return { key: c.key, name, rule: "devops_project" };
    for (const id of c.itemIds) if (!ownIds.has(id) && numbers.has(id)) return { key: c.key, name, rule: "work_item" };
  }
  return null;
}

/**
 * AS-1: the clients a text names, by the guard's own rule (a whole name, nickname or DevOps project of 3 letters or
 * more, or one of its known work item ids). Internal is GD-1's: known by `isInternal` (clientAccounts()'s why
 * "internal"), never by name, and it never counts. Keys compare without case. The assistant uses it to pick a
 * request's one client; two or more means "Which client?" and nothing is sent.
 */
export function clientsNamed(text: string, directory: readonly ClientEntry[], isInternal: (key: string) => boolean = () => false): string[] {
  const numbers = new Set([...text.matchAll(/(?<![\w.,$€£/:-])#?(\d{3,})(?![\w%]|[.,/:-]\d)/g)].map((m) => Number(m[1])));
  const out: string[] = [];
  for (const c of directory) {
    if (isInternal(c.key) || out.some((k) => k.toLowerCase() === c.key.toLowerCase())) continue;
    const words = [c.key, ...c.names, ...(c.aliases ?? []), ...c.projects].filter((w) => w.trim().length >= 3);
    if (words.some((w) => phrase(w).test(text)) || c.itemIds.some((id) => numbers.has(id))) out.push(c.key);
  }
  return out;
}

/** MC-1: what takes another client's name, project or item id in a transcript, and a spoken email address. */
export const ANOTHER_CLIENT = "[another client]";
export const MASKED_EMAIL = "[email]";

/**
 * MC-1: a meeting transcript is masked before the guard sees it (the product owner, Nov 6): another client's names,
 * nicknames, DevOps projects and known item ids become "[another client]", and every email address "[email]". A
 * Cooptimize Internal meeting (GD-1) keeps client names; its emails are still masked. The guard then runs as always on
 * the masked text, so anything left (a secret, the VM) still refuses the request. Counts only, never the text.
 */
export function maskTranscript(text: string, client: string, directory: readonly ClientEntry[], o: { internal?: boolean } = {}): { text: string; masked: { client: number; email: number } } {
  let clientHits = 0;
  let emailHits = 0;
  let out = text.replace(EMAIL, () => {
    emailHits++;
    return MASKED_EMAIL;
  });
  if (!o.internal) {
    const own = (k: string) => k.trim().toLowerCase() === client.trim().toLowerCase();
    const mine = directory.filter((c) => own(c.key));
    const ownWords = new Set([...mine.flatMap((c) => [...c.names, ...(c.aliases ?? []), ...c.projects]), client].map((w) => w.trim().toLowerCase()));
    const ownIds = new Set(mine.flatMap((c) => c.itemIds));
    // Longest first, so "Fab Labs" goes before "Fab".
    const words = [...new Set(directory.filter((c) => !own(c.key)).flatMap((c) => [c.key, ...c.names, ...(c.aliases ?? []), ...c.projects]).map((w) => w.trim()))]
      .filter((w) => w.length >= 3 && !ownWords.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    for (const w of words) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "giu");
      out = out.replace(re, (_m, pre: string) => {
        clientHits++;
        return `${pre}${ANOTHER_CLIENT}`;
      });
    }
    const theirIds = new Set(directory.filter((c) => !own(c.key)).flatMap((c) => c.itemIds).filter((id) => !ownIds.has(id)));
    if (theirIds.size)
      out = out.replace(/(?<![\w.,$€£/:-])#?(\d{3,})(?![\w%]|[.,/:-]\d)/g, (m, d: string) => {
        if (!theirIds.has(Number(d))) return m;
        clientHits++;
        return ANOTHER_CLIENT;
      });
  }
  return { text: out, masked: { client: clientHits, email: emailHits } };
}

/** HK-4: what an answer redaction replaced: the kind and the rule, never the text. */
export type Redaction = { kind: "secret" | "email"; rule: string };
/** HK-4: the words that take a redacted span's place. */
export const REMOVED = "[removed]";

/**
 * HK-4: an AI answer's text with each secret-shaped span (SECRET_SHAPES, the VM's name and resource id) and each email
 * address outside Cooptimize replaced by "[removed]", keeping the rest. Unlike guard(), which refuses a request, this
 * keeps a batch answer usable when one item quotes something from an image (CV-4). The client rule isn't here: an
 * answer naming another client is still refused whole (GD-1). Returns what was replaced, by kind, never the text.
 */
export function redact(text: string, g: Pick<GuardInput, "homeDomains" | "forbidden">): { text: string; removed: Redaction[] } {
  const removed: Redaction[] = [];
  let out = text;
  for (const [rule, re] of SECRET_SHAPES) {
    // A shape that starts with a boundary group, (^|[^…]), keeps the character before the span.
    const lead = re.source.startsWith("(^|");
    const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    out = out.replace(all, (_m: string, g1: unknown) => {
      removed.push({ kind: "secret", rule });
      return `${lead && typeof g1 === "string" ? g1 : ""}${REMOVED}`;
    });
  }
  for (const f of g.forbidden) {
    if (f.trim().length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(f.trim()).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (_m: string, g1: string) => {
      removed.push({ kind: "secret", rule: "vm" });
      return `${g1}${REMOVED}`;
    });
  }
  const home = g.homeDomains.map((d) => d.toLowerCase());
  out = out.replace(EMAIL, (m: string, domain: string) => {
    const d = domain.toLowerCase();
    if (home.some((h) => d === h || d.endsWith(`.${h}`))) return m;
    removed.push({ kind: "email", rule: "external_email" });
    return REMOVED;
  });
  return { text: out, removed };
}

/** HK-4: redact() over every string in a parsed answer (object keys are the schema's, never redacted). */
export function redactValue<T>(value: T, g: Pick<GuardInput, "homeDomains" | "forbidden">): { value: T; removed: Redaction[] } {
  const removed: Redaction[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v, g);
      removed.push(...r.removed);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, removed };
}
