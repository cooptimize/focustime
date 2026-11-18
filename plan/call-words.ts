// MC-1d: every word a registered client call shows about itself, in one place: the mark on a meeting (Day, Week, the
// block panel, the phone), the Calls list (MC-2; Client calls before), the call's page, its menu and the reviewer's
// notice all read them from here, so they always agree. docs/design/wording.md "MC-1d words" and "MC-2 words" have the
// same words. Pure: no I/O, no clock.
import { AI_MESSAGES } from "../ai/types.ts";
import { AI_RETRIES, parseOutcome, type OccurrenceState } from "./meetings.ts";

/**
 * DY-1: how a meeting is marked where it is drawn (Day, Week, the block panel, the phone): "Repeats" for one of a series
 * on the calendar (an icon, with the word for screen readers and on hover); a registered call by its type. The
 * register form's line under the type.
 */
export const MEETING_WORDS = {
  repeats: "Repeats",
  typeHint: "Both types are read the same way. The type is how the call is named on Day, Week and the call's page.",
} as const;

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

/**
 * MC-1e: a field a client's process requires on a new item of a type, with no default, and which of the New form's
 * fields fills it (null: the form can't, so the row says so before any preview).
 */
export type RequiredField = { ref: string; name: string; fill: "date" | "size" | "description" | "check" | "assignTo" | null };
/** MC-1e: one row's check before any preview: what it still needs, what the form can't fill, or why it won't be sent. */
export type ProposalCheck = { needs?: { fill: NonNullable<RequiredField["fill"]>; name: string }[]; /** Fields the process requires that the form fills, filled or not. */ required?: NonNullable<RequiredField["fill"]>[]; cant?: string; blocked?: string };

/** MC-1e: the call's page, made like the rest of the app: its filter, its sections, its rows and the bar for ticked rows. */
export const CALL_FILTERS = [
  { key: "all", label: "All" },
  { key: "gap", label: "New in DevOps" },
  { key: "commitment", label: "Promises" },
  { key: "comment", label: "Comments" },
] as const;
export type CallFilter = (typeof CALL_FILTERS)[number]["key"];
export const SECTION_HEAD = { gap: "New in DevOps", commitment: "Promises", comment: "Comments on stories" } as const;

/** QC-1's own words for a required field the form can't fill (the New form says the same, then its own next step). */
export const processNeeds = (project: string, names: readonly string[], type: string) => `${project}'s process needs ${names.join(", ")} on a new ${type}, which FocusTime doesn't fill.`;

export const CALL_ROW = {
  create: "Create in DevOps",
  comment: "Add comment",
  promise: "Add to Promises",
  note: "Note with this call",
  skip: "Skip",
  bringBack: "Bring back",
  needed: "Needed",
  /** A required field the form fills, still empty: on the row, before any preview. */
  needs: (names: readonly string[], type: string | null = null) => `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} needed: this client's process requires ${names.length === 1 ? "it" : "them"} on a new ${type ?? "item of this type"}.`,
  cantFill: (project: string, names: readonly string[], type: string) => `${processNeeds(project, names, type)} Create this one in DevOps, then skip it here.`,
  commentAboveStory: (type: string) => `This comment is on a ${type}, above story level. Status is reported on features, so a call's comment never goes there: it won't be sent. Skip it.`,
  noParent: "No parent yet. Choose one, or leave it without",
  keptPromise: (who: string) => `Added to ${who.split(/\s+/)[0]}'s Promises`,
  keptNote: (who: string) => `Noted with this call: ${who}`,
  /** PK-1: a promise from a Pocket export whose words don't say whose it is. */
  noOwner: "Pocket didn't say who",
  keptNobody: "Noted with this call. Pocket didn't say who",
  /** PK-1: how a promise with no owner is named in Waiting on. */
  someone: "Someone on the call",
  tryAgain: "Try again",
  /** The folded lines at a section's foot. */
  skipped: (n: number) => `${n} skipped`,
  done: (n: number) => `${n} done`,
  selectAll: "Select all",
  /** The one count. */
  toReview: (n: number) => `${n} to review`,
  showLine: (n: number) => (n === 1 ? "Proposal" : `${n} proposals`),
  goToProposal: "Go to the proposal",
  /** RQ-1: a new item at the feature tier: create it through the one preview, then Break down on it with Run started. */
  createAndBreakDown: "Create and break down",
  createAndBreakDownWhy: "Creates it through the preview, then opens Break down on it and starts Run. Nothing more is created until you confirm the stories.",
} as const;

