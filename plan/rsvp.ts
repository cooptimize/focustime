// Meeting RSVP (step 16, D283 and D284). Pure: which meetings I can answer, the exact request Graph gets, the words for
// a response, and the quiet hint when a meeting overlaps a focus block. The meeting itself is never edited: only the
// three response endpoints (accept, tentativelyAccept, decline) are ever called.
import { RSVP_RESPONSES, type RsvpResponse } from "./timebox.ts";

export { RSVP_RESPONSES, type RsvpResponse };
export const isRsvpResponse = (v: unknown): v is RsvpResponse => typeof v === "string" && (RSVP_RESPONSES as readonly string[]).includes(v);

/** The Graph action per response. */
export const RSVP_ENDPOINT: Record<RsvpResponse, "accept" | "tentativelyAccept" | "decline"> = { accepted: "accept", tentativelyAccepted: "tentativelyAccept", declined: "decline" };

/** Words for my response, any of Graph's values. */
export function responseLabel(r: string | null | undefined): string {
  switch (r) {
    case "accepted": return "Accepted";
    case "tentativelyAccepted": return "Tentative";
    case "declined": return "Declined";
    case "organizer": return "You organize it";
    default: return "No response yet";
  }
}
/** The menu and button word per response. */
export const RSVP_VERB: Record<RsvpResponse, string> = { accepted: "Accept", tentativelyAccepted: "Tentative", declined: "Decline" };

/** What the read for an RSVP knows about a meeting. No attendee addresses: only how many others. */
export type MeetingFacts = { isOrganizer: boolean; others: number; isCancelled: boolean; marker: string | null; response: string | null; organizer: string | null; allowNewTimeProposals: boolean };

/** Why FocusTime won't answer this meeting, or null when it can. */
export function rsvpProblem(m: MeetingFacts): string | null {
  if (m.marker) return "This event is FocusTime's: there is nothing to answer";
  if (m.isOrganizer) return "You organize this meeting, so there is nothing to answer";
  if (m.isCancelled) return "This meeting was cancelled";
  if (m.others === 0) return "Nobody else is on this event, so there is nothing to answer";
  return null;
}

/** A proposed time (step 16): only with Tentative or Decline, only when the meeting allows it, start before end. */
export function proposalProblem(response: RsvpResponse, proposed: { start: string; end: string } | null, allow: boolean): string | null {
  if (!proposed) return null;
  if (response === "accepted") return "A new time can be proposed only with Tentative or Decline";
  if (!allow) return "The organizer doesn't allow new time proposals for this meeting";
  if (Temporal.Instant.compare(Temporal.Instant.from(proposed.end), Temporal.Instant.from(proposed.start)) <= 0) return "The proposed time ends after it starts";
  return null;
}

const graphTime = (iso: string) => ({ dateTime: Temporal.Instant.from(iso).toString({ smallestUnit: "second" }).replace(/Z$/, ""), timeZone: "UTC" });
/**
 * The POST body for a response: the organizer is always told (sendResponse true), with the note when there is one, and
 * a proposed new time (in UTC) only for Tentative or Decline.
 */
export function rsvpBody(response: RsvpResponse, o: { comment?: string | undefined; proposed?: { start: string; end: string } | undefined } = {}) {
  return {
    sendResponse: true,
    ...(o.comment ? { comment: o.comment } : {}),
    ...(o.proposed && response !== "accepted" ? { proposedNewTime: { start: graphTime(o.proposed.start), end: graphTime(o.proposed.end) } } : {}),
  };
}

/** Who hears about it, for the preview. */
export function rsvpVisibility(organizer: string | null, undo: boolean, comment: boolean): string {
  const who = organizer || "The organizer";
  if (undo) return `${who} is notified again: they get your earlier response by email. The meeting itself isn't changed.`;
  return `${who} gets your response by email${comment ? ", with your note" : ""}. The meeting itself isn't changed.`;
}

/** The quiet hint on a meeting's menu when it overlaps a focus block: "Overlaps your Fabrikam focus block". */
export function overlapHint(e: { start: string; end: string }, blocks: readonly { start: string; end: string; clientName: string }[]): string | null {
  const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
  const hits = [...new Set(blocks.filter((b) => ms(b.start) < ms(e.end) && ms(e.start) < ms(b.end)).map((b) => b.clientName))];
  if (!hits.length) return null;
  return `Overlaps your ${hits.join(" and ")} focus block${hits.length > 1 ? "s" : ""}`;
}
