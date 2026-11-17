// MC-1d: every word a registered client call shows about itself, in one place: the mark on a meeting (Day, Week, the
// block panel, the phone), the Client calls list, the call's page, its menu and the reviewer's notice all read them from
// here, so they always agree. docs/design/wording.md "MC-1d words" has the same words. Pure: no I/O, no clock.
import { AI_MESSAGES } from "../ai/types.ts";
import { AI_RETRIES, parseOutcome, type OccurrenceState } from "./meetings.ts";

/** The states a person can see, as the mark and the list say them. */
export const CALL_STATE = {
  waiting: "Waiting for the transcript",
  review: (n: number) => `Review ${n} ${n === 1 ? "proposal" : "proposals"}`,
  /** An attendee who isn't a reviewer: there is something to see, not to do. */
  toReview: (n: number) => `${n} ${n === 1 ? "proposal" : "proposals"} to review`,
  nothing: "Nothing proposed",
  reviewed: "Reviewed",
  upload: "Upload the transcript",
  noTranscript: "No transcript this week",
  readFailed: "Couldn't read the transcript",
  aiFailed: "The AI step failed",
} as const;

/** The call's actions, as its menu, its page and its notice name them. */
export const CALL_ACTIONS = {
  review: "Review proposals",
  open: "Open the call",
  transcript: "Read the transcript",
  rerun: "Propose again",
  upload: "Upload a transcript",
  showLines: "Show in transcript",
  list: "Client calls",
} as const;

/** MC-1d: the reviewer's notice (in the app and the Teams card) when the AI step failed and FocusTime stopped trying. */
export const CALL_NOTICE = {
  failedTitle: (client: string) => `${client}'s call: the AI step failed`,
  failedBody: "Nothing was proposed. Open the call to see why, then Propose again.",
  failedButton: CALL_ACTIONS.open,
} as const;

/** The Transcript view's words. */
export const TRANSCRIPT_TEXT = {
  tabProposals: "Proposals",
  tab: "Transcript",
  filter: "Filter the transcript",
  filterHint: "Words or a name",
  marked: "A proposal rests on this line",
  count: (shown: number, all: number) => (shown === all ? `${all} lines` : `${shown} of ${all} lines`),
  none: (q: string) => `No line has "${q}"`,
  gone: "The transcript is kept 30 days after the call. This one is gone; the proposals and what was done stay.",
  missing: "No transcript yet.",
  who: "Kept 30 days, for this call's reviewers and attendees only. Read only.",
} as const;

/** What an occurrence needs, in words, for a reviewer or an attendee, and whether it needs me now. */
export function callLabel(o: { state: OccurrenceState; open: number; proposals?: number; readFailed?: boolean; retryAt?: string | null }, review: boolean): { label: string; needsMe: boolean } {
  switch (o.state) {
    case "ready":
      if (o.open) return { label: review ? CALL_STATE.review(o.open) : CALL_STATE.toReview(o.open), needsMe: review };
      return { label: o.proposals ? CALL_STATE.reviewed : CALL_STATE.nothing, needsMe: false };
    case "needs_upload":
      if (o.readFailed) return { label: CALL_STATE.readFailed, needsMe: review };
      return { label: review ? CALL_STATE.upload : CALL_STATE.waiting, needsMe: review };
    case "reviewed":
      return { label: CALL_STATE.reviewed, needsMe: false };
    case "no_transcript":
      return { label: CALL_STATE.noTranscript, needsMe: false };
    case "failed":
      // While FocusTime is still trying again by itself, nothing is asked of anyone yet.
      return { label: CALL_STATE.aiFailed, needsMe: review && !o.retryAt };
    default:
      return { label: CALL_STATE.waiting, needsMe: false };
  }
}

/** "AI is off..." stays as it is; "The AI service..." reads on after a colon as "the AI service...". */
const after = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** FocusTime's own reasons, which aren't the AI service's (MC-1d: never said as "The AI service couldn't answer"). */
const OWN: Record<string, string> = {
  no_ai: "AI isn't on for this client. A FocusTime admin allows it in Admin › AI.",
  no_context: "FocusTime couldn't read this client's DevOps items to send with the call.",
  // The AI service refused the request itself (a 4xx): its words, as for any other provider failure.
  provider_refused: AI_MESSAGES.provider,
};

/**
 * The failed pass's line on the page: "The AI step failed: <why>", and for a call sent in parts, which part. Null for
 * a pass that ran (done) or none yet.
 */
export function aiFailedLine(stored: string | null): string | null {
  if (!stored || stored === "done") return null;
  const o = parseOutcome(stored);
  const why = OWN[o.kind] ?? (AI_MESSAGES as Record<string, string>)[o.kind] ?? "The AI step didn't finish";
  const parts = o.parts > 1 && o.part ? ` The call was sent in ${o.parts} parts and part ${o.part} failed, so nothing was proposed: a reviewer never confirms from half a call.` : "";
  return `${CALL_STATE.aiFailed}: ${after(why)}${/[.!?]$/.test(why) ? "" : "."}${parts}`;
}

/**
 * What happens next after a failed pass: FocusTime trying again by itself (production only), it having stopped, or
 * that a person has to change something first (a failure a retry can't fix).
 */
export function aiNextLine(o: { retryAt: string | null; tries: number; retryable: boolean; retriesHere: boolean; at: (iso: string) => string }): string {
  if (!o.retryable) return "FocusTime doesn't try this one again by itself: once that's fixed, a reviewer presses Propose again.";
  if (o.retryAt && o.retriesHere) return `FocusTime tries again by itself at ${o.at(o.retryAt)} (${o.tries + 1} of ${AI_RETRIES}). A reviewer can Propose again now.`;
  if (o.tries >= AI_RETRIES) return `FocusTime tried again ${AI_RETRIES} times and stopped. A reviewer can Propose again.`;
  return "A reviewer can Propose again.";
}
