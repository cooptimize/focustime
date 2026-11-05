// CV-1: Conversations, the pure parts. A conversation is a burst of related messages in one client chat, shown as one
// short card with a living summary (never a transcript). The poller (actions/conversations.ts) runs, per chat and
// cycle: the chatter rules (no AI), then one "conversations.update" request with that chat's batch, its open
// conversations and the client's open items, then this module's checks on the answer (refs that weren't offered
// reject the whole answer; the rules' hints win over a doubtful "new topic"; my messages close together are one
// promise at most). Status is decided here from facts, never by the AI: New until a Cooptimizer answers, then In
// discussion, <Name> committed while a commitment is open, Tracked #id once an item is linked, Resolved and Closed only
// by a person. Nothing here does I/O or logs.
import { userZone } from "../week/zone.ts";
import type { AiErrorKind, JsonSchema } from "../ai/types.ts";
import { hasPhrase, isAcknowledgement } from "./asks.ts";
import { withoutEmails } from "./asks-ai.ts";
import { bodyKind } from "./sanitize.ts";
import { hoursOn, type TimeModel } from "../week/hours.ts";

// ---- the model ----

export const CONVERSATION_STATUSES = ["new", "discussion", "committed", "tracked", "resolved", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const MESSAGE_ROLES = ["work", "chatter", "ack", "unsorted"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export const COMMITMENT_STATES = ["open", "followup", "linked", "created", "done", "not_needed"] as const;
export type CommitmentState = (typeof COMMITMENT_STATES)[number];
export const ITEM_CHANGES = ["decision", "root_cause", "scope", "date", "data"] as const;
export type ItemChange = (typeof ITEM_CHANGES)[number];

export type Participant = { id: string; name: string; external: boolean };

/** One conversation (conversations, an app table read through the store's viewer). Times are instants. */
export type Conversation = {
  id: number;
  chatId: string;
  clientKey: string;
  title: string;
  summary: string;
  status: ConversationStatus;
  /** Who is on it (a Cooptimizer's Entra id), when someone is. */
  ownerId: string | null;
  participants: Participant[];
  firstAt: string;
  lastAt: string;
  /** The last work message (an acknowledgement after it is a wind-down signal). */
  lastWorkAt: string;
  /** "Looks wrapped up. Resolve?": set by thanks or a clear conclusion, cleared by new work. Never resolves by itself. */
  windDown: boolean;
  itemId: number | null;
  itemUrl: string | null;
  itemTitle: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** Bumped on every update a person would notice; the "Updated" marker compares it with what they last saw. */
  version: number;
  changeNote: string | null;
  /** A meaningful change for the linked item (decision, root cause, scope, date, data) not suggested yet. */
  itemChange: { kind: ItemChange; note: string; at: string; scope: boolean } | null;
  /** A likely existing item the AI matched (one of the offered ids), for Link. */
  likelyItem: number | null;
  createdAt: string;
  updatedAt: string;
};

/** A message's place in conversations (conversation_messages). */
export type MessagePlace = { chatId: string; messageId: string; conversationId: number | null; role: MessageRole; reason: string | null; placedBy: "ai" | "rule" | "person"; at: string };

/** A commitment someone made in a conversation (commitments, an app table). My own open ones are My promises. */
export type Commitment = {
  id: number;
  conversationId: number | null;
  chatId: string;
  clientKey: string;
  whoId: string | null;
  whoName: string;
  toId: string | null;
  toName: string | null;
  what: string;
  /** A due instant when a time was stated, else a due day (the committer's zone), else neither. */
  dueAt: string | null;
  dueDate: string | null;
  impliesItem: boolean;
  state: CommitmentState;
  messageIds: string[];
  followUpId: number | null;
  itemId: number | null;
  itemUrl: string | null;
  itemTitle: string | null;
  /** "Add to Today": the day it was put on Today (my day only). */
  onToday: string | null;
  remindedAt: string | null;
  escalatedAt: string | null;
  /** Take it over: who took it (now the committer) and from whom (told quietly, once). */
  takenBy: string | null;
  takenFrom: string | null;
  takenAt: string | null;
  reason: string | null;
  /** The DevOps item drafted for the committer (when they opened it), until it is created or linked. */
  draft: ItemDraft | null;
  createdAt: string;
  updatedAt: string;
};

/** A DevOps item drafted from a whole conversation: a path of action, a suggested type and parent. */
export type ItemDraft = {
  title: string;
  asked: string;
  checkFirst: string[];
  likelyChange: string;
  openQuestions: string[];
  /** bug, story or feature (the process's own type name comes from typeInfo). */
  level: "bug" | "story" | "feature";
  parentId: number | null;
  /** A likely existing item to link instead (one of the client's open ones), when there is one. */
  likelyItem: number | null;
  byAi: boolean;
};

export type SuggestionKind = "comment" | "description";
export type Suggestion = {
  id: number;
  conversationId: number;
  itemId: number;
  kind: SuggestionKind;
  forUser: string | null;
  body: string;
  /** Only for a description: the text before and the proposed text. */
  before: string | null;
  after: string | null;
  /** Lines that came from an internal delivery chat: shown flagged, left out unless included. */
  internal: string[];
  state: "open" | "posted" | "skipped";
  writeId: number | null;
  day: string;
  createdAt: string;
};

// ---- the chatter rules (no AI) ----

/** Short acknowledgements: a message that is only these (and punctuation or emoji) is chatter, or a wind-down signal. */
export const ACK_PHRASES = ["thanks", "thank you", "thanks a lot", "thank you so much", "thx", "ty", "ok", "okay", "k", "kk", "sounds good", "lol", "great", "perfect", "awesome", "cool", "got it", "nice", "appreciate it"];

export type RuleVerdict = { role: "chatter"; why: "gif" | "sticker" | "emoji" | "empty" } | { role: "ack" } | null;

/** What the rules decide before any AI: GIFs, stickers, emoji only and empty are chatter; thanks and the like are acks. */
export function ruleVerdict(m: { text: string; html: string | null; hasImage: boolean; hasFile: boolean }, extraAcks: readonly string[] = []): RuleVerdict {
  const k = bodyKind(m.html);
  const words = m.text.replace(/\s+/g, "");
  if (!m.hasFile && !m.hasImage) {
    if (k.gif && !/[\p{L}\p{N}]/u.test(m.text)) return { role: "chatter", why: "gif" };
    if (k.sticker && !/[\p{L}\p{N}]/u.test(m.text)) return { role: "chatter", why: "sticker" };
    if (!words) return { role: "chatter", why: k.emojiOnly ? "emoji" : "empty" };
    if (k.emojiOnly || !/[\p{L}\p{N}]/u.test(m.text)) return { role: "chatter", why: "emoji" };
    if (isAcknowledgement(m.text, [...ACK_PHRASES, ...extraAcks])) return { role: "ack" };
  }
  return null;
}

// ---- grouping hints ----

/** Messages this close among the same people lean to the same conversation. */
export const NEAR_MINUTES = 45;
/** My messages this close (with nobody else between) are one group: one promise at most. */
export const GROUP_MINUTES = 15;
/** Or replies to the same message within this long. */
export const GROUP_REPLY_MINUTES = 60;

export type HintWhy = "reply" | "mention" | "near";
export type Hint = { conversationId: number; why: HintWhy };

export type BatchMessage = {
  messageId: string;
  senderId: string | null;
  senderName: string | null;
  external: boolean;
  createdAt: string;
  text: string;
  html: string | null;
  hasImage: boolean;
  hasFile: boolean;
  replyToId: string | null;
  mentions: { id: string; name: string | null }[];
};

export type OpenConversation = Pick<Conversation, "id" | "title" | "summary" | "status" | "participants" | "lastAt"> & { messageIds: string[] };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const minutes = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 60_000;

/**
 * The rules' hint for one message: a reply or quote of a message in an open conversation joins it; an @mention of
 * someone already in one leans to it; a message within 45 minutes of an open conversation's last message, from someone
 * already in it, leans to it. `placed` maps a message id to its conversation (earlier ones in this batch included).
 */
export function hintFor(m: BatchMessage, open: readonly OpenConversation[], placed: ReadonlyMap<string, number>): Hint | null {
  if (m.replyToId) {
    const c = placed.get(m.replyToId) ?? open.find((x) => x.messageIds.includes(m.replyToId!))?.id;
    if (c !== undefined && open.some((x) => x.id === c)) return { conversationId: c, why: "reply" };
  }
  const mentioned = m.mentions.map((x) => x.id);
  const byMention = [...open].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).find((c) => c.participants.some((p) => mentioned.some((id) => same(id, p.id))));
  if (byMention) return { conversationId: byMention.id, why: "mention" };
  const near = [...open].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).find((c) => minutes(c.lastAt, m.createdAt) <= NEAR_MINUTES && c.participants.some((p) => same(p.id, m.senderId)));
  if (near) return { conversationId: near.id, why: "near" };
  return null;
}

