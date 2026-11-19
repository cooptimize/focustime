// MC-1d: every word a registered client call shows about itself, in one place: the mark on a meeting (Day, Week, the
// block panel, the phone), the Calls list (MC-2; Client calls before), the call's page, its menu and the reviewer's
// notice all read them from here, so they always agree. docs/design/wording.md "MC-1d words" and "MC-2 words" have the
// same words. Pure: no I/O, no clock.
import { AI_MESSAGES } from "../ai/types.ts";
import { AI_RETRIES, parseOutcome, type OccurrenceState } from "./meetings.ts";
import { aOr, vowelSound } from "./quick-create.ts";

/**
 * DY-1: how a meeting is marked where it is drawn (Day, Week, the block panel, the phone): "Repeats" for one of a series
 * on the calendar (an icon, with the word for screen readers and on hover); a registered call by its type. The
 * register form's line under the type.
 */
export const MEETING_WORDS = {
  repeats: "Repeats",
  typeHint: "Both types are read the same way. The type is how the call is named on Day, Week and the call's page.",
} as const;

/**
 * WK-6: a block's meetings where a card names them (the day in focus on Week, every card on Day, every card with the
 * Meetings switch on) and where it folds them to one line, and the block panel's line. A call shows only while it needs
 * me (callLabel's needsMe, the rule Calls counts by): its state on its meeting's row, a count on the folded line.
 */
export const CARD_MEETINGS = {
  /** The small heading over the named meetings (drawn in capitals as a section label). */
  heading: "Meetings",
  /** At the end of the folded line, in the link colour. */
  needsYou: (n: number) => (n === 1 ? "1 call needs you" : `${n} calls need you`),
  /** A call's state under its meeting's name: its kind (the call's type, or "Call" for one that isn't registered), then its state. */
  state: (c: { role: string; label: string }) => `${c.role} · ${c.label}`,
  /** Past five rows. */
  more: (n: number) => `${n} more`,
  moreHint: "Open the block's agenda",
  fold: "Fold the meetings to one line",
  unfold: "Name the meetings",
  /** A row with a call that needs me: what pressing it does. */
  openCall: "Open in Calls",
  /** A call with no meeting on my calendar, as its row says it to a screen reader. */
  callOnly: "Call",
  /** Week's header switch. */
  switchLabel: "Meetings",
  switchHint: "Name the meetings on every card. Off: only the day in focus names them",
} as const;
/** WK-6: rows a card names before "N more". */
export const CARD_MEETING_ROWS = 5;

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
/** A group's head: its name only (MC-6: the counts are on the Show chips, which use the same names). */
export const SECTION_HEAD = { gap: "New in DevOps", commitment: "Promises", comment: "Comments" } as const;

/** QC-1's own words for a required field the form can't fill (the New form says the same, then its own next step). */
/** MC-6: the gap form's hover on No parent: "a" or "an" by how the type's name sounds as written (UC-3), then the name in lower case. */
export const topNoParent = (type: string) => `${vowelSound(type) ? "An" : "A"} ${type.toLowerCase()} is at the top: no parent`;

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
  commentAboveStory: (type: string) => `This comment is on ${aOr(type)}, above story level. Status is reported on features, so a call's comment never goes there: it won't be sent. Skip it.`,
  noParent: "No parent yet. Choose one, or leave it without",
  keptPromise: (who: string) => `Added to ${who.split(/\s+/)[0]}'s Promises`,
  /** MC-6: my own promise, by the server's word that it is mine (never a name compared). */
  keptMine: "Added to your Promises",
  inMine: "in your Promises",
  inTheirs: (who: string) => `in ${who.split(/\s+/)[0]}'s Promises`,
  /** MC-6: one Undo message at a time, each saying what it undoes. */
  undoKept: (title: string) => `Kept: ${title}`,
  undoKeptMany: (n: number) => `Kept: ${n} promises`,
  undoSkipped: (title: string) => `Skipped: ${title}`,
  undoSkippedMany: (n: number) => `Skipped: ${n} proposals`,
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
  noPat: "Enable DevOps writes for this client first, in Settings › Connections › DevOps",
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
  /** MC-7: beside Upload a transcript in a call's menu. */
  paste: "Paste a transcript or notes",
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
  /** MC-2c: a call started in a client's chat. */
  whoSeesChat: "The Cooptimizers in the chat who follow this client see this call in Calls, and each can review it with their own sign-in.",
  /** MC-2c: the upload box on a chat call. */
  uploadChat: "Download it from the call in the chat in Teams. It's kept 30 days, for you and the Cooptimizers in the chat who follow this client only.",
} as const;

