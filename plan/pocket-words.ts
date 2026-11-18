// PK-2: every word of Settings › Accounts and calendars › Pocket recorder, in one place (docs/design/wording.md,
// "PK-2 words"), the failures' too: the client (sources/pocket/client.ts) throws these, so the server and the page say
// the same thing.
import { POCKET_ROW } from "./call-words.ts";

/** Where a person reads how Pocket's API keys work (Pocket's own page; the guide links it). */
export const POCKET_KEYS_DOC = "https://docs.heypocketai.com/docs/api";

export type PocketFailure = "refused" | "not_accepted" | "no_answer" | "busy" | "unexpected" | "too_long";

/** Plain words for each failure, with what to do (wording.md, "PK-2 words"). */
export const POCKET_FAILURE_TEXT: Record<PocketFailure, string> = {
  refused: "FocusTime doesn't make that call to Pocket. It only lists your own recordings and reads the one you choose",
  not_accepted: "Pocket didn't accept this key. Check that you copied all of it, or make a new one in Pocket and paste that",
  no_answer: "Pocket didn't answer in time. Try again in a few minutes",
  busy: "Pocket is busy right now. Try again in a few minutes",
  unexpected: "Pocket answered in a way FocusTime doesn't understand; Pocket may have changed how it answers. Try again later, and tell your FocusTime admin if it keeps happening",
  too_long: "This recording's transcript is larger than FocusTime takes (20 MB). Upload the part you need as a file instead",
};

export const POCKET_WORDS = {
  title: "Pocket recorder",
  /** What connecting does, in one sentence. */
  intro:
    "Connecting lets FocusTime count your Pocket recordings when you press a button here, so you know the key works; it reads nothing else here. To bring a recording in as a call's transcript, press Get my Pocket recordings in Calls.",
  stepsLabel: "How to connect",
  steps: [
    "In Pocket, make an API key for yourself, from your own Pocket account. Don't use a key someone shares with a team.",
    "Choose what the key may do: tick only reading recordings (recordings:read). Pocket gives a key every permission when none is ticked. If Pocket asks for an expiry date, any date is fine; when the key expires, paste a new one here.",
    "Copy the whole key. It starts with pk_ (often pk_live_), and Pocket may show it only once.",
    "Paste it below and press Check and save. Nothing is saved unless Pocket accepts it.",
  ],
  docsLink: "Pocket's guide to API keys",
  /** What a person wants to know before pasting. */
  trust: "Your key stays on FocusTime's server, encrypted, for you alone. Nobody else sees it or whether you connected, admins included, and it never goes to the AI or the logs.",
  field: "Your Pocket key",
  fieldHint: "pk_…",
  checkAndSave: "Check and save",
  checking: "Checking with Pocket…",
  connected: "Connected",
  checkAgain: "Check again",
  replace: "Use a new key",
  replaceHint: "The new key replaces this one only if Pocket accepts it.",
  disconnect: "Disconnect",
  /** Disconnect asks first. */
  disconnectAsk: "Disconnect Pocket? FocusTime forgets your key now. Your recordings stay in Pocket; you can also delete the key there.",
  keep: "Keep it",
  cancel: "Cancel",
  kept: "FocusTime keeps your key encrypted, only for you, and never shows it again. It asks Pocket only when you press a button here.",
  notChecked: "Not checked yet",
  replaced: "New key checked and saved.",
  checkedNow: "Checked. Pocket answered.",
  gone: "Disconnected. FocusTime forgot your key.",
} as const;

/** "6 recordings in the last 7 days" (never which, never their titles). */
export const recordingsLine = (n: number) => `${n} ${n === 1 ? "recording" : "recordings"} in the last 7 days`;

/** "checked just now", "checked 5 min ago", "checked 2 h ago", "checked Nov 12". */
export function checkedAgo(at: string, nowMs: number, timeZone: string): string {
  const i = Temporal.Instant.from(at);
  const mins = Math.floor((nowMs - i.epochMilliseconds) / 60_000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins} min ago`;
  if (mins < 24 * 60) return `checked ${Math.floor(mins / 60)} h ago`;
  return `checked ${i.toZonedDateTimeISO(timeZone).toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * MC-2b: the words for Pocket recordings in Calls (wording.md, "MC-2b words"). Titles are the person's own and shown
 * only to them; nothing here names who else recorded anything.
 */
export const POCKET_CALL_WORDS = {
  get: "Get my Pocket recordings",
  getting: "Asking Pocket…",
  /** For someone without Pocket connected: one quiet line and its link, no button. */
  connectLine: "Record calls on a Pocket? Connect it in Settings.",
  connectLink: "Connect it in Settings",
  notConnected: "Pocket isn't connected. Connect it in Settings › Accounts and calendars › Pocket recorder",
  getAgain: "Get your Pocket recordings again first: FocusTime keeps the list for 5 minutes",
  notThisCall: "That recording doesn't go with this call: they overlap for less than half the call",
  noWords: "Pocket has no transcript for this recording yet. Try again once Pocket has made it, or upload a file",
  found: POCKET_ROW.found,
  rowKind: POCKET_ROW.kind,
  source: "Use my Pocket recording",
  part: "Only the part during the call (5 minutes either side)",
  all: "Bring in all of it",
  whole: (length: string) => `Pocket gave this recording's lines no times, so all of it comes in: ${length}.`,
  seeCall: "The Cooptimizers on this call's invite will be able to read it.",
  seeClient: "This call's reviewers and attendees will be able to read it.",
  seeMe: "Only you will see it.",
  fromMine: "From your Pocket recording.",
  fromReviewer: "From a reviewer's Pocket recording.",
  unnamed: "Speakers aren't named, and Pocket can mix them up.",
  more: "Pocket has more recordings than FocusTime reads at once (300). The newest are here.",
  /** A call that already has a transcript: asked before Pocket is asked. */
  replaceAsk: "This call already has a transcript. Replace it with your Pocket recording?",
  replaceYes: "Replace it",
  /** A recording's own row: its setup. */
  addTitle: "Make this recording a call",
  addName: "Name",
  addClient: "Client it is about",
  /** On a call I review that has no transcript yet. */
  bringHead: "Your Pocket recording of this call",
  bring: "Bring it in",
  bringing: "Bringing it in…",
  pick: "Which recording",
  /** Said beside Continue: the transcript goes to the AI only from here, and nothing goes to DevOps yet. */
  ai: "Once it's in, the AI proposes updates from it if AI is on for this client. Nothing goes to DevOps until you confirm.",
  /** The part question for a recording much longer than its call. */
  partAsk: (rec: string, call: string) => `This recording is ${rec}; the call was ${call}. Which part comes in?`,
  /** A row's source when a recording of mine goes with it. */
  rowSource: "Your Pocket recording",
} as const;

/** "3 recordings by other people were left out." */
export const othersLeftOut = (n: number) => `${n} ${n === 1 ? "recording" : "recordings"} by other people ${n === 1 ? "was" : "were"} left out.`;
/** "Got 4 recordings at 10:42 AM." */
export const gotLine = (n: number, time: string) => (n ? `Got ${n} ${n === 1 ? "recording" : "recordings"} at ${time}.` : `No recordings of yours in the last 14 days, at ${time}.`);
/** A recording's start and length on the setup: "Mon 10:58 AM · 47 min". */
export const recordingLine = (when: string, length: string) => `${when} · ${length}`;
