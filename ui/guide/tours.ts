// UI-5 (GU-1: every step checked against the screen it points at, controls by their app name and icon): the Guide's
// "Show me" tours, as data. A tour opens a real screen and walks through it one element at a time:
// it only highlights and explains, never clicks, types or writes (ui/guide/tour/Tour.tsx blocks the page under it).
// Each step points at a `data-tour` hook on the real screen (listed in docs/guide.md). Where the screen has nothing
// there yet (no From last week, no client with blocks), the step shows a small example drawing instead.
// This file is plain data so nav.ts, the link checker and the tests can read it without loading the Guide.
import type { Nav } from "../nav.ts";

/** The example drawings a step can show in place of an empty highlight (ui/guide/tour/Illustrations.tsx). */
export type IllustrationId =
  | "todo-drag"
  | "done-offer"
  | "urgent"
  | "closeout"
  | "ib-item"
  | "attention-row"
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
  /** The step's words; Rich marks ({icon:add}, {b:Today}) are drawn by the tour card. */
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

// WD-1, WD-2: Plan the week's tour became adding work: Week is one screen, and work goes onto blocks from the block panel.
const PLAN_WEEK: Tour = {
  id: "plan-week",
  title: "Add work to your week",
  summary: "Put features, stories and promises on your blocks from the one panel beside Week.",
  // Opens with the panel on the block under way (or the next one), so its steps have something to point at.
  start: { tab: "week", mode: "board", week: null, add: { date: null, half: null } },
  section: "week",
  steps: [
    {
      target: "wk-add",
      title: "Add",
      text: "Opens the block's panel on the block under way, or the next one, with the cursor in its Add box. Each block also has its own Add at the bottom, and A opens it on the selected block.",
      phone: { text: "Add on a block opens its panel as a sheet." },
    },
    {
      target: "aw-panel",
      title: "One panel for a block",
      text: "The panel says which block it is on, its hours and how much room is left, then what's on the block and its meetings. Click another block and it follows; Esc closes it.",
      phone: "skip",
    },
    {
      target: "aw-features",
      title: "Assigned to you",
      text: "Your features and stories for this client, in backlog order, each story under its feature and saying where it is. More in the client, below, has everyone else's. {icon:add} Add to this block puts a row on it, or drag the row onto any block. Drag a to-do from a block back onto the panel to take it off the plan.",
      example: "todo-drag",
      phone: "skip",
    },
    {
      target: "aw-box",
      title: "One box to add",
      text: "Type to search this client's work and your promises. Up and Down move, Enter takes the highlighted row. The rows for something new (New to-do, New draft story) are always at the end, so with no match Enter makes a to-do.",
      phone: "skip",
    },
  ],
  end: { line: "That's adding work. About 15 minutes on a Thursday or Friday.", tryIt: "Try it yourself: press A on Week, or Add on any block." },
};

const BOARD: Tour = {
  id: "board",
  title: "Your week and to-dos",
  summary: "Your half-day blocks for the week, and the to-dos on them.",
  start: { tab: "week", mode: "board", week: null, add: null },
  section: "week",
  steps: [
    { target: "wk-block", title: "A block", text: "Week shows this week's half-day blocks, Monday to Friday, with one day for catch-up (Friday unless your week is set up differently). Each is half a day for one client, from Focus Time in Dataverse. It says when it's at risk and why, like a dentist at noon. Click it to open its panel.", phone: { text: "Half a day for one client, from Focus Time in Dataverse. It says when it's at risk and why. Tap it for that client's stories." } },
    { target: "wk-timeline", title: "Cards or Timeline", text: "Timeline shows the hours beside each block: meetings, free time and the line for now. Cards gives the to-dos the whole width. B switches.", phone: "skip" },
    { target: "wk-todo", title: "Put a to-do on a block", text: "Drag a to-do onto another of that client's blocks this week, or a story from the panel onto a block. The block shows its free time as you drag; each drop has Undo.", example: "todo-drag", phone: { text: "Tap a block, then Add to… on a story. Long-press a to-do to move it." } },
    { title: "Check it off", text: "Tick a to-do when it's done. When it has a DevOps item you can change, Wrap it up opens: Finished or Made progress, a preview, then Confirm. Skip DevOps keeps only the tick.", example: "done-offer" },
    { target: "wk-carry", title: "To place", text: "The line above the week counts what's waiting: unfinished work, last week's and anything a teammate sent. Review opens it in the block's panel. Nothing moves until you place it." },
  ],
  end: { line: "That's Week. One screen, with a block's panel beside it.", tryIt: "Try it yourself: the Guide's Week section has a block to drag stories onto." },
};