/**
 * MC-3: Calls as a tab: one list by day, its filters and client chips, each row's second line, the folds at its foot,
 * and the space beside the list. A row's state is CALL_STATE's (or CALLS_TEXT.notReviewed).
 */
export const CALL_LIST = {
  /** The tab's title (and its number key's line). */
  tabTitle: "Calls: review the calls you were on",
  sub: "The calls you were on, newest first",
  /** MC-4: the filters: what is still to do, what is finished, what I put out of the way. */
  filters: { open: "Open", closed: "Closed", hidden: "Hidden" },
  filterHint: { open: "Calls that need you first, then each week's calls that can be reviewed", closed: "Calls with nothing left to decide, and what came of each", hidden: "Meetings you hid. Only you see this list" },
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
  /** MC-2c: a call started in a client's registered chat: its name, and its source line. */
  fromChat: "From a chat",
  chatCallName: (chat: string) => `Call in ${chat}`,
  /** The mark on a registered weekly call, before its type. */
  weekly: "Weekly",
  noneHere: "No calls here.",
  none: (days: number) => `No calls in the last ${days} days. A call on your calendar shows here once it has started.`,
  privacy: "Only you see the calls from your calendar, and FocusTime keeps nothing about one until you review it.",
  /** The space beside the list when there's no call at all. */
  emptyBeside: "Calls turns what was said on a call into DevOps items, promises and comments you confirm. Review any call you were on, or add one that isn't on your calendar.",
  /** The fold at the list's foot: the registered client calls, each with when it meets and how its transcript arrives. */
  clientCalls: (n: number) => `Client calls (${n})`,
  clientCallsSub: "Weekly calls a FocusTime admin registered. Their calls from the last 14 days are in the list above.",
  reviewers: (names: readonly string[]) => `Reviewed by ${names.join(", ")}`,
  /** A registered call with no occurrence in the weeks FocusTime looks at. */
  noneLately: "Nothing in the last five weeks.",
  hideList: "Hide the list",
  showList: "Show the list",
  back: "Back to Calls",
  loading: "Loading calls…",
  tryAgain: "Try again",
  /** MC-4: a row's buttons, and the client choice's label. */
  reviewButton: "Review",
  uploadButton: "Upload",
  openButton: "Open",
  uploadState: CALL_STATE.upload,
  aboutLabel: "Which client is this call about?",
  /** The calls FocusTime keeps couldn't be read: no list rather than one missing the calls that need me. */
  failedMine: "FocusTime couldn't read your calls just now, so the list isn't shown: it would leave out the calls waiting for you.",
  /** Only my calendar's calls couldn't be read: the rest of the list is shown. */
  failedOthers: "FocusTime couldn't read your calendar's calls just now. The calls it keeps are listed.",
} as const;

/** MC-2c: the way on from any chat call outcome: the transcript is in the chat in Teams. */
export const CHAT_WAY_ON = "Or download the transcript from the call in the chat in Teams and upload it here.";

