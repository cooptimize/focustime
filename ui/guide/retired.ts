// GU-1: the names FocusTime no longer uses, in one place. The Guide's Renamed section is this list (one row per old
// name, with where it lives now); the Guide's search finds every one; and ui/guide/app-names.test.ts fails when Guide
// text outside Renamed uses one. A step that changes a name or a control adds its old name here and fixes the Guide in
// the same pull request (docs/guide.md).

export type Retired = {
  /** The old name, as people knew it. */
  was: string;
  /** Where it lives now, in the app's words. */
  now: string;
  /**
   * How the old name is recognised in Guide copy (case matters: "Board" the mode, not "a board"). Omitted where the
   * old words are still ordinary words the app uses (a "follow-up", "Add work", "requests").
   */
  match?: RegExp;
};

export const RETIRED: readonly Retired[] = [
  { was: "Coopilot", now: "FocusTime", match: /\bCoopilot\b/ },
  { was: "Today (the tab)", now: "Day", match: /\bToday\b/ },
  { was: "Plan the day", now: "Add, on a block", match: /\bPlan the day\b/ },
  { was: "Plan today", now: "Add, on a block", match: /\bPlan today\b/ },
  { was: "Plan the week", now: "Add, in Week's header", match: /\bPlan the week\b/ },
  { was: "Commit (in Week)", now: "Nothing to confirm: what's on your week is your plan", match: /\bCommit\b/ },
  { was: "Details (a block's dialog)", now: "A block's panel", match: /\bDetails dialog\b/ },
  { was: "Week › Board", now: "Week", match: /\bBoard\b/ },
  { was: "Week › Status", now: "Status, a tab of its own", match: /Week › Status\b/ },
  { was: "Roadmap", now: "Backlog", match: /\bRoadmap\b/ },
  { was: "Ahead", now: "Backlog", match: /\bAhead\b/ },
  { was: "Plan ahead", now: "Backlog › Gantt", match: /\bPlan ahead\b/ },
  { was: "Fix next", now: "Backlog › Needs attention", match: /\bFix next\b/ },
  { was: "Gaps", now: "Backlog › Needs attention", match: /\bGaps\b/ },
  { was: "Readiness", now: "Backlog › Needs attention", match: /\bReadiness\b/ },
  { was: "Ahead › Backlog (the mode)", now: "Backlog › Filter › Levels › One level as a list" },
  { was: "Sort later", now: "Decide later", match: /\bSort later\b/ },
  { was: "Pick (a planned piece of work)", now: "To-do", match: /\b(?:a|the|your|my|each|every|planned) picks?\b|\bpicks\b(?! (?:it|up|out|them|the)\b)/i },
  { was: "Draft stories", now: "Break down", match: /\bDraft stories\b/ },
  { was: "Needs help from…", now: "Ask to collaborate", match: /\bNeeds help from\b/ },
  { was: "Follow-up", now: "Promise", match: /\bFollow-ups?\b/ },
  { was: "Loop", now: "Promise", match: /\bLoops?\b/ },
  { was: "Requests", now: "Inbox › From chats", match: /\bRequests\b/ },
  { was: "Asks", now: "Inbox › From chats", match: /\bAsks\b(?! for\b)/ },
  { was: "Conversations (the Inbox's cards and statuses)", now: "Inbox › From chats: only the ones that need a DevOps item" },
  { was: "Needs you", now: "Inbox › From chats", match: /\bNeeds you\b/ },
  { was: "Waiting on", now: "Gone: a teammate's promise is in their own Inbox", match: /\bWaiting on\b/ },
  { was: "In progress (the Inbox)", now: "Inbox › Promises" },
  { was: "Captures and drafts", now: "Inbox › Captures", match: /\bCaptures and drafts\b/ },
  { was: "Request type and the four lines", now: "The three questions, in the New form", match: /\b[Rr]equest types?\b|\bfour lines\b/ },
  { was: "Settings › Data (Undo and logs)", now: "Settings › Activity", match: /Settings › Data\b/ },
  { was: "Settings › Planning", now: "Settings › Today and Week", match: /Settings › Planning\b/ },
  { was: "Settings › Connections", now: "Settings › Accounts and calendars", match: /Settings › Connections\b/ },
];

/** Renamed's rows: [was, now]. */
export const RENAMED_ROWS: readonly (readonly [string, string])[] = RETIRED.map((r) => [r.was, r.now] as const);

/**
 * "Today" is still a word: the day that is today, the Today button and pill, a time ("Today 4:07 PM"), the quick date,
 * and the app's own Settings section "Today and Week". Only these uses are allowed outside Renamed; anything else is
 * the old tab name.
 */
export const TODAY_ALLOWED: readonly RegExp[] = [/\{b:Today\}/g, /Settings › Today and Week/g, /Today \d{1,2}:\d\d/g, /\(Today, Tomorrow/g, /\bToday pill\b/g];

/** Controls written as characters (the app shows icon buttons with names): ⋯ ‹ › × ✓ ✕ and a lone +. */
export const CONTROL_CHARS = /[⋯‹×✕✓✗]|(?<![A-Za-z'’)>] )›(?! [A-Z<{])|(?<![A-Za-z0-9+])\+(?![0-9A-Za-z+])/u;

/** The retired names a text uses (never inside Renamed's own rows), by their `was`. */
export function retiredIn(text: string): string[] {
  let t = text;
  for (const ok of TODAY_ALLOWED) t = t.replace(ok, "");
  return RETIRED.filter((r) => r.match && r.match.test(t)).map((r) => r.was);
}
