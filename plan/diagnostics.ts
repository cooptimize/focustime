// DX-1: Settings › Data › Diagnostics. Pure rules for two counts-only checks QF-1 left open (Q-QF1-1, Q-QF1-3), over
// the signed-in person's own chats only. Nothing here reads or returns message text: the callers pass facts (states,
// ids, places, whether a message of mine has a promise phrase), and what comes back is codes, counts, and for my own
// conversations their client and title (never a message). The copy text has counts only: no titles, no chat names.
import type { CommitmentState, ConversationStatus, MessagePlace } from "./conversations.ts";
import { CONVERSATION_STATUSES, unsortedLine } from "./conversations.ts";

/**
 * Why a "committed" conversation has no promise of mine in Promises or Needs you. `shown` and `someone_else` are not
 * gaps (it is in Promises, or someone else committed); the rest are.
 */
export const PROMISE_REASONS = [
  "shown",
  "someone_else",
  "no_open_commitment",
  "who_unknown",
  "my_name_other_id",
  "same_first_name_other_user",
  "filtered",
] as const;
export type PromiseReason = (typeof PROMISE_REASONS)[number];

export const PROMISE_REASON_WORDS: Record<PromiseReason, string> = {
  shown: "In Promises (no gap)",
  someone_else: "Someone else committed (no gap)",
  no_open_commitment: "No open commitment row: the status is out of date",
  who_unknown: "The commitment has no person id",
  my_name_other_id: "My name, but another person id (a second account or a guest copy)",
  same_first_name_other_user: "Another FocusTime user with my first name",
  filtered: "My promise exists but the Inbox leaves it out",
};

/** A gap is a reason that isn't "shown" or "someone else". */
export const isPromiseGap = (r: PromiseReason) => r !== "shown" && r !== "someone_else";

/**
 * Why a message of mine that reads like a promise ("I will", my promise phrases) has no commitment of mine. Codes
 * only; `unsorted:<reason>` keeps the pipeline's own reason.
 */
export type ExtractionReason =
  | "not_placed"
  | `unsorted:${string}`
  | `chatter:${string}`
  | "ack"
  | "in_conversation"
  | "work_no_conversation"
  | "other_id";

export function extractionWords(r: string): string {
  if (r === "not_placed") return "Not sorted yet (no place)";
  if (r.startsWith("unsorted:")) return `Waiting unsorted: ${unsortedLine(r.slice(9), "the client").text}`;
  if (r.startsWith("chatter:")) return `Filtered as chatter (${chatterWord(r.slice(8))})`;
  if (r === "ack") return "Read as an acknowledgement";
  if (r === "in_conversation") return "In a conversation, but no commitment came out of it";
  if (r === "work_no_conversation") return "Work, in no conversation, with no commitment";
  if (r === "other_id") return "A commitment holds it, under another person id";
  return r;
}

/** Retry only helps a message waiting for a reason that passes on its own (busy, timed out, the chat's cap...). */
export const extractionRetry = (r: string) => r.startsWith("unsorted:") && unsortedLine(r.slice(9), "").does === "retry";

// ---- the promises check ----

export type CommitmentFact = { id: number; whoId: string | null; whoName: string; state: CommitmentState };
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const firstName = (s: string | null | undefined) => lower(s).split(/\s+/)[0] ?? "";

/**
 * One committed conversation's reason. The status line names the first open commitment's first name (CV-1's cards),
 * while Promises lists commitments whose who id is mine (`commitmentsBy`), so the reasons follow those two facts.
 */
export function promiseReason(
  commitments: readonly CommitmentFact[],
  me: { id: string; name: string },
  o: { otherUserIds: ReadonlySet<string>; shownIds: ReadonlySet<number> },
): PromiseReason {
  const open = commitments.filter((k) => k.state === "open");
  const mine = open.filter((k) => lower(k.whoId) === lower(me.id));
  if (mine.length) return mine.some((k) => o.shownIds.has(k.id)) ? "shown" : "filtered";
  const committer = open[0];
  if (!committer) return "no_open_commitment";
  if (!committer.whoId) return firstName(committer.whoName) === firstName(me.name) ? "who_unknown" : "someone_else";
  if (firstName(committer.whoName) !== firstName(me.name)) return "someone_else";
  return o.otherUserIds.has(lower(committer.whoId)) ? "same_first_name_other_user" : "my_name_other_id";
}

/** Why a promise-sounding message of mine has no commitment of mine, from its place and the chat's commitments. */
export function extractionReason(place: MessagePlace | null, heldBy: { whoId: string | null } | null): ExtractionReason {
  if (heldBy) return "other_id";
  if (!place) return "not_placed";
  if (place.role === "unsorted") return `unsorted:${place.reason ?? "unknown"}`;
  if (place.role === "chatter") return place.reason === "ack" ? "ack" : `chatter:${chatterKind(place)}`;
  if (place.role === "ack") return "ack";
  return place.conversationId !== null ? "in_conversation" : "work_no_conversation";
}

// ---- the chatter filter check ----

