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

// ---------- Pools of questions, placed by area in SECTION_BODY below ----------

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
    "Sizing is optional. An unsized story counts as 1h until you size it. Change that in Settings › Planning.",
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
    { level: "Done", text: "Tick it and FocusTime offers to set its item done in DevOps ({b:Confirm} or {b:Not now}); Close out asks once for the day's. Resolved in DevOps means no hours left; it drops off planning lists." },
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
    { q: "How do I create a feature or an epic in DevOps?", a: "Press Shift+N anywhere (or + New in Backlog, or + New under on a Backlog row for a child of that row). Choose the client and the level: the levels are the client's own, so an epic, a feature, a story or a level above epics if the project has one. Type the title and press Enter: the preview shows exactly what will be written, and nothing is created until you confirm it. It's assigned to you unless you choose someone on the client's project or nobody; the parent and the target date are optional. Without your write PAT for that client, the form says so and saves it as a draft instead. The new item is selected in Backlog, and if a filter would hide it, Backlog says which one." },
    { q: "How FocusTime uses Cooptimize's standards", a: "Break down, Draft story, Draft feature and Create DevOps item read Cooptimize's development standards from GitHub, the ones that fit the work and the client's data platform and source systems. Drafts split along the standards' layers (each Gold fact and dimension its own story, the semantic model apart from the report, the app when publishing), never ask anyone to hand-write Bronze or Silver SQL, and add acceptance criteria that name the standard with a link. Standards used under the draft lists what shaped it, and each title opens the article. A client's own requirements win: if the draft followed the client instead, it says so. Nothing goes to DevOps until you confirm the preview. In Ask you can ask things like \"What's our standard for fact table naming?\": it quotes the rule and links the article, or says Not in the standards." },
    { q: "What does Break down do?", a: "On an item that {b:Needs stories}, {b:Break down} asks the AI to propose the child items it's missing. The button names the item's type, like {b:Break down Feature} or {b:Break down Recurring}; on Week it reads just {b:Break down}, with the type in its tooltip. It opens a side panel: the item stays on the left (its state, priority, parent, description and any children it has) and the proposals fill the right, in three steps: Prepare, Review and Publish. Run never creates anything; nothing is written to DevOps until you press Create all." },
    { q: "What is sent to the AI?", a: "Open {b:What's sent to the AI} under the item to see the list in plain words. Text from DevOps only: the item's fields and description, its parent's title and a short description, the titles and states of the children it already has, and its newest comments up to a limit (Coop briefs as one line). Also up to 5 of that client's own past items with their children as examples, the client's house style (learned each week, or the default), and your note. Never attachments, linked documents, email addresses or another client's work. What it costs is in the AI log." },
    { q: "What do I choose in Prepare?", a: "Only what matters: the type to create, when the item's type takes more than one (the most common comes first), and an optional {b:Note for the AI}. Enter runs; Shift+Enter adds a line. If you broke the item down before, one line offers to open that draft." },
    { q: "What is the house style?", a: "A few lines about how a client's items are usually split: how many children, how titles start, whether they use acceptance criteria. FocusTime learns it each week from the client's own items, unless your FocusTime admin has written one for the client in Admin › Clients. What's sent to the AI says which one is used." },
    { q: "How do I review the proposals?", a: "Each card is one item: edit its title, description and acceptance criteria (a short checklist; Enter adds the next), give it a size (S 1h, M 2h, L 4h, or leave it unsized at 2h), drag it by its handle or move it with the up and down arrows, or Drop it (Undo brings it back). \"after <title>\" means it depends on another card. Regenerate… redoes one card and Regenerate all… the whole set, each with a note. The line at the top says why these, and what the AI left out as out of scope or already covered. The total at the bottom counts what you keep, like \"5 items · about 9h\"." },
    { q: "What happens when I press Create all?", a: "First you see the exact batch: each item's type, title and size, under its parent. Create all makes them one by one under the parent, assigned to you, in dependency order, and reads each one back. If some fail, the panel lists what was created and what wasn't, with Retry the rest; nothing is created twice. Sizes stay in FocusTime. Once the item has children it no longer needs stories. Settings › Activity has every create with Undo." },
    { q: "Why can't I break an item down?", a: "The panel says so. \"AI is off for <client>\": ask your FocusTime admin. Without that client's DevOps write access, it asks you to add it in Settings first and sends nothing, not even the AI request. The Coop brief is always there." },
  ],
};


/** One shortcut card: a label and the keys it takes from ui/keys.ts (each row's first key, or every key of one row). */
export type ShortcutCard = { label: string; keys: KeyRef[]; all?: boolean };

export const SHORTCUTS = {
  title: "The shortcuts worth learning",
  sub: "Everything works with the mouse. These save you a few clicks a day. {key:Ctrl K} lists every action with its key.",
  cards: [
    { label: "Day, Week, Backlog, Status, Inbox", keys: [{ command: "view.today" }, { command: "view.week" }, { command: "roadmap.load" }, { command: "view.status" }, { command: "view.inbox" }] },
    { label: "Add work (on Backlog, Grid or Gantt)", keys: [{ command: "view.plan" }] },
    { label: "Capture a thought", keys: [{ command: "capture.add" }], all: true },
    { label: "Midday check-in", keys: [{ command: "view.checkin" }] },
    { label: "Close out", keys: [{ command: "closeout.load" }] },
    { label: "Open a block (A puts the cursor in Add)", keys: [{ command: "ui.block" }, { command: "view.planweek" }] },
    { label: "Every action", keys: [{ key: "Ctrl K" }] },
    { label: "Ask the assistant", keys: [{ command: "assistant.ask" }], all: true },
    { label: "Next or previous client", keys: [{ key: "J" }], all: true },
    { label: "Text size", keys: [{ command: "ui.set_text_size" }], all: true },
  ] satisfies ShortcutCard[],
  every: "Every key",
};


/** P1: FocusTime on a phone: what works there, installing it, and notifications. */
export const PHONE = {
  title: "On your phone",
  sub: "The phone is for checking and doing. Planning stays on a bigger screen.",
  items: [
    { q: "Can I hide the hour rail on Week?", a: "Yes. Cards and Timeline, in Week's header, switch in one click (B does the same, and it's in Week's ⋯ and Ctrl K). On Cards, each block uses its full width for its to-dos, lists its meetings and events with their times, and today's block still shows the now line. Dragging works the same. A block with late promises shows \"1 late\" or \"3 late\": one opens that promise, several open your late promises for that client in the Inbox. FocusTime remembers your choice." },
    { q: "When do Saturday and Sunday show on Week?", a: "Week is Monday to Friday until something lands on a weekend day: a calendar item, a to-do (a Deployment too) or a promise due that day. Then that day shows as a narrow, quiet column, \"Sat 7 · weekend\", with its items and to-dos as plain rows with their times: no blocks, no Open half-days, nothing about capacity or risk. To see the weekend always, turn on Weekend in Week's ⋯ (this browser remembers it). You can still move a to-do onto a weekend by dragging it, from its ⋯ (Move, To Saturday) or by asking the assistant, and Undo puts it back. Today's ‹ › stop on a weekend day the same way, shown as \"Weekend\" with nothing asking you to plan it. Work after a weekday's afternoon shows in an Evening band under PM, hidden when there's none." },
    { q: "Planning a deployment", a: "Capture a line like \"Deploy Saturday\", choose Deployment, then set the client, the day and the window. The checkboxes list what can move for that client's data platform, Fabric or Azure, with its usual items already ticked; add anything else as a Note. A client with no platform set shows both lists with nothing ticked. Week and Today show a count like \"4 items\": hover or tap it for the list. Tick the deployment done and the draft for the client lists what went. You can also ask the assistant: \"Plan the deployment Saturday 9 to 11 with warehouse SQL and reports\", then Confirm. Admins and a client's leads change its platform and list; only new deployments follow." },
    { q: "What is a Deployment to-do?", a: "A to-do for a release or go-live: a client, a day and a window (say Saturday 9:00 to 11:00, or Friday 19:00 to 21:00), and if you like the DevOps items it covers and a note of what's going. Plan one from Capture (choose Deployment), a day's ⋯ (Plan a deployment…), Ctrl K, the assistant (it proposes, you Confirm), or make an existing to-do one with its ⋯ › Kind. It shows its own icon and window and moves like any to-do. Time outside your day shape adds up on Week as \"3h after hours this week\": a Deployment's window outside your hours, and any other to-do you put in an evening or on a weekend. When you tick it done, FocusTime offers Tell <client> it's deployed: a draft with the note and items that you check and send through Close the loop, never automatically. Not now just marks it done. The runbook and the deployment itself stay with Coop." },
    { q: "What does Call live mean?", a: "Someone started a Teams call in one of your client's delivery chats and it hasn't ended. Your block for that client today and Today's Now card say Call live in <chat>, when it started and who started it; Join opens the chat in Teams, where you join. It goes away when the call ends (or after 10 hours, in case Teams never says it ended), within about 5 minutes. To start one yourself, use the block's ⋯ or its details: Start a call in <chat> opens the chat in Teams ready for you to press Call. FocusTime never starts, joins or records a call, posts nothing, and never sends a call to the AI. You see it only for chats you're in, for clients you follow." },
    { q: "Why are some days narrow strips on Week?", a: "On a smaller window, at a larger Text size or with the side panel open, Week makes room before anything is cut: the hour rail turns into a slim ruler, then a thin bar under each block's name. Each day decides for itself, so the narrower catch-up day or a PTO day can show a slimmer rail than the others. When the five days still don't fit, the day you've selected and its neighbours stay open and the others fold into narrow strips. A strip still shows each half-day's client colour, an at-risk dot, PTO and catch-up, and the now line, and you can drop a story on it. Click a strip, or use the arrow keys, to open that day." },
    { q: "What works on a phone?", a: "The bar at the bottom has Day, Week, a round + to capture, the Inbox and Ask. Day comes first: the block you're in, your next meeting and your next to-do with Start and Done; the Midday check-in and Close out. Week one day at a time, with + Add on each block opening Add work as a sheet (long-press to move a story); each to-do's title has its own line and the meetings line is folded until you tap it. The Inbox, with every view and your promises; Coop brief and Break down. Backlog is made for a bigger screen: on a phone it asks first." },
    { q: "What's on Today on a phone?", a: "Now, at the top: the block you're in, until when and how much is left, the meeting under way or your next one, and your next to-do with big Start and Done. Between blocks it says Free until 1:00; after your last block, Day done. Then Needs you (at most 3 lines, then N more in Inbox), your to-dos grouped by block, and Next up for the rest of the day. Tap a to-do for Done, Move to tomorrow, Snooze to this afternoon, Add time, its story card or Copy DevOps link. Each runs at once, and Undo is in the message that follows." },
    { q: "What does the dot at the top mean?", a: "On a phone, the dot beside FocusTime's mark says how your sources are: green when everything is live, amber when some data is older or a sample, red when a source needs you. Tap it to see each source and its age, DevOps per client and your VM, with Retry, Reconnect and Refresh. Connect or disconnect in Settings opens Accounts and calendars." },
    { q: "Why does Backlog ask first on a phone?", a: "Backlog's grids and timelines need a wide screen, so the phone's bar leaves it out. A Backlog link on a phone says Backlog is made for a bigger screen, with Open anyway (read only, for the rest of the session) and Back to Today." },
    { q: "How do I install it?", a: "On Android or in Chrome or Edge on a computer: ⋯ › Install app. On iPhone: tap Share in Safari, then Add to Home Screen, then Add. ⋯ › Install app shows the steps. Once installed it opens like an app, straight to Today." },
    { q: "How do notifications work?", a: "Every notification shows in ⋯ › Notifications, with a dot on ⋯ when there's something new, and as a short note at the bottom while FocusTime is open. To get them on a phone or computer when FocusTime is closed, open Settings › Notifications on that device and tap Notify this device; the browser asks first. On iPhone this works only in FocusTime from the home screen." },
    { q: "What do they say on my lock screen?", a: "Only what kind of thing it is, like Promises due or Add work to today: no client names, no work item titles. Turn on Show details in notifications in Settings › Notifications if you want those." },
    { q: "Does it work offline?", a: "No. FocusTime opens without a connection but says it's offline; nothing of yours is kept on the phone. Signing out clears what the browser kept and turns notifications off on that device." },
    { q: "Can I just talk to it?", a: "Yes: on a phone, tap Ask in the bar at the bottom for the assistant, then hold Hold to talk. Release and the words land in the box; fix them if needed, then Send. Changes still wait for your Confirm." },
    { q: "Quick capture from anywhere?", a: "On a phone, Capture is the round + in the middle of the bar at the bottom. With a keyboard, press {key:capture.add} anywhere outside a text field." },
  ],
};


