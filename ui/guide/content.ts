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
  { id: "asks", name: "Requests and promises" },
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
  ladder: [
    { level: "Epic", text: "Lives on the Roadmap. Needs features before it reaches a week." },
    { level: "Feature", text: "Goes on a week as a must or nice to have." },
    { level: "Needs stories", text: "A feature with no stories can't go on a day yet. {b:Draft stories} or send a {b:Coop brief}.", flag: true },
    { level: "Story", text: "Goes on a day, gets a size, gets done." },
    { level: "Done", text: "Tick it, then {b:Mark done in DevOps} from Close out." },
  ] as { level: string; text: string; flag?: boolean }[],
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

/** Requests (was Asks) from client chats, read for everyone by one job and sorted by AI when allowed; Promises. */
export const ASKS = {
  eyebrow: "Chapter 7",
  title: "Requests and promises from client chats",
  sub: "When a client asks for something in Teams, it lands in Inbox › Requests so it doesn't scroll away, for everyone on the chat.",
  items: [
    { q: "What is a request?", a: "A message from someone outside Cooptimize in a client's Teams chat that looks like a request: it mentions someone from Cooptimize, asks a question, uses a phrase like \"can you\" or \"please\", or carries a file. A short \"thanks\" or \"ok\" never counts, and neither do messages from Cooptimize. Each card says which rule matched. Plain rules pick them out; the phrases are in Settings › Clients › Requests." },
    { q: "How do I turn it on?", a: "A FocusTime admin adds the client's chats, once for everyone: Settings › Clients, on a client, Add a chat. Everyone else sees which chats are read there. The first time, Microsoft asks you to let FocusTime read chat messages. Reading starts from that moment, never from history." },
    { q: "Who sees a chat's requests?", a: "Everyone at Cooptimize who is a member of the chat and follows its client. Nobody else, and never under another client." },
    { q: "When does it read?", a: "Every 5 minutes while anyone on the chat is in their working hours, and not at all outside them; the first read of the day catches up. Refresh in Inbox › Requests reads now. FocusTime only reads; it never posts, reacts or marks anything read in Teams." },
    { q: "Whose sign-in reads the chat?", a: "The person who added it, and when their sign-in can't (signed out, or they left the chat), another follower's. The chat then says \"Polling via <name>\". When nobody's works it says \"Needs reconnecting\" with the last time it was read; anyone on the chat can fix it by signing in with Microsoft again." },
    { q: "Can AI sort them?", a: "Yes, when Use AI (Settings › AI) and that client's Allow AI (Settings › Clients) are both on for the person whose sign-in read it. Each new request, and only requests, goes to the AI with that client's own context: the message, a few messages before it (authors as client or Cooptimize, no addresses) and the client's open DevOps items. The sort is saved once for everyone: what kind it is (bug, request, question, incident) and how urgent, with the reason on hover or a click, a draft title, and \"Looks like #1234\" when it seems to be an item you already have. Create and Link start from that draft; you still see the preview and confirm every change." },
    { q: "Why does a card say Not sorted?", a: "AI is off for that client, the month's AI budget is used up, FocusTime's own check stopped the request (it mentioned another client), or the AI service didn't answer. The card works the same as without AI. Sort again tries once more with your own AI settings; FocusTime never retries on its own." },
    { q: "Where did a request go?", a: "When the AI says a message needs nothing (an agreement, small talk), it's hidden instead of shown. \"Hidden by AI\" at the foot of Requests lists them with the reason; Show it anyway puts one back for everyone." },
    { q: "What's \"Walked in\" on Today?", a: "A request the AI sorted as needing attention now. It sits on Today's attention line with Start focus, which adds it to the block under way as walk-on work and starts the timer. You also get one notification, held while you focus unless Settings › Notifications lets urgent requests through. Requests still open after their window (two hours for now, Friday for this week) show in Check-in as \"Walked in, not resolved\"." },
    { q: "What can I do with a request?", a: "Create a bug, story or feature in DevOps from it (with a preview first, and it needs that client's DevOps write access), link it to a work item you already have, mark it Handled with an optional note, or Dismiss it. Whatever you do is done for everyone on the chat, with your name on it; Link, Handled and Dismiss can be undone. Keys: {key:ask.next} to move, {key:ask.primary} for the first action, {key:ask.handled} handled, {key:ask.dismiss} dismiss, {key:ask.context} the messages before it." },
    { q: "What does FocusTime keep?", a: "Each message once, under its client, for the people who see that chat. Messages that didn't become requests or promises are deleted after 14 days; requests keep their text with what was done. Delete stored messages on the client in Settings › Clients removes the rest now, for everyone. Chat text never goes into logs, and the AI request log keeps only counts and cost." },
    { q: "What are Promises?", a: "Your own messages in those chats that commit you to something: \"I'll send it tomorrow\", \"let me check\", \"by Friday\". They're yours alone, listed in Inbox › Promises with what, to whom, when it's due, your message and the request it answers (that request shows \"Promised\"). With AI on for the client, the AI reads what you promised and when; without it, the first line of your message, no date. The phrases are in Settings › Clients › Requests." },
    { q: "What do I do with a promise?", a: "Make it a follow-up (who, what and the due date filled in, channel Teams), link it to a DevOps item, or mark it Done or Dismiss it (both can be undone). A promise made a follow-up closes when the follow-up is done; a linked one when the item is done in DevOps. FocusTime never closes one because of a later message." },
  ],
};