/**
 * My consecutive messages as groups (D: one promise at most per group): each within 15 minutes of the one before with
 * nobody else posting between, or a reply to the same message within 60 minutes. Returns message id → group key.
 */
export function messageGroups(ms: readonly Pick<BatchMessage, "messageId" | "senderId" | "createdAt" | "replyToId">[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...ms].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let prev: (typeof sorted)[number] | null = null;
  let key = "";
  for (const m of sorted) {
    const consecutive = !!prev && same(prev.senderId, m.senderId) && minutes(prev.createdAt, m.createdAt) <= GROUP_MINUTES;
    const sameReply = !!prev && same(prev.senderId, m.senderId) && !!m.replyToId && prev.replyToId === m.replyToId && minutes(prev.createdAt, m.createdAt) <= GROUP_REPLY_MINUTES;
    if (!(consecutive || sameReply)) key = `g${m.messageId}`;
    out.set(m.messageId, key);
    prev = m;
  }
  // A reply to the same message within an hour joins its author's earlier group even with someone between.
  for (const m of sorted) {
    if (!m.replyToId) continue;
    const first = sorted.find((x) => x !== m && same(x.senderId, m.senderId) && x.replyToId === m.replyToId && Date.parse(x.createdAt) < Date.parse(m.createdAt) && minutes(x.createdAt, m.createdAt) <= GROUP_REPLY_MINUTES);
    if (first) out.set(m.messageId, out.get(first.messageId)!);
  }
  return out;
}

