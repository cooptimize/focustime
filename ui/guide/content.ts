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
  { id: "asks", name: "Conversations and my promises" },
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
    { name: "Feature & story", tone: "accent", short: "The week commits features. The day commits stories.", more: "A feature is the outcome a client cares about this week. Stories are the pieces you actually sit down and do. Both live in DevOps." },
    { name: "Must & nice to have", tone: "action", short: "What you'll definitely touch this week, and what fits if there's room.", more: "A must is a target, not a contract. Moving one is one click and nobody gets scolded. Dropping a promised one offers to draft a heads-up." },
    { name: "Size", tone: "watch", short: "Everything is sized in hours. {size:S} {size:M} {size:L} are shortcuts.", more: "S is 1h, M is 2h, L is 4h. Sizing is optional: an unsized story counts as 2h until you size it. Once a feature's stories are sized, they decide how big the feature is." },
    { name: "Follow-up", tone: "risk", short: "Something you owe someone, until you close the loop.", more: "An update, an answer, a DevOps change. Some open on their own (a slipped must, a done story still Active in DevOps). Close the loop when it's done." },
    { name: "Capture", tone: "brand", short: "Get a thought out of your head in one line.", more: "Press {key:capture.add} anywhere. Save it as is, or as a follow-up, a draft story or a draft feature. Sort the rest later in Inbox." },
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
      what: ["Open one client at a time: their blocks next week are already laid out.", "Pick the features you'll definitely touch (musts) and the ones that fit if there's room.", "Anything without stories gets a nudge: draft them now or send a Coop brief.", "A target date shows on a row only when it falls this week or has passed. Amber means it may land too late.", "Click Next client until all are planned, then Done."],
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
      name: "Plan the day",
      when: "Each morning · about 5 minutes",
      keys: [{ command: "view.plan" }],
      what: ["Each of today's blocks shows its meetings and free gaps.", "This week's musts for that client come first; add their stories.", "Size stories S, M or L if you like (1h, 2h, 4h). Unsized ones count as 2h.", "Done. Optionally, Timebox my day places stories into the gaps."],
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
      name: "Check-in",
      when: "After lunch · 2 minutes",
      keys: [{ command: "view.checkin" }],
      what: ["The same cards, re-fit to the time that's actually left.", "Anything that no longer fits gets one suggested move.", "Walk-on work? Add it once at the bottom.", "Done, and back to Now."],
      lit: [{ half: "PM", day: 0 }],
      mini: { kind: "check", title: "Check-in", meta: "4h left today", client: "Northwind", color: "teal", done: "2 done", story: "Invoice totals", size: "S · 1h", move: "Move to Wed", warn: "About an hour over. Move one?" },
    },
    {
      name: "Close out",
      when: "End of day · 3 minutes",
      keys: [{ command: "closeout.load" }],
      what: ["Write one line per client on where you left off.", "Mark finished stories done in DevOps.", "Close the loop on follow-ups that are due.", "Done. The week folds back up until tomorrow."],
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
    { level: "Top", icon: "icon_crown", text: "Epics (or whatever the top level is called). Live on the Roadmap. Need features before they reach a week." },
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
    { label: "Today, Week, Roadmap, Inbox", keys: [{ command: "view.today" }, { command: "view.week" }, { command: "roadmap.load" }, { command: "view.inbox" }] },
    { label: "Plan this view", keys: [{ command: "view.plan" }] },
    { label: "Capture a thought", keys: [{ command: "capture.add" }], all: true },
    { label: "Check-in", keys: [{ command: "view.checkin" }] },
    { label: "Close out", keys: [{ command: "closeout.load" }] },
    { label: "Plan the week", keys: [{ command: "view.planweek" }] },
    { label: "Every action", keys: [{ key: "Ctrl K" }] },
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
    { q: "What works on a phone?", a: "Today with the block you're in, its next pick, Start focus, Done and Mark done; Week one day at a time (swipe sideways); Capture; the Inbox; Check-in and Close out; your follow-ups. Plan the day, Plan the week, Plan ahead and Roadmap open read-only, with Copy link to finish on a computer." },
    { q: "How do I install it?", a: "On Android or in Chrome or Edge on a computer: ⋯ › Install app. On iPhone: tap Share in Safari, then Add to Home Screen, then Add. ⋯ › Install app shows the steps. Once installed it opens like an app, straight to Today." },
    { q: "How do notifications work?", a: "Every notification shows in ⋯ › Notifications, with a dot on ⋯ when there's something new, and as a short note at the bottom while FocusTime is open. To get them on a phone or computer when FocusTime is closed, open Settings › Notifications on that device and tap Notify this device; the browser asks first. On iPhone this works only in FocusTime from the home screen." },
    { q: "What do they say on my lock screen?", a: "Only what kind of thing it is, like Follow-ups due or Plan the day: no client names, no work item titles. Turn on Show details in notifications in Settings › Notifications if you want those." },
    { q: "Does it work offline?", a: "No. FocusTime opens without a connection but says it's offline; nothing of yours is kept on the phone. Signing out clears what the browser kept and turns notifications off on that device." },
    { q: "Quick capture from anywhere?", a: "On a phone, Capture is in the bottom bar. With a keyboard, press {key:capture.add} anywhere outside a text field." },
  ],
};

