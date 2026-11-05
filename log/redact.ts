// HK-1: what an error may say in telemetry. An exception's message passes through redact(): tokens, keys, PATs,
// Authorization values, emails, URLs' paths and queries, quoted text, GUIDs, long numbers and any known client key are
// replaced, and the rest is cut to 200 characters. Its stack keeps only frames in FocusTime's own code (no
// node_modules, no node: internals), as repo-relative paths with a function name and a line. A message is code's own
// words, but code sometimes puts a value in it ("No DevOps for <client>", a Graph error's text), so nothing in it is
// trusted. Pure.

const RULES: [RegExp, string][] = [
  // Authorization header values and bearer or basic credentials.
  [/\b(authorization|proxy-authorization)\s*[:=]\s*\S+(\s+\S+)?/gi, "$1: [redacted]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  // Private keys.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key]"],
  // key=value secrets (password, secret, token, key, sig, pat, client_secret) in any form.
  [/\b([A-Za-z_-]*(password|passwd|secret|token|apikey|api_key|key|sig|signature|pat|assertion))\b(\s*["']?\s*[:=]\s*["']?)[^\s"'&;,]+/gi, "$1$3[redacted]"],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // URLs: the scheme and host stay, the path and query go.
  [/\b(https?|wss?):\/\/([A-Za-z0-9.-]+)(:\d+)?[^\s"'<>)]*/gi, "$1://$2/[path]"],
  // Quoted text (a title, a message, a name), in any quotes.
  [/"[^"\n]{1,}"|'[^'\n]{2,}'|`[^`\n]{1,}`|“[^”\n]{1,}”/g, '"[text]"'],
  // GUIDs (object ids, tenant ids, chat ids' parts).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // Teams chat and message ids.
  [/\b19:[^\s]+/g, "[chat]"],
  // Long random strings (PATs are 52 base32 characters, keys and SAS signatures long base64).
  [/\b[A-Za-z0-9+/_=-]{24,}\b/g, "[secret]"],
  // Long numbers (work item ids are fine to keep short; phone numbers and the like go).
  [/\b\d{7,}\b/g, "[n]"],
];

export function redact(text: string, known: Iterable<string> = []): string {
  let out = String(text);
  for (const [re, to] of RULES) out = out.replace(re, to);
  for (const k of known) {
    if (k.length < 2) continue;
    out = out.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[client]");
  }
  return out.length > 200 ? `${out.slice(0, 199)}…` : out;
}

export type Frame = { level: number; method: string; fileName: string; line: number; assembly: string };

/** The frames of an Error's stack in FocusTime's own code, below `root`, at most 20. */
export function ownFrames(stack: string | undefined, root: string): Frame[] {
  const out: Frame[] = [];
  const base = root.replace(/\/+$/, "") + "/";
  for (const raw of (stack ?? "").split("\n").slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(?:file:\/\/)?([^()\s]+):(\d+):\d+\)?$/.exec(raw);
    if (!m) continue;
    const file = m[2]!;
    if (!file.startsWith(base) || file.includes("/node_modules/")) continue;
    const method = (m[1] ?? "<anonymous>").replace(/[^\w.$<> -]/g, "").slice(0, 80) || "<anonymous>";
    out.push({ level: out.length, method, fileName: file.slice(base.length), line: Number(m[3]), assembly: "focustime" });
    if (out.length >= 20) break;
  }
  return out;
}

/** An error's type name: its constructor's name when it is a plain word, else "Error". */
export const typeNameOf = (e: unknown): string => {
  const n = e instanceof Error ? e.name || e.constructor?.name : typeof e === "object" && e ? e.constructor?.name : typeof e;
  return typeof n === "string" && /^[A-Za-z_$][\w$]{0,60}$/.test(n) ? n : "Error";
};