/** MC-1e: the bar for ticked rows, as the Backlog's Grid has one. */
export const CALL_BAR = {
  selected: (n: number) => `${n} selected`,
  devops: (n: number) => `Send ${n} to DevOps`,
  /** Promises go to Promises, the client's go as notes with the call: said apart. */
  promises: (mine: number, notes: number) => [mine ? `Add ${mine} to Promises` : "", notes ? `Note ${notes} with this call` : ""].filter(Boolean).join(", "),
  skip: "Skip",
  clear: "Clear",
  tenAtATime: (n: number) => `DevOps changes go 10 at a time: the first 10 of ${n} now, the rest stay ticked.`,
  noPat: "Enable DevOps writes for this client in Settings › DevOps first",
  /** Ticked DevOps rows that still need a field: neither sent nor unticked. */
  waiting: (n: number) => (n === 1 ? "1 needs something on its row first" : `${n} need something on their rows first`),
} as const;

/** MC-1e: Propose again's line: how many are new, and how many were left out as already done, skipped or failed. */
export const rerunLine = (added: number, same: number) =>
  `${added ? `${added} new ${added === 1 ? "proposal" : "proposals"} to review.` : "Nothing new to propose."}${same ? ` ${same} left out: the same as ${same === 1 ? "one" : "ones"} already done, skipped or failed here.` : ""}`;

/**
 * MC-1e: a write that didn't go through, in plain words on its row. A field DevOps said was required (a rule the check
 * before the preview couldn't see) is named, with what to do; DevOps's own error text is never the message.
 */
export function callWriteWords(message: string, type: string | null): string {
  const field = /TF401320: Rule Error for field ([^.]+)\./.exec(message)?.[1]?.trim();
  if (field) return `DevOps says ${field} is needed on a new ${type ?? "item"}. Fill it in on this row and try again, or create this one in DevOps and skip it here.`;
  if (/TF401320/.test(message)) return `DevOps refused one of this item's fields. Check the row's fields and try again.`;
  if (/^DevOps refused the change: /.test(message)) return "DevOps refused this change. Check the row and try again.";
  return message;
}

/** The call's actions, as its menu, its page and its notice name them. */
export const CALL_ACTIONS = {
  review: "Review proposals",
  open: "Open the call",
  transcript: "Read the transcript",
  rerun: "Propose again",
  upload: "Upload a transcript",
  showLines: "Show in transcript",
  /** MC-2: the area (More, the command menu, the phone, its heading). A registered weekly call is still a client call. */
  list: "Calls",
  /** MC-2: on a meeting I was on that isn't registered or reviewed yet. */
  reviewCall: "Review this call",
  /** MC-2: on a calendar call's page, one try with my sign-in. */
  fromTeams: "Get it from Teams",
} as const;