// ---------- Chapter 7 ----------

/** CV-1: Conversations and My promises from client chats, read for everyone by one job and sorted by AI when allowed. */
export const ASKS = {
  eyebrow: "Chapter 7",
  title: "Conversations and my promises",
  sub: "What's said in a client's Teams chats becomes a short card per conversation, so nothing scrolls away, and what you promised there shows on Today.",
  items: [
    { q: "What is a conversation?", a: "One thread of work in a client's Teams chat: a question, the back and forth about it, and what people said they'll do. Each card has a title, two to four lines on where it stands, who's in it and when it last moved. Its status comes from what happened, never from a guess: New, In discussion, <Name> committed, Tracked #id (it has a DevOps item), Resolved or Closed. \"Updated\" means it changed since you last looked." },
    { q: "How do I turn it on?", a: "A FocusTime admin adds the client's chats, once for everyone: Admin › Clients, on a client, Add a chat. Everyone else sees them in Settings › Clients. The first time, Microsoft asks you to let FocusTime read chat messages. Reading starts from that moment, never from history." },
    { q: "Who sees a chat's conversations?", a: "Everyone at Cooptimize who is a member of the chat and follows its client. Nobody else, and never under another client." },
    { q: "When does it read?", a: "Every 5 minutes while anyone on the chat is in their working hours, and not at all outside them; the first read of the day catches up. Refresh in Inbox › Conversations reads now. FocusTime only reads; it never posts, reacts or marks anything read in Teams." },
    { q: "What's in Needs you?", a: "Conversations that wait on you: one you committed in, one you own, a new one nobody has picked up, or, for a client's lead, a promise nobody acted on (Unclaimed). Handled by teammates (folded) holds the ones someone else is on, and Closed the ones resolved or not a request. Each card has one main button (Create item, Link, Resolve or Take it over) and the rest under ⋯. J and K move, Enter runs the main button, X shows the messages, R resolves." },
    { q: "How does AI sort them?", a: "With AI on for FocusTime and allowed for that client (a FocusTime admin sets both in Admin › AI), each batch of new messages goes to the AI once, with that chat's open conversations, and it says which conversation each message belongs to, writes the summary and notes who committed to what. Names are sent, never email addresses. It runs on FocusTime's shared budget, not yours. Small talk, reactions and a plain \"thanks\" never become conversations: they're under Filtered as chatter, where This is work puts one back." },
    { q: "Why are some messages unsorted?", a: "AI is off for that client, its budget is used up or set to $0, or the AI service didn't answer. Rules still keep the messages, and the card says why. Sort unsorted (N) sorts them once AI is back." },
    { q: "Hide for me or Not a request?", a: "Hide for me takes a card off your list only. Not a request closes it for everyone, with your name and an optional reason, and anyone can open it again. A new work message opens a closed conversation again by itself. FocusTime never resolves anything on its own: when a thread winds down it asks \"Looks wrapped up. Resolve?\"." },
    { q: "What happens when someone commits to work?", a: "If what they said needs a DevOps item, only they get \"Create the DevOps item?\": a draft with a title, the path of action, a type (only the types that go under the suggested feature, the most common first) and the feature. The conversation's messages, who and when, and a Teams link are added below it. Create in DevOps shows the preview first. Link existing or Not needed are there too." },
    { q: "What if nobody creates it?", a: "After one of their working days (at once if they're on time off) the card says \"Waiting on <Name> · 1 day\" in amber, the client's leads see it as Unclaimed, and the person gets one reminder. Anyone who sees it can Take it over; the person is told quietly. FocusTime never reassigns on its own and never notifies the whole team." },
    { q: "What are the suggested comments?", a: "When a tracked conversation changes and then goes quiet for 30 minutes, or is resolved, the item's owner gets one drafted DevOps comment with a link to the chat: Post comment or Skip. At most one a day per item, plus one on resolve. A description change is suggested only for a clear change of scope, with before and after, and needs your confirm. Lines from an internal chat are flagged and left out unless you include them." },
    { q: "What are My promises?", a: "What you said you'd do in those chats, one per run of your messages: what, to whom (the person you answered or mentioned) and when it's due. \"I'll be back online at 7:30\" isn't a promise by itself, but it can set the due time of the one before it. The ⓘ shows why it counts. Add to Today or Make it a follow-up; Link, Done and Not needed are under ⋯." },
    { q: "Where do promises show?", a: "On Today: in Now when due before the half-day ends or overdue, at their time in the agenda (with After your blocks for the evening), and in the follow-ups row when they have no time. On Week, as a mark on the day's rail. Overdue is amber, never red." },
    { q: "What does FocusTime keep?", a: "Each message once, under its client, for the people who see that chat. Messages that aren't part of a conversation or promise are deleted after 14 days. Nothing goes to logs except counts." },
  ],
};

// ---------- Chapter 8 ----------