/** "Back online around 7:30", "running kids around": where someone will be, never a promise on its own (its time may set a due). */
const STATUS = /\b(back (online|on|in)|be back|i'?ll be (online|on|around|back)|running (the )?kids|kids around|offline|afk|brb|stepping (out|away)|(at|grabbing) lunch|heading out|on a call|in a meeting|out (of office|today|tomorrow|for the day)|signing off|logging off)\b/i;
export const isStatusStatement = (text: string) => STATUS.test(text);

// ---- due times ----

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * A due day and time stated in plain words, in the writer's zone: "tonight" or "today" (that day), "tomorrow",
 * "by Friday" (the next one), "end of day"; a clock time ("7:30 PM", "around 8pm", "at 19:30") sets the time. A bare
 * evening time with "tonight" is PM. Returns null when nothing is said.
 */
export function dueFromText(text: string, at: string, zone: string): { date: string; time: string | null } | null {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  const day = Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainDate();
  let date: Temporal.PlainDate | null = null;
  if (/\b(tonight|today|this (evening|afternoon|morning)|end of (the )?day|eod|later today)\b/.test(t)) date = day;
  else if (/\btomorrow\b/.test(t)) date = day.add({ days: 1 });
  else {
    const w = WEEKDAYS.findIndex((d) => new RegExp(`\\b(by |on |this |next )?${d}\\b`).test(t));
    if (w >= 0) date = day.add({ days: ((w + 1 - day.dayOfWeek + 7) % 7) || 7 });
  }
  const clock = /\b(?:at|around|by|about|before|after|~)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.exec(t) ?? /\b(?:at|around|by|about)\s+(\d{1,2}):(\d{2})\b/.exec(t);
  let time: string | null = null;
  if (clock) {
    let h = Number(clock[1]);
    const min = Number(clock[2] ?? 0);
    const mer = (clock[3] ?? "").replace(/\./g, "");
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    if (!mer && h < 12 && /\btonight|evening\b/.test(t)) h += 12;
    if (h <= 23 && min <= 59) time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  if (!date && !time) return null;
  if (!date) date = day;
  return { date: date.toString(), time };
}

/** A due as stored: an instant when there's a time, else the day. */
export function dueOf(d: { date: string; time: string | null } | null, zone: string): { dueAt: string | null; dueDate: string | null } {
  if (!d) return { dueAt: null, dueDate: null };
  if (!d.time) return { dueAt: null, dueDate: d.date };
  return { dueAt: Temporal.PlainDateTime.from(`${d.date}T${d.time}`).toZonedDateTime(zone).toInstant().toString(), dueDate: d.date };
}

// ---- the AI request (conversations.update) ----

export const UPDATE_TASK = "conversations.update";
/** At most this many open conversations, open items and recent messages per conversation go with a request. */
export const OPEN_FOR_AI = 12;
export const ITEMS_FOR_AI = 50;
export const RECENT_FOR_AI = 4;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const UPDATE_INSTRUCTIONS = [
  "You keep a consulting team's view of one client's Teams chat up to date. New messages arrive in a batch.",
  "Use only the input. Plain, short English. Never invent refs or ids: use only refs and item ids given in the input.",
  "For every message in messages: kind is work (about the client's work: data, reports, bugs, requests, decisions, deployments, questions about the work) or chatter (weather, sports, jokes, personal plans, greetings). conversation is the ref of the open conversation it continues, or a new ref you make up like n1, n2 for a new topic (several messages may share one new ref), or null for chatter. Respect hint: a hinted message joins that conversation unless you are confident it starts a new topic (then set confident_new_topic true).",
  "For every conversation you touched (open refs or new ones): title (at most 70 characters, what it is about), summary (2 to 4 short lines: what was asked, what has been found, who is on it, what is next; use people's first names), owner (the person ref of the Cooptimize person on it, or null), wrapped_up (true when it ended with thanks or a clear conclusion and nothing is left to do), change (one short line saying what changed in this batch), item_change (when something meaningful for a DevOps item happened: decision, root_cause, scope, date or data, with a one-line note; otherwise null), scope_changed (true only when what is being asked for clearly changed), likely_item (the id of one open_items entry that is clearly the same work, or null).",
  "commitments: when someone says they will do something (\"I'll look tonight\", \"I'll get this into the dev queue\", \"I'll log a ticket\"): who (person ref), what (an action, at most 80 characters, specific: say what will be done, using the conversation's words), due (YYYY-MM-DD or YYYY-MM-DDTHH:MM in the writer's local time, only when they said when, else null; a later message about when they'll be back can set the time), to (the person ref they answered or mentioned, never the committer, or null), implies_item (true when it means a DevOps item: dev queue, backlog, ticket, bug, story, fix in the next release), messages (the refs of their messages it comes from), status_only (true when it only says where they will be, like \"back online at 7:30\").",
  "Messages from one person close together (the same group) make at most one commitment: merge them.",
].join("\n");

const NULL_STRING: JsonSchema = { type: ["string", "null"] };
export const UPDATE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: { type: "string" }, kind: { type: "string", enum: ["work", "chatter"] }, conversation: NULL_STRING, confident_new_topic: { type: "boolean" } },
        required: ["ref", "kind", "conversation", "confident_new_topic"],
        additionalProperties: false,
      },
    },
    conversations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          owner: NULL_STRING,
          wrapped_up: { type: "boolean" },
          change: { type: "string" },
          item_change: {
            anyOf: [
              { type: "object", properties: { kind: { type: "string", enum: [...ITEM_CHANGES] }, note: { type: "string" } }, required: ["kind", "note"], additionalProperties: false },
              { type: "null" },
            ],
          },
          scope_changed: { type: "boolean" },
          likely_item: { type: ["integer", "null"] },
          commitments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                who: { type: "string" },
                what: { type: "string" },
                due: NULL_STRING,
                to: NULL_STRING,
                implies_item: { type: "boolean" },
                messages: { type: "array", items: { type: "string" } },
                status_only: { type: "boolean" },
              },
              required: ["who", "what", "due", "to", "implies_item", "messages", "status_only"],
              additionalProperties: false,
            },
          },
        },
        required: ["ref", "title", "summary", "owner", "wrapped_up", "change", "item_change", "scope_changed", "likely_item", "commitments"],
        additionalProperties: false,
      },
    },
  },
  required: ["messages", "conversations"],
  additionalProperties: false,
};

