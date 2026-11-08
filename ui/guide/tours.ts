// UI-5: the Guide's "Show me" tours, as data. A tour opens a real screen and walks through it one element at a time:
// it only highlights and explains, never clicks, types or writes (ui/guide/tour/Tour.tsx blocks the page under it).
// Each step points at a `data-tour` hook on the real screen (listed in docs/guide.md). Where the screen has nothing
// there yet (no From last week, no client with blocks), the step shows a small example drawing instead.
// This file is plain data so nav.ts, the link checker and the tests can read it without loading the Guide.
import type { Nav } from "../nav.ts";

/** The example drawings a step can show in place of an empty highlight (ui/guide/tour/Illustrations.tsx). */
export type IllustrationId =
  | "pw-grid"
  | "pw-carry"
  | "pw-card"
  | "pw-add"
  | "pw-next"
  | "todo-drag"
  | "done-offer"
  | "urgent"
  | "closeout"
  | "ib-item"
  | "gaps-row"
  | "pending"
  | "ask-answer"
  | "ask-move"
  | "ask-update"
  | "status-line"
  | "status-draft"
  | "status-push";

export type TourStep = {
  /** The `data-tour` value on the real screen this step points at; none: the step is its example drawing. */
  target?: string;
  /** Another screen this step (and the ones after it) is on: the tour moves the page there, an address change only. */
  at?: Nav;
  title: string;
  text: string;
  /** Shown when the target isn't on screen, or (`emptyWhen`) is there with nothing in it. Without it the step is skipped. */
  example?: IllustrationId;
  /** A selector inside the target: when it matches nothing, the target counts as empty. */
  emptyWhen?: string;
  /** On a phone: other words, or skip the step. */
  phone?: { text: string } | "skip";
};

export type Tour = {
  id: string;
  title: string;
  /** One line for the Show me button. */
  summary: string;
  /** Where the tour opens. */
  start: Nav;
  /** The Guide section "Back to the Guide" opens. */
  section: string;
  steps: TourStep[];
  /** The last card: one line, then what to try yourself. */
  end: { line: string; tryIt: string };
};

const PLAN_WEEK: Tour = {
  id: "plan-week",
  title: "Plan your week",
  summary: "Choose the features you'll touch next week, one client at a time.",
  start: { tab: "week", mode: "commit", week: null, focus: null },
  section: "week",
  steps: [
    {
      target: "modes-week",
      title: "Week › Plan",
      text: "Plan is Week's second mode. It opens on next week. You plan features here; the to-dos come later, on the Board.",
    },
    {
      target: "pw-grid",
      title: "Your blocks for the week",
      text: "Each cell is a half-day block from Focus Time in Dataverse, in its client's color. PTO is hatched and Friday is catch-up. Click a cell to open its client.",
      example: "pw-grid",
      phone: { text: "Each cell is a half-day block from Focus Time in Dataverse, in its client's color. PTO is hatched and Friday is catch-up." },
    },
    {
      target: "pw-carry",
      title: "From last week",
      text: "Last week's features come first, each with one suggestion: carry it over, watch it, or it's finished. Nothing is added until you choose.",
      example: "pw-carry",
    },
    {
      target: "pw-open-card",
      title: "One client at a time",
      text: "Musts are what you'll definitely touch; nice to haves fit if there's room. The line at the top compares the hours you planned with the free time in that client's blocks. Over turns amber, never red.",
      example: "pw-card",
      // No musts yet: the example card, not an empty ring.
      emptyWhen: ".pw-features",
    },
    {
      target: "pw-addpane",
      title: "Add from DevOps",
      text: "The right side lists that client's DevOps work assigned to you. Add a feature as a must or a nice to have, or type a draft feature at the bottom.",
      example: "pw-add",
      phone: "skip",
    },
    {
      target: "pw-next",
      title: "Next client",
      text: "Next client moves on (J and K do too). When every client is planned, this button reads Confirm week.",
      example: "pw-next",
      phone: { text: "Next client moves on. Planning works best on a bigger screen: Copy link at the top opens this week on your computer." },
    },
    {
      target: "mode-done",
      title: "Confirm week",
      text: "Confirm week saves your lists and goes back to the Board. You can change and confirm again any time; the header says if it changed since.",
      phone: "skip",
    },
  ],
  end: { line: "That's planning. About 15 minutes on a Thursday or Friday.", tryIt: "Try it yourself: open Week › Plan with W, or close this and start from the first client." },
};

