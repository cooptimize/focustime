// AP-1: Asks, the pure rules. A client's delivery chats with "Read for asks" on are read for new messages (no AI); a
// message from someone outside Cooptimize becomes an ask when it @mentions a Cooptimizer, asks a question, uses request
// phrasing or carries an attachment, and isn't only a short acknowledgement. Internal authors and my own messages
// aren't asks here (promises are AP-2). Each ask records the rule that matched. Nothing here does I/O or logs.
import { isExternal, type ChatMember } from "./chats.ts";
import type { AskKind, AskSort, DraftItemType, NotSorted, PromiseStatus, Urgency } from "./asks-ai.ts";

/** The per-user settings ([asks] in the settings model), with these defaults. */
export type AskSettings = {
  /** How often a chat with Read for asks on is read, in working hours: 1 to 60 minutes. */
  pollMinutes: number;
  /** Request phrasing (lower case; matched as whole words, any case). */
  requestPhrases: string[];
  /** Short acknowledgements: a message that is only these (and punctuation or emoji) is not an ask. */
  ackPhrases: string[];
  /** AP-2: commitment phrasing in my own messages (a promise candidate). */
  promisePhrases: string[];
};
export const DEFAULT_REQUEST_PHRASES = ["can you", "could you", "please", "add", "doesn't look right", "not working", "error", "failed", "urgent"];
export const DEFAULT_ACK_PHRASES = ["thanks", "thank you", "sounds good", "ok", "great"];
/** AP-2: the default commitment phrasing (plan/asks-ai.ts matchPromise). */
export const DEFAULT_PROMISE_PHRASES = ["i'll", "i will", "let me", "i can", "by friday", "tomorrow", "tonight", "end of day", "next week"];
export const DEFAULT_ASK_SETTINGS: AskSettings = { pollMinutes: 5, requestPhrases: DEFAULT_REQUEST_PHRASES, ackPhrases: DEFAULT_ACK_PHRASES, promisePhrases: DEFAULT_PROMISE_PHRASES };

/** Unmatched message text is kept this long (for Show context), then deleted; asks keep theirs with the resolution. */
export const UNMATCHED_DAYS = 14;
/** Show context: this many earlier messages in the same chat. */
export const CONTEXT_MESSAGES = 5;

/** A chat message as stored: only these fields (AP-1). `text` is the plain text, HTML stripped. */
export type StoredMessage = {
  chatId: string;
  messageId: string;
  clientKey: string;
  authorId: string | null;
  authorTenant: string | null;
  createdAt: string;
  text: string;
  hasImage: boolean;
  hasFile: boolean;
  replyToId: string | null;
};

/** What the rules look at for one new message: the stored fields, plus who it mentions (not stored). */
export type IncomingMessage = StoredMessage & { mentionedUserIds: string[] };

export type AskRule = "mention" | "question" | "phrase" | "attachment";
export type AskMatch = { rule: AskRule; detail: string | null };

/** "Matched: <rule>" on the card. */
export function ruleLabel(m: AskMatch): string {
  switch (m.rule) {
    case "mention": return "mentions a Cooptimizer";
    case "question": return "asks a question";
    case "phrase": return `says "${m.detail ?? ""}"`;
    case "attachment": return m.detail === "image" ? "has an image" : "has a file";
  }
}