export type UpdateAnswer = {
  messages: { ref: string; kind: "work" | "chatter"; conversation: string | null; confident_new_topic: boolean }[];
  conversations: {
    ref: string;
    title: string;
    summary: string;
    owner: string | null;
    wrapped_up: boolean;
    change: string;
    item_change: { kind: ItemChange; note: string } | null;
    scope_changed: boolean;
    likely_item: number | null;
    commitments: { who: string; what: string; due: string | null; to: string | null; implies_item: boolean; messages: string[]; status_only: boolean }[];
  }[];
};

/** Short aliases for what the request names, mapped back by code (message ids and people never go as themselves). */
export type Refs = { messages: Map<string, string>; people: Map<string, string>; conversations: Map<string, number> };

export type UpdateInput = {
  clientName: string;
  chatKind: "delivery" | "customer";
  zone: string;
  now: string;
  people: Participant[];
  open: OpenConversation[];
  recent: Map<number, BatchMessage[]>;
  items: { id: number; title: string; type: string; state: string }[];
  batch: BatchMessage[];
  hints: Map<string, Hint>;
  groups: Map<string, string>;
};

/**
 * The request's input for one chat's batch: people as p1, p2 (display names, Cooptimize or client, never an address),
 * messages as m1, m2, open conversations as c1, c2 (title, summary, status, participants, a few recent messages),
 * the client's open items (ids kept: they are checked against this list). Only this client's data is passed in.
 */
