// AP-2: AI sorts asks, and Promises: the pure parts. What one "asks.classify" or "promises.extract" request sends
// (that client's context only: the message, up to 5 earlier messages with authors as "client" or "Cooptimize" and no
// email addresses, the client's process type and state names, and up to 50 of its open item titles with ids), the
// strict schemas of the answers, and how an answer becomes what a card shows (an item id that wasn't offered is
// rejected; a due date must be a real date near the message). Also the promise rules (no AI) and the urgency windows.
// Nothing here does I/O or logs; ai/ (the guards, the budget, the log) sits between this and the provider.
import type { AiErrorKind, JsonSchema } from "../ai/types.ts";
import { hasPhrase } from "./asks.ts";

/** At most this many earlier messages go with one request. */
export const CONTEXT_FOR_AI = 5;
/** At most this many open item titles go with one request. */
export const ITEMS_FOR_AI = 50;
/** "Looks like #1234" shows from this confidence up. */
export const LIKELY_MIN = 0.6;

export const ASK_KINDS = ["bug", "request", "question", "incident", "none"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export const URGENCIES = ["now", "this_week", "backlog"] as const;
export type Urgency = (typeof URGENCIES)[number];
export type DraftItemType = "bug" | "story" | "feature";

/** One earlier or current message as the AI sees it: who (only "client" or "Cooptimize", or "me" for my own) and text. */
export type AiMessage = { id: string; from: "client" | "Cooptimize" | "me"; text: string; attachment: "image" | "file" | null };
/** An open item of the client, as offered. */
export type AiItem = { id: number; title: string; type: string; state: string };
/** What one request about a client is given. */
export type AiAskContext = { clientName: string; process: { name: string | null; types: string[]; states: string[] }; items: AiItem[]; earlier: AiMessage[]; message: AiMessage };

const EMAIL = /[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** No email addresses in anything sent: each becomes "[email address]". */
export const withoutEmails = (s: string) => s.replace(EMAIL, "[email address]");
/** Long text is cut so one message can't make a request expensive. */
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The process from the item types it uses (from the types alone, never guessed further). */
export function processName(types: readonly string[]): string | null {
  const t = new Set(types.map((x) => x.toLowerCase()));
  if (t.has("product backlog item")) return "Scrum";
  if (t.has("user story")) return "Agile";
  if (t.has("requirement")) return "CMMI";
  if (t.has("issue")) return "Basic";
  return null;
}

/**
 * The context for one request: that client's process names from its open items, up to 50 open items (newest change
 * first), up to 5 earlier messages (oldest first), every text without email addresses. Only what is passed in, which
 * the caller takes from this client alone.
 */
export function buildContext(o: { clientName: string; items: readonly { id: number; title: string; type: string; state: string; changedAt?: string }[]; earlier: readonly AiMessage[]; message: AiMessage }): AiAskContext {
  const items = [...o.items]
    .sort((a, b) => (b.changedAt ?? "").localeCompare(a.changedAt ?? "") || b.id - a.id)
    .slice(0, ITEMS_FOR_AI)
    .map((i) => ({ id: i.id, title: withoutEmails(cut(i.title, 200)), type: i.type, state: i.state }));
  const types = [...new Set(o.items.map((i) => i.type))].sort();
  const states = [...new Set(o.items.map((i) => i.state))].sort();
  const msg = (m: AiMessage): AiMessage => ({ ...m, text: withoutEmails(cut(m.text, 2000)) });
  return { clientName: o.clientName, process: { name: processName(types), types, states }, items, earlier: o.earlier.slice(-CONTEXT_FOR_AI).map(msg), message: msg(o.message) };
}

/** The input text for one request (JSON, so the model reads the parts apart). */
export function contextText(c: AiAskContext, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    client: c.clientName,
    devops_process: c.process,
    open_items: c.items,
    earlier_messages: c.earlier.map((m) => ({ id: m.id, from: m.from, text: m.text, ...(m.attachment ? { attachment: m.attachment } : {}) })),
    message: { id: c.message.id, from: c.message.from, text: c.message.text, ...(c.message.attachment ? { attachment: c.message.attachment } : {}) },
    ...extra,
  });
}

// ---- asks.classify ----

export const CLASSIFY_TASK = "asks.classify";
export const CLASSIFY_INSTRUCTIONS = [
  "You sort one message that a client sent in a Teams chat with a consulting team, so a person can decide what to do with it.",
  "Use only what is in the input. Write plain, short English. Never invent item ids.",
  "kind: bug (something broken), request (a change or new work), question (wants an answer only), incident (something down or failing now for many people), none (no action needed: small talk, thanks, an update).",
  "urgency: now (blocks the client today), this_week, or backlog.",
  "item_type: the DevOps item to create (bug, story or feature), or null when none fits (a question, or none).",
  "title: at most 80 characters, a DevOps title. description: two to four plain sentences; you may quote the message.",
  "likely_existing_item: only when one of open_items is clearly the same work: its id and your confidence from 0 to 1. Otherwise null.",
  "reason: one sentence saying why you chose the kind and urgency.",
].join("\n");