/** How a chatter place got there: a keyword rule (GIF, sticker, emoji, empty, a short ack), the AI, Social chat or a person. */
export type ChatterKind = "rule" | "ai" | "social" | "not_work" | "other";
export function chatterKind(p: Pick<MessagePlace, "reason" | "placedBy">): ChatterKind {
  const r = p.reason ?? "";
  if (r.startsWith("not_work:")) return "not_work";
  if (r === "social") return "social";
  if (r === "ai" || p.placedBy === "ai") return "ai";
  if (["gif", "sticker", "emoji", "empty", "ack"].includes(r)) return "rule";
  return "other";
}
const chatterWord = (k: string) => ({ rule: "a keyword rule", ai: "the AI", social: "Social chat", not_work: "Not work-related", other: "other" })[k] ?? k;

/** DX-1: "This is work" marks the place it makes, so Diagnostics can count it apart from Move and Split. */
export const IS_WORK_PLACE = "is_work";

export type ChatOutcomes = {
  /** Sorted into a conversation (work or a wind-down ack), by who placed it. */
  sorted: { ai: number; rules: number; person: number };
  /** Work with no conversation (a rules-only promise's own messages). */
  workNoConversation: number;
  chatter: { rule: number; ai: number; social: number; notWork: number; other: number };
  /** Waiting unsorted, by the pipeline's reason. */
  unsorted: Record<string, number>;
  /** Stored but not placed yet. */
  notPlaced: number;
};
export type ChatMarks = { thisIsWork: number; movedByMe: number; notWorkMessages: number; notWorkConversations: number };

export const emptyOutcomes = (): ChatOutcomes => ({ sorted: { ai: 0, rules: 0, person: 0 }, workNoConversation: 0, chatter: { rule: 0, ai: 0, social: 0, notWork: 0, other: 0 }, unsorted: {}, notPlaced: 0 });

/**
 * One chat's last 14 days: each stored message's outcome (by its place) and my own marks. `messageIds` are the stored
 * messages in the window; `places` may hold more (they're filtered to the window by their time).
 */
export function chatOutcomes(
  messageIds: readonly string[],
  places: readonly (MessagePlace & { byUser?: string | null })[],
  since: string,
  me: string,
): { outcomes: ChatOutcomes; marks: ChatMarks } {
  const o = emptyOutcomes();
  const marks: ChatMarks = { thisIsWork: 0, movedByMe: 0, notWorkMessages: 0, notWorkConversations: 0 };
  const inWindow = places.filter((p) => Date.parse(p.at) >= Date.parse(since));
  const placed = new Set(inWindow.map((p) => p.messageId));
  const notWorkConvs = new Set<string>();
  const mine = (p: { byUser?: string | null }) => lower(p.byUser) === lower(me);
  for (const p of inWindow) {
    if (p.role === "work" || p.role === "ack") {
      if (p.conversationId === null) o.workNoConversation++;
      else if (p.placedBy === "ai") o.sorted.ai++;
      else if (p.placedBy === "person") o.sorted.person++;
      else o.sorted.rules++;
      if (p.placedBy === "person" && mine(p)) {
        if (p.reason === IS_WORK_PLACE) marks.thisIsWork++;
        else marks.movedByMe++;
      }
    } else if (p.role === "chatter") {
      const k = chatterKind(p);
      o.chatter[k === "not_work" ? "notWork" : k]++;
      if (k === "not_work" && mine(p)) {
        marks.notWorkMessages++;
        notWorkConvs.add(p.reason!);
      }
    } else {
      const r = p.reason ?? "unknown";
      o.unsorted[r] = (o.unsorted[r] ?? 0) + 1;
    }
  }
  o.notPlaced = messageIds.filter((id) => !placed.has(id)).length;
  marks.notWorkConversations = notWorkConvs.size;
  return { outcomes: o, marks };
}

// ---- the result and its copy text ----

export type PromiseRow = { conversationId: number; clientName: string; title: string; reason: PromiseReason };
export type ExtractionRow = { clientName: string; title: string; reason: string; retry: boolean };
export type ChatRow = { chatName: string; clientName: string; kind: "delivery" | "customer" | string; social: boolean; total: number; outcomes: ChatOutcomes; marks: ChatMarks };

export type Diagnostics = {
  at: string;
  days: number;
  promises: {
    byStatus: Record<ConversationStatus, number>;
    committed: number;
    byReason: Record<PromiseReason, number>;
    /** Gaps only, each my own conversation's client and title. */
    rows: PromiseRow[];
    /** My promise-sounding messages in the window with no commitment of mine, by reason. */
    extraction: { checked: number; byReason: Record<string, number>; rows: ExtractionRow[] };
  };
  chats: ChatRow[];
  /** IB-4: the slim Inbox in the window, counts only (optional: older builds' answers have none). */
  inbox?: InboxCounts;
};

/** IB-4: suggestions shown to me and what became of them; my chat promises and how they ended. Counts only. */
export type InboxCounts = {
  suggestions: { shown: number; created: number; linked: number; dismissed: number; wrappedUp: number; expired: number };
  promises: { found: number; done: number; byItem: number; expired: number; putBack: number };
};

