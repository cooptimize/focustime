// G1: every word of the Guide, in one file, so wording can change without touching layout (ui/guide/Guide.tsx).
// The approved content and design are docs/ux/guide/prototype.html. Everything here is example data, labeled as such
// on screen; the Guide never shows the person's own clients, work or calendar.
//
// Keys are never typed into the copy: {key:<command>} (or {key:"Ctrl K"} for a key with no command) is replaced by
// that row's keys from ui/keys.ts, so the Guide can't drift from what works (ui/guide/guide.test.ts checks every one).

/** Example client colors, from the app's client slots (ui/styles.css). */
export type ExampleColor = "blue" | "teal" | "violet" | "ochre";

/** A key or keys from ui/keys.ts: by the command it mirrors, or by its first key when it has none. */
export type KeyRef = { command: string } | { key: string };

export const GUIDE_TITLE = "Guide";

export const CHAPTERS = [
  { id: "basics", name: "The basics" },
  { id: "rhythm", name: "Your rhythm" },
  { id: "sizing", name: "Sizing work" },
  { id: "devops", name: "DevOps first" },
  { id: "keys", name: "Shortcuts" },
  { id: "phone", name: "On your phone" },
  { id: "asks", name: "Conversations and promises" },
  { id: "team", name: "Working with your team" },
  { id: "teams", name: "FocusTime in Teams" },
  { id: "questions", name: "Questions" },
] as const;
export type ChapterId = (typeof CHAPTERS)[number]["id"];