/** MC-2: Get it from Teams, one try per press: what came of it, in plain words, each pointing to the upload when it failed. */
export const FETCH_OUTCOMES = ["found", "none", "outside", "not_allowed", "tenant_off", "not_on_invite", "not_online", "signin", "consent", "busy", "unreadable", "not_cooptimizer", "unavailable", "chat_not_granted", "chat_refused", "chat_none", "not_in_chat"] as const;
export type FetchOutcome = (typeof FETCH_OUTCOMES)[number];
export const FETCH_WORDS: Record<Exclude<FetchOutcome, "found">, string> = {
  none: "Teams has no transcript for this call. Transcription may not have been on. Upload a file instead.",
  outside: "This call is organized outside Cooptimize, so FocusTime doesn't ask Teams for it. Download the transcript from the meeting's recap in Teams, or ask the organizer for it, and upload it here.",
  not_allowed: "Microsoft didn't let your sign-in read this call's transcript. The organizer may have turned transcripts off for attendees. Ask the organizer for the file and upload it here.",
  // MC-4: Microsoft says it is the organization's own setting (GraphAccessToTranscriptsDisabled), not the organizer's.
  tenant_off: "Your organization's Microsoft settings don't let apps read Teams transcripts. That's the organization's setting, not the organizer's choice. Download the transcript from the meeting's recap in Teams and upload it here.",
  not_on_invite: "This call isn't on your calendar now, so FocusTime can't ask Teams for it. Upload the transcript instead.",
  not_online: "This isn't a Teams meeting, so there's no transcript to get. Upload one instead.",
  signin: "Sign in with Microsoft again, then try once more. Or upload the file.",
  consent: "Your sign-in needs the meetings permission first. Sign in again and allow it, or upload the file.",
  busy: "Microsoft isn't answering right now. Try again in a minute, or upload the file.",
  unreadable: "The transcript from Teams couldn't be read. Upload the file instead.",
  not_cooptimizer: "Only a Cooptimizer who was on a call can ask FocusTime to read it.",
  unavailable: "Getting a transcript from Teams isn't available here. Upload a file instead.",
  // MC-2c: a call started in a client's chat. Each ends with the way on: the transcript from the chat, uploaded here.
  chat_not_granted: `Cooptimize's Microsoft setup hasn't allowed FocusTime to read transcripts of calls started in chats yet. An admin allows it once. ${CHAT_WAY_ON}`,
  chat_refused: `Microsoft didn't let your sign-in read this call's transcript. Teams lets the people who were on a call read it. If you weren't on it, ask someone who was to review it here. ${CHAT_WAY_ON}`,
  chat_none: `Teams doesn't have this transcript, or it isn't ready yet. Try again in a few minutes. ${CHAT_WAY_ON}`,
  not_in_chat: "FocusTime shows a chat's calls to the Cooptimizers in that chat who follow its client. Upload the transcript with Add a call instead.",
};
/** MC-6: the refusal when a call started in a client's chat is given another client. */
/**
 * MC-6: Dismiss, a kept call's way out when it has no transcript (Add transcript or Use Pocket recording): a call I
 * added by hand is removed (it exists nowhere else); any other closes as No transcript, in Closed until a transcript
 * comes. One Undo message says which.
 */
export const DISMISS_TEXT = {
  dismiss: "Dismiss",
  hintRemove: "Remove this call: you added it, and it's nowhere else",
  hintClose: "Close it with no transcript. Adding one later opens it again",
  removed: (name: string) => `Removed: ${name}`,
  closed: (name: string) => `Closed with no transcript: ${name}`,
  hasTranscript: "This call has a transcript. Skip all and close closes it.",
  notMine: "Only a call you added by hand can be removed, and only by you.",
  notACall: "Dismiss is for a call in Calls. A registered client call says No transcript this week from its menu.",
  notClosed: "This call isn't closed with no transcript now, so there's nothing to undo.",
} as const;

export const CHAT_OTHER_CLIENT = "A call started in a client's chat is about that client, or Internal. Choose one of those.";
/** MC-2c: once, above the proposals and the Transcript, when Teams gave a chat call's transcript without speaker names. */
export const CHAT_NO_SPEAKERS = "Teams gave this transcript without speaker names.";
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

/** MC-7: what a call's transcript is, as the question before replacing it names it. */
const WHAT_IS_THERE: Record<string, string> = { teams: "the Teams transcript", teams_unnamed: "the Teams transcript", pocket: "the Pocket transcript", pocket_api: "the Pocket transcript", pasted: "the pasted transcript", pasted_notes: "the pasted notes" };