const TODAY: Tour = {
  id: "today",
  title: "Day, focus and close out",
  summary: "What's urgent, the moment of the day and the day's blocks.",
  start: { tab: "today", flow: null, date: null },
  section: "day",
  steps: [
    { target: "today-urgent", title: "The urgent strip", text: "What needs you now: promises late or due within 2 hours, and work sent to you that waits for your answer. The 3 most urgent. From chats · N beside it opens the conversations that need a DevOps item.", example: "urgent" },
    { target: "today-moment", title: "The moment card", text: "One card for the moment of the day: Nothing on today yet (with {icon:add} Add), then Midday check-in after lunch, then Close out. Each opens its flow; nothing is forced." },
    { target: "today-blocks", title: "The day's blocks", text: "The same block cards as Week. The next to-do has the one Start focus button; focus sets your Teams status to Busy and counts the time. Add on a block, or a click on it, opens its panel. Tick a to-do when it's done.", phone: { text: "Your to-dos by block. Add under a block opens its panel as a sheet. Tick a to-do when it's done." } },
    { title: "Close out", text: "At the end of the day: one line per client on where you left off, the DevOps updates you owe and the promises due. Then Done.", example: "closeout" },
    { target: "today-days", title: "Any day", text: "{icon:back} Previous day and {icon:next} Next day step to another day, and {b:Today} comes back. The day that is today and later days take work; a past day lets you tick what got done and move the rest forward.", phone: "skip" },
  ],
  end: { line: "That's Day. Most days it's the only screen you need.", tryIt: "Try it yourself: Add on one of today's blocks." },
};

const INBOX: Tour = {
  id: "inbox",
  title: "The Inbox",
  summary: "Three short lists: suggestions from chats, your promises and your captures.",
  start: { tab: "inbox", view: "chats", item: null },
  section: "inbox",
  steps: [
    { target: "ib-rail", title: "Three lists", text: "From chats, Promises and Captures, each with its count. The chips under them choose clients. FocusTime remembers the list you used last." },
    { target: "ib-list", title: "From chats", text: "A conversation shows here when it asks for work no DevOps item covers yet, after it has been quiet for 4 working hours. Hover a row to see why. Click it to open the messages in place." },
    { target: "ib-acts", title: "Create item, Already covered, Dismiss", text: "Create item (C) fills a new item from the conversation and shows a preview first. Already covered (L) links one that exists. Dismiss (X) takes it off your list only.", example: "ib-item" },
    { target: "ib-keys", title: "The keys, and Promises", text: "This line lists the keys: J and K move, Enter opens a row, and each action has its letter. In Promises, the second list, what you said you'd do in a chat clears on its own when its item is finished, or after 7 days untouched past due; Put back brings it back.", phone: "skip" },
  ],
  end: { line: "That's the Inbox. Most days it's a few rows, and they go away on their own.", tryIt: "Try it yourself: open a row in From chats." },
};

const AHEAD: Tour = {
  id: "ahead",
  title: "Backlog",
  summary: "Every client's DevOps on one screen: edit, clean up and organize.",
  start: { tab: "ahead", mode: "grid" },
  section: "backlog",
  steps: [
    { target: "modes-ahead", title: "Grid and Gantt", text: "Grid is a table you edit in place, client by client in each backlog's order. Gantt is the same items on a timeline: drag a bar to move its dates. P switches." },
    { target: "ah-owner", title: "Mine, Contributing, Everyone", text: "Choose whose items show. FocusTime remembers your choice for each client.", phone: "skip" },
    { target: "ah-attention", title: "Needs attention", text: "Only the items with something to fix: missing stories, a target date, an owner or a size, or stale. Each has its fix beside it, and Skip. Work from the top.", example: "attention-row", phone: "skip" },
    { target: "ah-filter", title: "Filter", text: "Epic, dates and the levels shown. One level as a list shows each client's backlog in its own rank order, with the rank number.", phone: "skip" },
    { target: "ah-pending", title: "Changes wait until you save", text: "Every edit collects here. Review shows before and after; Save writes them to DevOps, with Undo. Someone else's change since shows both.", example: "pending" },
  ],
  end: { line: "That's Backlog. A look once a week keeps every client's DevOps clean.", tryIt: "Try it yourself: turn on Needs attention and fix the top row." },
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
  start: { tab: "status" },
  section: "status",
  steps: [
    { target: "tab-status", title: "Status", text: "Status is its own tab (4): what Monday's report will say for your features, by client." },
    { target: "st-toggle", title: "Edit and Preview", text: "Preview shows the report as its email will read: a heading per feature, each comment this week a bullet with its author." },
    { target: "st-add", title: "Add a line", text: "Each line becomes its own DevOps comment on the feature. Edit changes your own comments from this week.", example: "status-line" },
    { target: "st-draft", example: "status-draft", title: "Draft", text: "With AI allowed for the client, a first version from your story changes, close-out notes and captures. Edit it as you like." },
    { target: "st-push", example: "status-push", title: "Push all", text: "One preview of every new line and edit, then each is written with its own result, Retry and Undo. FocusTime never sends the report." },
  ],
  end: { line: "That's Status. A few minutes on Friday afternoon is plenty.", tryIt: "Try it yourself: Preview shows what Monday's report will say." },
};

/** Every tour, in the Guide's order. */
export const TOURS: readonly Tour[] = [PLAN_WEEK, BOARD, TODAY, INBOX, AHEAD, ASSISTANT, STATUS];

export const tourById = (id: string): Tour | undefined => TOURS.find((t) => t.id === id);