/** MC-2: Calls (#/calls since MC-3; #/meetings before): its lists, Add a call, and the setup a call that isn't registered opens with. */
export const CALLS_TEXT = {
  heading: "Calls",
  sub: "Your client calls and the other calls you were on",
  clientCalls: "Client calls",
  clientCallsSub: "Weekly calls a FocusTime admin registered",
  noClientCalls: "No client calls yet. A FocusTime admin registers a client's weekly call in Admin › Clients › Meetings, and you see it here once you review or attend it.",
  others: "Your other calls",
  othersSub: (days: number) => `Calls you were on in the last ${days} days. Only you see this list, and FocusTime keeps nothing about a call until you review it.`,
  noOthers: (days: number) => `No other calls in the last ${days} days.`,
  add: "Add a call",
  addSub: "A call that isn't on your calendar. Only you see it.",
  addName: "Name",
  addDay: "Day",
  addStart: "Starts",
  addLength: "Length",
  addClient: "About",
  addSave: "Add and upload the transcript",
  notReviewed: "Not reviewed",
  review: "Review",
  open: "Open",
  upload: "Upload",
  people: (n: number) => `${n} ${n === 1 ? "person" : "people"}`,
  byHand: "Added by you",
  setupTitle: (name: string) => `Review ${name}`,
  setupClient: "Which client is this call about?",
  setupClientHint: "FocusTime suggests one; you choose. Proposals go to this client's plan only, and nothing goes to AI until you choose.",
  suggested: "suggested",
  internal: "Internal",
  pickClient: "Choose a client",
  setupSource: "Where does the transcript come from?",
  sourceTeams: "Get it from Teams",
  sourceTeamsHint: "FocusTime asks Teams once, now, with your sign-in, for this call only.",
  sourceUpload: "Upload a file",
  sourceUploadHint: "A Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf).",
  outsideHint: "Organized outside Cooptimize, so FocusTime doesn't ask Teams for it. Upload its transcript instead.",
  notTeamsHint: "Not a Teams meeting, so there's no transcript to get. Upload one instead.",
  start: "Continue",
  cancel: "Cancel",
  notFound: "FocusTime couldn't find this call on your calendar in the last 14 days.",
  summary: "What was said",
  whoSees: "You and the Cooptimizers on the invite can see this call. Only you can act on it.",
  whoSeesHand: "Only you can see this call.",
} as const;

/**
 * MC-3: Calls as a tab: one list by day, its filters and client chips, each row's second line, the folds at its foot,
 * and the space beside the list. A row's state is CALL_STATE's (or CALLS_TEXT.notReviewed).
 */
export const CALL_LIST = {
  /** The tab's title (and its number key's line). */
  tabTitle: "Calls: review the calls you were on",
  sub: "The calls you were on, newest first",
  /** The filters: All, then each bucket. */
  filters: { all: "All", review: "To review", open: CALLS_TEXT.notReviewed, done: "Done" },
  filterHint: { all: "Every call in the list", review: "Calls waiting for you: proposals to review, a transcript to upload or a step that failed", open: "Calls nobody has reviewed yet, or that wait for a transcript or for their reviewer", done: "Calls that were reviewed, had nothing to propose or had no transcript" },
  allClients: "All clients",
  noClient: "No client yet",
  today: "Today",
  yesterday: "Yesterday",
  /** A row's second line: where the transcript came from, or will. */
  fromTeams: "Transcript from Teams",
  uploaded: "Transcript uploaded",
  readAfter: "Read from Teams after the call",
  uploadedByReviewer: "Uploaded by a reviewer",
  teamsOrFile: "From Teams or a file",
  fileOnly: "Upload only",
  /** The mark on a registered weekly call, before its type. */
  weekly: "Weekly",
  noneHere: "No calls here. Choose All to see every call.",
  none: (days: number) => `No calls in the last ${days} days. A call on your calendar shows here once it has started.`,
  privacy: "Only you see the calls from your calendar, and FocusTime keeps nothing about one until you review it.",
  /** The space beside the list when there's no call at all. */
  emptyBeside: "Calls turns what was said on a call into DevOps items, promises and comments you confirm. Review any call you were on, or add one that isn't on your calendar.",
  /** The fold at the list's foot: the registered client calls, each with when it meets and how its transcript arrives. */
  clientCalls: (n: number) => `Client calls (${n})`,
  clientCallsSub: "Weekly calls a FocusTime admin registered. Their calls from the last 14 days are in the list above.",
  reviewers: (names: readonly string[]) => `Reviewed by ${names.join(", ")}`,
  earlier: "Earlier",
  /** Calls older than the list's days that don't need me, until their transcript is dropped. */
  older: (n: number) => `Earlier calls (${n})`,
  olderSub: "Calls from before the last 14 days that don't need you. Each goes when its transcript does, 30 days after the call.",
  hideList: "Hide the list",
  showList: "Show the list",
  back: "Back to Calls",
  loading: "Loading calls…",
  tryAgain: "Try again",
} as const;