/** MC-7: Paste, beside the other transcript choices: one box for a transcript or notes. */
export const PASTE_TEXT = {
  label: "Paste a transcript or your notes",
  hint: "Plain text. A transcript with names (copied from another tool), or notes you typed during the call.",
  transcript: (lines: number, speakers: number) => `A transcript: ${lines} ${lines === 1 ? "line" : "lines"}, ${speakers} ${speakers === 1 ? "speaker" : "speakers"}`,
  notes: (lines: number) => `Notes: ${lines} ${lines === 1 ? "line" : "lines"}`,
  asNotes: "Read it as notes",
  asTranscript: "Read it as a transcript",
  tooLong: "That is longer than FocusTime can read for one call. Paste the part that matters.",
  tooShort: "Paste at least a few words.",
  use: "Use this",
  reading: "Reading…",
  cancel: "Cancel",
  /** Leaving the page (or closing the box) with text in it. */
  leave: "Leave without using what you pasted? FocusTime doesn't keep it.",
  /** Before replacing a call's transcript, naming what is there. */
  replace: (kind: string | null) => `Replace ${WHAT_IS_THERE[kind ?? ""] ?? "this call's transcript"}? The open proposals are replaced, with any words you changed. The ones done, skipped or failed stay, and the same thing again is left out.`,
  read: (as: "transcript" | "notes", lines: number, proposals: number) => `Read ${lines} ${as === "notes" ? (lines === 1 ? "note line" : "note lines") : lines === 1 ? "line" : "lines"}. ${proposals} ${proposals === 1 ? "proposal" : "proposals"} to review.`,
} as const;