export const CLASSIFY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...ASK_KINDS] },
    urgency: { type: "string", enum: [...URGENCIES] },
    item_type: { type: ["string", "null"], enum: ["bug", "story", "feature", null] },
    title: { type: "string" },
    description: { type: "string" },
    likely_existing_item: {
      anyOf: [
        { type: "object", properties: { id: { type: "integer" }, confidence: { type: "number", minimum: 0, maximum: 1 } }, required: ["id", "confidence"], additionalProperties: false },
        { type: "null" },
      ],
    },
    reason: { type: "string" },
  },
  required: ["kind", "urgency", "item_type", "title", "description", "likely_existing_item", "reason"],
  additionalProperties: false,
};

export type ClassifyAnswer = {
  kind: AskKind;
  urgency: Urgency;
  item_type: DraftItemType | null;
  title: string;
  description: string;
  likely_existing_item: { id: number; confidence: number } | null;
  reason: string;
};

/** What a sorted ask keeps (asks.ai_*): the draft and the likely item, never anything else from the answer. */
export type AskSort = {
  kind: AskKind;
  urgency: Urgency;
  itemType: DraftItemType | null;
  title: string;
  description: string;
  likely: { id: number; confidence: number } | null;
  reason: string;
};

/** A title of at most 80 characters, cut at a word when it can. */
export function title80(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t;
  const c = t.slice(0, 79);
  const at = c.lastIndexOf(" ");
  return `${(at > 40 ? c.slice(0, at) : c).trimEnd()}…`;
}

/**
 * The answer as a sort, or null when it can't be used: a likely item that wasn't one of the offered ids is rejected
 * (the whole answer, so nothing invented reaches a card), an empty title too unless the kind is none.
 */
