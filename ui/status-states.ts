// ST-1: the three states a line under a Status feature is in, and Status's words. One pure rule, used by the page,
// Preview and the phone: every kind of text that can show under a feature is in exactly one state, with one name and
// one look everywhere. No React, no storage.

/**
 * On the report: in DevOps now, so Monday's report shows it (drawn plain, as a bullet).
 * Ready to push: mine, written or added, not in DevOps yet (a solid amber left edge, "Ready to push").
 * Suggested: written for me (by the AI, or from what I worked on when AI is off); nothing happens with it until I add
 * it (a dashed blue box, "Suggested").
 */
export type LineState = "on_report" | "ready" | "suggested";
export const LINE_STATES: readonly LineState[] = ["on_report", "ready", "suggested"];

/** The one name of each state, everywhere (the page, Preview, the phone, messages, the Guide). */
export const STATE_NAME: Record<LineState, string> = { on_report: "On the report", ready: "Ready to push", suggested: "Suggested" };
/** The few words each state has in the key under the header. */
export const STATE_KEY: Record<LineState, string> = { on_report: "in DevOps, on Monday's email", ready: "yours, not in DevOps yet", suggested: "written for you; add it to use it" };
/** The shape that tells them apart without color: none (a bullet), a solid edge, a dashed box. */
export type StateShape = "bullet" | "edge" | "dashed";
export const STATE_SHAPE: Record<LineState, StateShape> = { on_report: "bullet", ready: "edge", suggested: "dashed" };

/** Every kind of text that can show under a feature (ST-1's STEP 0.3). */
export type TextKind =
  | "comment_mine" // a comment of mine in the window, in DevOps
  | "comment_other" // a teammate's comment in the window
  | "comment_coop" // a Coop update in the window
  | "suggestion_ai" // a suggestion the AI wrote (status.suggest)
  | "suggestion_template" // a suggestion made without AI, from what I worked on
  | "draft" // what Suggest a line (once Draft) gave: the AI's text for one feature or every feature
  | "used_suggestion" // a suggestion I added (once Use)
  | "typed" // a line I wrote
  | "saved_draft" // a Draft's line kept in this browser from before ST-1: it was among the lines to push
  | "edit_pending" // an edit of my comment, not pushed yet
  | "delete_pending" // a delete of my comment, not pushed yet
  | "pushing" // a line in the DevOps preview now
  | "pushed" // a line that went to DevOps just now (with its Undo)
  | "push_failed" // a line DevOps didn't take (with its reason and Retry)
  | "last_week"; // last week's comments, behind "See last week's lines"

/**
 * The state a kind of text is in. A pushed line is in DevOps (On the report); one being pushed or that failed isn't
 * yet (Ready to push); what the AI writes is Suggested until I add it. Last week's lines are in DevOps and were on last
 * week's report: they're drawn plain like the report's own, behind their own link.
 */
export function stateOf(kind: TextKind): LineState {
  switch (kind) {
    case "comment_mine":
    case "comment_other":
    case "comment_coop":
    case "pushed":
    case "last_week":
      return "on_report";
    case "used_suggestion":
    case "typed":
    case "saved_draft":
    case "edit_pending":
    case "delete_pending":
    case "pushing":
    case "push_failed":
      return "ready";
    case "suggestion_ai":
    case "suggestion_template":
    case "draft":
      return "suggested";
  }
}

/** The short words a line shows beside its state's name, for the states a push moves through. */
export const LINE_NOTE = {
  pushing: "Pushing…",
  failed: (why: string) => `Didn't push: ${why}`,
  pushed: "Pushed",
  undone: "Undone",
  edit: "Edit of your line",
  delete: "Deletes your line",
} as const;

/** Status's words (ST-1). A test checks the states have no other names and the old words are gone. */
export const ST_WORDS = {
  title: "Status report",
  forMonday: (day: string, sends: string) => `For ${day} · ${sends}`,
  write: "Write",
  preview: "Preview",
  show: "Show",
  needsUpdate: "Needs an update",
  all: "All",
  updated: (n: number, of: number) => `${n} of ${of} ${of === 1 ? "feature has" : "features have"} an update`,
  clientUpdated: (n: number, of: number) => `${n} of ${of} updated`,
  onReport: "On Monday's report",
  onReportCount: (n: number) => (n === 0 ? "nothing yet" : n === 1 ? "1 line" : `${n} lines`),
  notYet: "Not on it yet",
  writeLine: "Write a line",
  suggestLine: "Suggest a line",
  suggesting: "Suggesting…",
  suggestAll: "Suggest for all",
  addAll: "Add all",
  add: "Add",
  edit: "Edit",
  dismiss: "Dismiss",
  remove: "Remove",
  delete: "Delete",
  keep: "Keep it",
  basedOn: (n: number) => `Based on ${n === 1 ? "1 thing" : `${n} things`} you worked on`,
  workedOn: (n: number) => `What you worked on (${n})`,
  namesRemoved: (name: string) => `${name}: another client's name was replaced with "another client".`,
  lastWeek: "See last week's lines",
  hideLastWeek: "Hide last week's lines",
  noUpdate: "No update yet",
  push: "Push to DevOps",
  ready: (n: number) => (n === 1 ? "1 line ready to push" : `${n} lines ready to push`),
  forClients: (parts: { name: string; n: number }[]) => parts.map((p) => `${p.name} ${p.n}`).join(", "),
  notOnYet: (n: number) => (n === 1 ? "1 line isn't on the report yet" : `${n} lines aren't on the report yet`),
  showThem: "Show them",
  hideThem: "Hide them",
  placeholder: "What moved this week, and what's next",
  lineHint: "Enter for the next line · Shift+Enter for a new line in this one · Esc to close",
  editHint: "Edits your line · Enter when done",
  showsAs: (who: string | null) => `Shows as ${who ?? "your DevOps name"}`,
  writing: "Writing a suggestion…",
  nothingToSuggest: "Nothing to suggest from: no story activity, notes or captures this week",
} as const;

/** The words a key line, a line's tag and a screen reader use for a state. */
export const stateLabel = (s: LineState) => STATE_NAME[s];

/** "Monday, Nov 9" from the report's date (IsoDate), as the header says it. */
export function mondayWords(iso: string): string {
  const d = Temporal.PlainDate.from(iso);
  return d.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** "Kat sends it 7:00 AM" from the server's "Kat sends it Monday 7:00 AM" (the day is in the header already). */
export const sendsWords = (sends: string) => sends.replace(/\s+(Monday|Mon)\b/, "");