/** One suggestion's facts for the count: my mark on it and its conversation now. */
export type SuggestionFact = { suggestedAt: string; outcome: string | null; itemId: number | null; windDown: boolean; closedAt: string | null; lastWorkAt: string };
/** One of my chat promises: when it was found, its state now, and my mark's clearing and put back. */
export type PromiseFact = { createdAt: string; state: string; cleared: "item" | "expired" | null; clearedAt: string | null; putBackAt: string | null };

/**
 * IB-4: the slim Inbox's counts since `since`. A suggestion counts once, by what happened: Create item (an item with no
 * Link), Already covered (linked), Dismiss, wrapped up in the chat, or expired (quiet more than 7 days with none of these).
 * One left open is only "shown". A promise found in the window counts as found; done, cleared and put back count by
 * when they happened.
 */
export function inboxCounts(s: readonly SuggestionFact[], p: readonly PromiseFact[], since: string, now: string): InboxCounts {
  const after = (t: string | null) => !!t && Date.parse(t) >= Date.parse(since);
  const week = 7 * 24 * 3600_000;
  const sug = { shown: 0, created: 0, linked: 0, dismissed: 0, wrappedUp: 0, expired: 0 };
  for (const x of s) {
    if (!after(x.suggestedAt)) continue;
    sug.shown++;
    if (x.outcome === "linked") sug.linked++;
    else if (x.outcome === "dismissed") sug.dismissed++;
    else if (x.itemId !== null) sug.created++;
    else if (x.windDown || x.closedAt) sug.wrappedUp++;
    else if (Date.parse(now) - Date.parse(x.lastWorkAt) > week) sug.expired++;
  }
  const pr = { found: 0, done: 0, byItem: 0, expired: 0, putBack: 0 };
  for (const x of p) {
    if (after(x.createdAt)) pr.found++;
    if (x.cleared === "item" && after(x.clearedAt)) pr.byItem++;
    else if (x.cleared === "expired" && after(x.clearedAt)) pr.expired++;
    else if (x.state === "done" && !x.cleared) pr.done++;
    if (after(x.putBackAt)) pr.putBack++;
  }
  return { suggestions: sug, promises: pr };
}

export const zeroReasons = (): Record<PromiseReason, number> => Object.fromEntries(PROMISE_REASONS.map((r) => [r, 0])) as Record<PromiseReason, number>;
export const zeroStatuses = (): Record<ConversationStatus, number> => Object.fromEntries(CONVERSATION_STATUSES.map((s) => [s, 0])) as Record<ConversationStatus, number>;

const pairs = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none";

/** "Copy as text": counts only. Chats are numbered with their kind; no title, chat name or client name. */
export function diagnosticsText(d: Diagnostics): string {
  const lines = [
    `FocusTime diagnostics, ${d.at.slice(0, 10)} (my own chats only, counts only)`,
    "",
    "Promises check",
    `Conversations by status: ${pairs(d.promises.byStatus)}`,
    `Committed: ${d.promises.committed}; by reason: ${pairs(d.promises.byReason)}`,
    `Promise-sounding messages of mine, last ${d.days} days: ${d.promises.extraction.checked}; with no commitment of mine, by reason: ${pairs(d.promises.extraction.byReason)}`,
    "",
    ...(d.inbox ? [
      "",
      `Inbox, last ${d.days} days`,
      `Suggestions shown: ${d.inbox.suggestions.shown}; created ${d.inbox.suggestions.created}, linked ${d.inbox.suggestions.linked}, dismissed ${d.inbox.suggestions.dismissed}, wrapped up in chat ${d.inbox.suggestions.wrappedUp}, expired ${d.inbox.suggestions.expired}`,
      `Promises found in chats: ${d.inbox.promises.found}; marked done ${d.inbox.promises.done}, cleared by a finished item ${d.inbox.promises.byItem}, expired untouched ${d.inbox.promises.expired}, put back ${d.inbox.promises.putBack}`,
    ] : []),
    "",
    `Chatter filter check, last ${d.days} days`,
  ];
  d.chats.forEach((c, i) => {
    const o = c.outcomes;
    lines.push(
      `Chat ${i + 1} (${c.kind}${c.social ? ", Social chat" : ""}): ${c.total} messages`,
      `  sorted to a conversation: by AI ${o.sorted.ai}, by rules ${o.sorted.rules}, by a person ${o.sorted.person}; work with no conversation ${o.workNoConversation}`,
      `  chatter: keyword rule ${o.chatter.rule}, AI ${o.chatter.ai}, Social chat ${o.chatter.social}, Not work-related ${o.chatter.notWork}, other ${o.chatter.other}`,
      `  unsorted: ${pairs(o.unsorted)}; not placed yet ${o.notPlaced}`,
      `  my marks: This is work ${c.marks.thisIsWork}, moved or split ${c.marks.movedByMe}, Not work-related ${c.marks.notWorkConversations} conversations (${c.marks.notWorkMessages} messages)`,
    );
  });
  if (!d.chats.length) lines.push("No registered chats I'm in.");
  return lines.join("\n");
}
