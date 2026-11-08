// CV-1: what Inbox › Conversations and My promises show (here so the UI never imports server code). A card is a
// summary, never a transcript; "Show messages" asks for the messages on their own.
import type { CommitmentState, ConversationStatus, ItemDraft } from "./conversations.ts";

export type CardPerson = { name: string; external: boolean; me: boolean };
export type CardItem = {
  id: number;
  title: string | null;
  url: string | null;
  /** CV-5: the linked item as the central store has it now (missing when DevOps can't say): state, assignee, last change. */
  state?: string;
  assignee?: string | null;
  changedAt?: string;
  /** Completed or Removed in DevOps: "Item closed" with Mark done (never done automatically). */
  closed?: boolean;
};
export type CardCommitment = { id: number; whoName: string; mine: boolean; what: string; dueAt: string | null; dueDate: string | null; state: CommitmentState; impliesItem: boolean; item: CardItem | null };
export type CardSuggestion = { id: number; kind: "comment" | "description"; itemId: number; body: string; internal: string[]; fromInternalChat: boolean; mine: boolean; /** GD-2 */ namesRemoved?: boolean };
export type Primary = "create" | "link" | "resolve" | "take_over" | "reopen" | "mark_done";

export type ConversationCard = {
  id: number;
  clientKey: string;
  clientName: string;
  chatId: string;
  chatName: string;
  /** An internal delivery chat (its content is flagged before it goes to a client's DevOps). */
  internalChat: boolean;
  /** GD-2 point 7: the other clients its messages name, by name ("mentions Wingtip"), for whoever can see it. */
  mentions?: string[];
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
  /** My DevOps write access for its client. CV-5: Create DevOps item shows either way; without it the form says how to turn writes on. */
  canCreate: boolean;
  link: string;
  /** CV-2: images pasted into its messages ("2 images" on the card). */
  images?: number;
  /** CV-4: the first image's AI description, for members of the chat ("1 image: refresh failed error"). */
  imageNote?: string;
};

export type FilteredMessage = { chatId: string; messageId: string; author: string; at: string; text: string };
export type ConversationsData = {
  needsYou: ConversationCard[];
  /** CV-5: open conversations with a linked item (a plain filter; IB-1 moves it into the rail). */
  inProgress: ConversationCard[];
  teammates: ConversationCard[];
  closed: ConversationCard[];
  hiddenCount: number;
  /** Messages waiting for AI, by reason ("AI budget is set to $0"). */
  /** IB-1 slice 3: each reason as its line (unsortedLine) with how many messages it holds. */
  unsorted: { count: number; reasons: { text: string; count: number; does?: "retry" | "switch" | "held"; fix?: string | null }[] };
  /** Per client: "Filtered as chatter (N)", newest first. */
  chatter: { clientKey: string; clientName: string; messages: FilteredMessage[] }[];
  myPromisesOpen: number;
  lastPoll: string | null;
  /** IB-1 slice 3: the registered chats I see (for the Chatter pane), and whether I'm a FocusTime admin. */
  chats?: { chatId: string; name: string; link: string; social: boolean }[];
  admin?: boolean;
  /** ADM-2 (D604): the Rule, for "every N minutes in working hours". */
  pollMinutes?: number;
  writeClients: string[];
  /** CV-2: a deep link's conversation: listed (and in which view), or not here any more (a plain note). */
  selected?: { id: number; found: boolean; where: "needs" | "progress" | "teammates" | "closed" | null };
  /** GD-2: how many messages the boundary holds back in my chats (opens the Held back list). */
  heldCount?: number;
};

/**
 * GD-2 Part 2: one message the boundary held back, as the chat's members see it: the chat, who wrote it, when, which
 * other client's name matched (only ever shown to members of that chat), and the message as Teams shows it.
 */
export type HeldMessage = {
  chatId: string;
  chatName: string;
  clientKey: string;
  clientName: string;
  messageId: string;
  author: string;
  at: string;
  /** GD-3: the words it matched, as the message has them (marked in `html`). Empty: no record, `reason` says so. */
  matched: string[];
  /** GD-3: "Mentions Harbor Health", or "Reason unknown". */
  reason: string;
  html: string;
  text: string;
  /** Why, in plain words. */
  why: string;
};
export type HeldData = { messages: HeldMessage[]; /** Each chat's open conversations, to sort a message into by hand. */ conversations: Record<string, { id: number; title: string }[]>; /** GD-3: how many are held per client, for the bulk actions (all of them, even past the list's limit). */ clients: { clientKey: string; clientName: string; count: number }[] };

/**
 * One message under Show messages (CV-2: rendered like Teams). `authorKey` groups consecutive messages (an alias for
 * this list, never an id); `email` only for a Cooptimizer, for their photo; `quote` the message it replies to (null
 * fields: "Quoted an earlier message"); `reactions` as counts, never who.
 */
export type ConversationMessage = {
  messageId: string;
  author: string;
  authorKey: string;
  name: string;
  email: string | null;
  external: boolean;
  mine: boolean;
  at: string;
  html: string;
  text: string;
  quote: { author: string | null; text: string | null } | null;
  reactions: { emoji: string; count: number }[];
  /** CV-2: its pasted images, in body order: FocusTime's own address for each (never Graph's), or why it isn't shown. */
  images?: MessageImageView[];
};
/**
 * CV-2: `src` is FocusTime's own address (read from Teams on view, CV-4), `note` why it isn't shown. CV-4: `link`
 * opens the message in Teams (shown when the image can't be read now), `description` is the AI's, when there is one.
 */
export type MessageImageView = { id: number; src: string | null; note: string | null; link?: string; description?: string };
/** CV-2: an image's address in FocusTime (the only one the page ever sees). */
export const chatImageSrc = (id: number) => `/media/chat-images/${id}`;
/** A page of Show messages: the latest first; `earlier` is the message id to ask "Show earlier" from (null: none). */
export type ConversationMessages = { messages: ConversationMessage[]; chatLink: string; earlier: string | null; total: number };

/** One of my promises (my own commitment), as My promises and Today show it. */
export type PromiseCard = {
  id: number;
  conversationId: number | null;
  /** CV-2: the one it was made to, for the PersonPicker (null: nobody known). */
  toRef: import("./person-ref.ts").PersonRef | null;
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