export function buildUpdate(u: UpdateInput): { text: string; refs: Refs } {
  const refs: Refs = { messages: new Map(), people: new Map(), conversations: new Map() };
  const pRef = new Map<string, string>();
  const person = (id: string | null) => {
    if (!id) return null;
    const k = id.toLowerCase();
    if (!pRef.has(k)) {
      const r = `p${pRef.size + 1}`;
      pRef.set(k, r);
      refs.people.set(r, id);
    }
    return pRef.get(k)!;
  };
  const mRef = new Map<string, string>();
  const msg = (id: string) => {
    if (!mRef.has(id)) {
      const r = `m${mRef.size + 1}`;
      mRef.set(id, r);
      refs.messages.set(r, id);
    }
    return mRef.get(id)!;
  };
  for (const p of u.people) person(p.id);
  const open = [...u.open].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).slice(0, OPEN_FOR_AI);
  const cRef = new Map<number, string>();
  open.forEach((c, i) => {
    cRef.set(c.id, `c${i + 1}`);
    refs.conversations.set(`c${i + 1}`, c.id);
  });
  const text = (s: string) => withoutEmails(cut(s, 2000));
  const line = (m: BatchMessage) => ({ ref: msg(m.messageId), from: person(m.senderId), at: localTime(m.createdAt, u.zone), text: text(m.text), ...(m.hasImage ? { attachment: "image" } : m.hasFile ? { attachment: "file" } : {}) });
  const conversations = open.map((c) => ({
    ref: cRef.get(c.id)!,
    title: withoutEmails(c.title),
    summary: withoutEmails(c.summary),
    status: c.status,
    participants: c.participants.map((p) => person(p.id)),
    recent_messages: (u.recent.get(c.id) ?? []).slice(-RECENT_FOR_AI).map(line),
  }));
  const peopleOut = u.people.map((p) => ({ ref: person(p.id), name: withoutEmails(p.name), side: p.external ? "client" : "Cooptimize" }));
  const batch = u.batch.map((m) => {
    const h = u.hints.get(m.messageId);
    return {
      ...line(m),
      reply_to: m.replyToId ? (mRef.get(m.replyToId) ?? null) : null,
      mentions: m.mentions.map((x) => person(x.id)).filter(Boolean),
      group: u.groups.get(m.messageId) ? `g${[...new Set(u.groups.values())].indexOf(u.groups.get(m.messageId)!) + 1}` : null,
      hint: h && cRef.has(h.conversationId) ? { conversation: cRef.get(h.conversationId), why: h.why } : null,
    };
  });
  const items = u.items.slice(0, ITEMS_FOR_AI).map((i) => ({ id: i.id, title: withoutEmails(cut(i.title, 200)), type: i.type, state: i.state }));
  return {
    text: JSON.stringify({ client: u.clientName, chat: u.chatKind === "delivery" ? "internal delivery team chat" : "customer collaboration chat", now: localTime(u.now, u.zone), people: peopleOut, open_conversations: conversations, open_items: items, messages: batch }),
    refs,
  };
}