/** CV-1, IB-1: the Inbox: conversations from client chats (read for everyone by one job, sorted by AI when allowed), promises, sends and captures in one list. */
export const ASKS = {
  title: "The Inbox, conversations and promises",
  sub: "One list of what needs you: what's said in a client's Teams chats as a short card per conversation, what you promised, what others owe you, sends and your captures.",
  items: [
    { q: "What is a conversation?", a: "One thread of work in a client's Teams chat: a question, the back and forth about it, and what people said they'll do. Each card has a title, two to four lines on where it stands, who's in it and when it last moved. Its status comes from what happened, never from a guess: New, In discussion, <Name> committed, Tracked #id (it has a DevOps item), Resolved or Closed. \"Updated\" means it changed since you last looked." },
    { q: "How do I turn it on?", a: "A FocusTime admin adds the client's chats, once for everyone: Admin › Clients, on a client, Add a chat. Everyone else sees them in Settings › Client chats. The first time, Microsoft asks you to let FocusTime read chat messages. Reading starts from that moment, never from history." },
    { q: "Who sees a chat's conversations?", a: "Everyone at Cooptimize who is a member of the chat and follows its client. Nobody else, and never under another client." },
    { q: "When does it read?", a: "Every 5 minutes while anyone on the chat is in their working hours, and not at all outside them; the first read of the day catches up. Refresh in the Inbox reads now. FocusTime only reads; it never posts, reacts or marks anything read in Teams." },
    { q: "What's in Needs you?", a: "Conversations that wait on you: one you committed in, one you own, a new one nobody has picked up, or, for a client's lead, a promise nobody acted on (Unclaimed). Each conversation has one shared owner, the same for everyone who can see it: Asked you and Up for grabs are open, You're on it is yours, Teammate has it (folded, out of Everything's main list) is someone else's, and Done is closed out for everyone. I'll take it, Give to…, Add helper, Release, Close out and Reopen each apply at once, with Undo, and nothing is posted to Teams. Replying never claims it: FocusTime offers it to you with one tap. Each card has one main button (Create DevOps item, Link, Resolve, Take it over or Mark done) and the rest under ⋯. A conversation linked to an item moves to In progress." },
    { q: "How does AI sort them?", a: "With AI on for FocusTime and allowed for that client (a FocusTime admin sets both in Admin › AI), each batch of new messages goes to the AI once, with that chat's open conversations, and it says which conversation each message belongs to, writes the summary and notes who committed to what. Names are sent, never email addresses. It runs on FocusTime's shared budget, not yours. Small talk, reactions and a plain \"thanks\" never become conversations: they're under Filtered as chatter, where This is work puts one back." },
    { q: "Why are some messages unsorted?", a: "The AI budget is used up or set to $0, or the AI service didn't answer: those wait, the card says why, and Sort unsorted (N) sorts them once AI is back. With AI off for the client, rules group what they can (next question) and the rest waits the same way." },
    { q: "Why is a message held back?", a: "It names another client in a chat where someone from outside Cooptimize can read it. That one message isn't sent to AI; the rest of the chat is sorted as usual. It waits under N messages held back in Needs you, only for the people in that chat, with the name it matched marked in the message. It stays held until someone sorts it or marks it not work-related, or an admin changes a client's names, which checks it again. Sort for <client> by hand puts it in a conversation (nothing goes to AI), Not work-related files it as chatter, Leave held leaves it; the same two work for all of a client's at once at the top of the list. In a chat with only Cooptimizers, mentioning another client is normal and nothing is held." },
    { q: "What does \"mentions <client>\" mean?", a: "A conversation or message that names another client gets that tag, so you notice before you copy anything out of it. Before FocusTime writes to a client's DevOps or sends an update for you, it checks the text: AI drafts have another client's name replaced with \"another client\" (it says \"Another client's name was removed\"), and text you typed that names one shows This mentions <client> with Replace with \"another client\". You can still save or send it as written. Cooptimize Internal may name clients." },
    { q: "What happens to a chat when AI is off for its client?", a: "Rules group its messages, as long as the client's Group messages without AI is on (it is unless a FocusTime admin turned it off in Admin › AI). A question or ask from the client starts a conversation. A message joins one when it replies to a message in it, @mentions someone in it, comes from someone it @mentioned within 45 minutes of its last message, or comes from someone already in it within 45 minutes of their last message there. Only within the same chat. The title is the first message, shortened; there's no summary without AI, so Show messages has the whole thread. Anything the rules can't place waits as unsorted." },
    { q: "Hide for me or Not a request?", a: "Hide for me takes a card off your list only. Not a request closes it for everyone, with your name and an optional reason, and anyone can open it again. A new work message opens a closed conversation again by itself. FocusTime never resolves anything on its own: when a thread winds down it asks \"Looks wrapped up. Resolve?\"." },
    { q: "What happens when someone commits to work?", a: "If what they said needs a DevOps item, they see Create DevOps item first, and it waits amber on them after a working day. Anyone on the chat can still create or link one." },
    { q: "How do I create a DevOps item from a conversation or a promise?", a: "Create DevOps item is on every conversation and promise without an item: the main button for a work request or an open promise, under ⋯ otherwise (and under ⋯ on a message filtered as chatter, which makes it a conversation first). With AI on for that client the form is drafted from that conversation only: a title, the description, acceptance criteria, the type (only the client's own types that go under the parent) and a suggested parent feature or epic in scope. With AI off, or Allow AI off for the client, the same form is empty for you to fill in. It's assigned to you, or to nobody if you untick it. The preview shows the full text, who can see it (everyone with access to that DevOps project) and Attach N images from the chat; nothing is written until you confirm, and Undo is in Settings › Activity. Without DevOps writes for the client the form says how to turn them on and sends nothing." },
    { q: "What if nobody creates it?", a: "After one of their working days (at once if they're on time off) the card says \"Waiting on <Name> · 1 day\" in amber, the client's leads see it as Unclaimed, and the person gets one reminder. Anyone who sees it can Take it over; the person is told quietly. FocusTime never reassigns on its own and never notifies the whole team." },
    { q: "What are the suggested comments?", a: "When a tracked conversation changes and then goes quiet for 30 minutes, or is resolved, the item's owner gets one drafted DevOps comment with a link to the chat: Post comment or Skip. At most one a day per item, plus one on resolve. A description change is suggested only for a clear change of scope, with before and after, and needs your confirm. Lines from an internal chat are flagged and left out unless you include them." },
    { q: "What does Show messages show?", a: "The messages as Teams shows them: one person's messages together under their picture and name, yours on the other side, a reply's quoted message above it, and reactions small underneath (only each emoji and how many, never who). The latest 20 show first; Show earlier loads 20 more." },
    { q: "Why do I see pictures from the chat?", a: "Pictures pasted into a chat show as thumbnails on the message, and the card says how many. Click one to see it large; Previous and Next (or the arrow keys) move between them, and Esc closes. FocusTime doesn't keep them: it reads each one from Teams with your own sign-in when you look (held in memory for a few minutes, never on disk), and only for people on that chat who follow its client. Whether they go to AI is a per-client switch, off by default (see Are chat images sent to the AI?). Only PNG, JPEG and GIF up to 10 MB show; anything else says why." },
    { q: "Can I merge two conversations?", a: "Yes, when one topic was split in two. Open one, then ⋯ › Merge into…, and pick the other (with only one other open conversation in that chat, it's picked for you). Before anything changes the pane shows which one moves into which, how many messages, commitments and suggestions move, who joins, what happens to the linked item (it comes along when the one you keep has none; when both have one, the other stays in DevOps but is no longer linked here) and the one you keep afterwards. Swap keeps the other one instead. Merge moves it for everyone on the chat and the summary is written again; Undo in the notice puts both back as they were." },
    { q: "What's in Today's urgent strip?", a: "The Inbox's own items that need you now: a conversation with a request sorted as needed now (Needs you now, with Start focus), your promises that are late or due within the next 2 hours, and sends waiting for your answer (a Must first). A promise due later waits at its time in Today's agenda and on Week's rail, so it doesn't sit at the top all day; one due today with no time is in the promises row of the attention line and joins the strip in your last 2 working hours. Snoozed and hidden items never show. It shows the 3 most urgent; \"N more in Inbox\" under them opens Needs you, and with those lines it adds up to the Inbox badge." },
    { q: "How do I link a conversation or promise to an item that already exists?", a: "Link to item (the main button when FocusTime sees a likely item, else under ⋯) searches that client's open items in Cooptimize's scope by title or #id; on a promise it first lists up to 5 likely ones with the reason. Linking is FocusTime's own note, nothing changes in DevOps, and Undo (or Unlink under ⋯) takes it off. Tick Also add a comment on the item to post a short comment with a link back to Teams: it has its own preview and confirm. A linked conversation moves to In progress with the item's state, assignee and last change; when the item closes in DevOps it shows Item closed with Mark done, and nothing is closed for you." },
    { q: "Can a link open one item?", a: "Yes. Each line in Today's urgent strip and each promise on Week's rail opens that item in the Inbox's detail pane, the same item, with the same actions, as in the Inbox. A send opens there too; Accept and the rest are in the pane." },
    { q: "How is the Inbox laid out?", a: "One list. It opens on Everything: every conversation, promise, capture and draft by its latest activity, under day headings (Today, Yesterday, then the date), so you can scroll through it in time and miss nothing. Newest first or Oldest first is one click. The Status chips choose what shows, with counts; Chatter is off until you turn it on. On the left: your clients (tick several) and the views, Needs you, Promises, Waiting on and the rest, which are shortcuts for Everything with only that status on. Group changes the headings to Client, Due date or Status. On the right the open item: its summary, the messages, the linked item, commitments and every action, the main one first. The Inbox remembers your sort, chips, clients and grouping. On a phone, View and Clients open one picker that also holds the sort and the chips, and an item opens as a sheet with one big main button." },
    { q: "What does New since you last looked mean?", a: "A line in Everything between what arrived since you last opened it and what you've already seen, with a small dot on each new item. It moves once you've seen it, and it follows you from your computer to your phone." },
    { q: "How are times shown?", a: "Like Teams: Today 4:07 PM, Yesterday 6:58 PM, otherwise Fri, Nov 6, 4:07 PM, with the year only if it isn't this year. Today and Yesterday follow midnight in your own time zone. Hover for the full date and time with seconds and the zone. On a phone's Inbox list, anything older than a week shows just the date." },
    { q: "What counts in Needs you?", a: "New promises, promises due today or late, conversations that need you and sends waiting for your answer. The tab's badge, the rail and the header always show the same number. Hidden and snoozed items don't count." },
    { q: "What are the Inbox's keys?", a: "J and K move, Enter opens. On the open item: C creates a DevOps item, L closes the loop, F changes the due day, W puts it on your week, H hides it for you, N is Not needed and E is Done. ? lists them. They never fire while you type, and each does exactly what its button does." },
    { q: "Do old links still work?", a: "Yes. #/inbox/conversation/<number>, #/inbox/promise/<number> and #/inbox/<number> (a promise you added) open that item in the Inbox; so do the old Conversations, Promises and Captures addresses." },
    { q: "What are Promises?", a: "What you said you'd do in those chats, one per run of your messages: what, to whom (the person you replied to, else the one you mentioned, else the one you answered) and when it's due. \"I'll be back online at 7:30\" isn't a promise by itself, but it can set the due time of the one before it. The ⓘ shows why it counts. Create DevOps item leads while it has no item; Close the loop leads once it's late. Due, Who, Add to Today and Done are always there; Link to item, Not needed and Hide for me are under ⋯. A promise is never read-only: linked to an item or added by you, every action still works. When what you said means a DevOps item (\"I'll log a ticket\", \"add it to the backlog\", \"I'll track it\"), it also waits amber after one of your working days. Create works even when the promise isn't in a conversation: it starts one from your message and the ones just before it." },
    { q: "How do I choose who a promise is for?", a: "Who is a search box: type a name and pick from In this conversation (people from other organizations marked External), On <client> (the people on that client) or Everyone at Cooptimize. You can also type any name and keep it as plain text; it says \"Not linked to a person\", and when the text matches exactly one person it offers to link it." },
    { q: "Where do promises show?", a: "On Today: in Now when due before the half-day ends or overdue, at their time in the agenda (with After your blocks for the evening), and in the promises row when they have no time. On Week, as a mark on the day's rail. Past its due it says \"Was due\" with the time or day, in amber, never red." },
    { q: "What does FocusTime keep?", a: "Each message once, under its client, for the people who see that chat. Messages that aren't part of a conversation or promise are deleted after 14 days. Images pasted into the chat are never kept: FocusTime reads one from Teams with your own sign-in when you look at it (held in memory for a few minutes, never on disk), and keeps only its type, size and the AI's short description. When Teams can't give it now (your sign-in ran out, the message was removed) it shows Image in Teams with Open in Teams. Nothing goes to logs except counts." },
    { q: "Are chat images sent to the AI?", a: "Only for a client whose Send attachments to AI is on (a FocusTime admin's switch in Admin › AI, off by default), and only with AI on for that client. Then the new images in a batch go with that same request, each after the message it belongs to, so the summary can use what they show, and the AI writes one short line about each (at most 120 characters), shown on the card and under the image only to the people in the chat. At most 4 images a message and 10 a request; the rest aren't described. Be aware: FocusTime's AI safety check reads text only. It can't look inside an image for another client's names, passwords or personal details, so turning the switch on is the consent to send whatever the client's chat images show. With it off, nothing is read or sent; images are only counted." },
    { q: "Can a DevOps item carry the chat's images?", a: "Yes. Create item from a conversation (or from a promise) shows the images of the messages going with it, each with a checkbox, all ticked; an internal chat's only when you include its messages. When you confirm, each ticked one is read from Teams with your sign-in, uploaded to DevOps with your write PAT and linked to the new item, with a note saying who pasted it and when; the description says how many were attached. At most 10, 10 MB each. One that can't be read is left out and said so; the item is still created. Undo unlinks them, but the files stay in DevOps: DevOps has no way to delete an attachment." },
  ],
};


