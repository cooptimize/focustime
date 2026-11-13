// The Guide's words, all in one file, so wording can change without touching layout (ui/guide/Guide.tsx).
// GU-1 rebuilt it to match the app as it is: the tabs are Day, Week, Backlog, Status and Inbox; a control is named by
// the name it has in the app, with the app's own icon beside the word ({icon:more} More); a path reads "More › About";
// and every sentence was checked against the app (docs/ux/gu1/ledger.md). Everything here is example data, labeled as
// such on screen; the Guide never shows the person's own clients, work or calendar.
//
// Marks in the copy (ui/guide/shortcuts.ts `richParts`):
//   {key:<command>}   that row's keys from ui/keys.ts (or {key:Ctrl K} for a key with no command): never typed
//   {icon:<name>}     one of the app's icons, by its name in ui/icons.tsx, beside the control's name
//   {b:<label>}       a label exactly as the app has it (ui/guide/app-names.test.ts checks it is the app's)
//   {size:<text>}     a size chip
// A step that changes a name or a control in the app updates this file and ui/guide/retired.ts in the same pull
// request (docs/guide.md).

/** Example client colors, from the app's client slots (ui/styles.css). */
export type ExampleColor = "blue" | "teal" | "violet" | "ochre";

/** A key or keys from ui/keys.ts: by the command it mirrors, or by its first key when it has none. */
export type KeyRef = { command: string } | { key: string };

export type QA = { q: string; a: string };

/** The sizing try-it, in Week. */
export const SIZING = {
  title: "Try it: how much time is free in a block?",
  sub: "A block is where you work: half a day for one client. Hours are how big the work is. Add stories and watch them fill the free time.",
  blockTitle: "One focus block",
  /** The example block: an afternoon with 4h of focus time left after its meetings (what the fit is measured against). */
  block: { label: "Northwind · Mon PM · example", color: "teal" as ExampleColor, freeMinutes: 240, free: "4h free after meetings" },
  empty: "Empty block",
  /** "3h of 4h": the stories' hours against the block's free time. */
  load: (planned: string, free: string) => `${planned} of ${free}`,
  /** The add buttons: S, M and L with their hours, and an unsized story. */
  add: (size: "XS" | "S" | "M" | "L" | null) => (size ? `${size} · ${{ XS: "30 min", S: "1h", M: "2h", L: "4h" }[size]}` : "unsized"),
  clear: "Clear",
  stackLabel: "Stories in this block",
  remove: (chip: string) => `Remove ${chip} story`,
  start: ["M", "S"] as ("XS" | "S" | "M" | "L" | null)[],
  /** Most the sandbox takes: three blocks' worth of hours (12h). */
  maxMinutes: 720,
  legend: [
    "{b:S} 1h · {b:M} 2h · {b:L} 4h",
    "Sizing is optional. An unsized story counts as 1h until you size it. Change that in Settings › Today and Week.",
    "Hours are a guide, not a limit. Plan what you like; what doesn't get done moves forward.",
    "Features are their stories added up, or your estimate until they're sized.",
  ],
  hint: "Tap a story chip to remove it.",
};

export const DEVOPS = {
  title: "DevOps first",
  quote: ["If it isn't in DevOps, ", "it isn't planned yet."] as const,
  body: "FocusTime makes the healthy path the easy one. It reads your work from DevOps, nudges big things into smaller pieces, and offers to update DevOps when you finish. It never changes anything without showing you first.",
  // WT-1: levels come from each client's DevOps process, not type names; the icon is the type's usual DevOps icon.
  ladder: [
    { level: "Top", icon: "icon_crown", text: "Epics (or whatever the top level is called). Live in Backlog. Need features before they reach a week." },
    { level: "Parent", icon: "icon_trophy", text: "Features, and any type at the same level. Go on a week once something of them is placed." },
    { level: "Needs stories", text: "A feature with no stories can't go on a day yet. {b:Break down} or send a {b:Coop brief}. An admin can turn this off for a type that's worked directly.", flag: true },
    { level: "Child", icon: "icon_book", text: "Stories, and bugs and tasks where the team tracks them. Go on a day, get a size, get done." },
    { level: "Done", text: "Tick it and Wrap it up opens: Finished or Made progress, then one preview and {b:Confirm}. Close out asks once for the day's. Resolved in DevOps means no hours left; it drops off planning lists." },
  ] as { level: string; icon?: string; text: string; flag?: boolean }[],
  /** WT-1: the icons that stand for work item types, drawn in each project's own colors. */
  icons: {
    intro: "FocusTime shows a small icon for each work item type instead of its name, in the color the client's DevOps project gives it. Hover an icon to see the type's name. The usual ones:",
    legend: [
      { icon: "icon_crown", color: "E06C00", name: "Epic, Domain" },
      { icon: "icon_trophy", color: "773B93", name: "Feature" },
      { icon: "icon_asterisk", color: "5c197b", name: "Recurring" },
      { icon: "icon_flame", color: "5c197b", name: "Ongoing, Risk" },
      { icon: "icon_book", color: "009CCC", name: "User Story" },
      { icon: "icon_list", color: "009CCC", name: "Product Backlog Item" },
      { icon: "icon_clipboard", color: "A4880A", name: "Task" },
      { icon: "icon_insect", color: "CC293D", name: "Bug" },
      { icon: "icon_gavel", color: "222222", name: "Decision" },
      { icon: "icon_parachute", color: "009CCC", name: "Action Item" },
      { icon: "icon_chart", color: "e87025", name: "Change Request" },
      { icon: null, color: null, name: "Any other type" },
    ] as { icon: string | null; color: string | null; name: string }[],
  },
};

/** One shortcut card: a label and the keys it takes from ui/keys.ts (each row's first key, or every key of one row). */
export type ShortcutCard = { label: string; keys: KeyRef[]; all?: boolean };

export const SHORTCUTS = {
  title: "The shortcuts worth learning",
  sub: "Everything works with the mouse. These save you a few clicks a day. {key:Ctrl K} lists every action with its key.",
  // In the app's own order: the tabs, then what you do on them.
  cards: [
    { label: "Day, Week, Backlog, Status, Inbox", keys: [{ command: "view.today" }, { command: "view.week" }, { command: "roadmap.load" }, { command: "view.status" }, { command: "view.inbox" }] },
    { label: "Open a block (A puts the cursor in Add)", keys: [{ command: "ui.block" }, { command: "view.planweek" }] },
    { label: "Add work (on Backlog, Grid or Gantt)", keys: [{ command: "view.plan" }] },
    { label: "Midday check-in", keys: [{ command: "view.checkin" }] },
    { label: "Close out", keys: [{ command: "closeout.load" }] },
    { label: "Capture a thought", keys: [{ command: "capture.add" }], all: true },
    { label: "Ask the assistant", keys: [{ command: "assistant.ask" }], all: true },
    { label: "Every action", keys: [{ key: "Ctrl K" }] },
    { label: "Next or previous row in the Inbox", keys: [{ key: "J" }], all: true },
    { label: "Text size", keys: [{ command: "ui.set_text_size" }], all: true },
  ] satisfies ShortcutCard[],
  every: "Every key",
};

export const FOOTER = "FocusTime by Cooptimize. Questions or ideas? {icon:more} More › Send feedback, or message the FocusTime team in Teams.";
/** DOC-1: the footer's link to the Technical docs (signed in only). */
export const TECH_DOCS_LINK = { label: "How FocusTime works under the hood", href: "#/docs" };

// ---------- Ways in ----------

export const TOUR = {
  /** The sign-in page and a person's first Day. */
  link: "New here? Start here (about 10 minutes)",
  dismiss: "Not now",
  close: "Close",
  signIn: "Back to sign in",
};

/** Start here. About 250 words: what FocusTime is for, the day in five steps, the week in three. */
export const START = {
  eyebrow: "Start here",
  title: "Plan features. Work stories. DevOps stays current.",
  why: [
    "Plan at the feature level, and work at the story level.",
    "DevOps is the system of record. FocusTime keeps it current without extra effort.",
    "The healthy path is the easy path. Re-planning is normal, never a failure.",
  ],
  markLabel: "The FocusTime week: four half-day columns, morning over afternoon",
  day: {
    title: "Your day, in five steps",
    where: "Day",
    steps: [
      { name: "Add work", text: "In the morning, {icon:add} Add on the day's blocks puts stories on them.", teams: true },
      { name: "Focus", text: "The next to-do has one Start focus. The urgent strip at the top shows what's due now.", teams: false },
      { name: "Check it off", text: "Tick a to-do when it's done. FocusTime offers the DevOps update.", teams: false },
      { name: "Midday check-in", text: "After lunch: what's done, the free time left, and Move to… on anything unfinished.", teams: true },
      { name: "Close out", text: "One line per client on where you left off, and the DevOps updates you owe.", teams: true },
    ],
    teams: "Also in Teams",
  },
  week: {
    title: "Your week, in three",
    steps: [
      { name: "Add work", where: "Week", text: "Thursday or Friday: open next week and place its features and stories on your blocks. What's on your week is your plan.", tour: "plan-week" },
      { name: "Your blocks", where: "Week", text: "Your half-day blocks and their to-dos. Timeline shows each block's hours.", tour: "board" },
      { name: "Status", where: "Status", text: "Before Monday's status report, write a line per feature. It goes to DevOps as a comment.", tour: "status" },
    ] as { name: string; where: string; text: string; tour: string | null }[],
  },
  promises: {
    title: "Two things that never change",
    items: [
      { name: "FocusTime proposes, you confirm", text: "Every change to DevOps or Outlook, and every message, shows a preview first. Changes have Undo; a sent message can't be unsent. Your own plan changes from a tap happen at once, with Undo." },
      { name: "Clients stay separate", text: "One client's work never shows in another client's view, AI request or post. AI is optional, and allowed per client." },
    ],
    /** The proposal card's two states (an animation from one to the other). */
    proposal: { ask: "Set #4411 to Closed?", confirm: "Confirm", done: "Done", undo: "Undo", replay: "Play again", label: "Example: a proposal, confirmed" },
  },
  showMe: "Show me",
  /** Signed out there are no screens to show. */
  signedOut: "Sign in to see it on your own screens.",
};

/** The words of the tour card (ui/guide/tour/Tour.tsx). */
export const TOUR_UI = {
  stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  back: "Back",
  next: "Next",
  finish: "Finish",
  skip: "Skip tour",
  example: "Example: what it looks like once there's something here",
  loading: "Opening the screen…",
  endTitle: "You're set",
  toGuide: "Back to the Guide",
  done: "Done",
  keys: "→ next · ← back · Esc skips",
  label: (title: string) => `Tour: ${title}`,
};

/**
 * The example data the tours' drawings use where a real screen has nothing yet. Fictional, labeled as an example.
 * A card's `kind` says which of the app's shapes it is drawn in (ui/guide/tour/Illustrations.tsx): a block card, a list
 * of rows, or a preview. `tag` is a status pill on a row; an action is a button's own label.
 */
