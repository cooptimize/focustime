// FN-1: the story card. One DevOps work item as FocusTime shows it in a modal (never a link out): what DevOps holds
// (read fresh, a short cache), and what FocusTime knows about it (to-dos, timeboxes, promises). Pure types and rules;
// the read is sources/devops (itemCard) and the action is actions/item-card-actions.ts.

/** A related item on the card: the parent feature, the epic above it, or a child. */
export type CardLink = { id: number; title: string; type: string; state: string | null };

/** A comment as the card shows it: the author's name, when, and the body as sanitized HTML. */
export type CardComment = { id: number; author: string; at: string; html: string };

/** What the DevOps read gives, before FocusTime's own context. HTML fields are raw here and sanitized by the action. */
export type CardRead = {
  id: number;
  title: string;
  type: string;
  state: string;
  /** The state's category in the process model (Proposed, InProgress, Resolved, Completed, Removed), for its colour. */
  stateCategory: string | null;
  /** The type's states in the process's order (Change state offers these). */
  states: { name: string; category: string }[];
  assignee: string | null;
  iteration: string | null;
  area: string | null;
  /** The type's own size field ("Story Points", "Effort", ...) and its number, when the type has one. */
  size: { label: string; value: number | null } | null;
  /** Remaining Work in hours, when the type has the field. */
  remainingWork: number | null;
  hasRemainingWork: boolean;
  start: string | null;
  target: string | null;
  descriptionHtml: string;
  acceptanceHtml: string;
  /** TP-1: the item's DevOps tags (the request type tag among them). */
  tags?: string[];
  parent: CardLink | null;
  /** The parent's parent (the epic over a feature), when there is one. */
  grandparent: CardLink | null;
  children: CardLink[];
  /** Newest first; at most COMMENTS_MAX. */
  comments: { id: number; author: string; at: string; text: string }[];
  /** The total DevOps reports, which may be more than were read. */
  commentCount: number;
  url: string;
  changedAt: string | null;
  /** The process model says this type is broken down into child items (Break down is offered). */
  breakDown: boolean;
};

/** How many comments the card shows before "Show all", and how many it reads at most. */
export const COMMENTS_SHOWN = 5;
export const COMMENTS_MAX = 50;

/** FocusTime's own context for an item: my to-dos and their timeboxes, my promises linked to it. */
export type CardTodo = { id: number; date: string; half: "AM" | "PM" | "EVE"; status: string; title: string; timebox: string | null; leftMinutes: number | null };
export type CardPromise = { key: string; what: string; due: string | null; state: string };

export type ItemCard = Omit<CardRead, "comments" | "descriptionHtml" | "acceptanceHtml"> & {
  clientKey: string;
  clientName: string;
  /** TP-1: the four lines read out of the description (plain text each, null when empty), shown as one block above the rest. */
  lines?: { key: "where" | "change" | "check" | "done"; name: string; text: string | null }[] | null;
  /** TP-1: the request type the item's tag names (the team's name for it), or null. */
  requestType?: string | null;
  /** TP-1: the quiet chip: "Ready" or "Missing: How we'll check"; null for an item never written this way. */
  readiness?: { ready: boolean; text: string } | null;
  /** The description without the four lines' sections, when they were found (else the whole description). */
  description: string;
  acceptance: string;
  comments: CardComment[];
  todos: CardTodo[];
  promises: CardPromise[];
  /** My write PAT for this client: the card's writes are offered. */
  canWrite: boolean;
  writeNote: string | null;
  /** When this was read from DevOps (the card says how fresh it is). */
  readAt: string;
};

/** A work item's id from its DevOps edit URL (…/_workitems/edit/<id>), or null. */
export function itemIdOfUrl(url: string | null | undefined): number | null {
  const m = /\/_workitems\/edit\/(\d{1,10})(?:[/?#]|$)/i.exec(url ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The card's address: #/item/<client>/<id>. Client keys are encoded; ids are positive integers. */
export function cardHash(clientKey: string, itemId: number): string {
  return `#/item/${encodeURIComponent(clientKey)}/${itemId}`;
}

/** A state's colour class from its category (never its name): new, active, resolved, done, removed. */
export function stateTone(category: string | null): "new" | "active" | "resolved" | "done" | "removed" | "other" {
  switch (category) {
    case "Proposed": return "new";
    case "InProgress": return "active";
    case "Resolved": return "resolved";
    case "Completed": return "done";
    case "Removed": return "removed";
    default: return "other";
  }
}