const localTime = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: "minute" });

/** A checked answer, in ids: per message its kind and conversation (an id, or "new:<ref>"), per conversation the update. */
export type CheckedUpdate = {
  placements: { messageId: string; kind: "work" | "chatter"; target: { id: number } | { newRef: string } | null }[];
  updates: {
    target: { id: number } | { newRef: string };
    title: string;
    summary: string;
    ownerId: string | null;
    wrappedUp: boolean;
    change: string;
    itemChange: { kind: ItemChange; note: string } | null;
    scopeChanged: boolean;
    likelyItem: number | null;
    commitments: { whoId: string; what: string; due: string | null; toId: string | null; impliesItem: boolean; messageIds: string[]; statusOnly: boolean }[];
  }[];
};

export class BadAnswer extends Error {}

/**
 * The answer checked against what was offered: any message, person or conversation ref, or item id that wasn't in the
 * request rejects the whole answer (nothing invented reaches a card). A hinted message (reply, quote or mention) joins
 * its hinted conversation unless the AI was confident it's new.
 */
export function checkUpdate(a: UpdateAnswer, refs: Refs, o: { batch: readonly string[]; itemIds: readonly number[]; hints: ReadonlyMap<string, Hint> }): CheckedUpdate {
  const newRefs = new Set(a.conversations.map((c) => c.ref).filter((r) => !refs.conversations.has(r)));
  for (const r of newRefs) if (!/^n\d{1,3}$/.test(r)) throw new BadAnswer(`unknown conversation ${r}`);
  const target = (r: string | null): { id: number } | { newRef: string } | null => {
    if (r === null) return null;
    const id = refs.conversations.get(r);
    if (id !== undefined) return { id };
    if (/^n\d{1,3}$/.test(r)) return { newRef: r };
    throw new BadAnswer(`unknown conversation ${r}`);
  };
  const messageId = (r: string) => {
    const id = refs.messages.get(r);
    if (!id || !o.batch.includes(id)) throw new BadAnswer(`unknown message ${r}`);
    return id;
  };
  const anyMessage = (r: string) => {
    const id = refs.messages.get(r);
    if (!id) throw new BadAnswer(`unknown message ${r}`);
    return id;
  };
  const personId = (r: string) => {
    const id = refs.people.get(r);
    if (!id) throw new BadAnswer(`unknown person ${r}`);
    return id;
  };
  const seen = new Set<string>();
  const placements = a.messages.map((m) => {
    const id = messageId(m.ref);
    if (seen.has(id)) throw new BadAnswer("a message placed twice");
    seen.add(id);
    let t = m.kind === "chatter" ? null : target(m.conversation);
    const h = o.hints.get(id);
    // The rules' hints win: a reply or a mention joins unless the AI is confident it's a new topic; it's work then.
    if (h && (h.why === "reply" || h.why === "mention") && !m.confident_new_topic && (!t || !("id" in t) || t.id !== h.conversationId)) t = { id: h.conversationId };
    return { messageId: id, kind: t ? ("work" as const) : ("chatter" as const), target: t };
  });
  const updates = a.conversations.map((c) => {
    const t = target(c.ref)!;
    if (c.likely_item !== null && !o.itemIds.includes(c.likely_item)) throw new BadAnswer("an item that wasn't offered");
    return {
      target: t,
      title: oneLine(c.title, 70),
      summary: c.summary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4).join("\n").slice(0, 600),
      ownerId: c.owner ? personId(c.owner) : null,
      wrappedUp: c.wrapped_up,
      change: oneLine(c.change, 160),
      itemChange: c.item_change ? { kind: c.item_change.kind, note: oneLine(c.item_change.note, 300) } : null,
      scopeChanged: c.scope_changed,
      likelyItem: c.likely_item,
      commitments: c.commitments.map((x) => ({ whoId: personId(x.who), what: oneLine(x.what, 120), due: x.due, toId: x.to ? personId(x.to) : null, impliesItem: x.implies_item, messageIds: x.messages.map(anyMessage), statusOnly: x.status_only })),
    };
  });
  return { placements, updates };
}