const BOARD: Tour = {
  id: "board",
  title: "Your Board and to-dos",
  summary: "Your half-day blocks for the week, and the to-dos on them.",
  start: { tab: "week", mode: "board", week: null, focus: null },
  section: "week",
  steps: [
    { target: "modes-week", title: "Week › Board", text: "The Board is Week's first mode: this week's half-day blocks, Monday to Friday, with Friday as catch-up." },
    { target: "wk-block", title: "A block", text: "Half a day for one client, from Focus Time in Dataverse. It says when it's at risk and why, like a dentist at noon. Click it for that client's stories.", phone: { text: "Half a day for one client, from Focus Time in Dataverse. It says when it's at risk and why. Tap it for that client's stories." } },
    { target: "wk-timeline", title: "Timeline", text: "Shows or hides the hours beside each block: meetings, free time and the line for now. B does the same.", phone: "skip" },
    { target: "wk-todo", title: "Put a to-do on a block", text: "Drag a story from a block's list onto any of that client's blocks this week. The block shows the fit as you drag; each drop has Undo.", example: "todo-drag", phone: { text: "Tap a block, then Add to… on a story. Long-press a to-do to move it." } },
    { title: "Check it off", text: "Tick a to-do when it's done. When it has a DevOps item you can change, FocusTime asks whether to set it done there too: Confirm, or Not now.", example: "done-offer" },
    { target: "wk-carry", title: "From last week", text: "Last week's unfinished work, suggested in each client's next block as dashed cards. Nothing moves until you keep it.", example: "pw-carry" },
  ],
  end: { line: "That's the Board. Plan today is the same screen, focused on one day.", tryIt: "Try it yourself: the Guide's Week section has a block to drag stories onto." },
};

const TODAY: Tour = {
  id: "today",
  title: "Today, focus and close out",
  summary: "What's next, what's urgent and the moment of the day.",
  start: { tab: "today", flow: null, date: null },
  section: "today",
  steps: [
    { target: "today-next", title: "What's next", text: "The block you're in and its next to-do, with the one Start focus button. Focus sets your Teams status to Busy and counts the time." },
    { target: "today-urgent", title: "The urgent strip", text: "What needs you now: requests sorted as urgent, promises late or due within 2 hours, and work sent to you. The 3 most urgent, then N more in Inbox.", example: "urgent" },
    { target: "today-moment", title: "The moment card", text: "One card for the moment of the day: Plan today, then Midday check-in after lunch, then Close out. Each opens its flow; nothing is forced." },
    { target: "today-blocks", title: "Today's blocks", text: "Each block's meetings and to-dos in time order, with the line for now. Tick a to-do when it's done." },
    { title: "Close out", text: "At the end of the day: one line per client on where you left off, the DevOps updates you owe and the promises due. Then Done.", example: "closeout" },
    { target: "today-days", title: "Any day", text: "‹ › step to another day, read only. Back to today comes back.", phone: "skip" },
  ],
  end: { line: "That's Today. Most days it's the only screen you need.", tryIt: "Try it yourself: Today's Plan today card opens the Board on today." },
};

const INBOX: Tour = {
  id: "inbox",
  title: "The Inbox",
  summary: "One list of what needs a decision.",
  start: { tab: "inbox", view: "needs_you", item: null },
  section: "inbox",
  steps: [
    { target: "ib-rail", title: "Views and clients", text: "Everything first: every item in time order. Needs you, Promises and the rest are shortcuts to one status. Tick the clients you want to see.", phone: { text: "View and Clients at the top open one picker: the views, with counts, and the clients you want to see." } },
    { target: "ib-list", title: "Why it's here", text: "Each row says why it needs you: due, late, new, or waiting on you." },
    { target: "ib-pane", title: "The open item", text: "Its summary, the messages, the linked DevOps item and where it came from.", example: "ib-item", phone: "skip" },
    { target: "ib-acts", title: "Every action, the main one first", text: "Create DevOps item, Link, Close the loop or Accept leads, with the rest beside it. Anything outside FocusTime shows a preview first.", example: "ib-item" },
    { target: "ib-keys", title: "Close the loop", text: "When you've done what you promised, Close the loop (L): send the update by Teams, email, a DevOps comment or a call, after a preview of who sees it. Not needed closes it quietly. J and K move, Enter opens.", phone: "skip" },
  ],
  end: { line: "That's the Inbox. Needs you is the one number to keep at zero.", tryIt: "Try it yourself: the Guide's Inbox section has a list to open items in." },
};