export function sortFrom(a: ClassifyAnswer, offered: readonly number[]): AskSort | null {
  if (a.likely_existing_item && !offered.includes(a.likely_existing_item.id)) return null;
  const title = title80(a.title);
  if (!title && a.kind !== "none") return null;
  return {
    kind: a.kind,
    urgency: a.urgency,
    itemType: a.kind === "none" ? null : a.item_type,
    title,
    description: a.description.trim().slice(0, 2000),
    likely: a.likely_existing_item ? { id: a.likely_existing_item.id, confidence: Math.max(0, Math.min(1, a.likely_existing_item.confidence)) } : null,
    reason: a.reason.replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

/** Why an ask wasn't sorted, in a few plain words for "Not sorted: …" (no ids, nothing from the message). */
export type NotSorted = AiErrorKind | "unknown_item";
export function notSortedText(k: NotSorted, clientName: string): string {
  switch (k) {
    case "off": return "AI is off";
    case "client_off": return `AI isn't allowed for ${clientName}`;
    case "not_set_up": return "AI isn't set up";
    case "over_budget": return "AI budget reached for this month";
    case "zero_budget": return "AI budget is set to $0";
    case "refused_client": return "it mentions another client";
    case "refused_secret": return "it contains something that looks like a key or secret";
    case "refused_email": return "it contains an email address";
    case "invalid_output":
    case "unknown_item": return "the AI's answer wasn't usable";
    case "rate_limited": return "the AI service was busy";
    case "quota": return "the AI service is out of credit";
    case "timeout": return "the AI service didn't answer in time";
    case "provider":
    case "bad_task": return "the AI service couldn't answer";
  }
}

export const KIND_WORD: Record<AskKind, string> = { bug: "Bug", request: "Request", question: "Question", incident: "Incident", none: "No action" };
export const URGENCY_WORD: Record<Urgency, string> = { now: "Now", this_week: "This week", backlog: "Backlog" };

/**
 * When an open ask has waited past its urgency: "now" after 2 hours, "this week" at the end of that week's Friday in
 * my zone, "backlog" never. Check-in lists these as "Walked in, not resolved".
 */
export function pastUrgency(u: Urgency | null, arrivedIso: string, nowIso: string, zone: string): boolean {
  if (!u || u === "backlog") return false;
  const arrived = Temporal.Instant.from(arrivedIso);
  const now = Temporal.Instant.from(nowIso);
  if (u === "now") return Temporal.Instant.compare(now, arrived.add({ hours: 2 })) >= 0;
  const day = arrived.toZonedDateTimeISO(zone).toPlainDate();
  const friday = day.add({ days: (5 - day.dayOfWeek + 7) % 7 });
  const end = friday.add({ days: 1 }).toZonedDateTime({ timeZone: zone });
  return Temporal.Instant.compare(now, end.toInstant()) >= 0;
}

// ---- Promises ----

export { DEFAULT_PROMISE_PHRASES } from "./asks.ts";

/** Whether one of my own messages reads as a commitment (no AI): the first phrase found, or null. */
export function matchPromise(text: string, phrases: readonly string[]): string | null {
  return phrases.find((p) => hasPhrase(text, p)) ?? null;
}

export const PROMISE_TASK = "promises.extract";
export const PROMISE_INSTRUCTIONS = [
  "You read one message that a consultant (\"me\") sent in a Teams chat with a client, and decide whether it promises to do something.",
  "Use only what is in the input. Write plain, short English.",
  "is_promise: true only when the message commits me to an action or a date. Polite phrases and questions are not promises.",
  "what: what I promised, at most 80 characters, starting with a verb (\"Send the export fix\").",
  "due_hint: the date it is due as YYYY-MM-DD, worked out from today in the input (\"tomorrow\", \"by Friday\"), or null when no time is given.",
  "to_whom: the name of the person it was promised to, only from people_in_chat, or null.",
  "answers_message_id: the id of the earlier message this answers, from earlier_messages only, or null.",
  "reason: one sentence.",
].join("\n");

export const PROMISE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    is_promise: { type: "boolean" },
    what: { type: "string" },
    due_hint: { type: ["string", "null"] },
    to_whom: { type: ["string", "null"] },
    answers_message_id: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["is_promise", "what", "due_hint", "to_whom", "answers_message_id", "reason"],
  additionalProperties: false,
};
export type PromiseAnswer = { is_promise: boolean; what: string; due_hint: string | null; to_whom: string | null; answers_message_id: string | null; reason: string };

/** What a promise card keeps from the answer. */
export type PromiseDraft = { what: string; due: string | null; toWhom: string | null; answers: string | null; reason: string | null };

/**
 * The answer as a promise, or null when it isn't one. The due date must be a real date from the message's day to 90
 * days after it (else none), the answered message one of the offered ids (else none), the names ones from the chat.
 */
export function promiseFrom(a: PromiseAnswer, o: { messageDay: string; offeredIds: readonly string[]; names: readonly string[] }): PromiseDraft | null {
  if (!a.is_promise) return null;
  const what = title80(a.what);
  if (!what) return null;
  let due: string | null = null;
  if (a.due_hint && /^\d{4}-\d{2}-\d{2}$/.test(a.due_hint)) {
    try {
      const d = Temporal.PlainDate.from(a.due_hint, { overflow: "reject" });
      const from = Temporal.PlainDate.from(o.messageDay);
      if (Temporal.PlainDate.compare(d, from) >= 0 && Temporal.PlainDate.compare(d, from.add({ days: 90 })) <= 0) due = d.toString();
    } catch {
      due = null;
    }
  }
  const known = o.names.map((n) => n.toLowerCase());
  const who = (a.to_whom ?? "")
    .split(/,|\band\b/)
    .map((n) => n.trim())
    .filter((n) => n && known.some((k) => k === n.toLowerCase() || k.split(/\s+/)[0] === n.toLowerCase()));
  return {
    what,
    due,
    toWhom: who.length ? who.join(", ").slice(0, 200) : null,
    answers: a.answers_message_id && o.offeredIds.includes(a.answers_message_id) ? a.answers_message_id : null,
    reason: a.reason.replace(/\s+/g, " ").trim().slice(0, 300) || null,
  };
}

/** Without AI: the rule's match alone, the message's first line as what, no due date. */
export function promiseWithoutAi(text: string): PromiseDraft {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "A promise in Teams";
  return { what: title80(line), due: null, toWhom: null, answers: null, reason: null };
}

/** How a promise ends: open, a follow-up made from it (open until that closes), linked to an item, done or dismissed. */
export type PromiseStatus = "open" | "followup" | "linked" | "done" | "dismissed";
export const PROMISE_STATUSES: readonly PromiseStatus[] = ["open", "followup", "linked", "done", "dismissed"];

/**
 * Whether a promise is closed by what it was turned into: its follow-up closed (done, not "not needed"), or its linked
 * item in a completed state. Done and Dismiss close it by hand.
 */
export function promiseClosedBy(p: { status: PromiseStatus }, f: { followUpDone: boolean | null; itemDone: boolean | null }): boolean {
  if (p.status === "followup") return f.followUpDone === true;
  if (p.status === "linked") return f.itemDone === true;
  return false;
}

/** A stored promise (plan store): my message the rules matched, the draft, and how it ended. */
export type StoredPromise = {
  chatId: string;
  messageId: string;
  clientKey: string;
  phrase: string | null;
  what: string;
  due: string | null;
  toWhom: string | null;
  answers: string | null;
  /** "sorted" with AI, or why AI wasn't used (an error kind), or null when it wasn't tried. */
  aiStatus: "sorted" | NotSorted | null;
  reason: string | null;
  status: PromiseStatus;
  followUpId: number | null;
  itemId: number | null;
  itemUrl: string | null;
  itemTitle: string | null;
  resolvedAt: string | null;
  /** The message's time. */
  createdAt: string;
};