/** SW-1: sending work to someone's week, client priorities and Ask to look (WD-1: Team is hidden for now). */
export const TEAM = {
  title: "Working with your team",
  sub: "Send a feature or story to someone's week, see a client's priorities, and ask a lead to look at your plan.",
  items: [
    { q: "How do I send work to someone?", a: "On any feature or story (a feature or a story in a block's panel, an item Break down just created), ⋯ then Send to…. Pick who (people on that client who use FocusTime; anyone not on it yet shows as Not on FocusTime yet and can't be picked), this week or next, Suggested or Must, and an optional note. Tick Ask them to take it in DevOps if it should be theirs there too." },
    { q: "Who can send a Must?", a: "Only that client's leads. Anyone on the client can send a Suggested. Levels are guidance everywhere else in FocusTime; the Must label is the one exception, because it asks for the week to change." },
    { q: "What do I do with something sent to me?", a: "It shows under To place at the bottom of a block's panel (the line over Week counts it), as one line on Day, and as a notification. Accept puts it on your week; Accept and schedule also opens the panel on the client's first block. Pass to… hands it to someone else on the client (who sent it stays the sender). Can't this week asks for a reason, which the sender sees. Nothing counts against your hours until you accept." },
    { q: "What if I can't take a Must?", a: "Say why. The sender sees Can't: <your reason>, and the client's other leads get a quiet note with it. The Must stays as a conflict, marked in amber for both of you, until the sender passes it on or withdraws it, or you accept it after all." },
    { q: "Does Accept change DevOps?", a: "Only if you leave Also assign to me in DevOps ticked. It's ticked when the sender asked you to take it, and unticked otherwise. Then the usual DevOps write runs: a preview, the item assigned to you, read back, in the audit log with Undo, and a quiet note to whoever had it." },
    { q: "How do I see what I sent?", a: "You sent, folded at the bottom of a block's panel: Waiting (Cancel while it waits), Accepted, Scheduled, Passed to <name>, Can't: <reason>, Done once DevOps resolves the item, or Not answered when its week ended with no answer." },
    { q: "What is a client priority?", a: "A feature a client's lead flags as the client's top ask, with an optional note. Everyone on the client sees it under To place in a block's panel, with Add to my week. A lead can unflag it any time, and it drops off once DevOps resolves it." },
    { q: "How do I ask a lead to look at my week?", a: "In a block's panel, open You sent at the bottom: Ask <lead> to look on the client, with an optional note. The lead gets a notification and can reply. The reply shows there under the client." },
    { q: "Does checking off a to-do change DevOps?", a: "Not by itself. When you tick a story that has a DevOps item, anywhere (Day, Week, the focus timer's Done, the midday check-in), the tick lands at once and Wrap it up opens: Finished or Made progress, a comment if you like, then one preview of everything that would go to DevOps and Confirm. Close it, or Skip DevOps, and only the tick stays. It opens only for items you can change that aren't done already, on clients where you've turned on DevOps writes. Close out asks once for the day's done to-dos, with a box per item and one Confirm. Settings › Today and Week › When I tick a story: Always skip DevOps turns it off." },
    { q: "Where did Fix next and Sort later go?", a: "Ahead's Fix next became Gaps, then Readiness, and is now Backlog's Needs attention, a chip in the Grid's toolbar; the capture box's Sort later is now Decide later. Typing fix next, gaps, readiness or sort later in the command menu still finds them." },
    { q: "Where did Ahead go?", a: "It's called Backlog now, with two views, Grid and Gantt; 3 still opens it. Readiness is the Grid's Needs attention, and Ahead's Backlog mode is Filter › Levels › One level as a list. Nothing you could do went away: see the Guide's Backlog section. Old links still open the right place, and typing ahead, roadmap, gaps or readiness in the command menu finds it." },
    { q: "Where did picks go?", a: "Renamed, nothing else changed. A pick is now a to-do: one planned piece of work in a half-day block. Typing pick in the command menu still finds every to-do command, and the assistant understands pick and to-do the same." },
    { q: "Where did Needs help from… go?", a: "It's now Ask to collaborate, in the same places. It still finds teammates who are free and sends a help invite after a preview. Typing needs help in the command menu still finds it." },
  ],
};


/** TB-1 and TB-2: the FocusTime bot in a 1:1 Teams chat, and the short daily rhythm it can send. */
export const TEAMS_BOT = {
  title: "FocusTime in Teams",
  sub: "Ask FocusTime things in a chat with it in Teams, and, if you want, get a short morning brief, a midday check-in and a close out there.",
  items: [
    { q: "How do I start?", a: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\". It answers only you, only in that 1:1 chat. It does what Ask does, with the same previews and Confirm. Ask it what it can do; what's next and today work even without AI." },
    { q: "Can FocusTime message me first?", a: "Only if you ask it to. Settings › Notifications › In Teams: turn on Let FocusTime message me in Teams, then tick what you want: Morning brief, Midday check-in, Close out, Nudges, Client calls to review. All are off until you turn them on. They come only in your own chat with FocusTime, never on weekends or PTO days, never in quiet hours, and wait while focus runs. Friday only with Also on Fridays. Send me a test now sends one at once so you can see it." },
    { q: "What's in each one?", a: "The morning brief (at the start of your day, or a time you set): today's blocks, meetings, to-dos, promises due and work sent to you, with Move…. The midday check-in (12:00 unless you change it): this morning's to-dos with Done and Not yet, and Move the rest. Done on a to-do with a DevOps item asks, in the card, whether to set it done in DevOps too; nothing is written until you Confirm. Close out (30 minutes before your day ends unless you change it): today's to-dos; tick what got done or just tell it. Nudges: a promise due tonight that's still open, work sent to you waiting over half a day, or someone taking over an item assigned to you, together in one message, at most one an hour." },
    { q: "Does tapping a button change things right away?", a: "Done and Not yet on a to-do change only your own plan, at once, exactly like the buttons in the app, with Undo on the card. Anything bigger (moving to-dos, closing out the day) shows the change first, with Confirm and Cancel, and nothing happens until you Confirm. Nothing in DevOps, Outlook or anywhere outside FocusTime changes without a Confirm." },
    { q: "Can I just tell it what I got done?", a: "Yes. While today's Close out is waiting, reply in your own words: \"all but the export\", \"1 and 3\", \"fixed the login timeout\". The card above fills in what it understood: the to-dos done, where the rest move (each to its client's next block, or the unfinished list when there's none this week) and the day closed out. One Confirm does all of it. FocusTime matches your words to the to-dos itself; no AI reads them." },
    { q: "How do I capture something from Teams?", a: "Start the message with capture: (or c:), for example \"capture: call Dana about the export\". It goes to the Inbox's Captures and drafts exactly as typed, to sort later, with Undo on the reply. Anything else you write goes to the assistant." },
    { q: "It says FocusTime can't message me in Teams.", a: "Teams told FocusTime the chat is blocked or the app was removed, so Let FocusTime message me in Teams turned itself off. Add FocusTime again in Teams, send it a message, then turn the switch back on." },
  ],
};