/** The Transcript view's words. */
export const TRANSCRIPT_TEXT = {
  /** MC-6: a line's time is time into the call; its clock time on hover, the same for a quote and the Transcript. */
  clockAt: (clock: string) => `${clock} on the clock`,
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
  /** MC-7: pasted notes: the view's tab and heading, and its filter's hint (no names in notes). */
  notes: "Your notes",
  notesHint: "Words",
  notesWho: "Notes pasted by a reviewer, not what was said word for word. Kept 30 days, for this call's reviewers and attendees only.",
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
  no_ai: "AI isn't on for this client. A FocusTime admin allows it on the client's page in Admin › Clients.",
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

/** MC-4: a row's mark: where its transcript is. */
export const MARK_TEXT = { teams: "Transcript in Teams", pocket: "Pocket recording", both: "Teams and Pocket", none: "No transcript", unchecked: "Not checked", checking: "Checking…" } as const;

/** MC-4: Calls' Open list, Hide, closing a call, and Review from the row. */
export const CLOSE_TEXT = {
  needs: "Needs you",
  week: { this: "This week", last: "Last week", earlier: "Earlier" },
  closedCount: (n: number) => `${n} closed`,
  stillOpen: (n: number) => `${n} still open`,
  left: (open: number, all: number) => `${open} left of ${all}`,
  fold: (n: number) => `${n} ${n === 1 ? "call" : "calls"} with no transcript`,
  foldSub: "Teams has no transcript for these, or FocusTime can't ask (not a Teams meeting, or organized outside Cooptimize). Each can still be reviewed from a file, or hidden.",
  series: (n: number, week: string) => `${n} ${week === "This week" ? "this week" : week === "Last week" ? "last week" : week === "Earlier" ? "earlier" : n === 1 ? "call" : "calls"}`,
  /** The check's quiet line at the list's head. */
  checkFailed: "FocusTime couldn't check which calls have a transcript just now. The list is still here.",
  checkAgain: "Check again",
  checkMore: (n: number) => `Check ${n} more`,
  notChecked: (n: number) => `${n} ${n === 1 ? "call wasn't" : "calls weren't"} checked yet.`,
  tenantOff: "Your organization's Microsoft settings don't let apps read Teams transcripts (the organization's setting, not an organizer's choice), so no call shows Transcript in Teams.",
  refresh: "Refresh",
  /** Hide (a meeting), with Undo; the repeating row's menu. */
  hide: "Hide",
  hideEvery: "Hide every one",
  hideEveryHint: "This meeting, from now on",
  hideWeek: "Hide only this week's",
  showEach: "Show each one",
  showEachHint: "Its calls as rows of their own",
  hideSeveral: (n: number) => `Hide ${n}`,
  /** MC-6: a hidden row is a call (a chat call, a Pocket recording or a calendar call), so the count says calls. */
  hidden: (n: number) => `${n} ${n === 1 ? "call" : "calls"} hidden`,
  hiddenEvery: (name: string) => `Every ${name} hidden`,
  putBack: "Put back",
  putBackAll: "Put back all",
  hiddenGone: (n: number) => `${n} you hid ${n === 1 ? "isn't" : "aren't"} in the last 14 days.`,
  hiddenWhy: "Only you see what you hid. Hiding never changes the meeting in Outlook or what anyone else sees.",
  hiddenEveryLine: "Every one, from now on",
  /** Closing a call. */
  skipAllClose: "Skip all and close",
  skipLastClose: (n: number) => `Skip the last ${n} and close`,
  skipSeveral: (n: number) => `Skip all and close ${n}`,
  closedCall: "Closed",
  closedAt: (when: string) => `Closed ${when}`,
  closedOne: "Call closed",
  closedMany: (n: number) => `${n} calls closed`,
  skippedNone: "Skipping writes nothing to DevOps and keeps no promise.",
  seeSkipped: (n: number) => `See what was skipped (${n})`,
  hideSkipped: "Fold what was skipped",
  putBackOne: "Put back",
  putBackOpens: "Bringing one back opens the call again.",
  goesIn: (when: string) => `Still open. Its transcript goes ${when} (30 days after the call).`,
  created: (n: number) => `${n} created`,
  promises: (n: number) => `${n} ${n === 1 ? "promise" : "promises"}`,
  comments: (n: number) => `${n} ${n === 1 ? "comment" : "comments"}`,
  skipped: (n: number) => `${n} skipped`,
  nothingTaken: "Nothing taken",
  noTranscript: "No transcript",
  /** Close out's list, and Week's header from Thursday. */
  closeOutHead: (day: string | null) => (day ? `Calls from ${day} still open` : "Calls still open today"),
  closeOutOpen: "Open",
  weekLine: (n: number) => `${n} ${n === 1 ? "call" : "calls"} to close this week`,
  /** Review from the row. */
  about: (client: string) => `About ${client}`,
  whichClient: "Which client?",
  aboutHint: "FocusTime suggests the client. Pressing Review with it shown is you saying the call is about it.",
  reviewing: "Getting the transcript from Teams…",
  uploadFile: "Upload a file",
  tick: (name: string) => `Choose ${name}`,
  ticked: (n: number) => `${n} chosen`,
  clearTicks: "Clear",
} as const;

/** MC-2b: a call my Pocket recording goes with, and a recording's own row (plan/pocket-words.ts has the rest). */
export const POCKET_ROW = { found: "Pocket recording found", kind: "Pocket recording", source: "Your Pocket recording" } as const;

/**
 * MC-5: Calls made scannable. The list's header menu, its one quiet Pocket line, the Client row, Needs you's one button
 * and short notes, a week row's mark and client, and the Undo messages that say what skipping did.
 */
export const LIST_TEXT = {
  /** The header's dots menu. */
  menu: "More for Calls",
  refresh: "Refresh",
  checkPocket: "Check Pocket",
  checkedAt: (time: string) => `Checked ${time}`,
  select: "Select calls",
  selectDone: "Done selecting",
  hideList: CALL_LIST.hideList,
  /** Said on the Calls heading's hover: what the old subtitle and privacy line said. */
  headingHint: "The calls you were on, newest first. Only you see the calls from your calendar, and FocusTime keeps nothing about one until you review it.",
  /** The one quiet Pocket line, only when there is something to do. */
  leftOut: (n: number) => `${n} Pocket ${n === 1 ? "recording was" : "recordings were"} left out.`,
  setAddress: "Set my Pocket address",
  pocketFailed: "Pocket didn't answer.",
  checkAgain: "Check again",
  connect: "Connect Pocket",
  /** The Client row under the filters. */
  client: "Client",
  all: "All",
  noClient: "No client",
  /** Needs you's one button by state. */
  addTranscript: "Add transcript",
  /** MC-6: a chat call's row, after Teams refused its transcript (the call's page says the whole of it). */
  teamsRefused: "Teams refused it",
  usePocket: "Use Pocket recording",
  tryAgain: "Try again",
  left: (n: number) => `${n} left`,
  /** MC-4's amber note, short: the transcript of a call from before this week goes 30 days after the call. */
  goes: (day: string) => `Transcript goes ${day}`,
  /** Skip all on a row (with Undo). */
  skipAll: "Skip all",
  skipLast: (n: number) => `Skip last ${n}`,
  /** The Undo message: what skipping did. */
  skippedClosed: (n: number) => `Skipped ${n}, call closed`,
  skippedClosedMany: (calls: number, n: number) => `Skipped ${n} in ${calls} calls, all closed`,
  /** A week row's mark, short, with its full words as its label. */
  mark: { teams: "Teams", pocket: "Pocket", both: "Teams · Pocket" },
  markFull: { teams: "Transcript in Teams", pocket: "Your Pocket recording", both: "Transcript in Teams and your Pocket recording" },
  /** MC-6: a chat call's transcript is found in its chat. */
  markChat: { teams: "Transcript in the chat", pocket: "Your Pocket recording", both: "Transcript in the chat and your Pocket recording" },
  whichClient: CLOSE_TEXT.whichClient,
  clientFor: (name: string) => `Client for ${name}`,
  /** Said on the fold's hover (it was the line under it). */
  foldHint: CLOSE_TEXT.foldSub,
  hiddenHint: CLOSE_TEXT.hiddenWhy,
} as const;

/**
 * MC-5: a call's page with less to read: the line under its name, its menu, the Show row and the one count, a proposal
 * folded to three lines and opened, and the transcript choices (Add a call's, on a call with none).
 */
export const PAGE_TEXT = {
  menu: "More for this call",
  /** Where a call came from, when not a calendar or a registered call. */
  origin: { hand: "Added by you", pocket: "Pocket", pasted: "Pasted transcript", notes: "Pasted notes" },
  /** Who sees it: short on the line, the full sentence on hover. */
  who: {
    hand: { short: "Only you see it", full: CALLS_TEXT.whoSeesHand },
    calendar: { short: "The invite sees it", full: CALLS_TEXT.whoSees },
    chat: { short: "The chat sees it", full: CALLS_TEXT.whoSeesChat },
    registered: { short: "Reviewers see it", full: "Only this call's reviewers and the Cooptimizers on its invite see it, for 30 days." },
  },
  onlyLook: (names: readonly string[]) => `Only ${names.join(", ")} can act on it. You can look.`,
  show: "Show",
  decided: (done: number, all: number) => `${done} of ${all} decided`,
  waiting: CALL_STATE.waiting,
  waitingHint: "FocusTime looks for the transcript after the call, every 15 minutes for 3 hours, then hourly up to 12 hours.",
  /** A proposal's three lines. */
  create: "Create",
  keep: "Keep",
  comment: "Add comment",
  details: "Details",
  me: "Me",
  nobody: "Nobody",
  noDate: "No date",
  noParent: "No parent",
  under: (id: number, title: string | null) => `under #${id}${title ? ` ${title}` : ""}`,
  by: (day: string) => `by ${day}`,
  on: (id: number, title: string) => `On #${id} ${title}`,
  quoteGone: "Its words went after 30 days",
  openQuote: (who: string) => `Open the transcript at ${who}'s words`,
  /** MC-7: a proposal from pasted notes rests on a note line, with no speaker and no time. */
  openNote: "Open your notes at this line",
  describe: "Description and size",
  needed: "needed",
  /** The transcript choices: Add a call's, and a call's page with no transcript. */
  transcript: "Transcript",
  choice: { teams: "From Teams", pocket: "Pocket recording", file: "A file", paste: "Paste", later: "Later" },
  getTeams: "Get it from Teams",
  drop: "Drop a Teams transcript or a Pocket export, or choose a file",
  kinds: ".vtt or .docx from Teams, .zip or .pdf exported from Pocket",
  useRecording: "Use this recording",
  noRecordings: "No recordings of yours from the last 14 days to choose.",
  connect: "Connect Pocket",
  /** A hand-added call taking any of my recordings takes its time from it, said before I confirm. */
  takesTime: (when: string) => `The call takes the recording's time: ${when}.`,
  fits: (call: string) => `Goes with ${call}`,
  reviewThat: "Review that call",
  /** MC-6: a recording that already has its own row in Calls (choosing it opens that row). */
  inYourList: "In your list",
} as const;

/** MC-5: Add a call, one panel, one step. */
export const ADD_TEXT = {
  title: CALLS_TEXT.add,
  onlyYou: PAGE_TEXT.who.hand.short,
  onlyYouFull: CALLS_TEXT.addSub,
  name: CALLS_TEXT.addName,
  day: CALLS_TEXT.addDay,
  starts: CALLS_TEXT.addStart,
  length: CALLS_TEXT.addLength,
  about: CALLS_TEXT.addClient,
  /** With a recording or a file; for Later. */
  addReview: "Add and review",
  add: "Add",
  adding: "Adding…",
} as const;
