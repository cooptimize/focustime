// Part 0: who is on a conversation, shared by everyone who can see it. Pure. One record per conversation: an owner (none,
// or one Cooptimizer, plus helpers), a state derived from it (Closed from closed_at, Owned from the claim, else Open),
// and a history. What each person sees is worked out from that record and from what is true only for them (asked by
// name, their own promise). A reply or a detected "I'll do it" never claims: it offers one tap.

export type SharedState = "open" | "owned" | "closed";
export type Person = { id: string; name: string };

/** What the record holds, as Conversation carries it. */
export type Ownership = { claimedBy: string | null; claimedName: string | null; claimedAt: string | null; helpers: Person[]; closedAt: string | null };

export const sharedState = (o: Pick<Ownership, "claimedBy" | "closedAt">): SharedState => (o.closedAt ? "closed" : o.claimedBy ? "owned" : "open");

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "Someone";

/** One person's view of the shared record. */
export type PersonView = "asked_you" | "up_for_grabs" | "yours" | "teammate" | "done";

export function personView(o: Pick<Ownership, "claimedBy" | "closedAt" | "helpers">, me: string, askedMe: boolean): PersonView {
  const state = sharedState(o);
  if (state === "closed") return "done";
  if (state === "owned") return same(o.claimedBy, me) || o.helpers.some((h) => same(h.id, me)) ? "yours" : "teammate";
  return askedMe ? "asked_you" : "up_for_grabs";
}

export type ConversationPlace = "needs" | "progress" | "teammates" | "closed";

/**
 * Where a person view sits in today's Inbox views. An Open conversation with a linked item stays In progress (CV-5),
 * and something waiting for my own decision (a suggestion for me) still needs me.
 */
export function placeOf(view: PersonView, o: { hasItem: boolean; suggestionForMe: boolean }): ConversationPlace {
  switch (view) {
    case "done": return "closed";
    case "teammate": return "teammates";
    case "yours": return o.suggestionForMe ? "needs" : "progress";
    case "asked_you":
    case "up_for_grabs": return o.hasItem && !o.suggestionForMe ? "progress" : "needs";
  }
}

/** The one-tap offer: I wrote in it, or said I'd do it, and nobody has it. Never claims by itself. */
export type ClaimOffer = "replied" | "committed";
export const offerOf = (state: SharedState, f: { replied: boolean; committed: boolean }): ClaimOffer | null => (state !== "open" ? null : f.committed ? "committed" : f.replied ? "replied" : null);

// ---- the history ----

export const EVENT_KINDS = ["claim", "give", "helper", "release", "close", "reopen"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** How a claim came about: the one-tap offer, or the one-time backfill. */
export type EventVia = ClaimOffer | "backfill" | "take_over" | "asked_again";

/** The record just before a change (Undo puts it back). */
export type OwnershipBefore = {
  claimedBy: string | null; claimedName: string | null; claimedAt: string | null; helpers: Person[];
  status: string; closedBy: string | null; closedAt: string | null; closeReason: string | null;
};

export type OwnershipEvent = {
  id: number;
  conversationId: number;
  kind: EventKind;
  /** Null: nobody did it by hand (a new message reopened it, or the backfill). */
  byUser: string | null;
  byName: string;
  toUser: string | null;
  toName: string | null;
  via: EventVia | null;
  note: string | null;
  before: OwnershipBefore;
  at: string;
  undoneAt: string | null;
};

/** A line of the timeline, in plain words, as `me` reads it. */
export function eventLine(e: OwnershipEvent, me: string): string {
  const who = same(e.byUser, me) ? "You" : firstName(e.byName);
  const to = same(e.toUser, me) ? "you" : firstName(e.toName);
  switch (e.kind) {
    case "claim":
      if (e.via === "backfill") return `${same(e.toUser, me) ? "You had" : `${to} had`} it when shared owners began`;
      if (e.via === "replied") return `${who} took it after replying`;
      if (e.via === "committed") return `${who} took it after saying they'd do it`;
      return `${who} took it`;
    case "give": return `${who} gave it to ${to}`;
    case "helper": return `${who} added ${to} as a helper`;
    case "release": return `${who} released it`;
    case "close": return e.note ? `${who} closed it: ${e.note}` : `${who} closed it`;
    case "reopen": return e.note ?? `${who} reopened it`;
  }
}

/** Only the newest change that's still in force can be undone, and only by whoever made it. */
export function undoableEvent(events: readonly OwnershipEvent[], me: string): OwnershipEvent | null {
  const latest = [...events].filter((e) => !e.undoneAt).sort((a, b) => a.id - b.id).at(-1);
  return latest && same(latest.byUser, me) ? latest : null;
}

/** Who may give or release it: its owner or one of the client's leads, or anyone while nobody has it (give only). */
export const mayHandOff = (claimedBy: string | null, me: string, lead: boolean) => !claimedBy || same(claimedBy, me) || lead;

// ---- a new message on a closed conversation ----

/**
 * The person whose new message asks again: the latest author who is neither its last owner nor whoever closed it. Null
 * means it stays Closed (the people who closed it can write in the chat without reopening it).
 */
export function askedAgainBy<T extends { senderId: string | null; senderName: string | null }>(o: { claimedBy: string | null; closedBy: string | null }, messages: readonly T[]): T | null {
  return [...messages].reverse().find((m) => !same(m.senderId, o.claimedBy) && !same(m.senderId, o.closedBy)) ?? null;
}
export const reopenedLine = (name: string | null | undefined) => `Reopened: ${firstName(name)} asked again`;

// ---- the one-time backfill ----

export type BackfillOutcome = { kind: "closed" } | { kind: "owned"; owner: Person } | { kind: "open"; why: "in_progress" | "needs_you" | "no_teammate" };

/**
 * Where a conversation goes at the switch to shared owners. Closed stays Closed. A linked item (In progress), a new one,
 * or one that still asks a Cooptimizer by name (Needs you) stays Open. What's left was Handled by teammates, and goes to
 * the teammate who had it: the AI's owner, an open commitment's author, or the last Cooptimizer who spoke.
 */
// `mentioned`: the Cooptimizers named in its work messages, whether or not they have written in it themselves.
export function backfillOutcome(c: { closedAt: string | null; itemId: number | null; status: string; ownerId: string | null; participants: readonly (Person & { external: boolean })[] }, f: { openCommitters: readonly string[]; lastInternalSpeaker: string | null; mentioned: readonly string[] }): BackfillOutcome {
  if (c.closedAt) return { kind: "closed" };
  if (c.itemId) return { kind: "open", why: "in_progress" };
  if (c.status === "new") return { kind: "open", why: "needs_you" };
  const internal = (id: string | null) => (id ? (c.participants.find((p) => same(p.id, id) && !p.external) ?? null) : null);
  const owner = internal(c.ownerId) ?? f.openCommitters.map(internal).find(Boolean) ?? internal(f.lastInternalSpeaker);
  if (!owner) return { kind: "open", why: "no_teammate" };
  if (f.mentioned.some((id) => !same(id, owner.id))) return { kind: "open", why: "needs_you" };
  return { kind: "owned", owner: { id: owner.id, name: owner.name } };
}