export const QUESTIONS = {
  title: "Questions people ask first",
  items: [
    { q: "What are Backlog's Grid and Gantt?", a: "Two views of the same items: every client's DevOps on one screen, a place to edit, clean up and organize. Grid is a table, client by client in each backlog's own order: Item, State, Dates, Assigned to, Size and Status, edited in place. Each client is a section you can fold, and its header says how many items it has and how many need attention. Gantt is the timeline: drag a bar by half-days to move its dates, with your free hours per week below. P switches between them. Readiness and the old Backlog mode are part of the Grid now: Needs attention in the toolbar, and One level as a list under Filter. Mine, Contributing and Everyone choose whose items show, and FocusTime remembers your choice." },
    { q: "How do I read and fold Backlog's Gantt?", a: "Each row is one item: its type's icon and title, indented by level (epic, feature, story). Show: Epics, Features or Stories folds every row to that level, and the arrow beside a row opens or closes just that one; a closed row's bar spans what's under it and says how many (4 features). The bar's look is its status: solid is on track, an amber edge at risk, muted and dashed stalled, a dashed open end means that date isn't set, light hatching that neither is, and an arrow at the edge means it runs past what's shown (hover for the date). The small flag at a bar's end gathers what needs attention, with a count; hover or focus it for the list and a fix for each (Break down, Set dates, Assign, Size), plus the hours planned per week. Callouts, in the toolbar's view group, turns the flags off for a clean planning view. Drag the edge of the item column to widen it. Keys: Up and Down move between rows, Left closes, Right opens, Enter opens the side panel. FocusTime remembers these choices in this browser." },
    { q: "How do Backlog's filters work?", a: "One row under the header, the same in Grid and Gantt: Clients, People (Mine, Contributing, Everyone), Needs attention with its count, and Search (titles or #id). Filter at the end of the row holds Epic, Dates (Next 2 weeks, Next 4 weeks, This quarter, Any time, or your own dates) and Levels (Epics, Features or Stories, and One level as a list); its number says how many of those you changed. ⋯ beside it has Expand all, Collapse all, Callouts (the Gantt's flags), Show the whole project, and which clients show Cooptimize's work only. When a filter isn't at its default, a line under the row says Showing 12 of 40 with a chip for each one you can remove, and Clear filters puts them all back; with nothing set there's no line. Switching views keeps everything, FocusTime remembers it, and the address carries it, so a link you send opens the same view. On a row, Left closes it and Right opens it." },
    { q: "How do I see a client's backlog in its rank order?", a: "Filter › Levels › One level as a list: each client's open stories (or features, or epics: choose the level beside it) as a flat list in the client's own stack rank, the order their board shows, with the rank number on each row. Hover the rank for when it last changed in DevOps. Mine, Contributing and Everyone still choose whose items show; Everyone is Cooptimize's work in the project. FocusTime never reorders the backlog; a project with no backlog order is listed by target date and says so. Old links to Ahead's Backlog open this list." },
    { q: "What does Stale mean?", a: "An open item nobody has changed in DevOps for 6 weeks or more: no state change, no comment, no edit of any kind. Done items are never stale. A stale row says so in its Status (hover for how long), Needs attention counts the stale items you can change, and its Stale count shows only those. You choose the number of weeks in Settings › Backlog. Stale isn't a problem to fix by itself: push its target date out, give it an owner, or plan it so it gets some time." },
    { q: "What can I do with several items at once in Backlog?", a: "Point at a row and tick it (or press Space on it); Shift+click ticks everything between. A bar appears above the grid: push the target date by 2 or 4 weeks, move it to a date, set a target date only where there's none, or assign to me. These go into your changes to save like any edit, so nothing reaches DevOps until you Review and save, with the preview, the check afterwards and Undo. Items you can't change are left out, with the reason under Why items were skipped. Plan it puts the ticked stories on next week's Plan, with Undo. Esc or Clear clears the ticks." },
    { q: "What does Needs attention show, and in what order?", a: "Items you can change that are missing stories, a target date, an owner or a size, or are stale, and only the ones that matter now: near the top of the client's DevOps backlog (the top 30 of each level, epics, features and stories, a number your FocusTime admin can change), dated in the next 4 weeks, or features and epics you own (and the features under your epics). They're in the client's backlog order, under their parents for context, so the order on screen is the order to work in. Each row has its status and its fix (Break down, Set dates, Assign or Size) and Skip; the first 10 per client show, then Show more. A project with no backlog order is ranked by target date and its header says so. An admin can turn any of the four gaps off for a client in Admin › Clients. The count on the chip is all of them for the clients and filters you're showing." },
    { q: "How do I work through Needs attention?", a: "Turn on Needs attention and start at the top. The counts beside Why these? (Needs stories, No target date, Unassigned, Unsized, Stale) each show just that kind when clicked; click it again to see everything. Fix right on the row: Set dates, Assign and Size open the row's own editor and go into your pending changes, and Break down opens its panel. When nothing is missing any more the item fades out with Undo. Nothing reaches DevOps until you save. The same line counts what you saved to DevOps this week and what's still pending save. Skip hides an item for 2 weeks and puts it in Skipped at the bottom (Unskip brings it back sooner); FocusTime remembers your skips, so they follow you to another computer." },
    { q: "Someone shows as Ext-Name in DevOps. Is that one of us?", a: "Often: many clients give us a login of their own in their DevOps. FocusTime counts that login as the person, so their items are theirs in Mine, Contributing, Team and notes, and their FocusTime name shows instead of the login. It knows a login from the person's Account Worker record in Dataverse, or because a FocusTime admin confirmed it in Admin › People, where logins that look like a Cooptimizer's are suggested for a confirm and the rest can be linked to a person. A suggestion is never applied without that confirm." },
    { q: "Why doesn't Backlog show everything in a client's DevOps project?", a: "A client's project often holds much more than our work, so Backlog, Readiness and Week's lists show Cooptimize's work in it. A FocusTime admin sets that per client in Admin › Clients: the whole project, some DevOps teams, or some area paths. Until then FocusTime works it out: items assigned to Cooptimizers, everything under epics and features a Cooptimizer owns, and the area paths where Cooptimizers have items. Items assigned to you always show. Show the whole project brings in the rest, marked Outside scope, and FocusTime remembers it for you; Needs attention never lists items outside the scope." },
    { q: "When do my Backlog changes reach DevOps?", a: "Only when you save. Every edit in Grid or Gantt goes into your pending changes first. Review lists them with before and after; Save sends them to DevOps per client with a preview, checks each one afterwards, and you can undo any of them from the Saved list or Settings › Activity. If someone changed the same field in DevOps since you started, Review shows both and you choose Keep mine or Take theirs." },
    { q: "How do I edit a cell in Backlog's Grid?", a: "Click a date, state, owner or size (or press Enter on it) and a small editor opens under the cell. Dates have a calendar that starts on Monday with today marked, quick dates (Today, Tomorrow, Next Monday, +1 week, Clear) and a box where you can type nov 20 or 11/20; a target before the start shows a warning and won't save. State lists the states this item's type has in the client's process. Assigned to lists the people on the client's DevOps project: you first, then people already assigned in this view, then everyone else by name, with a mark for anyone outside Cooptimize, who gets no note from FocusTime. Enter saves, Esc cancels, Tab saves and moves to the next cell in the row, and the arrow keys move around the grid. A saved edit shows as pending; nothing reaches DevOps until you Save." },
    { q: "What can I change in Backlog?", a: "Your own items, the features directly under an epic you own, and anything on a client you lead. Everything else shows Read-only. A teammate you assign gets a quiet note in FocusTime, and so does the owner of an item whose dates you moved." },
    { q: "How fresh is what I see from DevOps?", a: "FocusTime reads each client's DevOps once for everyone, about every minute in working hours and every 10 minutes outside them while someone is using it, and only what changed. If a read fails, you keep seeing the last good one with \"Showing items from\" and its time. Every open screen picks up a change on its own within about 2 minutes, keeping your scroll, selection and anything you're editing. The status bar says when DevOps was last checked (hover for each client). Press {key:week.load} or Refresh on any tab for a check now, and it says what it found (\"DevOps checked just now · 3 changes\"); within 30 seconds of someone else's, you see that one. A change you make from FocusTime shows at once." },
    { q: "An item I made in DevOps isn't showing. Why?", a: "Settings › DevOps › Find an item: choose the client, type the item number, and it says whether DevOps has it, whether FocusTime has it yet, whether it's inside the area FocusTime shows for that client, and whether Day, Week, Backlog and Status show it, with why not. It answers from FocusTime's last check of DevOps (about a minute old in working hours); Refresh checks now." },
    { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
    { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings › Activity. In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
    { q: "Does FocusTime tell me I planned too much?", a: "No. A block says how much free time it has left, or No free time; nothing warns you about how much is on it, not the midday check-in and not Ask. Plan it like a punch list: what doesn't get done moves forward. A block says At risk only when your calendar cuts into it: meetings, a personal event or out of office." },
    { q: "Do I have to size everything?", a: "No. Unsized stories count as 1h so the plan still adds up (change that in Settings › Planning), and nothing waits on a size. Size them when you know." },
    { q: "How do I plan stories into Week's blocks?", a: "Click a block on Week. The panel lists your open stories for that client, grouped under their features, in DevOps backlog order. Drag a story onto any of this week's blocks for that client, Friday's catch-up included. While you drag, the block shows its free time, like \"2h of 3h free\" or \"No free time left\"; PTO, past half-days and other clients' blocks say no. Drag a story from a card to another block to move it. Each drop has Undo. Without a mouse, use Add to… or Move to… (the drag handle or ⋯); on a tablet, press and hold; on a phone, Add to…. A story planned elsewhere stays in the list as \"Planned · Thu AM\", which opens that block." },
    { q: "This week's feature says No stories for you yet. Now what?", a: "Type a title in Add a story for me and press Enter (a size is optional). You see the DevOps preview; Create makes the story under the feature, assigned to you, and puts it in the block you're on. Not now leaves nothing behind. Break down opens the Break down panel for the feature, where AI can propose its stories. If teammates have stories there, Take one assigns one to you after a preview: the person who had it gets a quiet note in FocusTime, and Undo in Settings › Activity gives it back. Without DevOps write access for that client, the panel says where to add it." },
    { q: "What is From last week?", a: "When a new week starts, To place (at the bottom of a block's panel) shows last week's features per client with one suggestion each (the line over Week counts them). A feature with your open stories carries over, with those stories. One that's resolved or closed shows as Finished last week. If your stories are done, or were never yours, the feature's owner and the client's leads get Watching; anyone else sees Your part is done (with Keep watching) or Not yours yet (with Take one). A feature with no stories asks the owner or a lead to break it down. Nothing is added until you press Keep, Watch or Accept all, and a row you drop doesn't come back that week." },
    { q: "What are the suggested rows in my blocks?", a: "When a block today or on your next working day has nothing on it, FocusTime suggests work for it: first that client's unfinished to-dos from earlier days, then your open stories for the client in backlog order (one with a target date this week moves up), and a feature of yours with no stories marked Needs stories. Only as much as fits the block's free time, at most four. Hover one for why. Click it or + to keep it as a to-do, × to clear it for the week, or drag it to another of that client's blocks. A block with two or more has Keep all and Clear at its top, and a day with suggestions in two or more blocks has them beside its date on Day and Week. Every one has Undo. They count against nothing and go as soon as the block has a to-do of its own. Turn them off in Settings › Planning or with Suggestions in Day's or Week's ⋯." },
    { q: "How do I write my updates for Monday's status report?", a: "The Status tab (4) shows what Monday's report will say for your features: the ones you planned this week and any whose story you touched, by client. Preview shows it as the report's email will, a heading per feature with each comment this week as a bullet and its author; No update yet where there's none. In Edit, + Add a line on a feature (each line becomes its own DevOps comment), or Edit one of your own comments from this week. Draft writes a first version from your story changes, close-out notes and captures when AI is on for the client; edit it as you like. Push all shows every new line and edit in one preview, then writes them; each line has its own result, Retry and Undo. FocusTime never sends the report: it goes out Monday at 7:00 AM, as it always has." },
    { q: "Finish your status update before Monday", a: "Open Status (the Friday nudge opens it for you). Features you worked on since the last report went out, with no line from you yet, sit at the top under Needs your update with a \"You worked on this\" badge. Worked on means a story under it is assigned to you and changed, you moved or commented on one, you created one in FocusTime, it has a to-do or time on your calendar, or you commented on the feature. Each has a suggested line: AI suggests when AI is on for that client, otherwise \"Worked on\" with the story titles. Use puts it in, Edit opens it to change, Dismiss hides it. Type more with + Add a line: Enter adds the line and opens the next, Shift+Enter starts a new line in the same comment, Esc closes, and Tab goes to the next feature. Click one of your own comments to edit it, or Delete it. In a client's report, + Add a feature brings in any of its features by title or #id. Nothing goes to DevOps until Push all, which shows every line by feature first. Each line is its own comment, with Undo." },
    { q: "What does the dot on Status mean?", a: "It shows when features you worked on have no update of yours for Monday's report. Amber (a ring) is your second to last workday before the report goes out, red (a filled dot) your last one, counted from your own week: the days with focus blocks, not the catch-up day or PTO. Earlier in the week there's no dot, and it goes once you've written an update for each or the report is sent. Hover it for how many and when the report goes out." },
    { q: "See the whole report before it goes out", a: "At the top of Status, switch from My features to <Client> report (pick the client when you're on several). It shows Monday's report for that client as it will go out: every feature with a comment since the client's last report was sent, in backlog order, each comment with its author as DevOps shows them, then Upcoming PTO and Holidays for the next two weeks (the team's days away and Cooptimize's observed holidays). Below it, No update yet lists features someone worked on this week with no comment, each with its owner; + Add a line writes one there. Anyone on the client's team sees it, not only leads. You can add lines to any feature and edit your own comments; other people's stay as DevOps has them. Refresh reads DevOps again, and Push all updates the report from what DevOps reads back. It works on a phone too." },
    { q: "Which comments count as this week's?", a: "The ones added or edited since that client's report was last sent, as Monday's report counts them. When FocusTime can't read when that was, it counts from the last Monday at 7:00 AM Eastern and says so on the client. Teammates' and Coop's comments show but can't be edited, and you can only edit your own from this week. Settings › Notifications can remind you on Friday afternoon (and Sunday evening) when some features have no update yet, in the app or in Teams." },
    { q: "Why are some unfinished to-dos in a list instead?", a: "When the client has no block left this week, its unfinished to-dos go in Unfinished from earlier days, grouped by client and feature. Drag one onto any block or use Move to…. To-dos from an earlier week fold under From last week the same way." },
    { q: "What is the line across today?", a: "The time now, on today's blocks, with the time at its left end. Where a block has no hour rail, the time sits in the header of the block under way. The part of today that has passed is a little dimmer. Before or after your hours it sits at the top or bottom edge of the day; on a PTO or catch-up day it is thinner. Today's agenda and Plan today show it as a row in time order. Click the time to bring today into view on a narrow screen or the phone." },
    { q: "What does Watching mean?", a: "You're keeping a feature moving without doing its stories. Each Watching row gets a 30-minute check-in on the client's first block of the week that hasn't ended. It counts in the week's hours at once, shows on Week as a dashed Check-in chip, and becomes a to-do when you plan that day. Move it or remove it from the chip or the row; the row stays. If none of its stories changed state since Monday, from Wednesday the row turns amber, \"No movement this week\", with who to check in with: the Cooptimizer with the most open stories on it. Until FocusTime has a week of DevOps changes it says Movement not known yet." },
    { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
    { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional, and so is adding any calendar by its link (iCloud, Outlook, school apps). If you add one, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
    { q: "Can anyone else see my plan?", a: "No. Your plan, notes, promises and settings are yours. Teammates only ever see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
    { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Today shows a quiet line while steps are left, and Settings › Profile › Run setup again runs it again." },
    { q: "Which version am I on?", a: "⋯ › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
    { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off, and so is an observed company holiday, shown by its name (\"Thanksgiving Day (observed)\") instead of PTO. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it; a feature already pinned there stays, marked \"Pinned to PTO, move it\"." },
    { q: "How do I use the timeline with the keyboard?", a: "Tab to a to-do. On one that has no time yet, T puts it at the next free time that fits. On one with a time, Up and Down move it 15 minutes, Shift with Up or Down changes its length, and Backspace takes the time off. Undo is in the message that follows each mouse or T change." },
    { q: "How does the timeline work on a phone?", a: "Turn it on from ⋯ on Today; the phone remembers this separately from your computer. Tap a to-do without a time, then Pick a time, and choose from the 15-minute list. Tap one with a time for Move or Un-timebox. Timebox my day shows its suggestions with ✓ and ✕ and an Accept all bar." },
    { q: "Timeboxes and check-ins: how do they work?", a: "A timebox is a work session: it can be shorter than the to-do, and it never changes the to-do's size. At Midday check-in and Close out, any timebox that ended gets Done, Partly (say how much is left) or Didn't get to it, or All went to plan for the lot. What you skip comes back at the next one, and nothing reminds you in between. Once there's progress, the to-do shows \"1h of 2h left\" and planning uses what's left. Done means the story is done, so its to-dos on later days come off the plan, and Undo puts them back. Ticking a to-do done does the same. At Close out you can update DevOps in one preview, or Skip." },
    { q: "Does Timebox my day write to my calendar?", a: "Only if you tick Put on Outlook in its bar. You then see every Outlook event in one preview, and nothing is written until you confirm it. Without that, timeboxes stay in FocusTime. Suggestions stay clear of your meetings; a time you drag yourself can overlap one if you want it to." },
    { q: "Why can't I move some of my old timeboxes?", a: "Timeboxes made by an earlier FocusTime, before you signed in here, show as ordinary Outlook events. FocusTime leaves them alone; change or delete them in Outlook." },
    { q: "How do I add a client's Teams chats?", a: "A FocusTime admin adds them: Admin › Clients, on each client, Delivery chats, then Add a chat (everyone else sees the chats in Settings › Client chats, read-only). Type to search your Teams group chats, then Enter. A client can have several chats; a chat belongs to one client. Each is labelled Delivery team (the internal Cooptimize team) or Customer collaboration (with the client's key people): FocusTime suggests it from who is in the chat, and you can change it. People from other organizations, and guests, are marked External, and FocusTime warns when someone from outside is in a Delivery team chat. A chat added to a client is shared with everyone on it who follows the client, and its new messages are read into conversations (see The Inbox, conversations and promises)." },
    { q: "Where do I add my DevOps write access?", a: "Settings › DevOps › Write access, on each client: enter a personal access token with work item read and write, then Check and save. FocusTime checks it against your DevOps identity, stores it encrypted, and never shows it again." },
    { q: "How do I send an idea, a problem or a question?", a: "⋯ › Send feedback, or Send feedback in Commands. Pick Idea, Problem or Question, write it, and look at the preview: it shows exactly what goes to the FocusTime backlog in Cooptimize's DevOps. Your name and email go with it, and where you were if you leave that ticked; nothing from your plan or clients. It's created as you, with your own DevOps write PAT for Internal, so turn on DevOps writes for Internal in Settings › DevOps first; Settings › Accounts and calendars › Send feedback says whether you're set up. Once it's created you see its number, linked to the item in DevOps, and Settings › Activity lists it in the DevOps write log, with Undo. If it can't be sent, it says so and nothing is claimed; Copy text keeps it, and you can message the FocusTime team in Teams." },
    { q: "Does FocusTime use AI?", a: "Only where your FocusTime admin turns it on: AI for FocusTime and each client's Allow AI are set in Admin › AI, and Settings › AI and assistant shows them. What's sent is only what one task needs, about one client at a time; FocusTime checks it first and won't send another client's details, keys or passwords, your VM, or email addresses from outside Cooptimize. Your AI use stops at your monthly limit (10 dollars unless an admin changes it). Settings › AI and assistant shows this month's cost and your last 20 requests, never their text, and Test AI checks it works." },
    { q: "What does \"Set by your FocusTime admin\" mean?", a: "Some settings are the team's: a FocusTime admin sets them once for everyone in Admin, like whether AI is on, which clients allow it, a client's chats and its open states. You see them read-only. Others are team defaults you can change for yourself, like a client's color or how much of your free time to plan: pick your own, and Reset goes back to the team's." },
    { q: "What can a FocusTime admin do?", a: "Admins are the members of the FocusTime Admins group in Entra. Admin (in ⋯ and in Settings, only for admins) holds the team's settings: clients, AI, conversations, people and their levels and leads, the organization's defaults, the health of each source, and an audit of every change. Admins never see anyone's plan, to-dos, promises, captures, focus sessions, tokens, AI request text, or messages from chats they aren't in." },
    { q: "Do I need to save in Settings?", a: "No. Each setting saves as you change it, and says Saved by the field; Undo puts the old value back. Only access tokens wait for Check and save. App secrets aren't in Settings at all: they're set up by FocusTime's own scripts, never in the app." },
    { q: "Why isn't one of our accounts in my client list?", a: "FocusTime's clients are the active Dataverse accounts of type Customer, plus Cooptimize Internal. Prospects, partners, vendors and the rest stay out of your lists and pickers. A FocusTime admin can treat an account as a client, or hide one, in Admin › Clients under All accounts. Nothing is deleted either way." },
    { q: "Who shows as a Cooptimizer?", a: "People with an address in the Cooptimize email domains who aren't guests. Only they have a level, lead clients, and appear in teammate pickers. Guests and automation accounts are listed for admins under Not Cooptimizers in Admin › People. Sign-in is only for Cooptimize accounts: a guest account is told to sign in with their cooptimize.org account." },
    { q: "How do I find a setting in a short window?", a: "Type in Search settings at the top of the list: it finds a setting by its name or its old name and takes you there. The list scrolls on its own. On a phone, Settings opens on the list; each section is a page with Back. × at the top right, or Esc, closes Settings and goes back where you were." },
    { q: "Where does my level come from?", a: "Your position in Dataverse, through the mapping a FocusTime admin keeps in Admin › People. Until a position is mapped, its people show Level not set and get the Consultant defaults. A level only changes suggestions and emphasis, never what you can see or do." },
    { q: "What are client calls?", a: "A client's weekly call that a FocusTime admin registered for it in Admin › Clients. After each one, FocusTime reads its transcript (or a reviewer uploads it) and proposes what to do about it: new DevOps items for gaps nobody has a story for, promises people made (in their own Promises, or your Waiting on for the client's), and DevOps comments for decisions and status. FocusTime reads no other meeting. The call shows on its client's card on Week; ⋯ › Client calls lists yours." },
    { q: "How do I review a client call?", a: "Open it from its mark on Week or the note you got: Update <client>'s plan. Each proposal shows the words from the call it came from. Tick what's right, change the words where needed and skip the rest, then Confirm: every DevOps change is shown before anything runs, and each can be undone in Settings › Activity. Only the call's reviewers can confirm; other Cooptimizers on the call can look. Transcripts are kept 30 days; what you confirmed stays." },
    { q: "It asks me to upload a transcript.", a: "When the client hosts the call, or the transcript didn't come through, open the meeting's recap in Teams, download the transcript (.vtt or .docx) and use Upload a transcript. If you can't download it, ask the meeting's organizer to send it. No transcript this week clears the note for everyone." },
  ],
};

/** The example week's day names (the tours' drawings). */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export const FOOTER = "FocusTime by Cooptimize. Questions or ideas? ⋯ › Send feedback, or message the FocusTime team in Teams.";
/** DOC-1: the footer's link to the Technical docs (signed in only). */
export const TECH_DOCS_LINK = { label: "How FocusTime works under the hood", href: "#/docs" };

// ---------- Ways in ----------

export const TOUR = {
  /** The sign-in page and a person's first Today. */
  link: "New here? Start here (about 10 minutes)",
  dismiss: "Not now",
  close: "Close",
  signIn: "Back to sign in",
};

/** UI-5: Start here. About 250 words: what FocusTime is for, the day in five steps, the week in three. */
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
    steps: [
      { name: "Add work", text: "In the morning, + Add on today's blocks puts stories on them.", teams: true },
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
      { name: "FocusTime proposes, you confirm", text: "Every change to DevOps, Teams or Outlook shows a preview first, and has Undo. Your own plan changes from a tap happen at once, with Undo." },
      { name: "Clients stay separate", text: "One client's work never shows in another client's view, AI request or post. AI is optional, and allowed per client." },
    ],
    /** The proposal card's two states (an animation from one to the other). */
    proposal: { ask: "Set #4411 to Closed?", confirm: "Confirm", done: "Done ✓", undo: "Undo", replay: "Play again", label: "Example: a proposal, confirmed" },
  },
  showMe: "Show me",
  /** Signed out there are no screens to show. */
  signedOut: "Sign in to see it on your own screens.",
};

/** UI-5: the words of the tour card (ui/guide/tour/Tour.tsx). */
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

/** UI-5: the example data the tours' drawings use where a real screen has nothing yet. Fictional, labeled as an example. */
export const TOUR_EXAMPLES = {
  grid: {
    AM: [{ client: "Northwind", color: "teal" }, { client: "Harbor", color: "violet" }, { client: "Northwind", color: "teal" }, { client: "PTO", color: null }, { client: "Catch-up", color: null }],
    PM: [{ client: "Atlas", color: "ochre" }, { client: "Northwind", color: "teal" }, { client: "Cooptimize", color: "blue" }, { client: "PTO", color: null }, { client: "Catch-up", color: null }],
  } as Record<"AM" | "PM", { client: string; color: ExampleColor | null }[]>,
  carry: [
    { title: "Order history export", hint: "3 of your stories open", action: "Carry over" },
    { title: "Supplier onboarding", hint: "Finished last week", action: "Keep" },
  ],
  card: { client: "Northwind", color: "teal" as ExampleColor, fit: "9h planned · 11h free", features: [{ title: "Order history export", hours: "about 6h" }, { title: "Invoice totals", hours: "3h" }, { title: "Loyalty points", hours: "1h" }] },
  add: { client: "Northwind", rows: ["#4120 Returns dashboard", "#4133 Price list import", "#4158 Shipping labels"], box: "Type a feature for Northwind, then Enter" },
  next: { label: "Next client: Harbor ›" },
  /** UI-5: the other tours' drawings, each one small card: a heading, rows and the buttons it would have. */
  cards: {
    "todo-drag": { head: "Northwind · Mon PM", meta: "2h of 3h free", color: "teal", rows: [["Export button", "M · 2h"], ["Date filter  ← dropped here", "S · 1h"]], actions: ["Undo"] },
    "done-offer": { head: "Set #4411 to Closed?", meta: "Northwind", color: "teal", rows: [["State", "Active → Closed"]], actions: ["Confirm", "Not now"] },
    urgent: { head: "Urgent", meta: "", color: null, rows: [["Export misses the last day", "Needs you now"], ["Send the test plan to Alex", "Due 2:00"], ["Supplier onboarding · Must", "Waiting for you"]], actions: ["2 more in Inbox"] },
    closeout: { head: "Close out · Monday", meta: "4 done · 3h 10m focused", color: null, rows: [["Where you left off", "Chart renders; next, the filter"], ["#4411 still Active in DevOps", "Mark done"], ["Reply to Jordan", "Overdue"]], actions: ["Done"] },
    "ib-item": { head: "Export misses the last day", meta: "Northwind · Conversation", color: "teal", rows: [["Priya says the export stops a day early on Sundays.", ""], ["Why it's here", "New, nobody picked it up"]], actions: ["Create DevOps item", "Link", "⋯"] },
    "gaps-row": { head: "Northwind · Portal", meta: "3 gaps", color: "teal", rows: [["Customer portal redesign", "Set dates"], ["Export button on the order page", "Size"], ["Supplier onboarding", "Break down"]], actions: ["Skip"] },
    pending: { head: "3 changes to save", meta: "", color: null, rows: [["Order history export · Target", "Nov 20 → Dec 4"], ["Invoice totals · Size", "– → 8h"]], actions: ["Review"] },
    "ask-answer": { head: "What's next?", meta: "", color: null, rows: [["Export button", "Northwind · Mon PM · M"], ["Then: Date filter", "S · 1h"]], actions: ["Open Day"] },
    "ask-move": { head: "Move 3 to-dos to Friday", meta: "Only your plan changes", color: null, rows: [["Export button", "Mon PM → Fri"], ["Date filter", "Tue AM → Fri"], ["Harbor test plan", "Wed AM → Fri"]], actions: ["Confirm", "Edit", "Cancel"] },
    "ask-update": { head: "Update #4411", meta: "Northwind DevOps", color: "teal", rows: [["State", "Active → Closed"], ["Comment", "shipped"]], actions: ["Confirm", "Cancel"] },
    "status-line": { head: "Order history export", meta: "Northwind · No update yet", color: "teal", rows: [["Export runs for any range; filter next", "new line"]], actions: ["+ Add a line", "Draft"] },
    "status-draft": { head: "Draft for Northwind", meta: "Example · AI, from your week", color: "teal", rows: [["Order history export", "Export runs for any range"], ["Invoice totals", "Rounding fixed, in test"]], actions: ["Keep", "Edit"] },
    "status-push": { head: "Push 3 lines to DevOps", meta: "Northwind · one preview", color: "teal", rows: [["Order history export", "2 new lines"], ["Invoice totals", "1 edit"]], actions: ["Push all", "Cancel"] },
  } as Record<string, { head: string; meta: string; color: ExampleColor | null; rows: [string, string][]; actions: string[] }>,
};

// ---------- UI-5: the sections after Start here ----------

export { SECTIONS, SECTION_GROUPS, type SectionId } from "./sections.ts";

/** Questions with no G1 home, written for UI-5. */
const NEW_QUESTIONS = [
  { q: "How do I see who's set up?", a: "If you're a FocusTime admin: Admin › People shows every Cooptimizer with yes or no for Signed in, DevOps connected, Calendar connected and, where the Teams app is set up, Teams app added. Filter by Not signed in or Set up partly. It shows only these marks, never anyone's plan." },
  { q: "How do I invite a teammate?", a: "In Admin › People, Invite on their row (or tick several and Invite several) opens a message to edit, with FocusTime's link and the first three steps. Open in Teams starts a chat with them, Open in Outlook starts an email, or Copy message, and you send it. Where your sign-in allows it, Send in Teams (one 1:1 chat each) or Create Outlook draft or Send now sends it from FocusTime as you, after a preview of who gets it and the final text; if someone isn't reached, Retry tries only them. The row then shows when and how you invited them, and you can invite them again any time. In {key:Ctrl K}: Invite, or Who's set up." },
  { q: "What is the moment card?", a: "Day's one card for the moment of the day: Nothing on today yet (with + Add) while today's blocks have no to-dos, Midday check-in once your afternoon starts, and Close out near the end of your day. Each opens its flow; once it's done it's a small line with Reopen. Nothing is forced: skip any of them." },
  { q: "Can I look at another day?", a: "Yes. ‹ and › (or [ and ]) step to another day, and Today comes back. Today and every later day take work: each block has + Add. A past day's blocks open to tick what got done and move the rest forward. A PTO day says you're off, with nothing nagging." },
  { q: "Does the assistant ever change something on its own?", a: "No. Every change is a proposal with the same preview as the button, and runs only when you Confirm. What it reads from chats, DevOps or captures is information for it, never instructions." },
  { q: "Can it change several things at once?", a: "Yes. It can move several to-dos at once, across clients (\"Push everything from today to tomorrow\"), with one Confirm and one Undo. On one item it can do up to three things in one card, like mark it done and add a comment. Any it can't put back because you worked on them since are listed." },
  { q: "What happens when it isn't sure what I mean?", a: "It asks one short question with a few choices made from your own clients, blocks and items, plus \"or type it\". Tap one, or answer in your own words." },
  { q: "What does the assistant need?", a: "AI for FocusTime, which your FocusTime admin turns on, and Allow AI for the client it's about. Your history stays 30 days; clear it in Settings › AI and assistant." },
  { q: "Where do the assistant's answers come from?", a: "Only from what FocusTime already shows you: your blocks and to-dos, your promises and what you're waiting on, your DevOps items in Backlog, Monday's status report and your client calls. FocusTime puts the answer together itself, so another client's details never go to the AI with it. When a source didn't load or doesn't exist (holidays, for one), the answer says so instead of guessing." },
  { q: "How long does it remember what I asked?", a: "2 hours, so \"the ones under the export feature\" right after a request works. It's yours only, kept with your assistant history, and Clear in Settings › AI and assistant removes it." },
  { q: "Does it answer about every client?", a: "About every client you can see, grouped by client. Never a client you can't see, and an answer is never posted anywhere: it stays in your panel or your own Teams chat with FocusTime." },
  { q: "What if AI is off?", a: "It says AI isn't on and points you to the command menu ({key:Ctrl K}), where every action is. Everything else in FocusTime works the same." },
  { q: "What is Diagnostics?", a: "Settings › Your data › Diagnostics, or Diagnostics in {key:Ctrl K}. Counts only, for your own chats: why a conversation where someone said they'd do something has no promise of yours, why messages of yours that sounded like a promise have none, and where your chats' messages were sorted in the last 14 days. It never shows message text, and Copy as text copies only the counts." },
  { q: "What is a story card?", a: "A work item's title anywhere in FocusTime opens its card here, not DevOps: its state, type, who has it, iteration, size, Remaining Work and dates, its feature and epic (each opens its own card), its description and acceptance criteria, the latest comments (Show all for more), and what FocusTime knows: your to-dos and timeboxes on it and your promises about it. From the card: Wrap it up, Add comment, Change state, Assign, Dates and Break down, each with the usual preview and Confirm. Copy DevOps link at the foot copies the item's address; the ⋯ menus on to-dos and items do the same. Esc or × closes it and Back returns to the one before." },
  { q: "How do I wrap up a story?", a: "Tick it, or Wrap it up on its card. Finished sets the item's done state (the one you use most for that client) and Remaining Work to 0. Made progress keeps the state (a New item moves to Active), asks about how much is left (30m, 1h, 1.5h, 2h or type it) and keeps the story's later to-dos on your plan. Add a comment, or Suggest one, and tick Also add to <feature>'s status for Monday if it belongs there. Preview shows one line with every change, then Confirm writes them in order, each with its own result and Retry. Undo puts the tick back and offers each DevOps change's own undo. Close out asks the same for the day's done stories in one list: Finished or Made progress, the time left and a comment for each, then one Preview and one Confirm. In Teams, Done and Partly on a check-in card offer the same, with an optional comment and Confirm. If a client's DevOps updates are off, the first tick says so once, with the way to turn them on." },
  { q: "Add any calendar by link", a: "Settings › Accounts and calendars › Calendars added by link › Add a calendar by link. Paste the calendar's subscription link (https:// or webcal://), press Check link, and FocusTime says how many upcoming events it found. Give it a name and a color, choose Busy only (the default: no titles, places or notes are kept, events show as Busy) or Show titles, and Personal (hidden with {key:ui.set_show_personal}, like Google's) or Work (counts as meetings), then Save calendar. Where the link is: in Google Calendar, Settings, the calendar, Integrate calendar, Secret address in iCal format (Google's changes can take hours to reach it); in Outlook on the web, Settings › Calendar › Shared calendars › Publish a calendar, then copy the ICS link; in iCloud, share the calendar and turn on Public Calendar; school and activity apps say Subscribe, iCal or ICS. FocusTime reads it about every 15 minutes while you use it, and Refresh reads it now. It never writes to it. The link works like a password: FocusTime keeps it encrypted and only ever shows its host. If it stops working, the status line says so; Replace link takes a new one and Remove deletes it and its events." },
  { q: "Can I stop my VM from FocusTime?", a: "Yes, your own VM only. The VM chip's menu has Stop while it runs: a preview says it will be deallocated (it shuts down and stops billing for compute) and that anything running on it ends, then Stop. FocusTime never stops it on its own and never changes its auto-shutdown. Each start and stop is in Settings › Activity." },
  { q: "Can FocusTime start my VM before my day?", a: "Yes, if you turn it on: Settings › Accounts and calendars › My VM › Start my VM before my day, with how many minutes before your day starts and on which days. It starts only on days your working hours cover, not on PTO or holidays, and only when the VM is stopped; it says so after. It runs only on the production FocusTime, never on dev. After 3 working days without FocusTime it pauses until you press Resume. The chip's menu shows the next one, with Skip this one." },
  { q: "What is the demo?", a: "Try the demo, on the sign-in screen, opens FocusTime with made-up clients, work and calendars, so you can click everything. Nothing of yours is in it and nothing reaches DevOps, Outlook or Teams. Starting it signs you out of your own FocusTime; sign in again to come back." },
] as const;

/** LP-1: Close the loop sends the update (Teams, email, a DevOps comment or a call note), or closes without sending. */
export const CLOSE_THE_LOOP = {
  q: "How do I close the loop on a promise?",
  a: "Press Close the loop ({key:inbox.key.close}) on the promise. FocusTime drafts the update to the person you promised, says what it drafted from, and you edit it. Choose how it goes: Teams (the chat it came from, or a 1:1 with someone at Cooptimize), Email (an Outlook draft by default, or send now), a Comment on its DevOps item, or Call (a Teams call link and a note). Preview shows where it goes and who sees it, people outside Cooptimize by name, and nothing is sent until you press Send there. Sent messages can't be undone; Mark this promise kept has Undo. You can also add it as a comment on the item or move the item's state, each previewed. Close without sending closes it the old way, with how and a note. Not needed closes it quietly.",
};

/** Every question the Guide answers, from every pool; the sections below place each one by its words. */
export const QUESTION_POOL: readonly { q: string; a: string }[] = [...DEVOPS.breakdown, ...PHONE.items, ...ASKS.items, ...TEAM.items, ...TEAMS_BOT.items, ...QUESTIONS.items, ...NEW_QUESTIONS, CLOSE_THE_LOOP];

/** Pool questions the Guide no longer asks, and where their answer went instead. */
export const RETIRED_QUESTIONS: Readonly<Record<string, string>> = {
  "Where did Fix next and Sort later go?": "renamed",
  "Where did Ahead go?": "renamed",
  "Where did picks go?": "renamed",
  "Where did Needs help from… go?": "renamed",
};

/** A thing you do in an area: one line, and where to do it (an address the link checker opens) or a tour. */
export type Do = { title: string; text: string; go?: { href: string; label: string }; tour?: string };
/** The try-it sandboxes (ui/guide/TryIt.tsx): in-page example data, nothing sent. */
export type TryItId = "drag" | "timeline" | "sizing" | "inbox" | "assistant";
/** Extra pieces an area draws: Today's urgent strip animation, Week's DevOps ladder, the key list. */
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

export const AREAS: Record<"today" | "week" | "ahead" | "inbox" | "capture" | "assistant" | "ask" | "teams" | "calls" | "settings", AreaBody> = {
  today: {
    lead: "Day is one day on one screen: what's urgent, the moment of the day, and the day's blocks.",
    does: [
      { title: "The day's blocks", text: "The same cards as Week. The next to-do has the one Start focus button; focus sets your Teams status to Busy and counts the time. + Add, a click or {key:ui.block} opens a block's panel.", go: { href: "#/day", label: "Open Day" }, tour: "today" },
      { title: "The urgent strip", text: "At the top: conversations that need you now, promises late or due within 2 hours, and work sent to you. The 3 most urgent, then \"N more in Inbox\"." },
      { title: "One moment card", text: "Nothing on today yet (with + Add), Midday check-in after lunch, Close out at the end of the day. Each opens its flow; done, it's a small line with Reopen." },
      { title: "Any day", text: "‹ › step to other days, and Today comes back. Today and later take work; a past day ticks and moves work forward. A PTO day just says you're off." },
      { title: "The timeline", text: "Timeline at the top right, or {key:ui.set_today_timeline}, shows the day as hours, like Week. Each block's to-dos are listed beside its hours with their checkboxes, the ones with a time first. Drag one from Not timeboxed yet onto the hours, move or resize it, or drag it back to take its time off, each with Undo. Timebox my day adds dashed suggestions to accept." },
    ],
    extras: ["urgent"],
    faqs: ["Timeboxes and check-ins: how do they work?", "How do I use the timeline with the keyboard?", "How does the timeline work on a phone?", "Does Timebox my day write to my calendar?", "What is the moment card?", "What's on Today on a phone?", "What's in Today's urgent strip?", "Can I look at another day?", "Does checking off a to-do change DevOps?", "How do I wrap up a story?", "What is a story card?", "What is the line across today?", "How does FocusTime know I'm off?", "Why can't I move some of my old timeboxes?"],
  },
  week: {
    lead: "Week is your half-day blocks for the week, with one panel beside them for the block you're on.",
    does: [
      { title: "Your blocks", text: "Each block is a half-day for one client: its to-dos, a line for its meetings, and + Add at the bottom. Click a title for its story card, and a day's name to open that day in Day. Cards and Timeline ({key:ui.set_show_timelines}) switch to a slim hour rail beside each block. A busy block folds its done to-dos into \"3 done\"; click it to see them. A call live in the client's delivery chat shows on its block with Join; ⋯ › Start a call opens the chat in Teams.", go: { href: "#/week", label: "Open Week" }, tour: "board" },
      { title: "A block's panel", text: "+ Add on a block, a click on its header, or {key:ui.block} opens the one panel for that block: what's on it, its meetings, and Add. Type in the Add box to search this client's work and your promises; Enter takes the highlighted row, and the last rows make a new to-do or a new draft story. Before you type it lists what's assigned to you (your features and stories, each story under its feature), your promises, and More in the client for everyone else's work. + puts a row on the block, or drag it onto any block. Placing a story adds its feature to the week.", go: { href: "#/week/add", label: "Open a block" }, tour: "plan-week" },
      { title: "Take work off", text: "Drag a to-do from a block onto the panel, or ⋯ › Take off the plan. It leaves the block and goes back to not placed, with Undo. That isn't Drop, which marks it dropped." },
      { title: "Nothing to confirm", text: "What's on your week is your plan. Add work or take it off any time; teammates and Monday's status report see the change." },
      { title: "Send work to someone", text: "⋯ › Send to… on a feature or story, for this week or next. They answer from To place, at the bottom of a block's panel." },
    ],
    extras: ["ladder"],
    tryIts: ["drag", "timeline", "sizing"],
    faqs: [
      "How do I plan stories into Week's blocks?",
      "This week's feature says No stories for you yet. Now what?",
      "What is From last week?",
      "What are the suggested rows in my blocks?",
      "Why are some unfinished to-dos in a list instead?",
      "Can I hide the hour rail on Week?",
      "Why are some days narrow strips on Week?",
      "When do Saturday and Sunday show on Week?",
      "Planning a deployment",
      "What is a Deployment to-do?",
      "What does Call live mean?",
      "Do I have to size everything?",
      "Does FocusTime tell me I planned too much?",
      "What does Watching mean?",
      "What's a block, then?",
      "How do I write my updates for Monday's status report?",
      "Finish your status update before Monday",
      "What does the dot on Status mean?",
      "See the whole report before it goes out",
      "Which comments count as this week's?",
      "How do I send work to someone?",
      "Who can send a Must?",
      "What do I do with something sent to me?",
      "What if I can't take a Must?",
      "Does Accept change DevOps?",
      "How do I see what I sent?",
      "What is a client priority?",
      "How do I ask a lead to look at my week?",
    ],
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
    faqs: [
      "What are Backlog's Grid and Gantt?",
      "How do I read and fold Backlog's Gantt?",
      "How do Backlog's filters work?",
      "What does Needs attention show, and in what order?",
      "How do I work through Needs attention?",
      "How do I see a client's backlog in its rank order?",
      "What does Stale mean?",
      "What can I do with several items at once in Backlog?",
      "How do I edit a cell in Backlog's Grid?",
      "When do my Backlog changes reach DevOps?",
      "What can I change in Backlog?",
      "Why doesn't Backlog show everything in a client's DevOps project?",
      "Someone shows as Ext-Name in DevOps. Is that one of us?",
    ],
  },
  inbox: {
    lead: "The Inbox is one list of what needs a decision: conversations from client chats, your promises, work sent to you and your captures.",
    does: [
      { title: "Everything, in time", text: "It opens on Everything: every item by its latest activity under day headings, newest or oldest first, with a line at what's new since you last looked. Status chips and the client ticks narrow it; the views on the left are shortcuts for one status.", go: { href: "#/inbox", label: "Open the Inbox" }, tour: "inbox" },
      { title: "Why it's here", text: "In Needs you each row says why: you said you'd do it, you own it, nobody picked it up, or it's due." },
      { title: "The open item", text: "On the right: its summary, the messages, the linked item, commitments and every action, the main one first." },
      { title: "Create a DevOps item", text: "From a conversation or promise without one. With AI allowed for the client the form is drafted for you. Nothing is written until you confirm the preview." },
      { title: "Close the loop", text: "Send the update from the promise: Teams, email, a DevOps comment or a call note. FocusTime drafts it, you edit it, and the preview shows who will see it before anything is sent. Close without sending still works." },
    ],
    tryIts: ["inbox"],
    faqs: [
      "How is the Inbox laid out?",
      "What does New since you last looked mean?",
      "How are times shown?",
      "What counts in Needs you?",
      "What's in Needs you?",
      "What is a conversation?",
      CLOSE_THE_LOOP.q,
      "What are Promises?",
      "How do I choose who a promise is for?",
      "Where do promises show?",
      "How do I create a DevOps item from a conversation or a promise?",
      "How do I link a conversation or promise to an item that already exists?",
      "Can a link open one item?",
      "What happens when someone commits to work?",
      "What if nobody creates it?",
      "What are the suggested comments?",
      "Can I merge two conversations?",
      "Hide for me or Not a request?",
      "What does Show messages show?",
      "Why do I see pictures from the chat?",
      "Are chat images sent to the AI?",
      "Can a DevOps item carry the chat's images?",
      "How does AI sort them?",
      "Why are some messages unsorted?",
      "Why is a message held back?",
      "What does \"mentions <client>\" mean?",
      "What happens to a chat when AI is off for its client?",
      "How do I turn it on?",
      "How do I add a client's Teams chats?",
      "Who sees a chat's conversations?",
      "When does it read?",
      "What does FocusTime keep?",
      "What are the Inbox's keys?",
      "Do old links still work?",
    ],
  },
  capture: {
    lead: "Capture gets a thought out of your head in one line, saved at once, to sort later.",
    does: [
      { title: "Anywhere", text: "Press {key:capture.add}, or the Capture button. The client chip is where it goes; Enter saves, with Undo." },
      { title: "As what it is", text: "Decide later, Promise, Draft story or Draft feature. A draft gets a DevOps-ready version from AI in the background where AI is allowed." },
      { title: "Into DevOps", text: "Create in DevOps on a draft opens the preview straight away; it takes the draft's place wherever it was planned. Ctrl+Enter in the box saves and opens the New form, with the AI version under More.", go: { href: "#/inbox/captures", label: "Open Captures and drafts" } },
      { title: "New in DevOps", text: "{key:ui.new_item} anywhere, + New in Backlog, or + New under on a row: one form for a story, feature, epic or any level the client's process has. Type the title, press Enter, confirm the preview." },
      { title: "Break down", text: "On an item that needs stories, AI proposes the child items. Edit the cards; nothing is created until Create all." },
    ],
    faqs: ["Quick capture from anywhere?", "How do I create a feature or an epic in DevOps?", "What does Break down do?", "How FocusTime uses Cooptimize's standards", "What is sent to the AI?", "What do I choose in Prepare?", "What is the house style?", "How do I review the proposals?", "What happens when I press Create all?", "Why can't I break an item down?"],
  },
  assistant: {
    lead: "The assistant answers questions about your plan and proposes changes that you then confirm.",
    does: [
      { title: "Ask", text: "{key:assistant.ask}, or Ask in the top bar. What's next, what's due tonight, where an item stands, what people promised.", tour: "assistant" },
      { title: "Change several at once", text: "\"Move the stories under the export feature to Friday\": one card, one Confirm, one Undo, across clients." },
      { title: "Update an item", text: "Mark an item done and comment on it in one card." },
      { title: "It asks when it isn't sure", text: "Which client, block or item? It offers a few choices. Tap one, or type." },
      { title: "Talk", text: "Hold the mic, 60 seconds at most. The words land in the box; nothing goes until Send, and the recording isn't kept." },
    ],
    tryIts: ["assistant"],
    faqs: ["Does the assistant ever change something on its own?", "Can it change several things at once?", "What happens when it isn't sure what I mean?", "What does the assistant need?", "Can I just talk to it?"],
  },
  ask: {
    lead: "Ask in your own words: the assistant answers from your own plan, grouped by client, and says plainly what it can't see.",
    does: [
      { title: "Plan a week", text: "\"I'm planning next week. What should I look out for?\" Days heavy with meetings, blocks at risk, late promises, items not ready, deployments and status updates owed, then up to 3 next steps to tap." },
      { title: "Find out what it does", text: "\"What can you help me with here?\" Examples made from your own week, each one a tap away." },
      { title: "Ask about one thing", text: "\"Which promises are late?\", \"What's not ready for Northwind next week?\", \"Do I have any deployments this weekend?\", \"What am I waiting on?\"" },
      { title: "Follow up", text: "\"The ones under the Data export feature\" right after a request: it remembers what you asked for 2 hours, and asks when a name matches more than one thing." },
      { title: "Tap a next step", text: "A suggested step shows the same preview as the button. Nothing changes until you Confirm.", tour: "assistant" },
    ],
    faqs: ["Where do the assistant's answers come from?", "How long does it remember what I asked?", "Does it answer about every client?", "What if AI is off?"],
  },
  teams: {
    lead: "FocusTime in a 1:1 chat in Teams: ask it things, and if you like, get your brief, check-in and close out there.",
    does: [
      { title: "Start", text: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\"." },
      { title: "Your rhythm in Teams", text: "Turn on Let FocusTime message me in Teams, then choose what it sends. Everything is off until you do.", go: { href: "#/settings/notifications/teams-messages", label: "Open the setting" } },
      { title: "capture:", text: "Start a message with capture: and it's saved to Captures and drafts, as typed." },
    ],
    faqs: ["How do I start?", "Can FocusTime message me first?", "What's in each one?", "Does tapping a button change things right away?", "Can I just tell it what I got done?", "How do I capture something from Teams?", "It says FocusTime can't message me in Teams."],
  },
  calls: {
    lead: "A client's weekly call, registered by an admin. After each one, FocusTime proposes what to do about it.",
    does: [
      { title: "Review after the call", text: "Update <client>'s plan: each proposal shows the words it came from. Tick what's right, then Confirm.", go: { href: "#/meetings", label: "Open Client calls" } },
      { title: "Only registered calls", text: "FocusTime reads no other meeting. Transcripts are kept 30 days." },
    ],
    faqs: ["What are client calls?", "How do I review a client call?", "It asks me to upload a transcript."],
  },
  settings: {
    lead: "Settings are yours. They save as you change them, and search at the top of the list finds any of them.",
    does: [
      { title: "Search settings", text: "Type at the top of Settings' list: it finds a setting by its name or its old name. × or Esc closes.", go: { href: "#/settings", label: "Open Settings" } },
      { title: "On your phone", text: "Day, Week, the round + to capture, the Inbox and Ask in the bar at the bottom. The dot at the top shows how your sources are. On Week and Day, + Add on a block opens its panel as a sheet; Backlog asks first.", go: { href: "#/day", label: "Open Day" } },
      { title: "Invite teammates", text: "Admins only: Admin › People shows who's set up, and Invite opens a message to send from FocusTime or in Teams or Outlook.", go: { href: "#/settings/admin-people/whos-set-up", label: "Open Who's set up" } },
      { title: "Send feedback", text: "⋯ › Send feedback: an idea, a problem or a question, as a story in the FocusTime backlog, after a preview." },
      { title: "Diagnostics", text: "Counts only, for your own chats, when a promise you expected is missing.", go: { href: "#/settings/data/diagnostics", label: "Open Diagnostics" } },
    ],
    extras: ["keys"],
    faqs: [
      "What works on a phone?",
      "What does the dot at the top mean?",
      "Why does Backlog ask first on a phone?",
      "How do I install it?",
      "How do notifications work?",
      "What do they say on my lock screen?",
      "Does it work offline?",
      "How do I find a setting in a short window?",
      "Do I need to save in Settings?",
      "Where do I add my DevOps write access?",
      "Can I stop my VM from FocusTime?",
      "Can FocusTime start my VM before my day?",
      'What does "Set by your FocusTime admin" mean?',
      "What can a FocusTime admin do?",
      "How do I see who's set up?",
      "How do I invite a teammate?",
      "Where does my level come from?",
      "Why isn't one of our accounts in my client list?",
      "Who shows as a Cooptimizer?",
      "How do I send an idea, a problem or a question?",
      "What is Diagnostics?",
      "Add any calendar by link",
      "What is the demo?",
      "Which version am I on?",
    ],
  },
};

/** UI-5: Your first day. The checklist reads guide.checklist (states only); the links open the real place. */
export const FIRST_DAY = {
  lead: "Seven things that make FocusTime yours. Each takes a minute or two, and none of them blocks the others.",
  checks: {
    hours: { title: "Your working hours", text: "FocusTime fits work into your hours and time zone. Standing blocks, like Monday morning for Internal, are on the same page.", go: { href: "#/settings/hours/weekdays", label: "Open Working hours" } },
    clients: { title: "Your clients", text: "They come from Focus Time in Dataverse. Check the list and each client's color.", go: { href: "#/settings/clients/client-list", label: "Open Clients" } },
    calendars: { title: "Your personal calendar", text: "Optional. Connect Google Calendar, or add any calendar by its link (iCloud, Outlook, school apps), so personal events count against your free time.", go: { href: "#/settings/connections/sources", label: "Open Accounts and calendars" } },
    devops: { title: "DevOps write access", text: "A personal access token per client lets FocusTime update DevOps when you confirm. Without one, that client stays read only.", go: { href: "#/settings/devops/devops-write", label: "Open DevOps" } },
    notify: { title: "Notifications", text: "Turn on Notify this device, or let FocusTime message you in Teams.", go: { href: "#/settings/notifications/devices", label: "Open Notifications" } },
    week: { title: "Add work to your week", text: "Week with a block's panel open: place features and stories on your blocks.", go: { href: "#/week/add", label: "Open Week" }, tour: "plan-week" },
    today: { title: "Add work to today", text: "+ Add on one of today's blocks puts stories on it.", go: { href: "#/day", label: "Open Day" }, tour: "today" },
  } satisfies Record<string, { title: string; text: string; go: { href: string; label: string }; tour?: string }>,
  states: { done: "Done", todo: "To do", skipped: "Skipped in setup", unknown: "" },
  progress: (n: number, of: number) => `${n} of ${of} done`,
  loading: "Checking your setup…",
  signedOut: "Sign in to see which of these are done for you.",
  demo: "In the demo these aren't checked: the demo's person is made up. Signed in, this list shows your own setup.",
  problem: "Your setup can't be read just now. Every link still works.",
  never: "This list only checks whether each one is set. It never shows a token or a key.",
  faqTitle: "Questions people ask on day one",
  faqs: ["Where do my clients and blocks come from?", "Can anyone else see my plan?", "What does FocusTime change in DevOps or Outlook?", "First run: what was that setup?", "Do I need to connect my personal calendar?", "Does FocusTime use AI?", "How fresh is what I see from DevOps?", "An item I made in DevOps isn't showing. Why?"],
};

/** UI-5: one list of names that changed. The command menu still finds every old one. */
export const RENAMED = {
  lead: "Names that changed. The command menu ({key:Ctrl K}) still finds the old ones.",
  was: "Was",
  now: "Now",
  rows: [
    ["Coopilot", "FocusTime"],
    ["Today (the tab)", "Day"],
    ["Plan the day, Plan today", "+ Add on a block"],
    ["Week › Plan (Plan the week, Commit)", "+ Add"],
    ["Details, Add work", "A block's panel"],
    ["Week › Board", "Week"],
    ["Week › Status", "Status (its own tab)"],
    ["Roadmap, Ahead", "Backlog"],
    ["Plan ahead", "Gantt"],
    ["Fix next, Gaps, Readiness", "Needs attention"],
    ["Ahead › Backlog", "Filter › Levels"],
    ["Sort later", "Decide later"],
    ["Pick (a planned piece of work)", "To-do"],
    ["Draft stories", "Break down"],
    ["Needs help from…", "Ask to collaborate"],
    ["Follow-up, Loop", "Promise"],
    ["Requests, Asks", "Conversations"],
    ["Inbox › Captures", "Captures and drafts"],
    ["Settings › Data (Undo and logs)", "Settings › Activity"],
    ["Settings › Planning", "Settings › Today and Week"],
    ["Settings › Connections", "Settings › Accounts and calendars"],
  ] as [string, string][],
};

/** UI-5: the Guide's search box (in the rail) and its results. */
export const SEARCH = {
  label: "Search the Guide",
  placeholder: "Search the Guide",
  none: (q: string) => `Nothing in the Guide for "${q}". Try fewer words, or ask the assistant.`,
  results: (n: number) => (n === 1 ? "1 result" : `${n} results`),
  in: (section: string) => `in ${section}`,
};

/** UI-5: each section's one line under its title. */
export const SECTION_LINES: Record<string, string> = {
  start: "What FocusTime is for, your day and your week.",
  "first-day": "Get set up, then the questions people ask on day one.",
  today: AREAS.today.lead,
  week: AREAS.week.lead,
  ahead: AREAS.ahead.lead,
  inbox: AREAS.inbox.lead,
  capture: AREAS.capture.lead,
  assistant: AREAS.assistant.lead,
  ask: AREAS.ask.lead,
  teams: AREAS.teams.lead,
  calls: AREAS.calls.lead,
  settings: AREAS.settings.lead,
  renamed: "Old names, and what they're called now.",
};

/** UI-5: the try-it sandboxes' words and example data (ui/guide/TryIt.tsx). Fictional, labeled as an example, kept in the page. */
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
    title: "Try it: the Timeline",
    sub: "Timeline shows each block's hours beside its to-dos. Turn it off and the to-dos get the whole width, with meetings listed by time.",
    toggle: "Timeline",
    block: { label: "Northwind · Mon PM", color: "teal" as ExampleColor, from: 13, to: 17 },
    meetings: [{ title: "Sprint review", from: 14, to: 15 }],
    todos: ["Export button", "Date filter"],
    listMeeting: (title: string, from: number) => `${from > 12 ? from - 12 : from}:00 ${title}`,
    hour: (h: number) => `${h > 12 ? h - 12 : h}:00`,
  },
  inbox: {
    title: "Try it: open an Inbox item",
    sub: "Pick a row. The pane shows what it is, why it needs you and its main action.",
    list: "Needs you · example",
    items: [
      { id: "1", client: "Northwind", kind: "Conversation", title: "Export misses the last day", why: "New, nobody has picked it up", summary: "Priya says the export stops a day early when the range ends on a Sunday. Sam asked if it's the time zone.", main: "Create DevOps item" },
      { id: "2", client: "Harbor", kind: "Promise", title: "Send the test plan to Alex", why: "Due today", summary: "You said you'd send the test plan before the Thursday call.", main: "Close the loop" },
      { id: "3", client: "Atlas", kind: "Sent to you", title: "Supplier onboarding", why: "Waiting for your answer · Must", summary: "Jordan sent this feature to your week as a Must, with the note \"blocked without you\".", main: "Accept" },
    ],
    pick: "Pick a row to open it here.",
    note: "In the app this button opens its preview first. Here nothing happens.",
  },
  assistant: {
    title: "Try it: ask the assistant",
    sub: "Pick a suggestion or type one of them. This one is scripted: no AI, nothing changes.",
    box: "Ask, or ask for a change",
    send: "Send",
    suggestions: ["What's next?", "Move the export stories to Friday", "Mark #4411 done and comment shipped"],
    answers: {
      next: { kind: "answer" as const, text: "Next is Export button (Northwind, Mon PM, M · 2h). Start focus is on Today." },
      move: { kind: "proposal" as const, title: "Move 2 to-dos to Friday", rows: ["Export button · Mon PM → Fri", "Date filter · Tue AM → Fri"], who: "Only your plan changes." },
      update: { kind: "proposal" as const, title: "Update #4411 in DevOps", rows: ["State: Active → Closed", "Comment: shipped"], who: "Everyone with access to Northwind's DevOps project sees the comment." },
      unknown: { kind: "answer" as const, text: "In the Guide I only know the three suggestions. In the app, ask in your own words." },
    },
    confirm: "Confirm",
    cancel: "Cancel",
    done: "Done ✓",
    undo: "Undo",
    cancelled: "Cancelled. Nothing changed.",
  },
  urgent: {
    label: "Example: the urgent strip",
    rows: [
      { tone: "risk", text: "Northwind: export misses the last day", meta: "Needs you now" },
      { tone: "watch", text: "Send the test plan to Alex", meta: "Due 2:00" },
      { tone: "watch", text: "Supplier onboarding · Must from Jordan", meta: "Waiting for you" },
      { tone: "faint", text: "Reply about the price list", meta: "Due 4:30" },
      { tone: "faint", text: "Atlas: invoice question", meta: "Needs you" },
    ],
    more: (n: number) => `${n} more in Inbox`,
    replay: "Play again",
  },
  ladderTitle: "How DevOps work is shaped",
};