const words = (s: string) => s.toLowerCase().replace(/[’']/g, "'");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase found as whole words (so "add" matches "please add it" but not "address"). */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = words(phrase).trim();
  if (!p) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p).replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`, "u").test(words(text));
}

/** Only an acknowledgement: what is left after removing the ack phrases is punctuation, emoji or space. */
export function isAcknowledgement(text: string, acks: readonly string[]): boolean {
  let rest = words(text);
  if (!rest.trim()) return true;
  for (const a of [...acks].sort((x, y) => y.length - x.length)) {
    const p = words(a).trim();
    if (p) rest = rest.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "gu"), "$1");
  }
  return !/[\p{L}\p{N}]/u.test(rest);
}

/**
 * Whether a new message is an ask, and the first rule that matched (mention, question, phrase, attachment), or null.
 * Only messages from someone outside Cooptimize (by tenant, as members are judged) count, never mine.
 */
export function matchAsk(m: IncomingMessage, f: { homeTenant: string; me: string | null; members: readonly ChatMember[]; settings: AskSettings }): AskMatch | null {
  if (f.me && m.authorId && m.authorId.toLowerCase() === f.me.toLowerCase()) return null;
  const member = f.members.find((x) => x.userId && m.authorId && x.userId.toLowerCase() === m.authorId.toLowerCase());
  const author = { tenantId: m.authorTenant ?? member?.tenantId ?? null, ...(member?.guest ? { guest: true } : {}) };
  if (!m.authorId || !isExternal(author, f.homeTenant)) return null;
  const attachment = m.hasImage || m.hasFile;
  if (!attachment && isAcknowledgement(m.text, f.settings.ackPhrases)) return null;
  const cooptimizer = (id: string) => {
    const x = f.members.find((y) => y.userId?.toLowerCase() === id.toLowerCase());
    return !!x && !isExternal(x, f.homeTenant);
  };
  if (m.mentionedUserIds.some(cooptimizer)) return { rule: "mention", detail: null };
  if (m.text.includes("?")) return { rule: "question", detail: null };
  const phrase = f.settings.requestPhrases.find((p) => hasPhrase(m.text, p));
  if (phrase) return { rule: "phrase", detail: phrase };
  if (attachment) return { rule: "attachment", detail: m.hasImage ? "image" : "file" };
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** A Teams message body (HTML or text) as plain text: tags removed, breaks kept as new lines, entities decoded. */
export function plainText(content: string, contentType: string | null): string {
  if ((contentType ?? "").toLowerCase() !== "html") return content.replace(/\r\n?/g, "\n").trim();
  return content
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The DevOps title from an ask: its first non-empty line, at most 80 characters (cut at a word when it can). */
export function askTitle(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "Ask from Teams";
  if (line.length <= 80) return line;
  const cut = line.slice(0, 79);
  const at = cut.lastIndexOf(" ");
  return `${(at > 40 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** The DevOps description: the message, who and when, and the Teams link. Plain text (the writer makes it HTML). */
export function askDescription(a: { text: string; author: string; at: string; link: string; zone: string }): string {
  const when = Temporal.Instant.from(a.at).toZonedDateTimeISO(a.zone).toPlainDateTime().toString({ smallestUnit: "minute" }).replace("T", " ");
  return `${a.text}\n\nFrom ${a.author} in Teams, ${when}.\n${a.link}`;
}

/** A link to one message in its chat (the documented deep link form). */
export function messageLink(chatId: string, messageId: string): string {
  return `https://teams.microsoft.com/l/message/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}?context=${encodeURIComponent(JSON.stringify({ contextType: "chat" }))}`;
}

/**
 * Whether a chat is read now: Read for asks on, inside working hours on a day that isn't PTO, the interval since the
 * last read passed, and not waiting out a throttle (retryAt).
 */
export function pollDue(f: { now: string; lastPolledAt: string | null; retryAt: string | null; pollMinutes: number; inHours: boolean; pto: boolean }): boolean {
  if (!f.inHours || f.pto) return false;
  const now = Date.parse(f.now);
  if (f.retryAt && Date.parse(f.retryAt) > now) return false;
  return !f.lastPolledAt || now - Date.parse(f.lastPolledAt) >= f.pollMinutes * 60_000;
}

/** When a throttled chat is read again: Retry-After when Graph gives one (capped at an hour), else doubling from a minute. */
export function backoffUntil(nowIso: string, retryAfterSeconds: number | null, failures: number): string {
  const s = retryAfterSeconds !== null && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds, 3600) : Math.min(60 * 2 ** Math.max(0, failures - 1), 3600);
  return new Date(Date.parse(nowIso) + s * 1000).toISOString();
}

/** Resolutions: Create (a DevOps item), Link (an existing one), Handled (no item, optional note), Dismiss. */
export type AskStatus = "open" | "created" | "linked" | "handled" | "dismissed";
export const ASK_STATUSES: readonly AskStatus[] = ["open", "created", "linked", "handled", "dismissed"];

/** Which kind of DevOps item to create from an ask; the client's process names it. */
export type AskItemLevel = "bug" | "story" | "feature";

/** A delivery chat's Read for asks state (plan store). Times are instants. */
export type AsksState = {
  on: boolean;
  /** Switched on at: nothing older is read (no backfill). */
  since: string | null;
  /** The newest message time seen; the next read asks for messages changed after it. */
  seenAt: string | null;
  polledAt: string | null;
  /** Throttled or failing: not read again before this. */
  retryAt: string | null;
  failures: number;
  /** A plain line for Settings > Connections when the last read failed (null when healthy). */
  status: string | null;
};
export const ASKS_OFF: AsksState = { on: false, since: null, seenAt: null, polledAt: null, retryAt: null, failures: 0, status: null };

/** A stored ask: the message the rules matched, the rule, and how it ended. */
export type Ask = {
  chatId: string;
  messageId: string;
  clientKey: string;
  rule: AskRule;
  ruleDetail: string | null;
  status: AskStatus;
  itemId: number | null;
  itemUrl: string | null;
  itemTitle: string | null;
  note: string | null;
  writeId: number | null;
  resolvedAt: string | null;
  /** The message's time. */
  createdAt: string;
  /** AP-2: the AI's sort ("sorted"), or why it wasn't sorted (an error kind), or null when it wasn't tried. */
  sortStatus: "sorted" | NotSorted | null;
  sort: AskSort | null;
  /** "Show it anyway": an ask the AI marked as needing no action, shown on the tab again. */
  shown: boolean;
};

/**
 * The idle rule (plan/wake.ts): when the next chat with Read for asks on is due to be read (its interval after the last
 * read, or the end of a throttle wait), or null with none on. Working hours are weighed by the caller.
 */
export function nextPollAt(chats: readonly { on: boolean; polledAt: string | null; retryAt: string | null }[], pollMinutes: number, nowIso: string): string | null {
  let best: number | null = null;
  for (const c of chats) {
    if (!c.on) continue;
    const due = Math.max(c.polledAt ? Date.parse(c.polledAt) + pollMinutes * 60_000 : Date.parse(nowIso), c.retryAt ? Date.parse(c.retryAt) : 0);
    best = best === null ? due : Math.min(best, due);
  }
  return best === null ? null : new Date(best).toISOString();
}

// AP-1: what the Asks tab is sent (actions/ask-actions.ts builds it).
/** One ask card. `text` is shown only on its own client's card. */
export type AskView = {
  chatId: string; messageId: string; clientKey: string; clientName: string; chatName: string;
  author: string; external: boolean; at: string; text: string; hasImage: boolean; hasFile: boolean;
  matched: string; status: AskStatus; item: { id: number; url: string | null; title: string | null } | null; note: string | null; resolvedAt: string | null;
  /** Open in Teams: the message in its chat. */
  link: string;
  /** AP-2: the AI's sort, shown as small labels with the reason on hover, and the draft Create starts from. */
  sort: { kind: AskKind; urgency: Urgency; reason: string; itemType: DraftItemType | null; title: string } | null;
  /** "Looks like #1234 <title>": the likely existing item, only from confidence 0.6 (title null when DevOps isn't read). */
  likely: { id: number; title: string | null; url: string | null } | null;
  /** "Not sorted: <plain reason>" when AI didn't sort it (null when sorted, or never tried). */
  notSorted: string | null;
  /** "Promised: <what>": my promise that answers this ask. */
  promised: string | null;
};
/** A chat with Read for asks on, for the Asks tab's footer and Settings > Connections: its last read and any problem. */
export type AskChatStatus = { clientKey: string; clientName: string; chatId: string; chatName: string; polledAt: string | null; status: string | null; retryAt: string | null };
export type AsksData = {
  open: number; asks: AskView[]; chats: AskChatStatus[]; writeClients: string[]; pollMinutes: number;
  /** AP-2: asks the AI said need no action, open and not shown: "Hidden by AI (N)". */
  hidden: AskView[];
  /** AP-2: open promises (for the Promises tab's count). */
  promisesOpen: number;
};
/** AP-2: one promise card. */
export type PromiseView = {
  chatId: string; messageId: string; clientKey: string; clientName: string; chatName: string;
  what: string; toWhom: string | null; due: string | null; at: string; text: string;
  /** The ask it answers (its text's first line), when known. */
  answers: { messageId: string; title: string } | null;
  status: PromiseStatus; followUpId: number | null; item: { id: number; url: string | null; title: string | null } | null;
  /** Why AI didn't read it ("Not read by AI: …"), or null. */
  notSorted: string | null; reason: string | null; resolvedAt: string | null; link: string;
};
/** `today` is the person's date on the server's clock, for the due badges. */
export type PromisesData = { open: number; promises: PromiseView[]; asksOpen: number; today: string };
export type ContextMessage = { messageId: string; author: string; external: boolean; mine: boolean; at: string; text: string; hasImage: boolean; hasFile: boolean };
