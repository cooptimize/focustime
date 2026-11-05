// AS-1: the FocusTime assistant's interface, shared by the in-app panel and the Teams bot (TB-1). Locked: TB-1 codes
// against this file and docs/assistant-interface.md. Any change is noted there under "Changes". Types only.
//
// One service (assistant/service.ts) answers both front ends. It only calls allowlisted actions from the registry
// (assistant/allowlist.ts): reads answer at once; every write becomes a Proposal with the same preview the button
// shows, and runs only on confirm(), which re-checks permissions, the client and freshness first.

/** Who is asking: the signed-in person's Entra object id. The server builds their ActionContext from it; a front end
 * never passes anything else about the person. TB-1 maps the Teams user to this oid (same tenant) itself. */
export type Person = { userId: string };

export type Channel = "panel" | "teams";

/** What the person is looking at. Nothing else about the screen is sent to the model unless an action reads it. */
export type AssistantContext = {
  /** The app address of the screen ("#/week", "#/ahead/plan"), or a short name for Teams ("teams"). */
  screen?: string;
  /** The client in focus: the selected block's or item's client. */
  clientKey?: string;
  /** The selected DevOps item. */
  itemId?: number;
  /** The selected block. */
  block?: { date: string; half: "AM" | "PM" };
  /** The person's today (their zone), YYYY-MM-DD; the server's own today in their zone when absent. */
  date?: string;
};

export type HandleInput = { person: Person; channel: Channel; text: string; context?: AssistantContext };

/**
 * ok: answered (reply, cards, proposals). off: AI for FocusTime is off. client_off: the client in the request isn't
 * allowed AI ("The assistant is off for <client>"). not_set_up: no provider key. over_budget: a cap (the person's or
 * the app's) is reached or set to $0. refused: the guard refused the request (another client's data, a secret, an
 * outside address). which_client: the request names two clients; nothing was sent. For every status but ok the reply
 * says why in plain words, and links has the command menu ("Open the command menu", href "#/commands").
 */
export type HandleStatus = "ok" | "off" | "client_off" | "not_set_up" | "over_budget" | "refused" | "which_client";

export type Link = {
  label: string;
  /** In the panel an app address ("#/ahead?item=4417"); in Teams the same address on the public URL
   * ("https://focustime.example.com/#/ahead?item=4417"). */
  href: string;
};

export type ItemCard = {
  kind: "item";
  clientKey: string;
  clientName: string;
  id: number;
  title: string;
  type: string;
  state: string;
  owner: string | null;
  start: string | null;
  target: string | null;
  /** Open children (a feature's stories, an epic's features), at most 10. */
  children: { id: number; title: string; state: string; owner: string | null }[];
  link: Link;
  devopsUrl: string | null;
};

export type BlockCard = {
  kind: "block";
  clientKey: string;
  clientName: string;
  date: string;
  half: "AM" | "PM";
  /** "9:00 to 12:00". */
  time: string;
  /** "At risk · Dentist 12:00", "Fits", "Too much planned". */
  status: string;
  picks: { id: number; title: string; done: boolean; size: string }[];
  link: Link;
};

export type PickCard = { kind: "pick"; id: number; clientKey: string; clientName: string; title: string; date: string; half: "AM" | "PM"; time: string | null; done: boolean; link: Link };

export type SendCard = { kind: "send"; id: number; clientKey: string; clientName: string; title: string; to: string; from: string; tier: "suggested" | "must"; weekStart: string; state: string; link: Link };

export type PromiseCard = { kind: "promise"; id: number; clientKey: string; clientName: string; who: string; what: string; toWhom: string | null; due: string | null; link: Link };

/** A line with no card of its own ("Close out isn't done yet"). */
export type NoteCard = { kind: "note"; text: string; link?: Link };

export type Card = ItemCard | BlockCard | PickCard | SendCard | PromiseCard | NoteCard;

/** One row of a preview: a field and its value before and after (null: none). */
export type PreviewRow = { label: string; before: string | null; after: string | null };

/** The same preview the button shows: what changes, where, who it writes as and who can see it. */
export type PreviewView = {
  /** "Add a comment to a DevOps item", "Move a pick". */
  summary: string;
  /** "DevOps" for an external write; "FocusTime" for the plan (picks, the week, the change set, sends). */
  system: "DevOps" | "FocusTime";
  /** "#4417 Export the invoices" or "Pick: Export the invoices". */
  target: string;
  /** DevOps: "Your Name <you@cooptimize.com>"; FocusTime: null. */
  identity: string | null;
  rows: PreviewRow[];
  notes: string[];
};

export type ProposalState = "open" | "confirmed" | "cancelled" | "expired" | "failed";

export type Proposal = {
  id: number;
  /** The registry action confirm() will dispatch ("devops.confirm", "pick.move", "ahead.stage", "send.create"). */
  action: string;
  clientKey: string | null;
  clientName: string | null;
  /** "Comment on #4417", "Move to Thursday AM". */
  title: string;
  preview: PreviewView;
  /** "Everyone with access to the project can see the comment", "Only you", "Dana sees it in From your team". */
  whoSees: string;
  /** Before and after, the preview's rows as maps (for a front end that shows them as a list). */
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  /** 15 minutes after it was made; confirm() refuses after it ("expired"). */
  expiresAt: string;
  /** Fields confirm() takes in `edits` (a comment's "text", a description's "after", a pick's "date" and "half"). */
  editable: string[];
  state: ProposalState;
};

export type HandleResult = {
  turnId: number;
  status: HandleStatus;
  /** Short plain text. */
  reply: string;
  cards: Card[];
  proposals: Proposal[];
  links: Link[];
};

export type ConfirmInput = { person: Person; proposalId: number; edits?: Record<string, string> };

export type ConfirmResult =
  | { ok: true; result: Card; undo?: { kind: "devops" | "plan"; id: number }; message: string }
  /** changed: the target changed since the proposal (proposal is the fresh one to confirm again); not_allowed: a
   * permission or client check refused; expired: past expiresAt; gone: no such open proposal for this person. */
  | { ok: false; reason: "changed" | "not_allowed" | "expired" | "gone"; message: string; proposal?: Proposal };

export type CancelInput = { person: Person; proposalId: number };

export type TranscribeInput = { person: Person; audio: Uint8Array; mime: string; seconds: number; context?: AssistantContext };
export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: "off" | "client_off" | "not_set_up" | "over_budget" | "too_long" | "too_large" | "format" | "provider"; message: string };

export type Turn = { id: number; at: string; channel: Channel; role: "me" | "assistant"; text: string; cards: Card[]; proposals: Proposal[] };

/** The service both front ends call. */
export type Assistant = {
  handle(i: HandleInput): Promise<HandleResult>;
  confirm(i: ConfirmInput): Promise<ConfirmResult>;
  cancel(i: CancelInput): Promise<{ ok: true }>;
  transcribe(i: TranscribeInput): Promise<TranscribeResult>;
  history(i: { person: Person; limit?: number }): Promise<Turn[]>;
  clear(i: { person: Person }): Promise<{ ok: true; removed: number }>;
};

/** Limits both front ends rely on. */
export const PROPOSAL_MINUTES = 15;
export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORY_DAYS = 30;
export const MAX_TEXT = 2000;