const AHEAD: Tour = {
  id: "ahead",
  title: "Ahead",
  summary: "Past this week: your features and epics, and what they're missing.",
  start: { tab: "ahead", mode: "grid" },
  section: "ahead",
  steps: [
    { target: "modes-ahead", title: "Four modes", text: "Grid is a table you edit in place, Gantt the timeline, Gaps what's missing, Backlog each client's own order." },
    { target: "ah-owner", title: "Mine, Contributing, All", text: "Choose whose items show. FocusTime remembers your choice.", phone: "skip" },
    { target: "ah-pending", title: "Changes wait until you save", text: "Every edit collects here. Review shows before and after; Save writes them to DevOps, with Undo. Someone else's change since shows both.", example: "pending" },
    { at: { tab: "ahead", mode: "fix" }, target: "ah-fix-row", title: "Readiness: one next step", text: "Items missing stories, a target date, an owner or a size, near the top of each backlog. Each row has one next step, and Skip.", example: "gaps-row" },
    { at: { tab: "ahead", mode: "backlog" }, target: "ah-stale", title: "Backlog and Stale", text: "Each client's backlog in its own order. Stale shows open items nobody changed in DevOps for 6 weeks: push the date, give it an owner, or plan it." },
  ],
  end: { line: "That's Ahead. A look once a week keeps the next month honest.", tryIt: "Try it yourself: Gaps' count is in the mode switch." },
};

const ASSISTANT: Tour = {
  id: "assistant",
  title: "The assistant",
  summary: "Ask about your plan, or ask for a change you then confirm.",
  start: { tab: "today", flow: null, date: null },
  section: "assistant",
  steps: [
    { target: "ask", title: "Ask", text: "Ask in the top bar, Ctrl J or /. A panel opens beside the screen; on a phone, a sheet from the bottom.", phone: { text: "Ask in the bar at the bottom opens the assistant over the screen." } },
    { title: "It answers from your plan", text: "What's next, what's due tonight, where an item stands, what people promised. Answers are cards with links.", example: "ask-answer" },
    { title: "Change several at once", text: "\"Move the export stories to Friday\": one card lists every move, across clients. One Confirm, one Undo.", example: "ask-move" },
    { title: "Update an item", text: "Mark an item done and comment on it in one card, with the same preview as the buttons. Nothing happens until you Confirm.", example: "ask-update" },
  ],
  end: { line: "That's the assistant. It needs AI for FocusTime and Allow AI for the client.", tryIt: "Try it yourself: the Guide's assistant section has a scripted one to type into." },
};

const STATUS: Tour = {
  id: "status",
  title: "Status",
  summary: "This week's lines for Monday's status report.",
  start: { tab: "week", mode: "status", week: null, focus: null },
  section: "week",
  steps: [
    { target: "modes-week", title: "Week › Status", text: "Status is Week's fourth mode: what Monday's report will say for your features, by client." },
    { target: "st-toggle", title: "Edit and Preview", text: "Preview shows the report as its email will read: a heading per feature, each comment this week a bullet with its author." },
    { target: "st-add", title: "+ Add a line", text: "Each line becomes its own DevOps comment on the feature. Edit changes your own comments from this week.", example: "status-line" },
    { target: "st-draft", example: "status-draft", title: "Draft", text: "With AI allowed for the client, a first version from your story changes, close-out notes and captures. Edit it as you like." },
    { target: "st-push", example: "status-push", title: "Push all", text: "One preview of every new line and edit, then each is written with its own result, Retry and Undo. FocusTime never sends the report." },
  ],
  end: { line: "That's Status. A few minutes on Friday afternoon is plenty.", tryIt: "Try it yourself: Preview shows what Monday's report will say." },
};

/** Every tour, in the Guide's order. */
export const TOURS: readonly Tour[] = [PLAN_WEEK, BOARD, TODAY, INBOX, AHEAD, ASSISTANT, STATUS];

export const tourById = (id: string): Tour | undefined => TOURS.find((t) => t.id === id);
