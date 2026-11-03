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
    { label: "Capture a thought", keys: [{ command: "capture.add" }] },
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

export const QUESTIONS = {
  eyebrow: "Chapter 6",
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
    { q: "Where do I add my DevOps write access?", a: "Settings > Clients, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again." },
    { q: "Do I need to save in Settings?", a: "No. Each setting saves as you change it, and says Saved by the field; Undo puts the old value back. Only access tokens wait for Check and save." },
  ],
};

export const FOOTER = "FocusTime by Cooptimize. Questions or ideas? Message the FocusTime team in Teams.";

// ---------- Ways in ----------

export const TOUR = {
  /** The sign-in page and a person's first Today. */
  link: "New here? Take the 2-minute tour",
  dismiss: "Not now",
  close: "Close",
  signIn: "Back to sign in",
};