export const HERO = {
  eyebrow: "Start here",
  /** The title in three parts: the middle one is highlighted. */
  title: ["Your week is ", "half-days", ". Plan them, work them, close them."] as const,
  lede: "FocusTime takes the focus blocks you already have, lays your DevOps work into them, and keeps the day honest when meetings move. Five minutes here and you'll know the whole loop.",
  weekLabel: "An example week",
  caption: ["Each cell is a ", "focus block", ": half a day for one client."] as const,
  example: "Example data",
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** The example week: AM row then PM row, Monday to Friday. */
export type ExampleCell = { kind: "focus"; client: string; color: ExampleColor } | { kind: "off"; label: string } | { kind: "open"; label: string };
export const EXAMPLE_WEEK: { AM: ExampleCell[]; PM: ExampleCell[] } = {
  AM: [
    { kind: "focus", client: "Cooptimize", color: "blue" },
    { kind: "focus", client: "Harbor", color: "violet" },
    { kind: "focus", client: "Northwind", color: "teal" },
    { kind: "off", label: "PTO" },
    { kind: "open", label: "Catch-up" },
  ],
  PM: [
    { kind: "focus", client: "Northwind", color: "teal" },
    { kind: "focus", client: "Atlas", color: "ochre" },
    { kind: "focus", client: "Northwind", color: "teal" },
    { kind: "off", label: "PTO" },
    { kind: "open", label: "Catch-up" },
  ],
};

// ---------- Chapter 1 ----------

export type Tone = "client-blue" | "client-teal" | "accent" | "action" | "watch" | "risk" | "brand" | "faint";
export const BASICS = {
  eyebrow: "Chapter 1",
  title: "Seven words you'll see everywhere",
  sub: "Tap a card for the one-line detail. That's genuinely all the vocabulary FocusTime needs.",
  cards: [
    { name: "Focus block", tone: "client-blue", short: "Half a day set aside for one client.", more: "They come from Focus Time in Dataverse, the same schedule Cooptimize already keeps. FocusTime reads it; you change it where you always have." },
    { name: "Client", tone: "client-teal", short: "Who the block is for, with its own color.", more: "Cooptimize counts as a client too. Each client's work, notes and follow-ups stay with that client and never mix." },
    { name: "Feature & story", tone: "accent", short: "The week plans features. The day plans stories.", more: "A feature is the outcome a client cares about this week. Stories are the pieces you actually sit down and do. Both live in DevOps." },
    { name: "Must & nice to have", tone: "action", short: "What you'll definitely touch this week, and what fits if there's room.", more: "A must is a target, not a contract. Moving one is one click and nobody gets scolded. Dropping a promised one offers to draft a heads-up." },
    { name: "Size", tone: "watch", short: "Everything is sized in hours. {size:S} {size:M} {size:L} are shortcuts.", more: "S is 1h, M is 2h, L is 4h. Sizing is optional: an unsized story counts as 2h until you size it. Once a feature's stories are sized, they decide how big the feature is." },
    { name: "Follow-up", tone: "risk", short: "Something you owe someone, until you close the loop.", more: "An update, an answer, a DevOps change. Some open on their own (a slipped must, a done story still Active in DevOps). Close the loop when it's done." },
    { name: "Capture", tone: "brand", short: "Get a thought out of your head in one line.", more: "Press {key:capture.add} anywhere. Save it as is, or as a follow-up, a draft story or a draft feature. A follow-up's Who is the same search box as everywhere else: pick a person, or keep a plain name. Sort the rest later in Inbox › Captures. Enter saves, Shift+Enter starts a new line, and the client chip is where it goes: the Saved note names that client, with Undo for a few seconds. A draft story or feature gets a DevOps-ready version from AI in the background when AI is allowed for that client and you have a write PAT for it; your own words stay as you typed them. Create in DevOps shows yours and the AI version side by side: use either, edit it, pick the parent, then confirm the preview. Ctrl+Enter saves and opens that preview at once. Nothing is created in DevOps until you confirm." },
    { name: "Assistant", tone: "accent", short: "Ask what's next, or ask for a change you then confirm.", more: "Press {key:assistant.ask} (or / outside a text field), or Ask in the top bar. Ask what's next, what's due today or tonight, what you did for a client on a day, where an item stands, which features have gaps, what people promised in a client's conversations, or what you sent. It can also propose a change: move, drop or keep a pick, confirm today or the week, add a must, a date, size or owner in Ahead (into your change set), send work to a teammate, a DevOps comment or description, or a capture. Every change shows the same preview as the button, and nothing happens until you Confirm. Hold the mic to talk (60 seconds at most); the words land in the box for you to edit before Send, and the recording isn't kept. It needs AI for FocusTime, and Allow AI for the client it's about. Your history stays 30 days; clear it in Settings › Data." },
    { name: "At risk", tone: "risk", short: "A block that meetings or life are eating into.", more: 'The reason is always written on the card: "At risk · Dentist 12:00". It\'s a heads-up, not a failure.' },
    { name: "Close out", tone: "faint", short: "Leave each client ready to pick up again.", more: "One line per client on where you left off. Next time that client's block comes around, the note is waiting at the top." },
  ] satisfies { name: string; tone: Tone; short: string; more: string }[],
};

// ---------- Chapter 2 ----------

/** The little example screens beside each rhythm step. */
export type Mini =
  | { kind: "week"; title: string; meta: string; chips: (ExampleColor | null)[]; client: { name: string; color: ExampleColor; meta: string; rows: { title: string; meta: string; flag?: boolean }[] }; next: string }
  | { kind: "plan"; title: string; meta: string; client: string; color: ExampleColor; fit: string; stories: { title: string; size: string }[]; meeting: string; free: string }
  | { kind: "now"; title: string; risk: string; color: ExampleColor; rows: ({ kind: "meeting"; text: string } | { kind: "done"; text: string } | { kind: "next"; text: string; action: string } | { kind: "todo"; text: string })[] }
  | { kind: "check"; title: string; meta: string; client: string; color: ExampleColor; done: string; story: string; size: string; move: string; warn: string }
  | { kind: "close"; title: string; meta: string; noteLabel: string; note: string; devops: string; devopsAction: string; overdue: string; overdueText: string };

export type RhythmStep = { name: string; when: string; keys: KeyRef[]; what: string[]; lit: { half: "AM" | "PM"; day: number }[]; mini: Mini };

export const RHYTHM = {
  eyebrow: "Chapter 2",
  title: "The rhythm, from Thursday to Thursday",
  sub: "Five moments, each a few minutes. Click through them, or use the arrow keys once one is selected.",
  stepsLabel: "Rhythm steps",
  shortcut: "Shortcut",
  back: "Back",
  next: "Next:",
  again: "Start over",
  example: "Example",
  steps: [
    {
      name: "Plan the week",
      when: "Thursday or Friday · about 15 minutes",
      keys: [{ command: "view.planweek" }],
      what: ["In Week, switch to Plan (W) and open one client at a time: their blocks next week are already laid out.", "From last week comes first: each feature from this week's list with what it means now (carry it over, watch it, finished). Accept all, or keep, drop or watch each one. Nothing is added until you do.", "Pick the features you'll definitely touch (musts) and the ones that fit if there's room.", "Anything without stories gets a nudge: draft them now or send a Coop brief.", "A target date shows on a row only when it falls this week or has passed. Amber means it may land too late.", "Click Next client until all are planned, then Done."],
      lit: [{ half: "AM", day: 0 }, { half: "AM", day: 1 }, { half: "AM", day: 2 }, { half: "PM", day: 0 }, { half: "PM", day: 1 }, { half: "PM", day: 2 }],
      mini: {
        kind: "week",
        title: "Plan the week",
        meta: "2 of 4 planned",
        chips: ["blue", "violet", "teal", null, null, "teal", "ochre", "teal", null, null],
        client: { name: "Northwind", color: "teal", meta: "9h planned · 7h free", rows: [{ title: "Order history export", meta: "about 6h" }, { title: "Supplier onboarding", meta: "Needs stories", flag: true }] },
        next: "Next client: Harbor ›",
      },
    },
    {
      name: "Plan today",
      when: "Each morning · about 5 minutes",
      keys: [{ command: "view.plan" }],
      what: ["Today shows a Plan today card until the day is confirmed. It opens Week's Board on today.", "Each of today's blocks shows its meetings and free gaps; the arrows step to another day.", "This week's musts for that client come first; add their stories. Size them S, M or L if you like (1h, 2h, 4h). Unsized ones count as 2h.", "Confirm today. Optionally, Timebox my day places stories into the gaps."],
      lit: [{ half: "AM", day: 0 }, { half: "PM", day: 0 }],
      mini: { kind: "plan", title: "Plan today", meta: "about 5h free", client: "Cooptimize", color: "blue", fit: "Fits", stories: [{ title: "Utilization chart", size: "S · 1h" }, { title: "Onboarding guide", size: "Size?" }], meeting: "11:00 Proposal review", free: "Free · 1h 45m" },
    },
    {
      name: "Now",
      when: "All day",
      keys: [{ command: "view.today" }, { command: "timer.start" }],
      what: ["Today shows each block's meetings and stories in time order.", "The next story has the one Start focus button.", "Focus sets Teams to Busy and counts the time.", "Tick stories off as you finish them."],
      lit: [{ half: "AM", day: 0 }],
      mini: {
        kind: "now",
        title: "Today",
        risk: "At risk · Dentist 12:00",
        color: "blue",
        rows: [
          { kind: "meeting", text: "9:00 Team standup" },
          { kind: "done", text: "Timesheet summary" },
          { kind: "next", text: "Utilization chart", action: "Start focus" },
          { kind: "todo", text: "Onboarding guide" },
          { kind: "meeting", text: "11:00 Proposal review · Next" },
        ],
      },
    },
    {
      name: "Midday check-in",
      when: "After lunch · 2 minutes",
      keys: [{ command: "view.checkin" }],
      what: ["After lunch Today shows a Midday check-in card. It opens the same cards, re-fit to the time that's actually left.", "Anything that no longer fits gets one suggested move.", "Walk-on work? Add it once at the bottom.", "Done, and back to Now."],
      lit: [{ half: "PM", day: 0 }],
      mini: { kind: "check", title: "Midday check-in", meta: "4h left today", client: "Northwind", color: "teal", done: "2 done", story: "Invoice totals", size: "S · 1h", move: "Move to Wed", warn: "About an hour over. Move one?" },
    },
    {
      name: "Close out",
      when: "End of day · 3 minutes",
      keys: [{ command: "closeout.load" }],
      what: ["At the end of the day Today shows a Close out card. Write one line per client on where you left off.", "Mark finished stories done in DevOps.", "Close the loop on follow-ups that are due.", "Done. Today shows a small Closed out line you can reopen, and the week folds back up until tomorrow."],
      lit: [{ half: "AM", day: 0 }, { half: "PM", day: 0 }],
      mini: { kind: "close", title: "Close out", meta: "4 done · 3h 10m focused", noteLabel: "Where you left off", note: "Chart renders; next, the client filter.", devops: "#4411 still Active in DevOps", devopsAction: "Mark done", overdue: "Overdue", overdueText: "Reply to Jordan" },
    },
  ] satisfies RhythmStep[],
};

// ---------- Chapter 3 ----------

export const SIZING = {
  eyebrow: "Chapter 3",
  title: "How much fits in a block?",
  sub: "A block is where you work: half a day for one client. Hours are how big the work is. Add stories and watch them fill the free time.",
  blockTitle: "One focus block",
  /** The example block: an afternoon with 4h of focus time left after its meetings (what the fit is measured against). */
  block: { label: "Northwind · Mon PM · example", color: "teal" as ExampleColor, freeMinutes: 240, free: "4h free after meetings" },
  empty: "Empty block",
  /** "3h of 4h": the stories' hours against the block's free time. */
  load: (planned: string, free: string) => `${planned} of ${free}`,
  /** The add buttons: S, M and L with their hours, and an unsized story. */
  add: (size: "S" | "M" | "L" | null) => (size ? `${size} · ${{ S: "1h", M: "2h", L: "4h" }[size]}` : "unsized"),
  clear: "Clear",
  stackLabel: "Stories in this block",
  remove: (chip: string) => `Remove ${chip} story`,
  start: ["M", "S"] as ("S" | "M" | "L" | null)[],
  /** Most the sandbox takes: three blocks' worth of hours (12h). */
  maxMinutes: 720,
  legend: [
    "{b:S} 1h · {b:M} 2h · {b:L} 4h",
    "Sizing is optional. An unsized story counts as 2h until you size it.",
    "Too much? It turns amber. Move something, or keep it. Your call.",
    "Features are their stories added up, or your estimate until they're sized.",
  ],
  hint: "Tap a story chip to remove it.",
};

// ---------- Chapter 4 ----------

export const DEVOPS = {
  eyebrow: "Chapter 4",
  title: "DevOps first",
  quote: ["If it isn't in DevOps, ", "it isn't planned yet."] as const,
  body: "FocusTime makes the healthy path the easy one. It reads your work from DevOps, nudges big things into smaller pieces, and offers to update DevOps when you finish. It never changes anything without showing you first.",
  // WT-1: levels come from each client's DevOps process, not type names; the icon is the type's usual DevOps icon.
  ladder: [
    { level: "Top", icon: "icon_crown", text: "Epics (or whatever the top level is called). Live in Ahead. Need features before they reach a week." },
    { level: "Parent", icon: "icon_trophy", text: "Features, and any type at the same level. Go on a week as a must or nice to have." },
    { level: "Needs stories", text: "A feature with no stories can't go on a day yet. {b:Break down} or send a {b:Coop brief}. An admin can turn this off for a type that's worked directly.", flag: true },
    { level: "Child", icon: "icon_book", text: "Stories, and bugs and tasks where the team tracks them. Go on a day, get a size, get done." },
    { level: "Done", text: "Tick it, then {b:Mark done in DevOps} from Close out. Resolved in DevOps means no hours left; it drops off planning lists." },
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
  /** BD-1: Break down (was Draft stories), a side panel in three steps. */
  breakdown: [
    { q: "What does Break down do?", a: "On an item that {b:Needs stories}, {b:Break down} asks the AI to propose the child items it's missing. The button names the item's type, like {b:Break down Feature} or {b:Break down Recurring}. It opens a side panel: the item stays on the left (its state, priority, parent, description and any children it has) and the proposals fill the right, in three steps: Prepare, Review and Publish. Run never creates anything; nothing is written to DevOps until you press Create all." },
    { q: "What is sent to the AI?", a: "Open {b:What's sent to the AI} under the item to see the list in plain words. Text from DevOps only: the item's fields and description, its parent's title and a short description, the titles and states of the children it already has, and its newest comments up to a limit (Coop briefs as one line). Also up to 5 of that client's own past items with their children as examples, the client's house style (learned each week, or the default), and your note. Never attachments, linked documents, email addresses or another client's work. What it costs is in the AI log." },
    { q: "What do I choose in Prepare?", a: "Only what matters: the type to create, when the item's type takes more than one (the most common comes first), and an optional {b:Note for the AI}. Enter runs; Shift+Enter adds a line. If you broke the item down before, one line offers to open that draft." },
    { q: "What is the house style?", a: "A few lines about how a client's items are usually split: how many children, how titles start, whether they use acceptance criteria. FocusTime learns it each week from the client's own items, unless your FocusTime admin has written one for the client in Admin › Clients. What's sent to the AI says which one is used." },
    { q: "How do I review the proposals?", a: "Each card is one item: edit its title, description and acceptance criteria (a short checklist; Enter adds the next), give it a size (S 1h, M 2h, L 4h, or leave it unsized at 2h), drag it by its handle or move it with the up and down arrows, or Drop it (Undo brings it back). \"after <title>\" means it depends on another card. Regenerate… redoes one card and Regenerate all… the whole set, each with a note. The line at the top says why these, and what the AI left out as out of scope or already covered. The total at the bottom counts what you keep, like \"5 items · about 9h\"." },
    { q: "What happens when I press Create all?", a: "First you see the exact batch: each item's type, title and size, under its parent. Create all makes them one by one under the parent, assigned to you, in dependency order, and reads each one back. If some fail, the panel lists what was created and what wasn't, with Retry the rest; nothing is created twice. Sizes stay in FocusTime. Once the item has children it no longer needs stories. The Audit log in Settings › Data has every create with Undo." },
    { q: "Why can't I break an item down?", a: "The panel says so. \"AI is off for <client>\": ask your FocusTime admin. Without that client's DevOps write access, it asks you to add it in Settings first and sends nothing, not even the AI request. The Coop brief is always there." },
  ],
};

// ---------- Chapter 5 ----------

/** One shortcut card: a label and the keys it takes from ui/keys.ts (each row's first key, or every key of one row). */
export type ShortcutCard = { label: string; keys: KeyRef[]; all?: boolean };

export const SHORTCUTS = {
  eyebrow: "Chapter 5",
  title: "The shortcuts worth learning",
  sub: "Everything works with the mouse. These save you a few clicks a day. {key:Ctrl K} lists every action with its key.",
  cards: [
    { label: "Today, Week, Ahead, Inbox", keys: [{ command: "view.today" }, { command: "view.week" }, { command: "roadmap.load" }, { command: "view.inbox" }] },
    { label: "Week: Board or Plan", keys: [{ command: "view.plan" }] },
    { label: "Capture a thought", keys: [{ command: "capture.add" }], all: true },
    { label: "Midday check-in", keys: [{ command: "view.checkin" }] },
    { label: "Close out", keys: [{ command: "closeout.load" }] },
    { label: "Plan the week", keys: [{ command: "view.planweek" }] },
    { label: "Every action", keys: [{ key: "Ctrl K" }] },
    { label: "Ask the assistant", keys: [{ command: "assistant.ask" }], all: true },
    { label: "Next or previous client", keys: [{ key: "J" }], all: true },
    { label: "Text size", keys: [{ command: "ui.set_text_size" }], all: true },
  ] satisfies ShortcutCard[],
  every: "Every key",
};

// ---------- Chapter 6 ----------

/** P1: FocusTime on a phone: what works there, installing it, and notifications. */
export const PHONE = {
  eyebrow: "Chapter 6",
  title: "On your phone",
  sub: "The phone is for checking and doing. Planning stays on a bigger screen.",
  items: [
    { q: "What works on a phone?", a: "The bottom bar has the same four tabs: Today, Week, Ahead and Inbox; Capture is the + at the top. Today with the block you're in, its next pick, Start focus, Done and Mark done; the Midday check-in and Close out; Week one day at a time, with Plan today (day arrows, long-press to move a story, Confirm today); the Inbox; your follow-ups; Coop brief and Break down. Plan and Ahead (Grid, Gantt and Fix next) open read-only, with Copy link to finish on a computer." },
    { q: "How do I install it?", a: "On Android or in Chrome or Edge on a computer: ⋯ › Install app. On iPhone: tap Share in Safari, then Add to Home Screen, then Add. ⋯ › Install app shows the steps. Once installed it opens like an app, straight to Today." },
    { q: "How do notifications work?", a: "Every notification shows in ⋯ › Notifications, with a dot on ⋯ when there's something new, and as a short note at the bottom while FocusTime is open. To get them on a phone or computer when FocusTime is closed, open Settings › Notifications on that device and tap Notify this device; the browser asks first. On iPhone this works only in FocusTime from the home screen." },
    { q: "What do they say on my lock screen?", a: "Only what kind of thing it is, like Follow-ups due or Plan the day: no client names, no work item titles. Turn on Show details in notifications in Settings › Notifications if you want those." },
    { q: "Does it work offline?", a: "No. FocusTime opens without a connection but says it's offline; nothing of yours is kept on the phone. Signing out clears what the browser kept and turns notifications off on that device." },
    { q: "Can I just talk to it?", a: "Yes: on a phone, tap the speech mark at the top for the assistant, then hold Hold to talk. Release and the words land in the box; fix them if needed, then Send. Changes still wait for your Confirm." },
    { q: "Quick capture from anywhere?", a: "On a phone, Capture is the + at the top. With a keyboard, press {key:capture.add} anywhere outside a text field." },
  ],
};

// ---------- Chapter 7 ----------

/** CV-1: Conversations and My promises from client chats, read for everyone by one job and sorted by AI when allowed. */
export const ASKS = {
  eyebrow: "Chapter 7",
  title: "Conversations and promises",
  sub: "What's said in a client's Teams chats becomes a short card per conversation, so nothing scrolls away, and what you promised there shows on Today.",
  items: [
    { q: "What is a conversation?", a: "One thread of work in a client's Teams chat: a question, the back and forth about it, and what people said they'll do. Each card has a title, two to four lines on where it stands, who's in it and when it last moved. Its status comes from what happened, never from a guess: New, In discussion, <Name> committed, Tracked #id (it has a DevOps item), Resolved or Closed. \"Updated\" means it changed since you last looked." },
    { q: "How do I turn it on?", a: "A FocusTime admin adds the client's chats, once for everyone: Admin › Clients, on a client, Add a chat. Everyone else sees them in Settings › Clients. The first time, Microsoft asks you to let FocusTime read chat messages. Reading starts from that moment, never from history." },
    { q: "Who sees a chat's conversations?", a: "Everyone at Cooptimize who is a member of the chat and follows its client. Nobody else, and never under another client." },
    { q: "When does it read?", a: "Every 5 minutes while anyone on the chat is in their working hours, and not at all outside them; the first read of the day catches up. Refresh in Inbox › Conversations reads now. FocusTime only reads; it never posts, reacts or marks anything read in Teams." },
    { q: "What's in Needs you?", a: "Conversations that wait on you: one you committed in, one you own, a new one nobody has picked up, or, for a client's lead, a promise nobody acted on (Unclaimed). Handled by teammates (folded) holds the ones someone else is on, and Closed the ones resolved or not a request. Each card has one main button (Create DevOps item, Link, Resolve, Take it over or Mark done) and the rest under ⋯. A conversation linked to an item moves to In progress. J and K move, Enter runs the main button, X shows the messages, R resolves." },
    { q: "How does AI sort them?", a: "With AI on for FocusTime and allowed for that client (a FocusTime admin sets both in Admin › AI), each batch of new messages goes to the AI once, with that chat's open conversations, and it says which conversation each message belongs to, writes the summary and notes who committed to what. Names are sent, never email addresses. It runs on FocusTime's shared budget, not yours. Small talk, reactions and a plain \"thanks\" never become conversations: they're under Filtered as chatter, where This is work puts one back." },
    { q: "Why are some messages unsorted?", a: "The AI budget is used up or set to $0, or the AI service didn't answer: those wait, the card says why, and Sort unsorted (N) sorts them once AI is back. With AI off for the client, rules group what they can (next question) and the rest waits the same way." },
    { q: "What happens to a chat when AI is off for its client?", a: "Rules group its messages, as long as the client's Group messages without AI is on (it is unless a FocusTime admin turned it off in Admin › AI). A question or ask from the client starts a conversation. A message joins one when it replies to a message in it, @mentions someone in it, comes from someone it @mentioned within 45 minutes of its last message, or comes from someone already in it within 45 minutes of their last message there. Only within the same chat. The title is the first message, shortened; there's no summary without AI, so Show messages has the whole thread. Anything the rules can't place waits as unsorted." },
    { q: "Hide for me or Not a request?", a: "Hide for me takes a card off your list only. Not a request closes it for everyone, with your name and an optional reason, and anyone can open it again. A new work message opens a closed conversation again by itself. FocusTime never resolves anything on its own: when a thread winds down it asks \"Looks wrapped up. Resolve?\"." },
    { q: "What happens when someone commits to work?", a: "If what they said needs a DevOps item, they see Create DevOps item first, and it waits amber on them after a working day. Anyone on the chat can still create or link one." },
    { q: "How do I create a DevOps item from a conversation or a promise?", a: "Create DevOps item is on every conversation and promise without an item: the main button for a work request or an open promise, under ⋯ otherwise (and under ⋯ on a message filtered as chatter, which makes it a conversation first). With AI on for that client the form is drafted from that conversation only: a title, the description, acceptance criteria, the type (only the client's own types that go under the parent) and a suggested parent feature or epic in scope. With AI off, or Allow AI off for the client, the same form is empty for you to fill in. It's assigned to you, or to nobody if you untick it. The preview shows the full text, who can see it (everyone with access to that DevOps project) and Attach N images from the chat; nothing is written until you confirm, and Undo is in Settings > Data > Audit log. Without DevOps writes for the client the form says how to turn them on and sends nothing." },
    { q: "What if nobody creates it?", a: "After one of their working days (at once if they're on time off) the card says \"Waiting on <Name> · 1 day\" in amber, the client's leads see it as Unclaimed, and the person gets one reminder. Anyone who sees it can Take it over; the person is told quietly. FocusTime never reassigns on its own and never notifies the whole team." },
    { q: "What are the suggested comments?", a: "When a tracked conversation changes and then goes quiet for 30 minutes, or is resolved, the item's owner gets one drafted DevOps comment with a link to the chat: Post comment or Skip. At most one a day per item, plus one on resolve. A description change is suggested only for a clear change of scope, with before and after, and needs your confirm. Lines from an internal chat are flagged and left out unless you include them." },
    { q: "What does Show messages show?", a: "The messages as Teams shows them: one person's messages together under their picture and name, yours on the other side, a reply's quoted message above it, and reactions small underneath (only each emoji and how many, never who). The latest 20 show first; Show earlier loads 20 more." },
    { q: "Why do I see pictures from the chat?", a: "Pictures pasted into a chat show as thumbnails on the message, and the card says how many. Click one to see it large; Previous and Next (or the arrow keys) move between them, and Esc closes. FocusTime keeps a copy with its hidden details (where and when it was taken, the camera, comments) removed, shows it only to people on that chat who follow its client, and deletes it with its message. Pictures never go to AI. Only PNG, JPEG and GIF up to 10 MB show; anything else says why." },
    { q: "Can I merge two conversations?", a: "Yes, when one topic was split in two. On a card, ⋯ then Merge into…, and pick the one to keep; or Select, tick several of one chat, and choose the one to keep. Their messages, commitments and suggestions move into it for everyone on the chat, and the summary is written again. Undo puts everything back." },
    { q: "When is a promise in Today's urgent strip?", a: "When it's overdue, or due within the next 2 hours. Otherwise it waits at its time in Today's agenda (and on Week's rail), so it doesn't sit at the top all day. One due today with no time is in the follow-ups row of the attention line, and joins the strip in your last 2 working hours." },
    { q: "How do I link a conversation or promise to an item that already exists?", a: "Link to item (the main button when FocusTime sees a likely item, else under ⋯) searches that client's open items in Cooptimize's scope by title or #id; on a promise it first lists up to 5 likely ones with the reason. Linking is FocusTime's own note, nothing changes in DevOps, and Undo (or Unlink under ⋯) takes it off. Tick Also add a comment on the item to post a short comment with a link back to Teams: it has its own preview and confirm. A linked conversation moves to In progress with the item's state, assignee and last change; when the item closes in DevOps it shows Item closed with Mark done, and nothing is closed for you." },
    { q: "Can a link open one conversation?", a: "Yes. Each line in Today's urgent strip opens its own conversation or promise, selected and scrolled to. The addresses are #/inbox/conversation/<number> and #/inbox/promise/<number>." },
    { q: "What are the Inbox's modes?", a: "Conversations, Promises and Captures, on the switch at the right of the Inbox's header, each with its count. Captures is the capture box, your follow-ups and your drafts (it was called Inbox before). The Inbox opens on the mode you used last in this browser, Conversations the first time; a link to a conversation, a promise or a follow-up opens its own mode. P steps through them." },
    { q: "What are Promises?", a: "What you said you'd do in those chats, one per run of your messages: what, to whom (the person you replied to, else the one you mentioned, else the one you answered) and when it's due. \"I'll be back online at 7:30\" isn't a promise by itself, but it can set the due time of the one before it. The ⓘ shows why it counts. Create DevOps item leads while it has no item, then Add to Today or Make it a follow-up (Who starts as the person it was made to); Link to item, Done and Not needed are under ⋯. A promise linked to an item stays yours to act on: due, Today, a follow-up and Done all still work. When what you said means a DevOps item (\"I'll log a ticket\", \"add it to the backlog\", \"I'll track it\"), it also waits amber after one of your working days. Create works even when the promise isn't in a conversation: it starts one from your message and the ones just before it." },
    { q: "How do I choose who a follow-up is for?", a: "Who is a search box: type a name and pick from In this conversation (people from other organizations marked External), On <client> (the people on that client) or Everyone at Cooptimize. You can also type any name and keep it as plain text; it says \"Not linked to a person\", and when the text matches exactly one person it offers to link it." },
    { q: "Where do promises show?", a: "On Today: in Now when due before the half-day ends or overdue, at their time in the agenda (with After your blocks for the evening), and in the follow-ups row when they have no time. On Week, as a mark on the day's rail. Past its due it says \"Was due\" with the time or day, in amber, never red." },
    { q: "What does FocusTime keep?", a: "Each message once, under its client, for the people who see that chat. Messages that aren't part of a conversation or promise are deleted after 14 days. Images pasted into the chat are never kept: FocusTime reads one from Teams with your own sign-in when you look at it (held in memory for a few minutes, never on disk), and keeps only its type, size and the AI's short description. When Teams can't give it now (your sign-in ran out, the message was removed) it shows Image in Teams with Open in Teams. Nothing goes to logs except counts." },
    { q: "Are chat images sent to the AI?", a: "Only for a client whose Send attachments to AI is on (a FocusTime admin's switch in Admin › AI, off by default), and only with AI on for that client. Then the new images in a batch go with that same request, each after the message it belongs to, so the summary can use what they show, and the AI writes one short line about each (at most 120 characters), shown on the card and under the image only to the people in the chat. At most 4 images a message and 10 a request; the rest aren't described. Be aware: FocusTime's AI safety check reads text only. It can't look inside an image for another client's names, passwords or personal details, so turning the switch on is the consent to send whatever the client's chat images show. With it off, nothing is read or sent; images are only counted." },
    { q: "Can a DevOps item carry the chat's images?", a: "Yes. Create item from a conversation (or from a promise) shows the images of the messages going with it, each with a checkbox, all ticked; an internal chat's only when you include its messages. When you confirm, each ticked one is read from Teams with your sign-in, uploaded to DevOps with your write PAT and linked to the new item, with a note saying who pasted it and when; the description says how many were attached. At most 10, 10 MB each. One that can't be read is left out and said so; the item is still created. Undo unlinks them, but the files stay in DevOps: DevOps has no way to delete an attachment." },
  ],
};

// ---------- Chapter 8 ----------

/** SW-1: sending work to someone's week, client priorities, Ask to look, and Week › Team. */
export const TEAM = {
  eyebrow: "Chapter 8",
  title: "Working with your team",
  sub: "Send a feature or story to someone's week, see what everyone on a client planned, and ask a lead to look at your plan.",
  items: [
    { q: "How do I send work to someone?", a: "On any feature or story (a row in Week › Plan, a story in Your stories, an item Break down just created), ⋯ then Send to…. Pick who (people on that client who use FocusTime; anyone not on it yet shows as Not on FocusTime yet and can't be picked), this week or next, Suggested or Must, and an optional note. Tick Ask them to take it in DevOps if it should be theirs there too." },
    { q: "Who can send a Must?", a: "Only that client's leads. Anyone on the client can send a Suggested. Levels are guidance everywhere else in FocusTime; the Must label is the one exception, because it asks for the week to change." },
    { q: "What do I do with something sent to me?", a: "It shows in From your team at the top of Week › Plan, as one line on Today, and as a notification. Accept puts it on your week as a must; Accept and schedule also opens the Board on the client's first block. Pass to… hands it to someone else on the client (who sent it stays the sender). Can't this week asks for a reason, which the sender sees. Nothing counts against your hours until you accept." },
    { q: "What if I can't take a Must?", a: "Say why. The sender sees Can't: <your reason>, and the client's other leads get a quiet note with it. The Must stays as a conflict, marked in amber for both of you, until the sender passes it on or withdraws it, or you accept it after all." },
    { q: "Does Accept change DevOps?", a: "Only if you leave Also assign to me in DevOps ticked. It's ticked when the sender asked you to take it, and unticked otherwise. Then the usual DevOps write runs: a preview, the item assigned to you, read back, in the audit log with Undo, and a quiet note to whoever had it." },
    { q: "How do I see what I sent?", a: "You sent, under From your team: Waiting (Cancel while it waits), Accepted, Scheduled, Passed to <name>, Can't: <reason>, Done once DevOps resolves the item, or Not answered when its week ended with no answer." },
    { q: "What is a client priority?", a: "A feature a client's lead flags as the client's top ask, with an optional note. Everyone on the client sees it at the top of Plan with Add to my week. A lead can unflag it any time, and it drops off once DevOps resolves it." },
    { q: "What does Week › Team show?", a: "For each client you're on: what each person planned this week (their features, must or nice to have, and the ones they're watching with whether they moved), the client's priorities and what was sent. Someone who hasn't confirmed yet shows Not confirmed yet. It never shows hours, estimates, day plans, picks, pins, notes or focus: those stay with each person. Account Workers and the client's leads see it; on a phone it is read-only." },
    { q: "How do I ask a lead to look at my week?", a: "In Week › Plan, Ask <lead> to look on the client, with an optional note. The lead gets a notification and sees it at the foot of their Team view, where they can reply. The reply shows on your Plan under the client." },
    { q: "Where did Needs help from… go?", a: "It's now Ask to collaborate, in the same places. It still finds teammates who are free and sends a help invite after a preview. Typing needs help in the command menu still finds it." },
  ],
};

// ---------- Chapter 9 ----------

/** TB-1 and TB-2: the FocusTime bot in a 1:1 Teams chat, and the short daily rhythm it can send. */
export const TEAMS_BOT = {
  eyebrow: "Chapter 9",
  title: "FocusTime in Teams",
  sub: "Ask FocusTime things in a chat with it in Teams, and, if you want, get a short morning brief, a midday check-in and a close out there.",
  items: [
    { q: "How do I start?", a: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\". It answers only you, only in that 1:1 chat. Help lists what it understands; what's next and today work even without AI." },
    { q: "Can FocusTime message me first?", a: "Only if you ask it to. Settings › Notifications › In Teams: turn on Let FocusTime message me in Teams, then tick what you want: Morning brief, Midday check-in, Close out, Nudges. All are off until you turn them on. They come only in your own chat with FocusTime, never on weekends or PTO days, never in quiet hours, and wait while focus runs. Friday only with Also on Fridays. Send me a test now sends one at once so you can see it." },
    { q: "What's in each one?", a: "The morning brief (at the start of your day, or a time you set): today's blocks, meetings, picks, promises due and work sent to you, with Confirm today and Move…. The midday check-in (12:00 unless you change it): this morning's picks with Done and Not yet, and Move the rest. Close out (30 minutes before your day ends unless you change it): today's picks; tick what got done or just tell it. Nudges: a promise due tonight that's still open, work sent to you waiting over half a day, or someone taking over an item assigned to you, together in one message, at most one an hour." },
    { q: "Does tapping a button change things right away?", a: "Done and Not yet on a pick change only your own plan, at once, exactly like the buttons in the app, with Undo on the card. Anything bigger (moving picks, confirming today, closing out the day) shows the change first, with Confirm and Cancel, and nothing happens until you Confirm. Nothing in DevOps, Outlook or anywhere outside FocusTime changes without a Confirm." },
    { q: "Can I just tell it what I got done?", a: "Yes. While today's Close out is waiting, reply in your own words: \"all but the export\", \"1 and 3\", \"fixed the login timeout\". The card above fills in what it understood: the picks done, where the rest move (each to its client's next block, or the unfinished list when there's none this week) and the day closed out. One Confirm does all of it. FocusTime matches your words to the picks itself; no AI reads them." },
    { q: "How do I capture something from Teams?", a: "Start the message with capture: (or c:), for example \"capture: call Dana about the export\". It goes to Inbox › Captures exactly as typed, to sort later, with Undo on the reply. Anything else you write goes to the assistant." },
    { q: "It says FocusTime can't message me in Teams.", a: "Teams told FocusTime the chat is blocked or the app was removed, so Let FocusTime message me in Teams turned itself off. Add FocusTime again in Teams, send it a message, then turn the switch back on." },
  ],
};

// ---------- Chapter 10 ----------

export const QUESTIONS = {
  eyebrow: "Chapter 10",
  title: "Questions people ask first",
  items: [
    { q: "What are Ahead's Grid, Gantt and Fix next?", a: "Three views of the same features and epics (and your stories, in Grid). Grid is a table: state, dates, who it's assigned to, size and what's missing, edited in place; on a narrower window Start and Target share one Dates column, Readiness becomes dots (hover for the words), and below about 900 pixels each item is a two-line card. Gantt is the timeline: drag a bar by half-days to move its dates, with your free hours per week below. Fix next is its own mode, with its count in the switch (Fix next · 7). Mine, Contributing and All choose whose items show; FocusTime remembers your choice." },
    { q: "What does Fix next list, and in what order?", a: "Items you can change that are missing stories, a target date, an owner or a size, and only the ones that matter now: near the top of the client's DevOps backlog (the top 30 of each level, epics, features and stories, a number your FocusTime admin can change), dated in the next 4 weeks, or features and epics you own (and the features under your epics). They're in the client's backlog order, ties by target date, grouped by client, then epic and feature. Each row has one next step (Break down, Set dates, Assign or Size) and Skip; the first 10 per client show, then Show more. A project with no backlog order is ranked by target date and says so. An admin can turn any of the four gaps off for a client in Admin › Clients, for a client that doesn't size stories, say." },
    { q: "Someone shows as Ext-Name in DevOps. Is that one of us?", a: "Often: many clients give us a login of their own in their DevOps. FocusTime counts that login as the person, so their items are theirs in Mine, Contributing, Team and notes, and their FocusTime name shows instead of the login. It knows a login from the person's Account Worker record in Dataverse, or because a FocusTime admin confirmed it in Admin › People, where logins that look like a Cooptimizer's are suggested for a confirm and the rest can be linked to a person. A suggestion is never applied without that confirm." },
    { q: "Why doesn't Ahead show everything in a client's DevOps project?", a: "A client's project often holds much more than our work, so Ahead, Fix next and Week's lists show Cooptimize's work in it. A FocusTime admin sets that per client in Admin › Clients: the whole project, some DevOps teams, or some area paths. Until then FocusTime works it out: items assigned to Cooptimizers, everything under epics and features a Cooptimizer owns, and the area paths where Cooptimizers have items. Items assigned to you always show. Show the whole project brings in the rest, marked Outside scope, and FocusTime remembers it for you; Fix next never lists items outside the scope." },
    { q: "When do my Ahead changes reach DevOps?", a: "Only when you save. Every edit in Grid, Gantt or Fix next goes into your pending changes first. Review lists them with before and after; Save sends them to DevOps per client with a preview, checks each one afterwards, and you can undo any of them from the Saved list or Settings > Data. If someone changed the same field in DevOps since you started, Review shows both and you choose Keep mine or Take theirs." },
    { q: "What can I change in Ahead?", a: "Your own items, the features directly under an epic you own, and anything on a client you lead. Everything else shows Read-only. A teammate you assign gets a quiet note in FocusTime, and so does the owner of an item whose dates you moved." },
    { q: "How fresh is what I see from DevOps?", a: "FocusTime reads each client's DevOps once for everyone, about every minute in working hours and every 10 minutes outside them while someone is using it, and only what changed. If a read fails, you keep seeing the last good one with \"Showing items from\" and its time. Press {key:week.load} or Refresh for a check now; within 30 seconds of someone else's, you see that one. A change you make from FocusTime shows at once." },
    { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
    { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings > Data. In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
    { q: 'Why is "over" amber and not red?', a: "Because plans change and that's normal. Red is only for real trouble, like a block at risk or a follow-up that's overdue." },
    { q: "Do I have to size everything?", a: "No. Unsized stories count as 2h so the plan still adds up, and nothing waits on a size. Size them when you know." },
    { q: "How do I plan stories into Week's blocks?", a: "Click a block on Week. The panel lists your open stories for that client, grouped under their features: this week's features first, then the rest in DevOps order. Drag a story onto any of this week's blocks for that client, Friday's catch-up included. While you drag, the block shows the fit, like \"2h of 3h free\" or an amber \"1h over\"; PTO, past half-days and other clients' blocks say no. Drag a story from a card to another block to move it. Each drop has Undo. Without a mouse, use Add to… or Move to… (the drag handle or ⋯); on a tablet, press and hold; on a phone, Add to…. A story planned elsewhere stays in the list as \"Planned · Thu AM\", which opens that block." },
    { q: "This week's feature says No stories for you yet. Now what?", a: "Type a title in Add a story for me and press Enter (a size is optional). You see the DevOps preview; Create makes the story under the feature, assigned to you, and puts it in the block you're on. Not now leaves nothing behind. Break down opens the Break down panel for the feature, where AI can propose its stories. If teammates have stories there, Take one assigns one to you after a preview: the person who had it gets a quiet note in FocusTime, and Undo in Settings > Data gives it back. Without DevOps write access for that client, the panel says where to add it." },
    { q: "What is From last week?", a: "When a new week starts, Week's Board and Plan show last week's features per client with one suggestion each. A feature with your open stories carries over as a must, with those stories. One that's resolved or closed shows as Finished last week. If your stories are done, or were never yours, the feature's owner and the client's leads get Watching; anyone else sees Your part is done (with Keep watching) or Not yours yet (with Take one). A feature with no stories asks the owner or a lead to break it down. Nothing is added until you press Keep, Watch or Accept all, and a row you drop doesn't come back that week." },
    { q: "What are the dashed cards on Week's Board?", a: "Unfinished picks from earlier days this week, suggested in the client's next block you can still plan (never a PTO day, the catch-up day or a block with no working hours). They say where they came from (From Mon) and don't count against the block until you keep them. Click one for Keep here, Move to… or Drop, or drag it like any card; each can be undone. Keep all keeps every suggestion, and Review lists them by client and feature. The block they came from shows them dimmed with where they went. Nothing moves on its own." },
    { q: "Why are some unfinished picks in a list instead?", a: "When the client has no block left this week, its unfinished picks go in Unfinished from earlier days, grouped by client and feature. Drag one onto any block or use Move to…. Picks from an earlier week fold under From last week the same way." },
    { q: "What is the line across today?", a: "The time now, on today's blocks, with the time at its left end. The part of today that has passed is a little dimmer. Before or after your hours it sits at the top or bottom edge of the day; on a PTO or catch-up day it is thinner. Today's agenda and Plan today show it as a row in time order. Click the time to bring today into view on a narrow screen or the phone." },
    { q: "What does Watching mean?", a: "You're keeping a feature moving without doing its stories. Each Watching row gets a 30-minute check-in on the client's first block of the week that hasn't ended. It counts in the week's hours at once, shows on the Board as a dashed Check-in chip, and becomes a pick when you plan that day. Move it or remove it from the chip or the row; the row stays. If none of its stories changed state since Monday, from Wednesday the row turns amber, \"No movement this week\", with who to check in with: the Cooptimizer with the most open stories on it. Until FocusTime has a week of DevOps changes it says Movement not known yet." },
    { q: "What is Keep open?", a: "A share of a client's block hours left unplanned for walk-in work, from None to 50%, on the client's card in Plan. Your level may set a default. \"Keeping 30% open for walk-ins\" lowers how much you plan up to, and the amber over line uses the lower number." },
    { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
    { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional. If you connect it, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
    { q: "Can anyone else see my plan?", a: "No. Your plan, notes, follow-ups and settings are yours. Teammates only ever see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
    { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Today shows a quiet line while steps are left, and Settings > Setup runs it again." },
    { q: "Which version am I on?", a: "⋯ › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
    { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it; a must already pinned there stays, marked \"Pinned to PTO, move it\"." },
    { q: "Why can't I move some of my old timeboxes?", a: "Timeboxes made by an earlier FocusTime, before you signed in here, show as ordinary Outlook events. FocusTime leaves them alone; change or delete them in Outlook." },
    { q: "How do I add a client's Teams chats?", a: "A FocusTime admin adds them: Admin › Clients, on each client, Delivery chats, then Add a chat (everyone else sees the chats in Settings › Clients, read-only). Type to search your Teams group chats, then Enter. A client can have several chats; a chat belongs to one client. Each is labelled Delivery team (the internal Cooptimize team) or Customer collaboration (with the client's key people): FocusTime suggests it from who is in the chat, and you can change it. People from other organizations, and guests, are marked External, and FocusTime warns when someone from outside is in a Delivery team chat. A chat added to a client is shared with everyone on it who follows the client, and its new messages are read into conversations (see Conversations and my promises)." },
    { q: "Where do I add my DevOps write access?", a: "Settings > Clients, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again." },
    { q: "How do I send an idea, a problem or a question?", a: "⋯ › Send feedback, or Send feedback in Commands. Pick Idea, Problem or Question, write it, and look at the preview: it shows exactly what goes to the FocusTime backlog in Cooptimize's DevOps. Your name and email go with it, and where you were if you leave that ticked; nothing from your plan or clients. It's created as you, with your own DevOps write PAT for Internal, so turn on DevOps writes for Internal in Settings › Clients first; Settings › Connections › Send feedback says whether you're set up. Once it's created you see its number, linked to the item in DevOps, and Settings › Data lists it in the DevOps write log, with Undo. If it can't be sent, it says so and nothing is claimed; Copy text keeps it, and you can message the FocusTime team in Teams." },
    { q: "Does FocusTime use AI?", a: "Only where your FocusTime admin turns it on: AI for FocusTime and each client's Allow AI are set in Admin › AI, and Settings › AI shows them. What's sent is only what one task needs, about one client at a time; FocusTime checks it first and won't send another client's details, keys or passwords, your VM, or email addresses from outside Cooptimize. Your AI use stops at your monthly limit (10 dollars unless an admin changes it). Settings › AI shows this month's cost and your last 20 requests, never their text, and Test AI checks it works." },
    { q: "What does \"Set by your FocusTime admin\" mean?", a: "Some settings are the team's: a FocusTime admin sets them once for everyone in Admin, like whether AI is on, which clients allow it, a client's chats and its open states. You see them read-only. Others are team defaults you can change for yourself, like a client's color or how much of your free time to plan: pick your own, and Reset goes back to the team's." },
    { q: "What can a FocusTime admin do?", a: "Admins are the members of the FocusTime Admins group in Entra. Admin (in ⋯ and in Settings, only for admins) holds the team's settings: clients, AI, conversations, people and their levels and leads, the organization's defaults, the health of each source, and an audit of every change. Admins never see anyone's plan, picks, follow-ups, captures, focus sessions, tokens, AI request text, or messages from chats they aren't in." },
    { q: "Do I need to save in Settings?", a: "No. Each setting saves as you change it, and says Saved by the field; Undo puts the old value back. Only access tokens wait for Check and save." },
    { q: "Why isn't one of our accounts in my client list?", a: "FocusTime's clients are the active Dataverse accounts of type Customer, plus Cooptimize Internal. Prospects, partners, vendors and the rest stay out of your lists and pickers. A FocusTime admin can treat an account as a client, or hide one, in Admin › Clients under All accounts. Nothing is deleted either way." },
    { q: "Who shows as a Cooptimizer?", a: "People with an address in the Cooptimize email domains who aren't guests. Only they have a level, lead clients, and appear in teammate pickers. Guests and automation accounts are listed for admins under Not Cooptimizers in Admin › People. Sign-in is only for Cooptimize accounts: a guest account is told to sign in with their cooptimize.org account." },
    { q: "How do I find a setting in a short window?", a: "The menu on the left scrolls on its own, and Settings and Admin each fold (FocusTime remembers the fold in this browser). On a phone or a narrow window, the Settings picker at the top lists every section." },
    { q: "Where does my level come from?", a: "Your position in Dataverse, through the mapping a FocusTime admin keeps in Admin › People. Until a position is mapped, its people show Level not set and get the Consultant defaults. A level only changes suggestions and emphasis, never what you can see or do." },
  ],
};

export const FOOTER = "FocusTime by Cooptimize. Questions or ideas? ⋯ › Send feedback, or message the FocusTime team in Teams.";

// ---------- Ways in ----------

export const TOUR = {
  /** The sign-in page and a person's first Today. */
  link: "New here? Take the 2-minute tour",
  dismiss: "Not now",
  close: "Close",
  signIn: "Back to sign in",
};