/** MC-2: Get it from Teams, one try per press: what came of it, in plain words, each pointing to the upload when it failed. */
export const FETCH_OUTCOMES = ["found", "none", "outside", "not_allowed", "not_on_invite", "not_online", "signin", "consent", "busy", "unreadable", "not_cooptimizer", "unavailable"] as const;
export type FetchOutcome = (typeof FETCH_OUTCOMES)[number];
export const FETCH_WORDS: Record<Exclude<FetchOutcome, "found">, string> = {
  none: "Teams has no transcript for this call. Transcription may not have been on. Upload a file instead.",
  outside: "This call is organized outside Cooptimize, so FocusTime doesn't ask Teams for it. Download the transcript from the meeting's recap in Teams, or ask the organizer for it, and upload it here.",
  not_allowed: "Microsoft didn't let your sign-in read this call's transcript. The organizer may have turned transcripts off for attendees. Ask the organizer for the file and upload it here.",
  not_on_invite: "This call isn't on your calendar now, so FocusTime can't ask Teams for it. Upload the transcript instead.",
  not_online: "This isn't a Teams meeting, so there's no transcript to get. Upload one instead.",
  signin: "Sign in with Microsoft again, then try once more. Or upload the file.",
  consent: "Your sign-in needs the meetings permission first. Sign in again and allow it, or upload the file.",
  busy: "Microsoft isn't answering right now. Try again in a minute, or upload the file.",
  unreadable: "The transcript from Teams couldn't be read. Upload the file instead.",
  not_cooptimizer: "Only a Cooptimizer who was on a call can ask FocusTime to read it.",
  unavailable: "Getting a transcript from Teams isn't available here. Upload a file instead.",
};
export const fetchFound = (lines: number, proposals: number, ran = true) => `Got the transcript from Teams (${lines} ${lines === 1 ? "line" : "lines"}). ${!ran ? `${CALL_STATE.aiFailed}.` : proposals ? `${proposals} ${proposals === 1 ? "proposal" : "proposals"} to review.` : "Nothing to propose from it."}`;

/** MC-1d: the reviewer's notice (in the app and the Teams card) when the AI step failed and FocusTime stopped trying. */
export const CALL_NOTICE = {
  failedTitle: (client: string) => `${client}'s call: the AI step failed`,
  failedBody: "Nothing was proposed. Open the call to see why, then Propose again.",
  failedButton: CALL_ACTIONS.open,
} as const;

/** PK-1: a Pocket export as a call's transcript, and the upload area that takes a dropped file. */
export const POCKET_TEXT = {
  /** Once, above the proposals and above the Transcript, for a transcript from a Pocket export. */
  note: "From a Pocket recording. Speakers aren't named, and Pocket can mix them up.",
  /** What the upload area takes. */
  takes: "FocusTime takes a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf).",
  pocketHow: "Recorded it on Pocket? Export the transcript from Pocket and upload the download as it is.",
  choose: "Choose a file",
  orDrop: "or drop it here",
  dropHere: "Drop the file here",
  dropReplace: "Drop the file here to replace the transcript",
  oneAtATime: "One file at a time: drop just the transcript.",
  /** A drop onto a call that already has a transcript: the words the page uses for replacing (Propose again's). */
  replace: "Replace this call's transcript? The open proposals are replaced, with any words you changed. The ones done, skipped or failed stay, and the same thing again is left out.",
  dateAsk: (recorded: string, length: string | null, callDay: string) => `This Pocket recording is from ${recorded}${length ? `, ${length} long` : ""}. This call is ${callDay}. Use it for this call?`,
  dateYes: "Use it for this call",
  dateNo: "Don't use it",
  dateNoLine: "Nothing was kept. Upload the recording from this call's day.",
  /** Read N lines, in the area's line after an upload. */
  read: (lines: number, proposals: number) => `Read ${lines} lines. ${proposals} ${proposals === 1 ? "proposal" : "proposals"} to review.`,
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