// ---------- Chapter 8 ----------

export const QUESTIONS = {
  eyebrow: "Chapter 8",
  title: "Questions people ask first",
  items: [
    { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
    { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings > Data. In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
    { q: 'Why is "over" amber and not red?', a: "Because plans change and that's normal. Red is only for real trouble, like a block at risk or a follow-up that's overdue." },
    { q: "Do I have to size everything?", a: "No. Unsized stories count as 2h so the plan still adds up, and nothing waits on a size. Size them when you know." },
    { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
    { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional. If you connect it, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
    { q: "Can anyone else see my plan?", a: "No. Your plan, notes, follow-ups and settings are yours. Teammates only ever see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
    { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Today shows a quiet line while steps are left, and Settings > Setup runs it again." },
    { q: "Which version am I on?", a: "⋯ › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
    { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it; a must already pinned there stays, marked \"Pinned to PTO, move it\"." },
    { q: "Why can't I move some of my old timeboxes?", a: "Timeboxes made by an earlier FocusTime, before you signed in here, show as ordinary Outlook events. FocusTime leaves them alone; change or delete them in Outlook." },
    { q: "How do I add a client's Teams chats?", a: "A FocusTime admin adds them: Settings > Clients, on each client, Delivery chats, then Add a chat (everyone else sees the chats there, read-only). Type to search your Teams group chats, then Enter. A client can have several chats; a chat belongs to one client. Each is labelled Delivery team (the internal Cooptimize team) or Customer collaboration (with the client's key people): FocusTime suggests it from who is in the chat, and you can change it. People from other organizations, and guests, are marked External, and FocusTime warns when someone from outside is in a Delivery team chat. A chat added to a client is shared with everyone on it who follows the client, and its new messages are read for requests (see Requests and promises)." },
    { q: "Where do I add my DevOps write access?", a: "Settings > Clients, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again." },
    { q: "How do I send an idea, a problem or a question?", a: "⋯ › Send feedback, or Send feedback in Commands. Pick Idea, Problem or Question, write it, and look at the preview: it shows exactly what goes to the FocusTime backlog in Cooptimize's DevOps. Your name and email go with it, and where you were if you leave that ticked; nothing from your plan or clients. If it can't be sent, Copy text keeps it, and you can message the FocusTime team in Teams." },
    { q: "Does FocusTime use AI?", a: "Only if you turn it on. Use AI in Settings › AI is off until you switch it on, and each client also needs Allow AI in Settings › Clients. What's sent is only what one task needs, about one client at a time; FocusTime checks it first and won't send another client's details, keys or passwords, your VM, or email addresses from outside Cooptimize. Your AI use stops at your monthly limit (10 dollars unless you change it). Settings › AI shows this month's cost and your last 20 requests, never their text, and Test AI checks it works." },
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
