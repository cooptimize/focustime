// CV-1: what Inbox › Conversations and My promises show (here so the UI never imports server code). A card is a
// summary, never a transcript; "Show messages" asks for the messages on their own.
import type { CommitmentState, ConversationStatus, ItemDraft } from "./conversations.ts";

export type CardPerson = { name: string; external: boolean; me: boolean };
export type CardItem = { id: number; title: string | null; url: string | null };
export type CardCommitment = { id: number; whoName: string; mine: boolean; what: string; dueAt: string | null; dueDate: string | null; state: CommitmentState; impliesItem: boolean; item: CardItem | null };
export type CardSuggestion = { id: number; kind: "comment" | "description"; itemId: number; body: string; internal: string[]; fromInternalChat: boolean; mine: boolean };
export type Primary = "create" | "link" | "resolve" | "take_over" | "reopen";

export type ConversationCard = {
  id: number;
  clientKey: string;
  clientName: string;
  chatId: string;
  chatName: string;
  /** An internal delivery chat (its content is flagged before it goes to a client's DevOps). */
  internalChat: boolean;
  title: string;
  summary: string;
  status: ConversationStatus;
  statusLine: string;
  participants: CardPerson[];
  lastAt: string;
  /** "Updated" with what changed since I last looked (null: nothing new for me). */
  updated: string | null;
  windDown: boolean;
  item: CardItem | null;
  likely: CardItem | null;
  /** Amber "Waiting on <Name> · 1 day" for everyone on the client. */
  waiting: { name: string; days: number } | null;
  /** Escalated, and nobody took it over: shown to the client's leads in Needs you. */
  unclaimed: boolean;
  owner: string | null;
  mentionsMe: boolean;
  commitments: CardCommitment[];
  suggestions: CardSuggestion[];
  closed: { kind: "resolved" | "not_request"; by: string; at: string; reason: string | null } | null;
  hidden: boolean;
  primary: Primary | null;
  canCreate: boolean;
  link: string;
};

export type FilteredMessage = { chatId: string; messageId: string; author: string; at: string; text: string };
export type ConversationsData = {
  needsYou: ConversationCard[];
  teammates: ConversationCard[];
  closed: ConversationCard[];
  hiddenCount: number;
  /** Messages waiting for AI, by reason ("AI budget is set to $0"). */
  unsorted: { count: number; reasons: { text: string; count: number }[] };
  /** Per client: "Filtered as chatter (N)", newest first. */
  chatter: { clientKey: string; clientName: string; messages: FilteredMessage[] }[];
  myPromisesOpen: number;
  lastPoll: string | null;
  writeClients: string[];
};

export type ConversationMessage = { messageId: string; author: string; external: boolean; mine: boolean; at: string; html: string; text: string };

/** One of my promises (my own commitment), as My promises and Today show it. */
export type PromiseCard = {
  id: number;
  conversationId: number | null;
  conversationTitle: string | null;
  clientKey: string;
  clientName: string;
  chatName: string;
  what: string;
  toName: string | null;
  dueAt: string | null;
  dueDate: string | null;
  overdue: boolean;
  state: CommitmentState;
  onToday: string | null;
  followUpId: number | null;
  item: CardItem | null;
  /** "Create the DevOps item?": the commitment implies one and none is created or linked yet. */
  needsItem: boolean;
  draft: ItemDraft | null;
  /** An item I changed since I committed that may be it (for Link existing). */
  likely: CardItem | null;
  /** A comment suggested for an item I own, from this conversation. */
  suggestions: CardSuggestion[];
  waitingDays: number | null;
  reason: string | null;
  messages: { at: string; text: string }[];
  link: string;
  createdAt: string;
};

export type MyPromisesData = { promises: PromiseCard[]; open: number; today: string; writeClients: string[] };

/** A promise with a due, as Today and Week place it (my day only). */
export type DayPromise = { id: number; what: string; toName: string | null; clientKey: string; clientName: string; dueAt: string | null; dueDate: string; overdue: boolean };