export const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const c = t.slice(0, n - 1);
  const at = c.lastIndexOf(" ");
  return `${(at > n / 2 ? c.slice(0, at) : c).trimEnd()}…`;
};

/** A stated due checked: a real day (or day and time) from a day before the message to 60 days after it. */
export function checkDue(due: string | null, messageAt: string, zone: string): { date: string; time: string | null } | null {
  if (!due) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(due.trim());
  if (!m) return null;
  try {
    const d = Temporal.PlainDate.from(m[1]!, { overflow: "reject" });
    const day = Temporal.Instant.from(messageAt).toZonedDateTimeISO(zone).toPlainDate();
    const diff = d.since(day).days;
    if (diff < -1 || diff > 60) return null;
    if (m[2]) Temporal.PlainTime.from(m[2], { overflow: "reject" });
    return { date: d.toString(), time: m[2] ?? null };
  } catch {
    return null;
  }
}

/**
 * Commitments of one person in one message group merged into one: a status statement ("back online at 7:30") is
 * never one on its own, but its time sets the due of the real one when that has none.
 */
export function mergeByGroup<T extends { whoId: string; what: string; due: { date: string; time: string | null } | null; messageIds: string[]; statusOnly: boolean; impliesItem: boolean; toId: string | null }>(
  cs: readonly T[],
  groups: ReadonlyMap<string, string>,
  texts: ReadonlyMap<string, string>,
): T[] {
  const byKey = new Map<string, T[]>();
  for (const c of cs) {
    const g = c.messageIds.map((id) => groups.get(id)).find(Boolean) ?? `solo:${c.messageIds[0] ?? c.what}`;
    const k = `${c.whoId.toLowerCase()}|${g}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const out: T[] = [];
  for (const list of byKey.values()) {
    const status = (c: T) => c.statusOnly || (c.messageIds.length > 0 && c.messageIds.every((id) => isStatusStatement(texts.get(id) ?? "") && !hasPromisePhraseOutsideStatus(texts.get(id) ?? "")));
    const real = list.filter((c) => !status(c));
    if (!real.length) continue;
    const [first, ...rest] = real;
    const timed = list.find((c) => c.due?.time) ?? null;
    const due = first!.due?.time ? first!.due : timed?.due ? { date: first!.due?.date ?? timed.due.date, time: timed.due.time } : (first!.due ?? rest.find((c) => c.due)?.due ?? null);
    out.push({ ...first!, due, impliesItem: real.some((c) => c.impliesItem), toId: first!.toId ?? rest.find((c) => c.toId)?.toId ?? null, messageIds: [...new Set(list.flatMap((c) => c.messageIds))] });
  }
  return out;
}

const hasPromisePhraseOutsideStatus = (text: string) => /\b(i'?ll|i will|let me|i can)\b/i.test(text.replace(STATUS, ""));

// ---- rules-only promises (no AI) ----

/** "I'll", "I will", "let me", "tonight": the first commitment phrase in a message of mine, or null (status statements aside). */
export function promisePhrase(text: string, phrases: readonly string[]): string | null {
  if (isStatusStatement(text) && !hasPromisePhraseOutsideStatus(text)) return null;
  return phrases.find((p) => hasPhrase(text, p)) ?? null;
}

/** The "what" of a promise without AI: the sentence with the phrase, cleaned up, at most 80 characters. */
export function promiseWhatWithoutAi(text: string, phrase: string): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const hit = sentences.find((s) => hasPhrase(s, phrase)) ?? sentences[0] ?? text;
  return oneLine(hit, 80);
}

// ---- status, wind-down, views ----

/** The status from facts: a person's Resolve or Not a request stands; a linked item tracks it; an open commitment; a Cooptimizer's reply. */
export function statusOf(c: Pick<Conversation, "status" | "itemId" | "closedAt">, o: { openCommitment: boolean; cooptimizerSpoke: boolean }): ConversationStatus {
  if (c.closedAt && (c.status === "resolved" || c.status === "closed")) return c.status;
  if (c.itemId) return "tracked";
  if (o.openCommitment) return "committed";
  return o.cooptimizerSpoke ? "discussion" : "new";
}

export const STATUS_WORD: Record<ConversationStatus, string> = { new: "New", discussion: "In discussion", committed: "Committed", tracked: "Tracked", resolved: "Resolved", closed: "Closed" };

/** A conversation's status line: "Eric committed", "Tracked #1234", "Waiting on Eric · 1 day". */
export function statusLine(c: Pick<Conversation, "status" | "itemId">, committer: string | null, waiting: { name: string; days: number } | null): string {
  if (waiting) return `Waiting on ${waiting.name} · ${waiting.days} day${waiting.days === 1 ? "" : "s"}`;
  if (c.status === "committed" && committer) return `${committer} committed`;
  if (c.status === "tracked" && c.itemId) return `Tracked #${c.itemId}`;
  return STATUS_WORD[c.status];
}

/** The follow-through pause: a conversation with no new message this long has paused. */
export const PAUSE_MINUTES = 30;
/**
 * Whether to draft a DevOps comment now: a linked item, a meaningful change not suggested yet, and the conversation
 * paused (30 minutes quiet) or resolved; at most one a day per item unless it resolved.
 */
export function suggestionDue(c: Pick<Conversation, "itemId" | "itemChange" | "lastAt" | "status">, now: string, suggestedToday: boolean): boolean {
  if (!c.itemId || !c.itemChange) return false;
  const resolved = c.status === "resolved";
  if (suggestedToday && !resolved) return false;
  return resolved || Date.parse(now) - Date.parse(c.lastAt) >= PAUSE_MINUTES * 60_000;
}

/**
 * When an item a commitment implies counts as waiting (escalation): the same time on the committer's next working day
 * after it was made (their hours, PTO days skipped); at once when they're on PTO the day it was made.
 */
export function escalateAt(createdAt: string, hours: TimeModel, ptoDays: ReadonlySet<string>): string {
  const zone = userZone(hours);
  const made = Temporal.Instant.from(createdAt).toZonedDateTimeISO(zone);
  if (ptoDays.has(made.toPlainDate().toString())) return createdAt;
  let d = made.toPlainDate();
  for (let i = 0; i < 21; i++) {
    d = d.add({ days: 1 });
    if (ptoDays.has(d.toString())) continue;
    const segs = hoursOn(hours, d.toString()).segments;
    if (!segs.length) continue;
    const start = Temporal.PlainTime.from(segs[0]!.start);
    const end = Temporal.PlainTime.from(segs.at(-1)!.end);
    let t = made.toPlainTime();
    if (Temporal.PlainTime.compare(t, start) < 0) t = start;
    if (Temporal.PlainTime.compare(t, end) > 0) t = end;
    return d.toZonedDateTime({ timeZone: zone, plainTime: t }).toInstant().toString();
  }
  return made.add({ days: 1 }).toInstant().toString();
}

/** Whole days waited since the escalation time, at least 1. */
export const daysWaiting = (escalatedAt: string, now: string) => Math.max(1, 1 + Math.floor((Date.parse(now) - Date.parse(escalatedAt)) / 86_400_000));

/** Why messages wait unsorted, in a few plain words (no ids, nothing from a message). A $0 cap isn't "reached". */
export type UnsortedReason = AiErrorKind | "chat_cap" | "unknown_ref" | "zero_budget";
export function unsortedText(k: string | null, clientName: string): string {
  switch (k) {
    case "off": return "AI is off";
    case "client_off": return `AI isn't allowed for ${clientName}`;
    case "not_set_up": return "AI isn't set up";
    case "zero_budget": return "AI budget is set to $0";
    case "over_budget": return "AI budget reached for this month";
    case "chat_cap": return "This chat reached its AI limit for today";
    case "refused_client": return "it mentions another client";
    case "refused_secret": return "it contains something that looks like a key or secret";
    case "refused_email": return "it contains an email address";
    case "invalid_output":
    case "unknown_ref": return "the AI's answer wasn't usable";
    case "rate_limited": return "the AI service was busy";
    case "quota": return "the AI service is out of credit";
    case "timeout": return "the AI service didn't answer in time";
    default: return "the AI service couldn't answer";
  }
}