export type ExampleCard = { kind: "block" | "rows" | "preview"; head: string; meta: string; color: ExampleColor | null; rows: [string, string][]; actions: string[]; main?: string };
export const TOUR_EXAMPLES = {
  /** The other tours' drawings, each one small card: a heading, rows and the buttons it would have. */
  cards: {
    "todo-drag": { kind: "block", head: "Northwind · Mon PM", meta: "2h of 3h free", color: "teal", rows: [["Export button", "M · 2h"], ["Date filter, dropped here", "S · 1h"]], actions: ["Undo"] },
    "done-offer": { kind: "preview", head: "Wrap it up: #4411 Export button", meta: "Northwind", color: "teal", rows: [["State", "Active → Closed"], ["Remaining Work", "2 → 0"]], actions: ["Confirm", "Skip DevOps"], main: "Confirm" },
    urgent: { kind: "rows", head: "Urgent", meta: "", color: null, rows: [["Send the test plan to Alex", "1 day late"], ["Reply about the price list", "Due 2:00"], ["Supplier onboarding · Must", "Sent to you"]], actions: ["From chats · 2"] },
    closeout: { kind: "rows", head: "Close out · Monday", meta: "4 done · 3h 10m focused", color: null, rows: [["Where you left off", "Chart renders; next, the filter"], ["#4411 still Active in DevOps", "Mark done"], ["Reply to Jordan", "1 day late"]], actions: ["Done"], main: "Done" },
    "ib-item": { kind: "rows", head: "Fix the export's last day", meta: "Northwind · From chats", color: "teal", rows: [["Priya says the export stops a day early on Sundays.", ""], ["Why it needs an item", "Asks for a fix no item covers yet"]], actions: ["Create item", "Already covered", "Dismiss"], main: "Create item" },
    "attention-row": { kind: "rows", head: "Northwind · Portal", meta: "3 need attention", color: "teal", rows: [["Customer portal redesign", "Set dates"], ["Export button on the order page", "Size"], ["Supplier onboarding", "Break down"]], actions: ["Skip"] },
    pending: { kind: "preview", head: "3 changes to save", meta: "", color: null, rows: [["Order history export · Target", "Nov 20 → Dec 4"], ["Invoice totals · Size", "none → 8h"]], actions: ["Review"], main: "Review" },
    "ask-answer": { kind: "rows", head: "What's next?", meta: "", color: null, rows: [["Export button", "Northwind · Mon PM · M"], ["Then: Date filter", "S · 1h"]], actions: ["Open Day"] },
    "ask-move": { kind: "preview", head: "Move 3 to-dos to Friday", meta: "Only your plan changes", color: null, rows: [["Export button", "Mon PM → Fri"], ["Date filter", "Tue AM → Fri"], ["Harbor test plan", "Wed AM → Fri"]], actions: ["Confirm", "Edit", "Cancel"], main: "Confirm" },
    "ask-update": { kind: "preview", head: "Update #4411", meta: "Northwind DevOps", color: "teal", rows: [["State", "Active → Closed"], ["Comment", "shipped"]], actions: ["Confirm", "Cancel"], main: "Confirm" },
    "status-line": { kind: "rows", head: "Order history export", meta: "Northwind · No update yet", color: "teal", rows: [["Export runs for any range; filter next", "new line"]], actions: ["Add a line", "Draft"] },
    "status-draft": { kind: "rows", head: "Draft for Northwind", meta: "Example · AI, from your week", color: "teal", rows: [["Order history export", "Export runs for any range"], ["Invoice totals", "Rounding fixed, in test"]], actions: ["Use", "Edit", "Dismiss"] },
    "status-push": { kind: "preview", head: "Push 3 lines to DevOps", meta: "Northwind · one preview", color: "teal", rows: [["Order history export", "2 new lines"], ["Invoice totals", "1 edit"]], actions: ["Push all", "Cancel"], main: "Push all" },
  } as Record<string, ExampleCard>,
};

// ---------- The questions, by the section a person would look in. No answer is over 120 words. ----------