export const QUESTIONS = {
  eyebrow: "Chapter 8",
  title: "Questions people ask first",
  items: [
    { q: "How fresh is what I see from DevOps?", a: "FocusTime reads each client's DevOps once for everyone, about every minute in working hours and every 10 minutes outside them while someone is using it, and only what changed. If a read fails, you keep seeing the last good one with \"Showing items from\" and its time. Press {key:week.load} or Refresh for a check now; within 30 seconds of someone else's, you see that one. A change you make from FocusTime shows at once." },
    { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
    { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings > Data. In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
    { q: 'Why is "over" amber and not red?', a: "Because plans change and that's normal. Red is only for real trouble, like a block at risk or a follow-up that's overdue." },
    { q: "Do I have to size everything?", a: "No. Unsized stories count as 2h so the plan still adds up, and nothing waits on a size. Size them when you know." },
    { q: "How do I plan stories into Week's blocks?", a: "Click a block on Week. The panel lists your open stories for that client, grouped under their features: this week's features first, then the rest in DevOps order. Drag a story onto any of this week's blocks for that client, Friday's catch-up included. While you drag, the block shows the fit, like \"2h of 3h free\" or an amber \"1h over\"; PTO, past half-days and other clients' blocks say no. Drag a story from a card to another block to move it. Each drop has Undo. Without a mouse, use Add to… or Move to… (the drag handle or ⋯); on a tablet, press and hold; on a phone, Add to…. A story planned elsewhere stays in the list as \"Planned · Thu AM\", which opens that block." },
    { q: "This week's feature says No stories for you yet. Now what?", a: "Type a title in Add a story for me and press Enter (a size is optional). You see the DevOps preview; Create makes the story under the feature, assigned to you, and puts it in the block you're on. Not now leaves nothing behind. Break down opens the Break down panel for the feature, where AI can propose its stories. If teammates have stories there, Take one assigns one to you after a preview: the person who had it gets a quiet note in FocusTime, and Undo in Settings > Data gives it back. Without DevOps write access for that client, the panel says where to add it." },
    { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
    { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional. If you connect it, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
    { q: "Can anyone else see my plan?", a: "No. Your plan, notes, follow-ups and settings are yours. Teammates only ever see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
    { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Today shows a quiet line while steps are left, and Settings > Setup runs it again." },
    { q: "Which version am I on?", a: "⋯ › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
    { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it; a must already pinned there stays, marked \"Pinned to PTO, move it\"." },
    { q: "Why can't I move some of my old timeboxes?", a: "Timeboxes made by an earlier FocusTime, before you signed in here, show as ordinary Outlook events. FocusTime leaves them alone; change or delete them in Outlook." },
    { q: "How do I add a client's Teams chats?", a: "A FocusTime admin adds them: Admin › Clients, on each client, Delivery chats, then Add a chat (everyone else sees the chats in Settings › Clients, read-only). Type to search your Teams group chats, then Enter. A client can have several chats; a chat belongs to one client. Each is labelled Delivery team (the internal Cooptimize team) or Customer collaboration (with the client's key people): FocusTime suggests it from who is in the chat, and you can change it. People from other organizations, and guests, are marked External, and FocusTime warns when someone from outside is in a Delivery team chat. A chat added to a client is shared with everyone on it who follows the client, and its new messages are read into conversations (see Conversations and my promises)." },
    { q: "Where do I add my DevOps write access?", a: "Settings > Clients, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again." },
    { q: "How do I send an idea, a problem or a question?", a: "⋯ › Send feedback, or Send feedback in Commands. Pick Idea, Problem or Question, write it, and look at the preview: it shows exactly what goes to the FocusTime backlog in Cooptimize's DevOps. Your name and email go with it, and where you were if you leave that ticked; nothing from your plan or clients. If it can't be sent, Copy text keeps it, and you can message the FocusTime team in Teams." },
    { q: "Does FocusTime use AI?", a: "Only where your FocusTime admin turns it on: AI for FocusTime and each client's Allow AI are set in Admin › AI, and Settings › AI shows them. What's sent is only what one task needs, about one client at a time; FocusTime checks it first and won't send another client's details, keys or passwords, your VM, or email addresses from outside Cooptimize. Your AI use stops at your monthly limit (10 dollars unless an admin changes it). Settings › AI shows this month's cost and your last 20 requests, never their text, and Test AI checks it works." },
    { q: "What does \"Set by your FocusTime admin\" mean?", a: "Some settings are the team's: a FocusTime admin sets them once for everyone in Admin, like whether AI is on, which clients allow it, a client's chats and its open states. You see them read-only. Others are team defaults you can change for yourself, like a client's color or how much of your free time to plan: pick your own, and Reset goes back to the team's." },
    { q: "What can a FocusTime admin do?", a: "Admins are the members of the FocusTime Admins group in Entra. Admin (in ⋯ and in Settings, only for admins) holds the team's settings: clients, AI, conversations, people and their levels and leads, the organization's defaults, the health of each source, and an audit of every change. Admins never see anyone's plan, picks, follow-ups, captures, focus sessions, tokens, AI request text, or messages from chats they aren't in." },
    { q: "Do I need to save in Settings?", a: "No. Each setting saves as you change it, and says Saved by the field; Undo puts the old value back. Only access tokens wait for Check and save." },
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