const Q_FIRST_DAY: QA[] = [
  { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
  { q: "Can anyone else see my plan?", a: "Not your to-dos, hours, notes, promises, captures or settings: those are yours. Teammates on a client see which features are on your week for it, and Monday's status report counts them as active. They also see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
  { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings › Activity (a message or email you sent can't). In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
  { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Day shows a quiet line while steps are left, and Settings › Profile › Run setup again runs it again." },
  { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional, and so is adding any calendar by its link (iCloud, Outlook, school apps). If you add one, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
  { q: "Does FocusTime use AI?", a: "Only where your FocusTime admin turns it on: AI for FocusTime and each client's Allow AI are set in Admin › AI, and Settings › AI and assistant shows them. What's sent is only what one task needs, about one client at a time; FocusTime checks it first and won't send another client's details, keys or passwords, your VM, or email addresses from outside Cooptimize. Your AI use stops at your monthly limit (10 dollars unless an admin changes it). Settings › AI and assistant shows this month's cost and your last 20 requests, never their text, and Test AI checks it works." },
  { q: "How fresh is what I see from DevOps?", a: "FocusTime reads each client's DevOps once for everyone, about every minute in working hours and every 10 minutes outside them while someone is using it. Every open screen picks up a change on its own within about 2 minutes, keeping your scroll, selection and anything you're editing. The bar at the bottom says when DevOps was last checked. {key:week.load}, or Refresh there, checks now and says what it found. If a read fails, you keep the last good one, with its time. A change you make from FocusTime shows at once." },
  { q: "An item I made in DevOps isn't showing. Why?", a: "Settings › DevOps › Find an item: choose the client, type the item number, and it says whether DevOps has it, whether FocusTime has it yet, whether it's inside the area FocusTime shows for that client, and whether Day, Week, Backlog and Status show it, with why not. It answers from FocusTime's last check of DevOps; Refresh checks now." },
];

const Q_DAY: QA[] = [
  { q: "What is the moment card?", a: "Day's one card for the moment of the day: Nothing on today yet (with {icon:add} Add) while the day's blocks have no to-dos, Midday check-in once your afternoon starts, and Close out near the end of your day. Each opens its flow; once it's done it's a small line with Reopen. Nothing is forced: skip any of them." },
  { q: "What's in the urgent strip?", a: "Your promises that are late or due within the next 2 hours, and work sent to you that waits for your answer (a Must first): the 3 most urgent. A promise due later waits at its time on the Timeline and on Week's rail. Beside the strip, From chats · N opens the conversations that need a DevOps item." },
  { q: "Can I look at another day?", a: "Yes. {icon:back} Previous day and {icon:next} Next day (or {key:week.prev} and {key:week.next}) step to another day, and {b:Today} comes back. The day that is today and every later day take work: each block has {icon:add} Add. A past day's blocks open to tick what got done and move the rest forward. A PTO day says you're off, with nothing nagging." },
  { q: "How do I start focus on a to-do?", a: "The next to-do on Day has the one Start focus button, which starts the timer on it. {key:timer.start} or Focus in the top bar opens a menu instead: a to-do to time, or a plain timer. While it runs, the top bar shows the countdown; click it for the focus screen, with Done, +15 and Stop, a sound, and Deep focus (Do not disturb in Teams). Plain focus sets your Teams status to Busy. The time counts on the to-do for Close out." },
  { q: "Does checking off a to-do change DevOps?", a: "Not by itself. Tick a story that has a DevOps item, anywhere (Day, Week, the focus timer's Done, the Midday check-in), and the tick lands at once and Wrap it up opens. Close it, or Skip DevOps, and only the tick stays. It opens only for items you can change that aren't done already, on clients where you've turned on DevOps writes. Settings › Today and Week › When I tick a story turns it off." },
  { q: "How do I wrap up a story?", a: "Tick it, or Wrap it up on its card. {b:Finished} sets the item's done state (the one you use most for that client) and Remaining Work to 0. {b:Made progress} keeps the state (a New item moves to Active), asks how much is left (30m, 1h, 1.5h, 2h or type it) and keeps the story's later to-dos on your plan. Add a comment, or Suggest for a draft of one. Preview shows every change in one line, then Confirm writes them, each with its own result and Retry. Undo puts the tick back and offers each DevOps change's own undo." },
  { q: "What does Close out ask?", a: "One line per client on where you left off, the day's done stories for one DevOps update (Finished or Made progress, the time left and a comment for each, then one Preview and one Confirm), the promises due, and any timebox that ended. Then Done. {key:closeout.load} opens it; the moment card offers it near the end of your day." },
  { q: "Timeboxes and check-ins: how do they work?", a: "A timebox is a work session: it can be shorter than the to-do, and it never changes the to-do's size. At Midday check-in and Close out, any timebox that ended gets Done, Partly (say how much is left) or Didn't get to it, or All went to plan for the lot. What you skip comes back at the next one. Once there's progress, the to-do shows \"1h of 2h left\" and planning uses what's left. Done means the story is done, so its to-dos on later days come off the plan, and Undo puts them back." },
  { q: "How does the timeline work?", a: "Timeline, in Day's header, or {key:ui.set_today_timeline}, shows the day as hours. Each block's to-dos are listed beside its hours, the ones with a time first. Drag one from Not timeboxed yet onto the hours, move or resize it, or drag it back to take its time off, each with Undo. Timebox my day adds dashed suggestions: {icon:done} Accept or {icon:close} Drop each, or Accept all." },
  { q: "How do I use the timeline with the keyboard?", a: "Tab to a to-do. On one that has no time yet, T puts it at the next free time that fits. On one with a time, Up and Down move it 15 minutes, Shift with Up or Down changes its length, and Backspace takes the time off. Undo is in the message that follows each change." },
  { q: "How does the timeline work on a phone?", a: "Turn on Timeline under {icon:more} View options on Day; the phone remembers this separately from your computer. Tap a to-do without a time, then Pick a time, and choose from the 15-minute list. Tap one with a time for Move or Un-timebox. Timebox my day shows its suggestions with {icon:done} Accept and {icon:close} Drop, and Accept all." },
  { q: "Does Timebox my day write to my calendar?", a: "Only if you tick Put on Outlook in its bar. You then see every Outlook event in one preview, and nothing is written until you confirm it. Without that, timeboxes stay in FocusTime. Suggestions stay clear of your meetings; a time you drag yourself can overlap one if you want it to." },
  { q: "Why can't I move some of my old timeboxes?", a: "Timeboxes made by an earlier FocusTime, before you signed in here, show as ordinary Outlook events. FocusTime leaves them alone; change or delete them in Outlook." },
  { q: "What is the line across the day?", a: "The time now, on the blocks of the day that is today, with the time at its left end. Where a block has no hour rail, the time sits in the header of the block under way. The part of the day that has passed is a little dimmer. Before or after your hours it sits at the top or bottom edge of the day." },
  { q: "What is a story card?", a: "A work item's title anywhere in FocusTime opens its card here, not DevOps: its state, type, who has it, iteration, size, Remaining Work and dates, its feature and epic, its description and acceptance criteria, the latest comments, and your to-dos, timeboxes and promises on it. From the card: Wrap it up, Edit, Add comment, Change state, Assign, Dates, Move… and Break down, each with the usual preview and Confirm. Copy DevOps link is at the foot. Esc or {icon:close} Close closes it, and Back returns to the one before." },
  { q: "How do I fix an item's title, description or parent?", a: "Open its story card and choose Edit (or E). The title, description and acceptance criteria become boxes in place, with Bold, Italic, Bullets, Numbers and Link and a look at how DevOps will show it. Save (Ctrl+Enter) opens one preview with the text before and after; nothing is written until you confirm. If someone changed the item meanwhile, nothing is written, your words stay, and Save again is offered. Move…, beside the parent or under the card's {icon:more} More, puts the item under another feature or epic. Undo is in Settings › Activity." },
  { q: "Which items can I edit?", a: "Items you own, the features under an epic you own, and anything on a client you lead. A description with a table, an image or a mention isn't a box: Add to the end adds your text after it. Move… changes only the parent link, never the item's order, area or dates." },
  { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off, and so is an observed company holiday, shown by its name (\"Thanksgiving Day (observed)\") instead of PTO. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it." },
  { q: "Can I change my hours for one day, or block time?", a: "Yes, from a day's {icon:more} Actions menu on Week: Working hours for this day… sets that day's own hours (Use the usual hours puts them back), Block time as unavailable… takes time out of a block's free time, and Add a flex session… adds work time outside your hours." },
  { q: "What is I'll make it up…?", a: "A to-do you won't get to in its block: its {icon:more} More menu has I'll make it up…, for tonight, Friday or another day. The to-do moves there and the time shows as borrowed, with a flex session offered for an evening or a weekend. It counts as paid when the to-do is done." },
  { q: "How do I ask a teammate to work with me?", a: "Ask to collaborate, under a to-do's or an item's {icon:more} More: it lists Cooptimizers on the client first, shows when you're both free in everyone's working hours (a teammate's PTO shows only as away), and sends a help invite to their Outlook after a preview. Undo cancels the invite. Teammates' calendars are never shown, only free and busy." },
];

const Q_WEEK: QA[] = [
  { q: "How do I plan stories into Week's blocks?", a: "Click a block. Its panel lists your open stories for that client, grouped under their features, in DevOps backlog order. Drag a story onto any of this week's blocks for that client, the catch-up day included. While you drag, the block shows its free time, like \"2h of 3h free\"; PTO, past half-days and other clients' blocks say no. Each drop has Undo. Without a mouse, use {icon:add} Add on the row, or Move under its {icon:more} More; on a tablet, press and hold. A story planned elsewhere stays in the list as \"Planned · Thu AM\"." },
  { q: "A feature on my week has no stories for me. Now what?", a: "In the block's panel, type a title in the Add box and choose New draft story: it's saved under the feature for you, to add in DevOps when it's ready. Break down, on the feature, opens the Break down panel, where AI can propose its stories. If a teammate has a story there, Take one assigns it to you after a preview: the person who had it gets a quiet note in FocusTime, and Undo in Settings › Activity gives it back." },
  { q: "What is From last week?", a: "When a new week starts, To place (at the bottom of a block's panel) shows last week's features per client with one suggestion each; the line over Week counts them. A feature with your open stories carries over with them. One that's resolved shows as Finished last week. If your part is done, or it was never yours, you can keep watching it or take a story. Nothing is added until you choose Keep, Watch or Accept all, and a row you drop doesn't come back that week." },
  { q: "What does Watching mean?", a: "You're keeping a feature moving without doing its stories. Each Watching row gets a 30-minute check-in on the client's first block of the week that hasn't ended; it shows on Week as a dashed Check-in chip and becomes a to-do when that day comes. Move or remove it from the chip. If none of its stories changed state since Monday, from Wednesday the row turns amber, \"No movement this week\", with who to check in with." },
  { q: "What are the suggested rows in my blocks?", a: "When a block on the day that is today or your next working day is empty, FocusTime suggests work for it: that client's unfinished to-dos first, then your open stories in backlog order, at most four and only what fits. Hover one for why. Click it or {icon:add} Keep to make it a to-do, {icon:close} Clear to drop it for the week. A block with two or more has Keep all and Clear. They count against nothing and go once the block has a to-do. Turn them off in Settings › Today and Week, or with Suggestions under {icon:more} View options on Day or Week." },
  { q: "Why are some unfinished to-dos in a list instead?", a: "When the client has no block left this week, its unfinished to-dos go in Unfinished from earlier days, grouped by client and feature. Drag one onto any block or use Move to…. To-dos from an earlier week fold under From last week the same way." },
  { q: "Cards or Timeline?", a: "Cards and Timeline, in Week's header, switch in one click ({key:ui.set_show_timelines}, also under {icon:more} View options). On Cards, each block uses its full width for its to-dos and lists its meetings with their times. Timeline adds a slim hour rail beside each block, with meetings, free time and the line for now. Under {icon:more} View options, Timelines chooses the hours the rails show: Business hours, 12 hours or 24 hours ({key:ui.set_view_range}). FocusTime remembers both." },
  { q: "Why are some days narrow strips on Week?", a: "Week gives the day in focus the most room: about twice a working day. On a smaller window, at a larger Text size or with the panel open, days fold into narrow strips before any day gets too narrow to read a title: the weekend first, then the catch-up day, then past days, then the days farthest from today. A strip shows each block's client color with its count of open to-dos, PTO and the now line, and you can drop a story on it. Click a strip, or press Enter on it, to open that day." },
  { q: "Can I hide the catch-up day or the weekend?", a: "Yes, each on its own: under Week's {icon:more} View options, Show weekend and Show with your catch-up day's name (Show Friday when it's Friday); both are also in Settings › Display › Days on Week. A hidden day stays hidden even when something is on it; one quiet line under Week's header says so, like \"Fri hidden · 2 to-dos\", with Show to bring it back until you leave Week." },
  { q: "When do Saturday and Sunday show on Week?", a: "Week is Monday to Friday until something lands on a weekend day: a calendar item, a to-do or a promise due that day. Then that day shows as a narrow, quiet column with its items as plain rows: no blocks, nothing about capacity or risk. Every weekend day, under Week's {icon:more} View options, shows the weekend always. You can move a to-do onto a weekend by dragging it, from Move under its {icon:more} More, or by asking the assistant. Work after a weekday's afternoon shows in an Evening band under PM." },
  { q: "What is a Deployment to-do?", a: "A to-do for a release or go-live: a client, a day and a window (say Saturday 9:00 to 11:00), and if you like the DevOps items it covers and a note of what's going. It shows its own icon and window and moves like any to-do. Time outside your hours adds up on Week as \"3h after hours this week\". When you tick it done, FocusTime offers Tell <client> it's deployed: a draft you check and send through Close the loop, never automatically." },
  { q: "How do I plan a deployment?", a: "Capture a line like \"Deploy Saturday\" and choose Deployment, or use Plan a deployment… under a day's {icon:more} Actions on Week, or ask the assistant and Confirm. Set the client, the day and the window. The checkboxes list what can move for that client's data platform, with its usual items already ticked; add anything else as a Note. Week and Day show a count like \"4 items\": hover or tap it for the list. Kind, under a to-do's {icon:more} More, turns an existing to-do into one." },
  { q: "What does Call live mean?", a: "Someone started a Teams call in one of your client's delivery chats and it hasn't ended. Your block for that client says Call live in <chat>, when it started and who started it; {icon:call} Join opens the chat in Teams. It goes away when the call ends (or after 10 hours), within about 5 minutes. To start one yourself, use Start a call in <chat> under the block's {icon:more} Actions. FocusTime never starts, joins or records a call, and you see it only for chats you're in." },
  { q: "Do I have to size everything?", a: "No. Unsized stories count as 1h so the plan still adds up (change that in Settings › Today and Week), and nothing waits on a size. Size them when you know." },
  { q: "Does FocusTime tell me I planned too much?", a: "No. A block says how much free time it has left, or No free time; nothing warns you about how much is on it. Plan it like a punch list: what doesn't get done moves forward. A block says At risk only when your calendar cuts into it: meetings, a personal event or out of office." },
  { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
  { q: "How do I send work to someone?", a: "On a feature or story, Send to… under its {icon:more} More. Pick who (people on that client who use FocusTime), this week or next, Suggested or Must, and an optional note. Tick Ask them to take it in DevOps if it should be theirs there too. Only that client's leads can send a Must; anyone on the client can send a Suggested." },
  { q: "What do I do with something sent to me?", a: "It shows under To place at the bottom of a block's panel (the line over Week counts it), as one line on Day, and as a notification. Accept puts it on your week; Accept and schedule also opens the panel on the client's first block. Pass to… hands it to someone else on the client. Can't this week asks for a reason, which the sender sees. Nothing counts against your hours until you accept." },
  { q: "What if I can't take a Must?", a: "Say why. The sender sees Can't: <your reason>, and the client's other leads get a quiet note with it. The Must stays as a conflict, marked in amber for both of you, until the sender passes it on or withdraws it, or you accept it after all." },
  { q: "Does Accept change DevOps?", a: "Only if you leave Also assign to me in DevOps ticked. It's ticked when the sender asked you to take it, and unticked otherwise. Then the usual DevOps write runs: a preview, the item assigned to you, checked afterwards, with Undo in Settings › Activity and a quiet note to whoever had it." },
  { q: "How do I see what I sent?", a: "You sent, folded at the bottom of a block's panel: Waiting (Cancel while it waits), Accepted, Scheduled, Passed to <name>, Can't: <reason>, Done once DevOps resolves the item, or Not answered when its week ended with no answer." },
  { q: "What is a client priority?", a: "A feature a client's lead flags as the client's top ask, with an optional note. Everyone on the client sees it under To place in a block's panel, with Add to my week. A lead can unflag it any time, and it drops off once DevOps resolves it." },
  { q: "How do I ask a lead to look at my week?", a: "In a block's panel, open You sent at the bottom: Ask <lead> to look on the client, with an optional note. The lead gets a notification and can reply. The reply shows there under the client." },
];

const Q_BACKLOG: QA[] = [
  { q: "What are Backlog's Grid and Gantt?", a: "Two views of the same items: every client's DevOps on one screen. Grid is a table, client by client in each backlog's own order: Item, State, Dates, Assigned to, Size and Status, edited in place. Each client is a section you can fold, and its header says how many items it has and how many need attention. Gantt is the timeline: drag a bar by half-days to move its dates, with your free hours per week below. {key:view.plan} switches between them. Mine, Contributing and Everyone choose whose items show, and FocusTime remembers your choice." },
  { q: "How do I read Backlog's Gantt?", a: "Each row is one item: its type's icon and title, indented by level. The bar's look is its status: solid is on track, an amber edge at risk, muted and dashed stalled, a dashed open end means that date isn't set, light hatching that neither is, and an arrow at the edge means it runs past what's shown. The small flag at a bar's end gathers what needs attention, with a count; hover or focus it for the list and a fix for each (Break down, Set dates, Assign, Size). Callouts at the end of bars, under {icon:more} More in the toolbar, turns the flags off." },
  { q: "How do I fold Backlog's rows?", a: "The chevron beside a row opens or closes just that one; a closed row's bar spans what's under it and says how many (4 features). Under Filter, Levels shows Epics, Features or Stories; Expand all and Collapse all are under {icon:more} More in the toolbar. Keys: Up and Down move between rows, Left closes and Right opens. In Gantt, drag the edge of the item column to widen it. FocusTime remembers these choices in this browser." },
  { q: "How do Backlog's filters work?", a: "One row under the header, the same in Grid and Gantt: client chips, Mine, Contributing and Everyone, Needs attention with its count, and a search box (titles or #id). Filter holds Epic, Dates (Next 2 weeks, Next 4 weeks, This quarter, Any time, or your own dates) and Levels; its number says how many of those you changed. When a filter isn't at its default, a line under the row says Showing 12 of 40 with a chip for each one you can remove, and Clear filters puts them all back. FocusTime remembers it, and the address carries it, so a link you send opens the same view." },
  { q: "What does Needs attention show, and in what order?", a: "Items you can change that are missing stories, a target date, an owner or a size, or are stale, and only the ones that matter now: near the top of the client's backlog (the top 30 of each level, a number your FocusTime admin can change), dated in the next 4 weeks, or features and epics you own. They're in the client's backlog order, under their parents, so the order on screen is the order to work in. Each row has its fix (Break down, Set dates, Assign or Size) and Skip; the first 10 per client show, then Show more. The count on the chip is all of them for the clients and filters you're showing." },
  { q: "How do I work through Needs attention?", a: "Turn on Needs attention and start at the top. The counts beside Why these? (Needs stories, No target date, Unassigned, Unsized, Stale) each show just that kind when clicked. Fix right on the row: Set dates, Assign and Size open the row's own editor and go into your changes to save, and Break down opens its panel. When nothing is missing any more the item fades out with Undo. Skip hides an item for 2 weeks and puts it in Skipped at the bottom; Unskip brings it back sooner." },
  { q: "How do I see a client's backlog in its rank order?", a: "Filter › Levels › One level as a list: each client's open stories (or features, or epics: choose the level beside it) as a flat list in the client's own stack rank, the order their board shows, with the rank number on each row. Mine, Contributing and Everyone still choose whose items show. FocusTime never reorders the backlog; a project with no backlog order is listed by target date and says so." },
  { q: "What does Stale mean?", a: "An open item nobody has changed in DevOps for 6 weeks or more: no state change, no comment, no edit of any kind. Done items are never stale. A stale row says so in its Status (hover for how long), and Needs attention counts the stale items you can change. You choose the number of weeks in Settings › Backlog. Stale isn't a problem to fix by itself: push its target date out, give it an owner, or plan it so it gets some time." },
  { q: "What can I do with several items at once in Backlog?", a: "Point at a row and tick it (or press Space on it); Shift+click ticks everything between. A bar appears above the grid: push the target date by 2 or 4 weeks, move it to a date, set a target date only where there's none, or assign to me. These go into your changes to save like any edit. Items you can't change are left out, with the reason in a line that opens (Why 2 items were skipped). Plan it puts the ticked stories on next week, with Undo. Esc or Clear clears the ticks." },
  { q: "How do I edit a cell in Backlog's Grid?", a: "Click a date, state, owner or size (or press Enter on it) and a small editor opens under the cell. Dates have a calendar, quick dates (Today, Tomorrow, Next Monday, +1 week, Clear) and a box where you can type nov 20 or 11/20; a target before the start shows a warning and won't save. State lists the states this item's type has. Assigned to lists the people on the client's DevOps project, you first. Enter saves, Esc cancels, Tab saves and moves to the next cell, and the arrow keys move around the grid." },
  { q: "When do my Backlog changes reach DevOps?", a: "Only when you save. Every edit in Grid or Gantt collects as \"N changes to save\". Review lists them with before and after; Save sends them to DevOps per client with a preview, checks each one afterwards, and you can undo any of them from the Saved list or Settings › Activity. If someone changed the same field in DevOps since you started, Review shows both and you choose Keep mine or Take theirs." },
  { q: "What can I change in Backlog?", a: "Your own items, the features directly under an epic you own, and anything on a client you lead. Everything else shows Read only. A teammate you assign gets a quiet note in FocusTime, and so does the owner of an item whose dates you moved." },
  { q: "How do I create a feature or an epic in DevOps?", a: "{key:ui.new_item} anywhere, {icon:add} New in Backlog, or {icon:add} New under on a Backlog row for a child of that row. Choose the client and the level: the levels are the client's own. Type the title and press Enter: the preview shows exactly what will be written, and nothing is created until you confirm it. It's assigned to you unless you choose someone on the client's project or nobody; the parent and the target date are optional. Without your DevOps write access for that client, the form says so and saves it as a draft instead." },
  { q: "Why doesn't Backlog show everything in a client's DevOps project?", a: "A client's project often holds much more than our work, so Backlog and Week's lists show Cooptimize's work in it. A FocusTime admin sets that per client in Admin › Clients: the whole project, some DevOps teams, or some area paths. Until then FocusTime works it out from items assigned to Cooptimizers and what's under the epics and features they own. Items assigned to you always show. Show the whole project, under {icon:more} More in the toolbar, brings in the rest, marked Outside scope; Needs attention never lists those." },
  { q: "Someone shows as Ext-Name in DevOps. Is that one of us?", a: "Often: many clients give us a login of their own in their DevOps. FocusTime counts that login as the person, so their items are theirs in Mine and Contributing, and their FocusTime name shows instead of the login. It knows a login from the person's record in Dataverse, or because a FocusTime admin confirmed it in Admin › People. A suggestion is never applied without that confirm." },
];

const Q_STATUS: QA[] = [
  { q: "How do I write my updates for Monday's status report?", a: "Status ({key:view.status}) shows what Monday's report will say for your features: the ones you planned this week and any whose story you touched, by client. In {b:Edit}, {icon:add} Add a line on a feature (each line becomes its own DevOps comment), or change one of your own comments from this week. {b:Draft} writes a first version from your story changes, close-out notes and captures when AI is on for the client. {b:Push all} shows every new line and edit in one preview, then writes them; each line has its own result, Retry and Undo." },
  { q: "What does Preview show?", a: "The report as its email will read: a heading per feature, each comment this week as a bullet with its author, and No update yet where there's none. FocusTime never sends the report: it goes out Monday at 7:00 AM, as it always has." },
  { q: "What is Needs your update?", a: "Features you worked on since the last report went out, with no line from you yet, sit at the top with a \"You worked on this\" badge. Worked on means a story under it is assigned to you and changed, you moved or commented on one, you created one in FocusTime, it has a to-do or time on your calendar, or you commented on the feature. Each has a suggested line: Use puts it in, Edit opens it to change, Dismiss hides it. Nothing goes to DevOps until Push all." },
  { q: "How do I type several lines quickly?", a: "{icon:add} Add a line opens a box on the feature: Enter adds the line and opens the next, Shift+Enter starts a new line in the same comment, Esc closes, and Tab goes to the next feature. Click one of your own comments to edit it, or Delete it. Each line is its own DevOps comment, with Undo after Push all." },
  { q: "What does the dot on Status mean?", a: "It shows when features you worked on have no update of yours for Monday's report. Amber (a ring) is your second to last workday before the report goes out, red (a filled dot) your last one, counted from your own week: the days with focus blocks, not the catch-up day or PTO. Earlier in the week there's no dot, and it goes once you've written an update for each or the report is sent. Hover it for how many and when the report goes out." },
  { q: "How do I see the whole report before it goes out?", a: "At the top of Status, switch from My features to <Client> report (pick the client when you're on several). It shows Monday's report for that client: every feature with a comment since the client's last report was sent, in backlog order, each comment with its author, then Upcoming PTO and Holidays for the next two weeks. Below it, No update yet lists features someone worked on this week with no comment. Anyone on the client's team sees it. You can add lines to any feature and edit your own comments; other people's stay as DevOps has them." },
  { q: "Can I add a feature that isn't listed?", a: "Yes, in a client's report: {icon:add} Add a feature brings in any of the client's features by title or #id, with its line open to type." },
  { q: "Which comments count as this week's?", a: "The ones added or edited since that client's report was last sent, as Monday's report counts them. When FocusTime can't read when that was, it counts from the last Monday at 7:00 AM Eastern and says so on the client. Teammates' and Coop's comments show but can't be edited, and you can only edit your own from this week." },
  { q: "Can FocusTime remind me?", a: "Yes. Settings › Notifications can remind you on Friday afternoon (and Sunday evening) when some features have no update yet, in the app or in Teams. The reminder opens Status." },
];

const Q_INBOX: QA[] = [
  { q: "How is the Inbox laid out?", a: "One page with three lists, each with its count: From chats, Promises and Captures. The client chips under them narrow all three. Rows are grouped by client and open in place: click one, or press Enter. The Inbox remembers the list you used last and the clients you chose. On a phone it's the same, one column." },
  { q: "What's in From chats?", a: "Conversations in your clients' chats that ask for work no DevOps item covers yet: a fix, a change, something new. One shows after the chat has been quiet on it for 4 working hours, so people can settle it first, and stays for 7 days. It doesn't show once it has an item, when an item likely covers it, when it wound down, or once you dismiss it. Each row has the client, a suggested title, two lines of summary, who and when; hover for why it needs an item." },
  { q: "What can I do with a suggestion?", a: "Click it to open it in place, with the messages and three actions: {b:Create item}, {b:Already covered} (link the item that covers it) and {b:Dismiss} (for you only, with Undo). Under its {icon:more} More: Add as my promise, This isn't work and Open in Teams." },
  { q: "Dismiss or This isn't work?", a: "Dismiss takes a suggestion off your From chats only; everyone else on the chat still sees it, and Undo puts it back. This isn't work, under the row's {icon:more} More, closes the conversation for everyone on the chat, with your name, and Undo opens it again. A new work message opens a closed conversation again by itself. Neither changes anything in Teams or DevOps." },
  { q: "What does the Inbox's number count?", a: "Suggestions in From chats plus your promises that are late or due today. Captures never count. Zero shows nothing." },
  { q: "What are Promises?", a: "What you said you'd do in those chats, one per run of your messages, and the ones you added: what, to whom and when it's due, late first, then by due date. \"I'll be back online at 7:30\" isn't a promise by itself, but it can set the due time of the one before it. Create DevOps item leads while it has no item; Close the loop leads once it's late. Due, Who, Add to my week, Done and Not needed are always there; Link to item is under the row's {icon:more} More." },
  { q: "Why did a promise disappear?", a: "It cleared on its own. A promise whose linked DevOps item was finished is done. A promise from a chat that you never touched (no due or who change, not on your week, no item, no note) clears 7 days after its due day, or 7 days after it was found when it has no due date. Promises you added never expire. Cleared on their own · N at the foot of Promises lists the last 14 days with the reason, and Put back brings one back for good." },
  { q: "How do I close the loop on a promise?", a: "Close the loop on the promise. FocusTime drafts the update to the person you promised, says what it drafted from, and you edit it. Choose how it goes: Teams (the chat it came from, or a 1:1 with someone at Cooptimize), Email (an Outlook draft by default, or send now), a Comment on its DevOps item, or Call. Preview shows where it goes and who sees it, people outside Cooptimize by name, and nothing is sent until you choose Send there. Sent messages can't be undone. Close without sending closes it with how and a note; Not needed closes it quietly." },
  { q: "How do I choose who a promise is for?", a: "Who is a search box: type a name and pick from In this conversation (people from other organizations marked External), On <client> or Everyone at Cooptimize. You can also type any name and keep it as plain text; it says \"Not linked to a person\", and when the text matches exactly one person it offers to link it." },
  { q: "Where do promises show?", a: "On Day: in the urgent strip when late or due within 2 hours, in the promises due chip, and at their time on the Timeline. On Week, as a mark on the day's rail. Past its due it says \"Was due\" with the time or day, in amber, never red. Each one opens its row in the Inbox, open in place." },
  { q: "How do I create a DevOps item from a suggestion or a promise?", a: "{b:Create item} on a suggestion ({key:inbox.key.create}), or Create DevOps item on a promise without one. With AI on for that client the form is drafted from that conversation only: a title, the description, acceptance criteria, the type and a suggested parent. With AI off the same form is empty for you to fill in. The preview shows the full text and who can see it; nothing is written until you confirm, and Undo is in Settings › Activity. Once it has an item, the suggestion leaves From chats for everyone." },
  { q: "How do I link one to an item that already exists?", a: "{b:Already covered} ({key:inbox.key.link}) on a suggestion, or Link to item on a promise, searches that client's open items by title or #id; on a promise it first lists up to 5 likely ones with the reason. Linking is FocusTime's own note, nothing changes in DevOps, and Unlink takes it off. Tick Also add a comment on the item to post a short comment with a link back to Teams, after its own preview. A promise linked to an item clears itself once the item is finished in DevOps." },
  { q: "What happens when someone commits to work?", a: "When you say you'll do something, it's your promise, in Promises. When a teammate does, it's theirs, in their own Inbox. FocusTime doesn't chase anyone about it." },
  { q: "What is a conversation?", a: "One thread of work in a client's Teams chat: a question, the back and forth about it, and what people said they'll do. FocusTime groups a chat's messages into conversations so it can tell which ones ask for work. You see one only when it needs a DevOps item, as a row in From chats, with its messages when you open it." },
  { q: "What do the messages look like?", a: "As Teams shows them: one person's messages together under their picture and name, yours on the other side, a reply's quoted message above it, and reactions small underneath (only each emoji and how many, never who). The latest 20 show first; Show earlier loads 20 more. Times read like Teams: Today 4:07 PM, Yesterday 6:58 PM, otherwise Fri, Nov 6, 4:07 PM." },
  { q: "Why do I see pictures from the chat?", a: "Pictures pasted into a chat show as thumbnails on the message. Click one to see it large; Previous and Next (or the arrow keys) move between them, and Esc closes. FocusTime doesn't keep them: it reads each one from Teams with your own sign-in when you look, and only for people on that chat who follow its client. Only PNG, JPEG and GIF up to 10 MB show; anything else says why." },
  { q: "Are chat images sent to the AI?", a: "Only for a client whose Send attachments to AI is on (a FocusTime admin's switch in Admin › AI, off by default), and only with AI on for that client. Then the new images in a batch go with that same request, and the AI writes one short line about each. At most 4 images a message and 10 a request. Be aware: FocusTime's AI safety check reads text only. It can't look inside an image for another client's names, passwords or personal details, so turning the switch on is the consent to send whatever the client's chat images show." },
  { q: "Can a DevOps item carry the chat's images?", a: "Yes. Create item shows the images of the messages going with it, each with a checkbox, all ticked. When you confirm, each ticked one is read from Teams with your sign-in, uploaded to DevOps with your write access and linked to the new item; the description says how many were attached. At most 10, 10 MB each. One that can't be read is left out and said so; the item is still created. Undo unlinks them, but the files stay in DevOps: DevOps has no way to delete an attachment." },
  { q: "How does AI sort a chat?", a: "With AI on for FocusTime and allowed for that client (a FocusTime admin sets both in Admin › AI), each batch of new messages goes to the AI once, with that chat's open conversations. It says which conversation each message belongs to, writes the summary, notes who committed to what, and says whether the conversation needs a new DevOps item. Names are sent, never email addresses. It runs on FocusTime's shared budget, not yours. Small talk, reactions and a plain \"thanks\" never become conversations." },
  { q: "Why does a client say it can't get suggestions now?", a: "Its chat's messages are waiting for AI: AI is off for that client, its budget is used up or set to $0, or the AI service didn't answer. The foot of From chats names the client and the reason. Once AI is back the waiting messages are sorted with the next read, and their suggestions follow. With AI off for a client, promises are still found, but that chat makes no suggestions." },
  { q: "Why is a message held back?", a: "It names another client in a chat where someone from outside Cooptimize can read it. That one message isn't sent to AI, so it never makes a suggestion; the rest of the chat is sorted as usual. In a chat with only Cooptimizers, mentioning another client is normal and nothing is held." },
  { q: "What does \"mentions <client>\" mean?", a: "A conversation or message that names another client gets that tag, so you notice before you copy anything out of it. Before FocusTime writes to a client's DevOps or sends an update for you, it checks the text: AI drafts have another client's name replaced with \"another client\", and text you typed that names one shows This mentions <client> with Replace with \"another client\". You can still save or send it as written. Cooptimize Internal may name clients." },
  { q: "How do a client's chats get added?", a: "A FocusTime admin adds them, once for everyone: Admin › Clients, on a client, Delivery chats, then Add a chat. A client can have several chats; a chat belongs to one client. Each is labelled Delivery team (the internal Cooptimize team) or Customer collaboration (with the client's key people), and people from other organizations are marked External. Everyone else sees them in Settings › Client chats, read-only. The first time, Microsoft asks you to let FocusTime read chat messages. Reading starts from that moment, never from history." },
  { q: "Who sees a chat's conversations?", a: "Everyone at Cooptimize who is a member of the chat and follows its client. Nobody else, and never under another client." },
  { q: "When does it read?", a: "Every 5 minutes while anyone on the chat is in their working hours, and not at all outside them; the first read of the day catches up. Refresh in the Inbox reads now. Reading a chat, FocusTime never posts, reacts or marks anything read. The only message it sends to a chat is one you send yourself with Close the loop." },
  { q: "What does FocusTime keep?", a: "Each message once, under its client, for the people who see that chat. Messages that aren't part of a conversation or promise are deleted after 14 days. Images pasted into the chat are never kept: FocusTime reads one from Teams with your own sign-in when you look at it, and keeps only its type, size and the AI's short description. Nothing goes to logs except counts." },
  { q: "What are the Inbox's keys?", a: "{key:J} and K move, Enter opens or closes a row. In From chats: {key:inbox.key.create} creates an item, {key:inbox.key.link} is Already covered and {key:inbox.key.dismiss} dismisses. In Promises: {key:inbox.key.done} is Done. They never fire while you type, and each does exactly what its button does." },
];

const Q_WRITING: QA[] = [
  { q: "What are the three questions?", a: "Three optional boxes under Title in the New form and the draft editor: {b:Where is it?} (the report and page, model, table or pipeline), {b:What should change?} (before and after, or the rule) and {b:How will we know it's right?} (one example and the answer it should give). Answer what you can; a title alone still works. When the item is created, the first two go into its description under \"Where:\" and \"What should change:\", and the third into its acceptance criteria, or into the description when the item's type has no such field. FocusTime writes them only when it creates the item, never into one that already exists." },
];

const Q_CAPTURE: QA[] = [
  { q: "Quick capture from anywhere?", a: "{key:capture.add} anywhere outside a text field, or Capture in the top bar. On a phone, {icon:add} Capture is the round button in the middle of the bar at the bottom. One line, saved at once, with Undo." },
  { q: "What does Break down do?", a: "On an item that {b:Needs stories}, {b:Break down} asks the AI to propose the child items it's missing. It opens a side panel: the item stays on the left and the proposals fill the right, in three steps: Prepare, Review and Publish. In Prepare you choose the type to create, when the item's type takes more than one, and an optional {b:Note for the AI}. Nothing is written to DevOps until you choose Create all." },
  { q: "How do I review the proposals?", a: "Each card is one item: edit its title, description and acceptance criteria, give it a size (S 1h, M 2h, L 4h, or leave it unsized), drag it by its handle or use {icon:arrow-up} Move up and {icon:arrow-down} Move down, or Drop it (Undo brings it back). \"after <title>\" means it depends on another card. Regenerate… redoes one card and Regenerate all… the whole set, each with a note. The line at the top says why these. The total at the bottom counts what you keep, like \"5 items · about 9h\"." },
  { q: "What happens when I choose Create all?", a: "First you see the exact batch: each item's type, title and size, under its parent. Create all makes them one by one under the parent, assigned to you, in dependency order, and reads each one back. If some fail, the panel lists what was created and what wasn't, with Retry the rest; nothing is created twice. Sizes stay in FocusTime. Settings › Activity has every create with Undo." },
  { q: "What is sent to the AI?", a: "Open {b:What's sent to the AI} under the item to see the list in plain words. Text from DevOps only: the item's fields and description, its parent's title, the titles and states of the children it already has, and its newest comments. Also up to 5 of that client's own past items as examples, the client's house style, and your note. Never attachments, linked documents, email addresses or another client's work." },
  { q: "What is the house style?", a: "A few lines about how a client's items are usually split: how many children, how titles start, whether they use acceptance criteria. FocusTime learns it each week from the client's own items, unless your FocusTime admin has written one for the client in Admin › Clients." },
  { q: "How does FocusTime use Cooptimize's standards?", a: "Break down, a draft story or feature and Create DevOps item read Cooptimize's development standards, the ones that fit the work and the client's data platform. Drafts split along the standards' layers and add acceptance criteria that name the standard with a link. Standards used, under the draft, lists what shaped it, and each title opens the article. A client's own requirements win: if the draft followed the client instead, it says so. In Ask you can ask things like \"What's our standard for fact table naming?\": it quotes the rule and links the article, or says Not in the standards." },
  { q: "Why can't I break an item down?", a: "The panel says so. \"AI is off for <client>\": ask your FocusTime admin. Without that client's DevOps write access, it asks you to add it in Settings first and sends nothing, not even the AI request. The Coop brief is always there." },
];

const Q_ASSISTANT: QA[] = [
  { q: "Does the assistant ever change something on its own?", a: "No. Every change is a proposal with the same preview as the button, and runs only when you Confirm. What it reads from chats, DevOps or captures is information for it, never instructions." },
  { q: "Can it change several things at once?", a: "Yes. It can move several to-dos at once, across clients (\"Push everything from today to tomorrow\"), with one Confirm and one Undo. On one item it can do up to three things in one card, like mark it done and add a comment. Any it can't put back because you worked on them since are listed." },
  { q: "What happens when it isn't sure what I mean?", a: "It asks one short question with a few choices made from your own clients, blocks and items, plus \"or type it\". Tap one, or answer in your own words." },
  { q: "What does the assistant need?", a: "AI for FocusTime, which your FocusTime admin turns on, and Allow AI for the client it's about. Your history stays 30 days; clear it in Settings › AI and assistant." },
  { q: "Can I just talk to it?", a: "Yes: open Ask, then hold Hold to talk, 60 seconds at most. Release and the words land in the box; fix them if needed, then Send. Changes still wait for your Confirm, and the recording isn't kept." },
];

const Q_ASK: QA[] = [
  { q: "Where do the assistant's answers come from?", a: "Only from what FocusTime already shows you: your blocks and to-dos, your promises, your DevOps items in Backlog, Monday's status report and your client calls. FocusTime puts the answer together itself, so another client's details never go to the AI with it. When a source didn't load or doesn't exist, the answer says so instead of guessing." },
  { q: "How long does it remember what I asked?", a: "2 hours, so \"the ones under the export feature\" right after a request works. It's yours only, kept with your assistant history, and Clear in Settings › AI and assistant removes it." },
  { q: "Does it answer about every client?", a: "About every client you can see, grouped by client. Never a client you can't see, and an answer is never posted anywhere: it stays in your panel or your own Teams chat with FocusTime." },
  { q: "What if AI is off?", a: "It says AI isn't on and points you to the command menu ({key:Ctrl K}), where every action is. Everything else in FocusTime works the same." },
];

const Q_TEAMS: QA[] = [
  { q: "How do I start?", a: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\". It answers only you, only in that 1:1 chat. It does what Ask does, with the same previews and Confirm. Ask it what it can do; what's next and today work even without AI." },
  { q: "Can FocusTime message me first?", a: "Only if you ask it to. Settings › Notifications: turn on Let FocusTime message me in Teams, then tick what you want: Morning brief, Midday check-in, Close out, Nudges, Client calls to review. All are off until you turn them on. They come only in your own chat with FocusTime, never on weekends or PTO days, never in quiet hours, and wait while focus runs. Send me a test now sends one at once so you can see it." },
  { q: "What's in each one?", a: "The morning brief: the day's blocks, meetings, to-dos, promises due and work sent to you. The midday check-in: this morning's to-dos with Done and Not yet. Close out (30 minutes before your day ends unless you change it): the day's to-dos; tick what got done or just tell it. Nudges: a promise due tonight that's still open, work sent to you waiting over half a day, or someone taking over an item assigned to you, together in one message, at most one an hour." },
  { q: "Does tapping a button change things right away?", a: "Done and Not yet on a to-do change only your own plan, at once, exactly like the buttons in the app, with Undo on the card. Anything bigger (moving to-dos, closing out the day) shows the change first, with Confirm and Cancel. Nothing in DevOps, Outlook or anywhere outside FocusTime changes without a Confirm." },
  { q: "Can I just tell it what I got done?", a: "Yes. While Close out is waiting, reply in your own words: \"all but the export\", \"1 and 3\", \"fixed the login timeout\". The card above fills in what it understood: the to-dos done, where the rest move and the day closed out. One Confirm does all of it. FocusTime matches your words to the to-dos itself; no AI reads them." },
  { q: "How do I capture something from Teams?", a: "Start the message with capture: (or c:), for example \"capture: call Dana about the export\". It goes to the Inbox's Captures exactly as typed, to sort later, with Undo on the reply. Anything else you write goes to the assistant." },
  { q: "It says FocusTime can't message me in Teams.", a: "Teams told FocusTime the chat is blocked or the app was removed, so Let FocusTime message me in Teams turned itself off. Add FocusTime again in Teams, send it a message, then turn the switch back on." },
];

const Q_CALLS: QA[] = [
  { q: "What are client calls?", a: "A client's weekly call that a FocusTime admin registered for it in Admin › Clients. After each one, FocusTime reads its transcript (or a reviewer uploads it) and proposes what to do about it: new DevOps items for gaps nobody has a story for, promises people made, each in the Promises of the person who made it, and DevOps comments for decisions and status. FocusTime reads no other meeting. The call shows on its client's block on Week; My client calls in {key:Ctrl K} lists yours." },
  { q: "How do I review a client call?", a: "Open it from its mark on Week or the note you got: Update <client>'s plan. Each proposal shows the words from the call it came from. Tick what's right, change the words where needed and skip the rest, then Confirm: every DevOps change is shown before anything runs, and each can be undone in Settings › Activity. Only the call's reviewers can confirm; other Cooptimizers on the call can look. Transcripts are kept 30 days; what you confirmed stays." },
  { q: "It asks me to upload a transcript.", a: "When the client hosts the call, or the transcript didn't come through, open the meeting's recap in Teams, download the transcript (.vtt or .docx) and use Choose a file under Upload the transcript. If you can't download it, ask the meeting's organizer to send it. No transcript this week clears the note for everyone." },
];

const Q_CODE: QA[] = [
  { q: "Can I read another client's code?", a: "Yes, read only. {icon:more} More › Code (or Code in {key:Ctrl K}): choose the client, then the repo, open folders or type a file's name in Find a file, and open a file. The client's name is at the top the whole time. Copy takes the whole file; Copy link opens the same file for a teammate. FocusTime never changes a repo, keeps none of the code and sends none of it to AI. A FocusTime admin can keep one client's code to its team; that client shows greyed for everyone else." },
  { q: "Who sees that I opened a file?", a: "FocusTime admins, in Admin › Audit › Code views: who opened which client's repo or file, or used Find, and when. Never the code. Rows are kept 12 months." },
  { q: "It says FocusTime can't read a client's code yet.", a: "The company DevOps token for that client doesn't have Code (read) yet. It's added by hand in DevOps; ask your FocusTime admin. Until then that client's work items still show as before." },
];

const Q_SETTINGS: QA[] = [
  { q: "Where is Settings?", a: "Your photo in the top bar › Settings, {key:settings.load}, or {key:Ctrl K}, then Open Settings. Type in Search settings at the top of the list: it finds a setting by its name or its old name. On a phone, Settings is under {icon:more} More and opens on the list; each section is a page with Back. {icon:close} Close, or Esc, goes back where you were." },
  { q: "Do I need to save in Settings?", a: "No. Each setting saves as you change it, and says Saved by the field; Undo puts the old value back. Only access tokens wait for Check and save." },
  { q: "How do I change the theme or the text size?", a: "Settings › Display: Theme (Cooptimize Dark, Cooptimize Light or Neutral) and Text size (Default, Large or Larger). {key:ui.set_text_size} also steps the text size, when you aren't typing. Reduce motion is there too." },
  { q: "What works on a phone?", a: "The bar at the bottom has Day, Week, the round {icon:add} Capture button, Inbox and Ask; Status is under {icon:more} More. Day comes first: the block you're in, your next meeting and your next to-do with Start and Done, then the Midday check-in and Close out. Week is one day at a time, with {icon:add} Add on each block opening its panel as a sheet. Backlog is made for a bigger screen: on a phone it asks first, with Open anyway (read only)." },
  { q: "What does the dot at the top mean?", a: "On a phone, the dot beside FocusTime's mark says how your sources are: green when everything is live, amber when some data is older or a sample, red when a source needs you. Tap it to see each source and its age, DevOps per client and your VM, with Retry, Reconnect and Refresh. On a computer the same is in the bar at the bottom." },
  { q: "How do I install it?", a: "On Android or in Chrome or Edge on a computer: {icon:more} More › Install app. On iPhone: tap Share in Safari, then Add to Home Screen, then Add; {icon:more} More › Install app shows the steps. Once installed it opens like an app, straight to Day." },
  { q: "How do notifications work?", a: "Every notification shows in {icon:more} More › Notifications, with a dot on {icon:more} More when there's something new, and as a short note at the bottom while FocusTime is open. To get them when FocusTime is closed, open Settings › Notifications on that device and choose Notify this device; the browser asks first. On iPhone this works only in FocusTime from the home screen. A lock screen says only what kind of thing it is, like Promises due, unless you turn on Show details in notifications." },
  { q: "Does it work offline?", a: "No. FocusTime opens without a connection but says it's offline; nothing of yours is kept on the phone. Signing out clears what the browser kept and turns notifications off on that device." },
  { q: "Where do I add my DevOps write access?", a: "Settings › DevOps › Write access, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again. Without one, that client stays read only." },
  { q: "How do I add a calendar by link?", a: "Settings › Accounts and calendars › Calendars added by link. Paste the calendar's subscription link (https:// or webcal://), choose Check link, and FocusTime says how many upcoming events it found. Give it a name and a color, choose Busy only (the default: no titles are kept) or Show titles, and Personal or Work, then Save calendar. FocusTime reads it about every 15 minutes while you use it and never writes to it. The link works like a password: FocusTime keeps it encrypted and only ever shows its host." },
  { q: "Where do I find a calendar's link?", a: "In Google Calendar: Settings, the calendar, Integrate calendar, Secret address in iCal format. In Outlook on the web: Settings, Calendar, Shared calendars, Publish a calendar, then copy the ICS link. In iCloud: share the calendar and turn on Public Calendar. School and activity apps say Subscribe, iCal or ICS. If a link stops working, the status line says so; Replace link takes a new one and Remove deletes it and its events." },
  { q: "Can I start or stop my VM from FocusTime?", a: "Yes, your own VM only. The VM chip in the top bar has Start, and Stop… while it runs: a preview says it will be deallocated (it shuts down and stops billing for compute) and that anything running on it ends. FocusTime never stops it on its own and never changes its auto-shutdown. Each start and stop is in Settings › Activity." },
  { q: "Can FocusTime start my VM before my day?", a: "Yes, if you turn it on: Settings › Accounts and calendars › Start my VM before my day, with how many minutes before your day starts and on which days. It starts only on days your working hours cover, not on PTO or holidays, and only when the VM is stopped. After 3 working days without FocusTime it pauses until you choose Resume. The chip's menu shows the next one, with Skip this one." },
  { q: "How do I export or delete my data?", a: "Settings › Your data: Export my data downloads what FocusTime keeps for you as one file; Reset my plan and Delete my data are there too, each asking first. Diagnostics, in the same section, shows counts only, for your own chats, when a promise you expected is missing; it never shows message text." },
  { q: 'What does "Set by your FocusTime admin" mean?', a: "Some settings are the team's: a FocusTime admin sets them once for everyone in Admin, like whether AI is on, which clients allow it, a client's chats and its open states. You see them read-only. Others are team defaults you can change for yourself, like a client's color: pick your own, and Reset goes back to the team's." },
  { q: "What can a FocusTime admin do?", a: "Admins are the members of the FocusTime Admins group in Entra. Admin (under {icon:more} More and in Settings' list, only for admins) holds the team's settings: Clients, AI, Conversations, People, Organization, Standards, Status and Audit. Admins never see anyone's plan, to-dos, promises, captures, focus sessions, tokens, AI request text, or messages from chats they aren't in." },
  { q: "How do I see who's set up, and invite a teammate?", a: "If you're a FocusTime admin: Admin › People shows every Cooptimizer with yes or no for Signed in, DevOps connected and Calendar connected. Invite on a row (or tick several) opens a message to edit, with FocusTime's link and the first three steps. Open in Teams starts a chat, Open in Outlook starts an email, or Copy message. Where your sign-in allows it, FocusTime sends it as you after a preview of who gets it. The row then shows when and how you invited them." },
  { q: "Where does my level come from?", a: "Your position in Dataverse, through the mapping a FocusTime admin keeps in Admin › People. Until a position is mapped, its people show Level not set and get the Consultant defaults. A level only changes suggestions and emphasis, never what you can see or do." },
  { q: "Why isn't one of our accounts in my client list?", a: "FocusTime's clients are the active Dataverse accounts of type Customer, plus Cooptimize Internal. Prospects, partners, vendors and the rest stay out of your lists and pickers. A FocusTime admin can treat an account as a client, or hide one, in Admin › Clients under All accounts. Nothing is deleted either way." },
  { q: "Who shows as a Cooptimizer?", a: "People with an address in the Cooptimize email domains who aren't guests. Only they have a level, lead clients, and appear in teammate pickers. Guests and automation accounts are listed for admins under Not Cooptimizers in Admin › People. Sign-in is only for Cooptimize accounts." },
  { q: "How do I send an idea, a problem or a question?", a: "{icon:more} More › Send feedback, or Send feedback in {key:Ctrl K}. Pick Idea, Problem or Question, write it, and look at the preview: it shows exactly what goes to the FocusTime backlog in Cooptimize's DevOps. Your name and email go with it, and where you were if you leave that ticked; nothing from your plan or clients. It's created as you, so turn on DevOps writes for Internal in Settings › DevOps first. If it can't be sent, it says so; Copy text keeps it, and you can message the FocusTime team in Teams." },
  { q: "What is the demo?", a: "Try the demo, on the sign-in screen, opens FocusTime with made-up clients, work and calendars, so you can click everything. Nothing of yours is in it and nothing reaches DevOps, Outlook or Teams. Starting it signs you out of your own FocusTime; sign in again to come back." },
  { q: "Which version am I on?", a: "{icon:more} More › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
];

/** LP-1: Close the loop sends the update (Teams, email, a DevOps comment or a call note), or closes without sending. */
export const CLOSE_THE_LOOP = Q_INBOX.find((x) => x.q === "How do I close the loop on a promise?")!;

/** Every question the Guide answers; each lives in exactly one section. */
export const QUESTION_POOL: readonly QA[] = [...Q_FIRST_DAY, ...Q_DAY, ...Q_WEEK, ...Q_BACKLOG, ...Q_STATUS, ...Q_INBOX, ...Q_WRITING, ...Q_CAPTURE, ...Q_ASSISTANT, ...Q_ASK, ...Q_TEAMS, ...Q_CALLS, ...Q_CODE, ...Q_SETTINGS];

/** No answer is longer than this (GU-1): a longer one is cut, or split into two questions. */
export const MAX_ANSWER_WORDS = 120;

// ---------- The sections after Start here ----------

export { SECTIONS, SECTION_GROUPS, type SectionId } from "./sections.ts";

/** A thing you do in an area: one line, and where to do it (an address the link checker opens) or a tour. */
export type Do = { title: string; text: string; go?: { href: string; label: string }; tour?: string };
/** The try-it sandboxes (ui/guide/TryIt.tsx): in-page example data, nothing sent. */
export type TryItId = "drag" | "timeline" | "sizing" | "inbox" | "assistant";
/** Extra pieces an area draws: Day's urgent strip animation, Week's DevOps ladder, the key list. */
export type Extra = "urgent" | "ladder" | "keys";

export type AreaBody = {
  /** One sentence: what the area is for. */
  lead: string;
  does: Do[];
  extras?: Extra[];
  tryIts?: TryItId[];
  /** Questions by their words, from QUESTION_POOL, under "How it works". */
  faqs: string[];
};

export const AREA_UI = {
  does: "What you do here",
  how: "How it works",
  tryIt: "Try it",
  open: "Open",
  noTour: "Tours run on your own screens. Sign in to see them.",
};

const qs = (list: readonly QA[]) => list.map((x) => x.q);

export const AREAS: Record<"day" | "week" | "ahead" | "status" | "inbox" | "writing" | "capture" | "assistant" | "ask" | "teams" | "calls" | "code" | "settings", AreaBody> = {
  day: {
    lead: "Day is one day on one screen: what's urgent, the moment of the day, and the day's blocks.",
    does: [
      { title: "The day's blocks", text: "The same cards as Week. The next to-do has the one Start focus button. {icon:add} Add on a block, a click on its header or {key:ui.block} opens the block's panel.", go: { href: "#/day", label: "Open Day" }, tour: "today" },
      { title: "The urgent strip", text: "At the top: promises late or due within 2 hours and work sent to you, the 3 most urgent. From chats · N opens chats that need a DevOps item." },
      { title: "One moment card", text: "Nothing on today yet (with {icon:add} Add), Midday check-in after lunch, Close out at the end of the day. Each opens its flow; done, it's a small line with Reopen." },
      { title: "Any day", text: "{icon:back} Previous day and {icon:next} Next day step to other days, and {b:Today} comes back. Later days take work; a past day ticks and moves work forward." },
      { title: "The timeline", text: "Cards and Timeline, in the header, switch the day to hours ({key:ui.set_today_timeline}). Drag a to-do onto the hours, move or resize it, each with Undo. Timebox my day suggests times to accept." },
    ],
    extras: ["urgent"],
    faqs: qs(Q_DAY),
  },
  week: {
    lead: "Week is your half-day blocks for the week, with one panel beside them for the block you're on.",
    does: [
      { title: "Your blocks", text: "Each block is a half-day for one client: its to-dos, a line for its meetings, and {icon:add} Add at the bottom. Click a title for its story card, and a day's name to open that day in Day. Cards and Timeline ({key:ui.set_show_timelines}) switch to a slim hour rail beside each block.", go: { href: "#/week", label: "Open Week" }, tour: "board" },
      { title: "A block's panel", text: "{icon:add} Add on a block, a click on its header, or {key:ui.block} opens the one panel for that block: what's on it, its meetings, and Add. Type in the Add box to search this client's work and your promises; Enter takes the highlighted row. Before you type it lists what's assigned to you, your promises, and More in the client. {icon:add} Add on a row puts it on the block, or drag it onto any block.", go: { href: "#/week/add", label: "Open a block" }, tour: "plan-week" },
      { title: "Take work off", text: "Drag a to-do from a block onto the panel, or Take off the plan under its {icon:more} More. It leaves the block and goes back to not placed, with Undo. That isn't Drop, which marks it dropped." },
      { title: "Nothing to confirm", text: "What's on your week is your plan. Add work or take it off any time; teammates and Monday's status report see the change." },
      { title: "Send work to someone", text: "Send to…, under a feature's or story's {icon:more} More, for this week or next. They answer from To place, at the bottom of a block's panel." },
    ],
    extras: ["ladder"],
    tryIts: ["drag", "timeline", "sizing"],
    faqs: qs(Q_WEEK),
  },
  ahead: {
    lead: "Backlog is every client's DevOps on one screen: a place to edit, clean up and organize, in two views, Grid and Gantt.",
    does: [
      { title: "Grid", text: "Each client's items in its backlog order: state, dates, owner, size and one status, edited in place. Fold a client, tick rows for bulk changes.", go: { href: "#/backlog", label: "Open Backlog" }, tour: "ahead" },
      { title: "Gantt", text: "The same items on a timeline: drag a bar to move its dates. The flag at a bar's end lists what needs attention.", go: { href: "#/backlog/gantt", label: "Open Gantt" } },
      { title: "Needs attention", text: "A chip in the toolbar: only the items with something to fix (stories, a target date, an owner, a size, or stale), each with its fix and Skip.", go: { href: "#/backlog/attention", label: "Show what needs attention" } },
      { title: "One level as a list", text: "Filter › Levels: each client's stories (or features, or epics) in its own rank order, with the rank number.", go: { href: "#/backlog/stories", label: "Open the stories list" } },
      { title: "Changes wait until you save", text: "Edits collect as \"N changes to save\". Review shows before and after; Save writes them to DevOps, with Undo." },
    ],
    faqs: qs(Q_BACKLOG),
  },
  status: {
    lead: "Status is this week's lines for Monday's status report: what it will say for your features, by client.",
    does: [
      { title: "Write your lines", text: "In Edit, {icon:add} Add a line on a feature. Each line becomes its own DevOps comment. Draft writes a first version where AI is allowed for the client.", go: { href: "#/status", label: "Open Status" }, tour: "status" },
      { title: "Needs your update", text: "Features you worked on with no line from you yet sit at the top, each with a suggested line: Use, Edit or Dismiss.", go: { href: "#/status/needs", label: "Open Needs your update" } },
      { title: "Preview", text: "Edit and Preview switch to the report as its email will read: a heading per feature, each comment a bullet with its author." },
      { title: "Push all", text: "One preview of every new line and edit, then each is written to DevOps with its own result, Retry and Undo. FocusTime never sends the report." },
      { title: "A client's whole report", text: "My features and <Client> report switch to everything Monday's report will say for one client, with Upcoming PTO and Holidays." },
    ],
    faqs: qs(Q_STATUS),
  },
  inbox: {
    lead: "The Inbox is three short lists: conversations in your clients' chats that need a DevOps item, what you promised, and your captures.",
    does: [
      { title: "From chats", text: "A conversation that asks for work no item covers yet, once the chat has been quiet on it for 4 working hours. Create item, Already covered or Dismiss; it goes away once it has an item.", go: { href: "#/inbox/chats", label: "Open From chats" }, tour: "inbox" },
      { title: "Promises that clear themselves", text: "What you said you'd do, late first. A promise whose item was finished clears as done; one from a chat you never touched clears 7 days past due. Put back brings one back.", go: { href: "#/inbox/promises", label: "Open Promises" } },
      { title: "Create a DevOps item", text: "From a suggestion or a promise without one. With AI allowed for the client the form is drafted for you. Nothing is written until you confirm the preview." },
      { title: "Close the loop", text: "Send the update from the promise: Teams, email, a DevOps comment or a call note. FocusTime drafts it, you edit it, and the preview shows who will see it before anything is sent." },
      { title: "Captures", text: "The capture box, what's left to sort and the drafts to add in DevOps.", go: { href: "#/inbox/captures", label: "Open Captures" } },
    ],
    tryIts: ["inbox"],
    faqs: qs(Q_INBOX),
  },
  writing: {
    lead: "Three short questions turn a title into work a builder can start without coming back to ask.",
    does: [
      { title: "Answer what you can", text: "Under Title in the New form ({key:ui.new_item}): Where is it?, What should change? and How will we know it's right? One plain box each, all optional." },
      { title: "One short example", text: "Where is it? The margin page of the sales report. What should change? Margin percent is revenue minus cost, divided by revenue. How will we know it's right? October, East region shows 31%." },
      { title: "What DevOps gets", text: "The first two in the description, the third in the acceptance criteria (or the description when the type has no such field), only when the item is created." },
    ],
    faqs: qs(Q_WRITING),
  },
  capture: {
    lead: "Capture gets a thought out of your head in one line, saved at once, to sort later.",
    does: [
      { title: "Anywhere", text: "{key:capture.add}, or Capture in the top bar. The client chip is where it goes; Enter saves, with Undo." },
      { title: "As what it is", text: "Decide later, Promise, Draft story, Draft feature or Deployment. A draft gets a DevOps-ready version from AI in the background where AI is allowed." },
      { title: "Into DevOps", text: "Create in DevOps on a draft opens the preview straight away; it takes the draft's place wherever it was planned. Ctrl+Enter in the box saves and opens the New form.", go: { href: "#/inbox/captures", label: "Open Captures" } },
      { title: "New in DevOps", text: "{key:ui.new_item} anywhere, {icon:add} New in Backlog, or {icon:add} New under on a row: one form for a story, feature, epic or any level the client's process has." },
      { title: "Break down", text: "On an item that needs stories, AI proposes the child items. Edit the cards; nothing is created until Create all." },
    ],
    faqs: qs(Q_CAPTURE),
  },
  assistant: {
    lead: "The assistant answers questions about your plan and proposes changes that you then confirm.",
    does: [
      { title: "Ask", text: "{key:assistant.ask}, or Ask in the top bar. What's next, what's due tonight, where an item stands, what you promised.", tour: "assistant" },
      { title: "Change several at once", text: "\"Move the stories under the export feature to Friday\": one card, one Confirm, one Undo, across clients." },
      { title: "Update an item", text: "Mark an item done and comment on it in one card." },
      { title: "It asks when it isn't sure", text: "Which client, block or item? It offers a few choices. Tap one, or type." },
      { title: "Talk", text: "Hold to talk, 60 seconds at most. The words land in the box; nothing goes until Send, and the recording isn't kept." },
    ],
    tryIts: ["assistant"],
    faqs: qs(Q_ASSISTANT),
  },
  ask: {
    lead: "Ask in your own words: the assistant answers from your own plan, grouped by client, and says plainly what it can't see.",
    does: [
      { title: "Plan a week", text: "\"I'm planning next week. What should I look out for?\" Days heavy with meetings, blocks at risk, late promises, items not ready, deployments and status updates owed, then up to 3 next steps to tap." },
      { title: "Find out what it does", text: "\"What can you help me with here?\" Examples made from your own week, each one a tap away." },
      { title: "Ask about one thing", text: "\"Which promises are late?\", \"What's not ready for Northwind next week?\", \"Do I have any deployments this weekend?\"" },
      { title: "Follow up", text: "\"The ones under the Data export feature\" right after a request: it remembers what you asked for 2 hours, and asks when a name matches more than one thing." },
      { title: "Tap a next step", text: "A suggested step shows the same preview as the button. Nothing changes until you Confirm.", tour: "assistant" },
    ],
    faqs: qs(Q_ASK),
  },
  teams: {
    lead: "FocusTime in a 1:1 chat in Teams: ask it things, and if you like, get your brief, check-in and close out there.",
    does: [
      { title: "Start", text: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\"." },
      { title: "Your rhythm in Teams", text: "Turn on Let FocusTime message me in Teams, then choose what it sends. Everything is off until you do.", go: { href: "#/settings/notifications/teams-messages", label: "Open the setting" } },
      { title: "capture:", text: "Start a message with capture: and it's saved to Captures, as typed." },
    ],
    faqs: qs(Q_TEAMS),
  },
  calls: {
    lead: "A client's weekly call, registered by an admin. After each one, FocusTime proposes what to do about it.",
    does: [
      { title: "Review after the call", text: "Update <client>'s plan: each proposal shows the words it came from. Tick what's right, then Confirm.", go: { href: "#/meetings", label: "Open Client calls" } },
      { title: "Only registered calls", text: "FocusTime reads no other meeting. Transcripts are kept 30 days." },
    ],
    faqs: qs(Q_CALLS),
  },
  code: {
    lead: "Read any client's code, read only, to borrow what already works. One client at a time.",
    does: [
      { title: "Find a file", text: "{icon:more} More › Code, choose the client and the repo, then open folders or type part of a file's name in Find a file.", go: { href: "#/code", label: "Open Code" } },
      { title: "Copy what you need", text: "Copy takes the whole file, Copy path its path, Copy DevOps link its page in DevOps. Select part of it to copy just that." },
      { title: "It's logged", text: "Opening a file is logged for FocusTime admins: who, which file and when. Nothing of the code is kept." },
    ],
    faqs: qs(Q_CODE),
  },
  settings: {
    lead: "Settings are yours. They save as you change them, and search at the top of the list finds any of them.",
    does: [
      { title: "Search settings", text: "Type at the top of Settings' list: it finds a setting by its name or its old name. {icon:close} Close or Esc goes back.", go: { href: "#/settings", label: "Open Settings" } },
      { title: "On your phone", text: "Day, Week, the round {icon:add} Capture button, Inbox and Ask in the bar at the bottom. The dot at the top shows how your sources are. {icon:add} Add on a block opens its panel as a sheet; Backlog asks first.", go: { href: "#/day", label: "Open Day" } },
      { title: "Invite teammates", text: "Admins only: Admin › People shows who's set up, and Invite opens a message to send from FocusTime or in Teams or Outlook.", go: { href: "#/settings/admin-people/whos-set-up", label: "Open Who's set up" } },
      { title: "Send feedback", text: "{icon:more} More › Send feedback: an idea, a problem or a question, as a story in the FocusTime backlog, after a preview." },
      { title: "Your data", text: "Export, reset or delete what FocusTime keeps for you, and Diagnostics for your own chats.", go: { href: "#/settings/data/diagnostics", label: "Open Diagnostics" } },
    ],
    extras: ["keys"],
    faqs: qs(Q_SETTINGS),
  },
};

/** Your first day. The checklist reads guide.checklist (states only); the links open the real place. */
export const FIRST_DAY = {
  lead: "Seven things that make FocusTime yours. Each takes a minute or two, and none of them blocks the others.",
  checks: {
    hours: { title: "Your working hours", text: "FocusTime fits work into your hours and time zone. Standing blocks, like Monday morning for Internal, are on the same page.", go: { href: "#/settings/hours/weekdays", label: "Open Working hours" } },
    clients: { title: "Your clients", text: "They come from Focus Time in Dataverse. Check the list and each client's color.", go: { href: "#/settings/clients/client-list", label: "Open Clients" } },
    calendars: { title: "Your personal calendar", text: "Optional. Connect Google Calendar, or add any calendar by its link (iCloud, Outlook, school apps), so personal events count against your free time.", go: { href: "#/settings/connections/sources", label: "Open Accounts and calendars" } },
    devops: { title: "DevOps write access", text: "A personal access token per client lets FocusTime update DevOps when you confirm. Without one, that client stays read only.", go: { href: "#/settings/devops/devops-write", label: "Open DevOps" } },
    notify: { title: "Notifications", text: "Turn on Notify this device, or let FocusTime message you in Teams.", go: { href: "#/settings/notifications/devices", label: "Open Notifications" } },
    week: { title: "Add work to your week", text: "Week with a block's panel open: place features and stories on your blocks.", go: { href: "#/week/add", label: "Open Week" }, tour: "plan-week" },
    today: { title: "Add work to your day", text: "Add on one of the day's blocks puts stories on it.", go: { href: "#/day", label: "Open Day" }, tour: "today" },
  } satisfies Record<string, { title: string; text: string; go: { href: string; label: string }; tour?: string }>,
  states: { done: "Done", todo: "To do", skipped: "Skipped in setup", unknown: "" },
  progress: (n: number, of: number) => `${n} of ${of} done`,
  loading: "Checking your setup…",
  signedOut: "Sign in to see which of these are done for you.",
  demo: "In the demo these aren't checked: the demo's person is made up. Signed in, this list shows your own setup.",
  problem: "Your setup can't be read just now. Every link still works.",
  never: "This list only checks whether each one is set. It never shows a token or a key.",
  faqTitle: "Questions people ask on day one",
  faqs: qs(Q_FIRST_DAY),
};

/**
 * One list of names that changed: one row per old name, with where it lives now (ui/guide/retired.ts, which the
 * retired-names test reads too). The Guide's search and the command menu still find every old name.
 */
export { RENAMED_ROWS } from "./retired.ts";
export const RENAMED = {
  lead: "Names that changed, one row each, with where it lives now. Search here and the command menu still find the old names, and old links open the nearest place.",
  was: "Was",
  now: "Now",
};

/** The Guide's search box (in the rail) and its results. */
export const SEARCH = {
  label: "Search the Guide",
  placeholder: "Search the Guide",
  none: (q: string) => `Nothing in the Guide for "${q}". Try fewer words, or ask the assistant.`,
  results: (n: number) => (n === 1 ? "1 result" : `${n} results`),
  in: (section: string) => `in ${section}`,
};

/** Each section's one line under its title. */
export const SECTION_LINES: Record<string, string> = {
  start: "What FocusTime is for, your day and your week.",
  "first-day": "Get set up, then the questions people ask on day one.",
  day: AREAS.day.lead,
  week: AREAS.week.lead,
  ahead: AREAS.ahead.lead,
  status: AREAS.status.lead,
  inbox: AREAS.inbox.lead,
  writing: AREAS.writing.lead,
  capture: AREAS.capture.lead,
  assistant: AREAS.assistant.lead,
  ask: AREAS.ask.lead,
  teams: AREAS.teams.lead,
  calls: AREAS.calls.lead,
  code: AREAS.code.lead,
  settings: AREAS.settings.lead,
  renamed: "Old names, and what they're called now.",
};

/** The try-it sandboxes' words and example data (ui/guide/TryIt.tsx). Fictional, labeled as an example, kept in the page. */
export const TRY = {
  example: "Example data. Nothing here is saved or sent.",
  reset: "Start over",
  drag: {
    title: "Try it: put a to-do on a block",
    sub: "Drag a story onto one of Northwind's blocks, or use its Move to buttons. The block shows its free time as you go.",
    unplanned: "Northwind's stories",
    todos: [
      { id: "a", title: "Export button", size: "M", minutes: 120 },
      { id: "b", title: "Date filter", size: "S", minutes: 60 },
      { id: "c", title: "CSV column order", size: "L", minutes: 240 },
    ],
    blocks: [
      { id: "mon", label: "Mon PM", client: "Northwind", color: "teal" as ExampleColor, freeMinutes: 180 },
      { id: "tue", label: "Tue AM", client: "Northwind", color: "teal" as ExampleColor, freeMinutes: 240 },
    ],
    moveTo: (block: string) => `Move to ${block}`,
    back: "Take off",
    fit: (planned: number, free: number) => (planned >= free ? "No free time left" : `${Math.round((free - planned) / 60)}h free`),
    empty: "Drop a story here",
    moved: (title: string, block: string) => `${title} is on ${block}.`,
  },
  timeline: {
    title: "Try it: Cards or Timeline",
    sub: "Timeline shows each block's hours beside its to-dos. On Cards the to-dos get the whole width, with meetings listed by time.",
    block: { label: "Northwind · Mon PM", color: "teal" as ExampleColor, from: 13, to: 17 },
    meetings: [{ title: "Sprint review", from: 14, to: 15 }],
    todos: ["Export button", "Date filter"],
    listMeeting: (title: string, from: number) => `${from > 12 ? from - 12 : from}:00 ${title}`,
    hour: (h: number) => `${h > 12 ? h - 12 : h}:00`,
  },
  inbox: {
    title: "Try it: open a row in From chats",
    sub: "Pick a row. It opens with why it needs an item and its three actions.",
    list: "From chats · example",
    items: [
      { id: "1", client: "Northwind", kind: "From chats", title: "Fix the export's last day", why: "Asks for a fix no item covers yet", summary: "Priya says the export stops a day early when the range ends on a Sunday. Sam asked if it's the time zone.", main: "Create item" },
      { id: "2", client: "Harbor", kind: "From chats", title: "Add a supplier filter to the dashboard", why: "Asks for a change no item covers yet", summary: "Alex asked for the dashboard to filter by supplier before the Thursday review.", main: "Create item" },
      { id: "3", client: "Atlas", kind: "From chats", title: "Move the cutover a day later", why: "Asks for a change no item covers yet", summary: "Dana asked for the cutover a day later so the client's team can test first.", main: "Create item" },
    ],
    /** The other two actions on a From chats row, after its main one. */
    others: ["Already covered", "Dismiss"],
    pick: "Pick a row to open it here.",
    note: "In the app, Create item opens a preview first, Already covered a search, and Dismiss takes the row off your list with Undo. Here nothing happens.",
  },
  assistant: {
    title: "Try it: ask the assistant",
    sub: "Pick a suggestion or type one of them. This one is scripted: no AI, nothing changes.",
    box: "Ask, or ask for a change",
    send: "Send",
    suggestions: ["What's next?", "Move the export stories to Friday", "Mark #4411 done and comment shipped"],
    answers: {
      next: { kind: "answer" as const, text: "Next is Export button (Northwind, Mon PM, M · 2h). Start focus is on Day." },
      move: { kind: "proposal" as const, title: "Move 2 to-dos to Friday", rows: ["Export button · Mon PM → Fri", "Date filter · Tue AM → Fri"], who: "Only your plan changes." },
      update: { kind: "proposal" as const, title: "Update #4411 in DevOps", rows: ["State: Active → Closed", "Comment: shipped"], who: "Everyone with access to Northwind's DevOps project sees the comment." },
      unknown: { kind: "answer" as const, text: "In the Guide I only know the three suggestions. In the app, ask in your own words." },
    },
    confirm: "Confirm",
    cancel: "Cancel",
    done: "Done",
    undo: "Undo",
    cancelled: "Cancelled. Nothing changed.",
  },
  urgent: {
    label: "Example: the urgent strip",
    rows: [
      { icon: "promise", tag: "Promise · was due Mon, Nov 2", who: "Alex", text: "Send the test plan" },
      { icon: "promise", tag: "Promise · 2:00 PM", who: "Sam", text: "Reply about the price list" },
      { icon: "send", tag: "Sent to you · Must", who: "Jordan", text: "Supplier onboarding" },
    ] as { icon: "promise" | "send"; tag: string; who: string; text: string }[],
  },
  ladderTitle: "How DevOps work is shaped",
};
