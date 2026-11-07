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

// ---------- Pools of questions, placed by area in SECTION_BODY below ----------

/** The sizing try-it, in Week. */
export const SIZING = {
  title: "Try it: how much fits in a block?",
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


export const DEVOPS = {
  title: "DevOps first",
  quote: ["If it isn't in DevOps, ", "it isn't planned yet."] as const,
  body: "FocusTime makes the healthy path the easy one. It reads your work from DevOps, nudges big things into smaller pieces, and offers to update DevOps when you finish. It never changes anything without showing you first.",
  // WT-1: levels come from each client's DevOps process, not type names; the icon is the type's usual DevOps icon.
  ladder: [
    { level: "Top", icon: "icon_crown", text: "Epics (or whatever the top level is called). Live in Ahead. Need features before they reach a week." },
    { level: "Parent", icon: "icon_trophy", text: "Features, and any type at the same level. Go on a week as a must or nice to have." },
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
    { q: "What does Break down do?", a: "On an item that {b:Needs stories}, {b:Break down} asks the AI to propose the child items it's missing. The button names the item's type, like {b:Break down Feature} or {b:Break down Recurring}. It opens a side panel: the item stays on the left (its state, priority, parent, description and any children it has) and the proposals fill the right, in three steps: Prepare, Review and Publish. Run never creates anything; nothing is written to DevOps until you press Create all." },
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
    { label: "Today, Week, Ahead, Inbox", keys: [{ command: "view.today" }, { command: "view.week" }, { command: "roadmap.load" }, { command: "view.inbox" }] },
    { label: "The tab's planning mode", keys: [{ command: "view.plan" }] },
    { label: "Capture a thought", keys: [{ command: "capture.add" }], all: true },
    { label: "Midday check-in", keys: [{ command: "view.checkin" }] },
    { label: "Close out", keys: [{ command: "closeout.load" }] },
    { label: "Week › Plan", keys: [{ command: "view.planweek" }] },
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
    { q: "Can I hide the hour rail on Week?", a: "Yes. Timeline, beside Board · Plan · Team · Status, shows or hides it in one click (B does the same, and it's in Week's ⋯ and Ctrl K). Hidden, each block uses its full width for its to-dos, lists its meetings and events with their times, and today's block still shows the now line. Dragging works the same. A block with late promises shows \"1 late\" or \"3 late\": one opens that promise, several open your late promises for that client in the Inbox. FocusTime remembers your choice." },
    { q: "Why are some days narrow strips on Week?", a: "On a smaller window, at a larger Text size or with the side panel open, the Board makes room before anything is cut: the hour rail turns into a slim ruler, then a thin bar under each block's name. Each day decides for itself, so the narrower catch-up day or a PTO day can show a slimmer rail than the others. When the five days still don't fit, the day you've selected and its neighbours stay open and the others fold into narrow strips. A strip still shows each half-day's client colour, an at-risk dot, PTO and catch-up, and the now line, and you can drop a story on it. Click a strip, or use the arrow keys, to open that day." },
    { q: "What works on a phone?", a: "The bar at the bottom has Today, Week, a round + to capture, the Inbox and Ask. Today comes first: the block you're in, your next meeting and your next to-do with Start and Done; the Midday check-in and Close out. Week one day at a time, with Plan today (day arrows, long-press to move a story, Confirm today); each to-do's title has its own line and the agenda is folded until you tap it. The Inbox, with every view and your promises; Coop brief and Break down. Plan opens read-only, with Copy link to finish on a computer. Ahead is made for a bigger screen: on a phone it asks first." },
    { q: "What's on Today on a phone?", a: "Now, at the top: the block you're in, until when and how much is left, the meeting under way or your next one, and your next to-do with big Start and Done. Between blocks it says Free until 1:00; after your last block, Day done. Then Needs you (at most 3 lines, then N more in Inbox), your to-dos grouped by block, and Next up for the rest of the day. Tap a to-do for Done, Move to tomorrow, Snooze to this afternoon, Add time or Open in DevOps. Each runs at once, and Undo is in the message that follows." },
    { q: "What does the dot at the top mean?", a: "On a phone, the dot beside FocusTime's mark says how your sources are: green when everything is live, amber when some data is older or a sample, red when a source needs you. Tap it to see each source and its age, DevOps per client and your VM, with Retry, Reconnect and Refresh. Connect or disconnect in Settings opens Accounts and calendars." },
    { q: "Why does Ahead ask first on a phone?", a: "Ahead's grids and timelines need a wide screen, so the phone's bar leaves it out. An Ahead link on a phone says Ahead is made for a bigger screen, with Open anyway (read only, for the rest of the session) and Back to Today." },
    { q: "How do I install it?", a: "On Android or in Chrome or Edge on a computer: ⋯ › Install app. On iPhone: tap Share in Safari, then Add to Home Screen, then Add. ⋯ › Install app shows the steps. Once installed it opens like an app, straight to Today." },
    { q: "How do notifications work?", a: "Every notification shows in ⋯ › Notifications, with a dot on ⋯ when there's something new, and as a short note at the bottom while FocusTime is open. To get them on a phone or computer when FocusTime is closed, open Settings › Notifications on that device and tap Notify this device; the browser asks first. On iPhone this works only in FocusTime from the home screen." },
    { q: "What do they say on my lock screen?", a: "Only what kind of thing it is, like Promises due or Plan the day: no client names, no work item titles. Turn on Show details in notifications in Settings › Notifications if you want those." },
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
    { q: "What's in Needs you?", a: "Conversations that wait on you: one you committed in, one you own, a new one nobody has picked up, or, for a client's lead, a promise nobody acted on (Unclaimed). Handled by teammates (folded) holds the ones someone else is on, and Closed the ones resolved or not a request. Each card has one main button (Create DevOps item, Link, Resolve, Take it over or Mark done) and the rest under ⋯. A conversation linked to an item moves to In progress." },
    { q: "How does AI sort them?", a: "With AI on for FocusTime and allowed for that client (a FocusTime admin sets both in Admin › AI), each batch of new messages goes to the AI once, with that chat's open conversations, and it says which conversation each message belongs to, writes the summary and notes who committed to what. Names are sent, never email addresses. It runs on FocusTime's shared budget, not yours. Small talk, reactions and a plain \"thanks\" never become conversations: they're under Filtered as chatter, where This is work puts one back." },
    { q: "Why are some messages unsorted?", a: "The AI budget is used up or set to $0, or the AI service didn't answer: those wait, the card says why, and Sort unsorted (N) sorts them once AI is back. With AI off for the client, rules group what they can (next question) and the rest waits the same way." },
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
    { q: "How is the Inbox laid out?", a: "One list with views. On the left: your clients (tick several, each with its count) and the views: Needs you, Promises, Waiting on, In progress, Captures and drafts, Handled by teammates, Done and Chatter. In the middle the list, grouped by client, due date or kind, late items first. On the right the open item: its summary, the messages, the linked item, commitments and every action, the main one first. The Inbox remembers your view, clients and grouping. On a phone, View and Clients are two buttons that open one picker, and an item opens as a sheet with one big main button." },
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


/** SW-1: sending work to someone's week, client priorities, Ask to look, and Week › Team. */
export const TEAM = {
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
    { q: "What does Week › Team show?", a: "For each client you're on: what each person planned this week (their features, must or nice to have, and the ones they're watching with whether they moved), the client's priorities and what was sent. Someone who hasn't confirmed yet shows Not confirmed yet. It never shows hours, estimates, day plans, to-dos, pins, notes or focus: those stay with each person. Account Workers and the client's leads see it; on a phone it is read-only." },
    { q: "How do I ask a lead to look at my week?", a: "In Week › Plan, Ask <lead> to look on the client, with an optional note. The lead gets a notification and sees it at the foot of their Team view, where they can reply. The reply shows on your Plan under the client." },
    { q: "Does checking off a to-do change DevOps?", a: "Not by itself. When you check off a to-do that has a DevOps item, on Today, the Board or Plan today, FocusTime asks \"Set #1234 to Closed?\" with the change shown before and after. The state comes from the item's own process: its done state, and Resolved too where the process has one. Confirm writes it as you; Not now leaves DevOps alone. It only asks for items you can change that aren't done already, and only for clients where you've turned on DevOps writes. Uncheck it soon after and FocusTime offers to undo that change too. Close out asks once for the day's done to-dos, with a box per item and one Confirm. Settings › Today and Week › When I check off a to-do: Never ask turns it off." },
    { q: "Where did Fix next and Sort later go?", a: "Renamed, nothing else changed. Ahead's Fix next is now Gaps (Grid · Gantt · Gaps), and the capture box's Sort later is now Decide later. Typing fix next or sort later in the command menu still finds them." },
    { q: "Where did picks go?", a: "Renamed, nothing else changed. A pick is now a to-do: one planned piece of work in a half-day block. Typing pick in the command menu still finds every to-do command, and the assistant understands pick and to-do the same." },
    { q: "Where did Needs help from… go?", a: "It's now Ask to collaborate, in the same places. It still finds teammates who are free and sends a help invite after a preview. Typing needs help in the command menu still finds it." },
  ],
};


/** TB-1 and TB-2: the FocusTime bot in a 1:1 Teams chat, and the short daily rhythm it can send. */
export const TEAMS_BOT = {
  title: "FocusTime in Teams",
  sub: "Ask FocusTime things in a chat with it in Teams, and, if you want, get a short morning brief, a midday check-in and a close out there.",
  items: [
    { q: "How do I start?", a: "Add FocusTime from Apps in Teams and send it any message, like \"what's next\". It answers only you, only in that 1:1 chat. Help lists what it understands; what's next and today work even without AI." },
    { q: "Can FocusTime message me first?", a: "Only if you ask it to. Settings › Notifications › In Teams: turn on Let FocusTime message me in Teams, then tick what you want: Morning brief, Midday check-in, Close out, Nudges, Client calls to review. All are off until you turn them on. They come only in your own chat with FocusTime, never on weekends or PTO days, never in quiet hours, and wait while focus runs. Friday only with Also on Fridays. Send me a test now sends one at once so you can see it." },
    { q: "What's in each one?", a: "The morning brief (at the start of your day, or a time you set): today's blocks, meetings, to-dos, promises due and work sent to you, with Confirm today and Move…. The midday check-in (12:00 unless you change it): this morning's to-dos with Done and Not yet, and Move the rest. Done on a to-do with a DevOps item asks, in the card, whether to set it done in DevOps too; nothing is written until you Confirm. Close out (30 minutes before your day ends unless you change it): today's to-dos; tick what got done or just tell it. Nudges: a promise due tonight that's still open, work sent to you waiting over half a day, or someone taking over an item assigned to you, together in one message, at most one an hour." },
    { q: "Does tapping a button change things right away?", a: "Done and Not yet on a to-do change only your own plan, at once, exactly like the buttons in the app, with Undo on the card. Anything bigger (moving to-dos, confirming today, closing out the day) shows the change first, with Confirm and Cancel, and nothing happens until you Confirm. Nothing in DevOps, Outlook or anywhere outside FocusTime changes without a Confirm." },
    { q: "Can I just tell it what I got done?", a: "Yes. While today's Close out is waiting, reply in your own words: \"all but the export\", \"1 and 3\", \"fixed the login timeout\". The card above fills in what it understood: the to-dos done, where the rest move (each to its client's next block, or the unfinished list when there's none this week) and the day closed out. One Confirm does all of it. FocusTime matches your words to the to-dos itself; no AI reads them." },
    { q: "How do I capture something from Teams?", a: "Start the message with capture: (or c:), for example \"capture: call Dana about the export\". It goes to the Inbox's Captures and drafts exactly as typed, to sort later, with Undo on the reply. Anything else you write goes to the assistant." },
    { q: "It says FocusTime can't message me in Teams.", a: "Teams told FocusTime the chat is blocked or the app was removed, so Let FocusTime message me in Teams turned itself off. Add FocusTime again in Teams, send it a message, then turn the switch back on." },
  ],
};


export const QUESTIONS = {
  title: "Questions people ask first",
  items: [
    { q: "What are Ahead's Grid, Gantt and Gaps?", a: "Three views of the same features and epics (and your stories, in Grid). Grid is a table: state, dates, who it's assigned to, size and what's missing, edited in place; on a narrower window Start and Target share one Dates column, Readiness becomes dots (hover for the words), and below about 900 pixels each item is a two-line card. Gantt is the timeline: drag a bar by half-days to move its dates, with your free hours per week below. Gaps is its own mode, with its count in the switch (Gaps · 7). Mine, Contributing and All choose whose items show; FocusTime remembers your choice." },
    { q: "What is Ahead's Backlog?", a: "Each client's DevOps backlog in the client's own stack rank, the order their board shows, one level at a time: Stories, Features or Epics. Clients sit side by side on a wide screen and one under another on a narrow one; choose clients with the chips at the top. Each row shows its rank, title, state, who it's assigned to, target date, size, when it last changed in DevOps (and what changed, for the last 30 days) and a dot for anything missing, as in Gaps. Mine, Contributing and Everything in scope choose whose items show; Everything in scope is Cooptimize's work in the project, not the whole project. FocusTime never reorders the backlog; a project with no backlog order is listed by target date and says so." },
    { q: "What does Stale mean?", a: "An open item nobody has changed in DevOps for 6 weeks or more: no state change, no comment, no edit of any kind. Done items are never stale. Each client shows how many it has (\"3 stale\"), the Stale chip shows only those, and you choose the number of weeks in Settings › Ahead. Stale isn't a problem to fix by itself: push its target date out, give it an owner, or plan it so it gets some time." },
    { q: "What can I do with several items at once in Backlog?", a: "Tick rows (or a client's whole list) and choose: push the target date by 2 or 4 weeks, move it to a date, set a target date only where there's none, or assign to me. These go into your changes to save like any Ahead edit, so nothing reaches DevOps until you Review and save, with the preview, the check afterwards and Undo. Items you can't change are left out, with the reason under Why items were skipped; the preview names who each item is assigned to when it isn't you. Plan it puts the ticked stories on next week's Plan as nice to haves, with Undo." },
    { q: "What does Gaps list, and in what order?", a: "Items you can change that are missing stories, a target date, an owner or a size, and only the ones that matter now: near the top of the client's DevOps backlog (the top 30 of each level, epics, features and stories, a number your FocusTime admin can change), dated in the next 4 weeks, or features and epics you own (and the features under your epics). They're in the client's backlog order, ties by target date, grouped by client, then epic and feature. Each row has one next step (Break down, Set dates, Assign or Size) and Skip; the first 10 per client show, then Show more. A project with no backlog order is ranked by target date and says so. An admin can turn any of the four gaps off for a client in Admin › Clients, for a client that doesn't size stories, say." },
    { q: "Someone shows as Ext-Name in DevOps. Is that one of us?", a: "Often: many clients give us a login of their own in their DevOps. FocusTime counts that login as the person, so their items are theirs in Mine, Contributing, Team and notes, and their FocusTime name shows instead of the login. It knows a login from the person's Account Worker record in Dataverse, or because a FocusTime admin confirmed it in Admin › People, where logins that look like a Cooptimizer's are suggested for a confirm and the rest can be linked to a person. A suggestion is never applied without that confirm." },
    { q: "Why doesn't Ahead show everything in a client's DevOps project?", a: "A client's project often holds much more than our work, so Ahead, Gaps and Week's lists show Cooptimize's work in it. A FocusTime admin sets that per client in Admin › Clients: the whole project, some DevOps teams, or some area paths. Until then FocusTime works it out: items assigned to Cooptimizers, everything under epics and features a Cooptimizer owns, and the area paths where Cooptimizers have items. Items assigned to you always show. Show the whole project brings in the rest, marked Outside scope, and FocusTime remembers it for you; Gaps never lists items outside the scope." },
    { q: "When do my Ahead changes reach DevOps?", a: "Only when you save. Every edit in Grid, Gantt or Gaps goes into your pending changes first. Review lists them with before and after; Save sends them to DevOps per client with a preview, checks each one afterwards, and you can undo any of them from the Saved list or Settings › Activity. If someone changed the same field in DevOps since you started, Review shows both and you choose Keep mine or Take theirs." },
    { q: "What can I change in Ahead?", a: "Your own items, the features directly under an epic you own, and anything on a client you lead. Everything else shows Read-only. A teammate you assign gets a quiet note in FocusTime, and so does the owner of an item whose dates you moved." },
    { q: "How fresh is what I see from DevOps?", a: "FocusTime reads each client's DevOps once for everyone, about every minute in working hours and every 10 minutes outside them while someone is using it, and only what changed. If a read fails, you keep seeing the last good one with \"Showing items from\" and its time. Press {key:week.load} or Refresh for a check now; within 30 seconds of someone else's, you see that one. A change you make from FocusTime shows at once." },
    { q: "Where do my clients and blocks come from?", a: "From Focus Time in Dataverse, the schedule Cooptimize already keeps. If a block is wrong, change it there and FocusTime picks it up on the next refresh." },
    { q: "What does FocusTime change in DevOps or Outlook?", a: "Only what you confirm. Every change shows a preview first, is checked afterwards, and can be undone from Settings › Activity. In Outlook it only edits events it created, or your own events with no one else on them. It never deletes anything in DevOps." },
    { q: 'Why is "over" amber and not red?', a: "Because plans change and that's normal. Red is only for real trouble, like a block at risk or a promise that's overdue." },
    { q: "Do I have to size everything?", a: "No. Unsized stories count as 2h so the plan still adds up, and nothing waits on a size. Size them when you know." },
    { q: "How do I plan stories into Week's blocks?", a: "Click a block on Week. The panel lists your open stories for that client, grouped under their features: this week's features first, then the rest in DevOps order. Drag a story onto any of this week's blocks for that client, Friday's catch-up included. While you drag, the block shows the fit, like \"2h of 3h free\" or an amber \"1h over\"; PTO, past half-days and other clients' blocks say no. Drag a story from a card to another block to move it. Each drop has Undo. Without a mouse, use Add to… or Move to… (the drag handle or ⋯); on a tablet, press and hold; on a phone, Add to…. A story planned elsewhere stays in the list as \"Planned · Thu AM\", which opens that block." },
    { q: "This week's feature says No stories for you yet. Now what?", a: "Type a title in Add a story for me and press Enter (a size is optional). You see the DevOps preview; Create makes the story under the feature, assigned to you, and puts it in the block you're on. Not now leaves nothing behind. Break down opens the Break down panel for the feature, where AI can propose its stories. If teammates have stories there, Take one assigns one to you after a preview: the person who had it gets a quiet note in FocusTime, and Undo in Settings › Activity gives it back. Without DevOps write access for that client, the panel says where to add it." },
    { q: "What is From last week?", a: "When a new week starts, Week's Board and Plan show last week's features per client with one suggestion each. A feature with your open stories carries over as a must, with those stories. One that's resolved or closed shows as Finished last week. If your stories are done, or were never yours, the feature's owner and the client's leads get Watching; anyone else sees Your part is done (with Keep watching) or Not yours yet (with Take one). A feature with no stories asks the owner or a lead to break it down. Nothing is added until you press Keep, Watch or Accept all, and a row you drop doesn't come back that week." },
    { q: "What are the dashed cards on Week's Board?", a: "Unfinished to-dos from earlier days this week, suggested in the client's next block you can still plan (never a PTO day, the catch-up day or a block with no working hours). They say where they came from (From Mon) and don't count against the block until you keep them. Click one for Keep here, Move to… or Drop, or drag it like any card; each can be undone. Keep all keeps every suggestion, and Review lists them by client and feature. The block they came from shows them dimmed with where they went. Nothing moves on its own." },
    { q: "How do I write my updates for Monday's status report?", a: "Week › Status (the fourth mode, after Team) shows what Monday's report will say for your features: the ones you planned this week and any whose story you touched, by client. Preview shows it as the report's email will, a heading per feature with each comment this week as a bullet and its author; No update yet where there's none. In Edit, + Add a line on a feature (each line becomes its own DevOps comment), or Edit one of your own comments from this week. Draft writes a first version from your story changes, close-out notes and captures when AI is on for the client; edit it as you like. Push all shows every new line and edit in one preview, then writes them; each line has its own result, Retry and Undo. FocusTime never sends the report: it goes out Monday at 7:00 AM, as it always has." },
    { q: "Which comments count as this week's?", a: "The ones added or edited since that client's report was last sent, as Monday's report counts them. When FocusTime can't read when that was, it counts from the last Monday at 7:00 AM Eastern and says so on the client. Teammates' and Coop's comments show but can't be edited, and you can only edit your own from this week. Settings › Notifications can remind you on Friday afternoon (and Sunday evening) when some features have no update yet, in the app or in Teams." },
    { q: "Why are some unfinished to-dos in a list instead?", a: "When the client has no block left this week, its unfinished to-dos go in Unfinished from earlier days, grouped by client and feature. Drag one onto any block or use Move to…. To-dos from an earlier week fold under From last week the same way." },
    { q: "What is the line across today?", a: "The time now, on today's blocks, with the time at its left end. The part of today that has passed is a little dimmer. Before or after your hours it sits at the top or bottom edge of the day; on a PTO or catch-up day it is thinner. Today's agenda and Plan today show it as a row in time order. Click the time to bring today into view on a narrow screen or the phone." },
    { q: "What does Watching mean?", a: "You're keeping a feature moving without doing its stories. Each Watching row gets a 30-minute check-in on the client's first block of the week that hasn't ended. It counts in the week's hours at once, shows on the Board as a dashed Check-in chip, and becomes a to-do when you plan that day. Move it or remove it from the chip or the row; the row stays. If none of its stories changed state since Monday, from Wednesday the row turns amber, \"No movement this week\", with who to check in with: the Cooptimizer with the most open stories on it. Until FocusTime has a week of DevOps changes it says Movement not known yet." },
    { q: "What is Keep open?", a: "A share of a client's block hours left unplanned for walk-in work, from None to 50%, on the client's card in Plan. Your level may set a default. \"Keeping 30% open for walk-ins\" lowers how much you plan up to, and the amber over line uses the lower number." },
    { q: "What's a block, then?", a: "Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours." },
    { q: "Do I need to connect my personal calendar?", a: "No. Google Calendar is optional. If you connect it, personal events count against your free time so the plan stays realistic, and you can hide them with {key:ui.set_show_personal}." },
    { q: "Can anyone else see my plan?", a: "No. Your plan, notes, promises and settings are yours. Teammates only ever see your free and busy times and your Teams presence, the same as in Outlook and Teams today." },
    { q: "First run: what was that setup?", a: "Four short screens the first time you sign in: Your day, Your clients, Standing blocks and Calendars. Every one has Skip and Back, and closing it skips the rest. Today shows a quiet line while steps are left, and Settings › Profile › Run setup again runs it again." },
    { q: "Which version am I on?", a: "⋯ › About: one line with where it runs, the pull request, the commit and when it was built, and a Copy button for sending it to the FocusTime team." },
    { q: "How does FocusTime know I'm off?", a: "PTO in Dataverse is a whole day off. Out of office in Outlook over a whole morning or afternoon makes that half PTO. A PTO half has no free time and nothing can be planned on it; a must already pinned there stays, marked \"Pinned to PTO, move it\"." },
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
      { name: "Plan today", text: "In the morning, put stories on today's blocks and Confirm today.", teams: true },
      { name: "Focus", text: "What's next has one Start focus. The urgent strip above it shows what's due now.", teams: false },
      { name: "Check it off", text: "Tick a to-do when it's done. FocusTime offers the DevOps update.", teams: false },
      { name: "Midday check-in", text: "After lunch, re-fit what's left. Anything that won't fit gets one suggested move.", teams: true },
      { name: "Close out", text: "One line per client on where you left off, and the DevOps updates you owe.", teams: true },
    ],
    teams: "Also in Teams",
  },
  week: {
    title: "Your week, in three",
    steps: [
      { name: "Plan", where: "Week › Plan", text: "Thursday or Friday: choose the features you'll touch next week, client by client.", tour: "plan-week" },
      { name: "Board", where: "Week › Board", text: "Put to-dos on your half-day blocks. Timeline shows each block's hours.", tour: "board" },
      { name: "Status", where: "Week › Status", text: "Before Monday's status report, write a line per feature. It goes to DevOps as a comment.", tour: "status" },
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
  card: { client: "Northwind", color: "teal" as ExampleColor, fit: "9h planned · 11h free", musts: [{ title: "Order history export", hours: "about 6h" }, { title: "Invoice totals", hours: "3h" }], nice: "Nice to have · 1" },
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
    "ask-answer": { head: "What's next?", meta: "", color: null, rows: [["Export button", "Northwind · Mon PM · M"], ["Then: Date filter", "S · 1h"]], actions: ["Open Today"] },
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
  { q: "How do I invite a teammate?", a: "In Admin › People, Invite on their row (or tick several and Invite several) opens a message to edit, with FocusTime's link and the first three steps. Open in Teams starts a chat with them, Open in Outlook starts an email, or Copy message. FocusTime doesn't send it: you do. The row then shows Invited <day> by <you>, and you can invite them again any time. In {key:Ctrl K}: Invite, or Who's set up." },
  { q: "What is the moment card?", a: "Today's one card for the moment of the day: Plan today until the day is confirmed, Midday check-in once your afternoon starts, and Close out near the end of your day. Each opens its flow; once it's done it's a small line with Reopen. Nothing is forced: skip any of them." },
  { q: "Can I look at another day?", a: "Yes. ‹ and › (or [ and ]) step to another day, and Back to today comes back. Other days are read only. A PTO day says you're off, with nothing nagging." },
  { q: "Does the assistant ever change something on its own?", a: "No. Every change is a proposal with the same preview as the button, and runs only when you Confirm. What it reads from chats, DevOps or captures is information for it, never instructions." },
  { q: "Can it change several things at once?", a: "Yes. It can move several to-dos at once, across clients (\"Push everything from today to tomorrow\"), with one Confirm and one Undo. On one item it can do up to three things in one card, like mark it done and add a comment. Any it can't put back because you worked on them since are listed." },
  { q: "What happens when it isn't sure what I mean?", a: "It asks one short question with a few choices made from your own clients, blocks and items, plus \"or type it\". Tap one, or answer in your own words." },
  { q: "What does the assistant need?", a: "AI for FocusTime, which your FocusTime admin turns on, and Allow AI for the client it's about. Your history stays 30 days; clear it in Settings › AI and assistant." },
  { q: "What is Diagnostics?", a: "Settings › Your data › Diagnostics, or Diagnostics in {key:Ctrl K}. Counts only, for your own chats: why a conversation where someone said they'd do something has no promise of yours, why messages of yours that sounded like a promise have none, and where your chats' messages were sorted in the last 14 days. It never shows message text, and Copy as text copies only the counts." },
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

export const AREAS: Record<"today" | "week" | "ahead" | "inbox" | "capture" | "assistant" | "teams" | "calls" | "settings", AreaBody> = {
  today: {
    lead: "Today is your day on one screen: what's next, what's urgent, and the moment of the day.",
    does: [
      { title: "What's next", text: "The next to-do in the block you're in has the one Start focus button. Focus sets your Teams status to Busy and counts the time.", go: { href: "#/today", label: "Open Today" }, tour: "today" },
      { title: "The urgent strip", text: "Under what's next: conversations that need you now, promises late or due within 2 hours, and work sent to you. It shows the 3 most urgent, then \"N more in Inbox\"." },
      { title: "One moment card", text: "Plan today in the morning, Midday check-in after lunch, Close out at the end of the day. Each opens its flow; done, it's a small line with Reopen." },
      { title: "Check it off", text: "Tick a to-do when it's done. When it has a DevOps item you can change, FocusTime asks whether to set it done there too." },
      { title: "Any day", text: "‹ › step to other days, read only, and Back to today comes back. A PTO day just says you're off." },
    ],
    extras: ["urgent"],
    faqs: ["What is the moment card?", "What's on Today on a phone?", "What's in Today's urgent strip?", "Can I look at another day?", "Does checking off a to-do change DevOps?", "What is the line across today?", "How does FocusTime know I'm off?", "Why can't I move some of my old timeboxes?"],
  },
  week: {
    lead: "Week holds your half-day blocks and the plan for them, in four modes: Board, Plan, Team and Status.",
    does: [
      { title: "Board", text: "Your blocks, each a half-day for one client. Click one for that client's stories, and drag a story onto any of its blocks this week. Timeline ({key:ui.set_show_timelines}) shows or hides each block's hours.", go: { href: "#/week", label: "Open the Board" }, tour: "board" },
      { title: "Plan", text: "Thursday or Friday: one client at a time, choose next week's features as musts or nice to haves, then Confirm week.", go: { href: "#/week/commit", label: "Open Week › Plan" }, tour: "plan-week" },
      { title: "Team", text: "What everyone on your clients planned this week, the client's priorities and what was sent. Never hours or to-dos: those stay yours.", go: { href: "#/week/team", label: "Open Week › Team" } },
      { title: "Status", text: "Before Monday's status report, a line per feature, saved in DevOps as a comment. Preview shows the report as it will read.", go: { href: "#/week/status", label: "Open Week › Status" }, tour: "status" },
      { title: "Send work to someone", text: "⋯ › Send to… on a feature or story, for this week or next. They answer from Plan's From your team." },
    ],
    extras: ["ladder"],
    tryIts: ["drag", "timeline", "sizing"],
    faqs: [
      "How do I plan stories into Week's blocks?",
      "This week's feature says No stories for you yet. Now what?",
      "What is From last week?",
      "What are the dashed cards on Week's Board?",
      "Why are some unfinished to-dos in a list instead?",
      "Can I hide the hour rail on Week?",
      "Why are some days narrow strips on Week?",
      "Do I have to size everything?",
      'Why is "over" amber and not red?',
      "What is Keep open?",
      "What does Watching mean?",
      "What's a block, then?",
      "How do I write my updates for Monday's status report?",
      "Which comments count as this week's?",
      "How do I send work to someone?",
      "Who can send a Must?",
      "What do I do with something sent to me?",
      "What if I can't take a Must?",
      "Does Accept change DevOps?",
      "How do I see what I sent?",
      "What is a client priority?",
      "What does Week › Team show?",
      "How do I ask a lead to look at my week?",
    ],
  },
  ahead: {
    lead: "Ahead looks past this week: the features and epics you own or work on, and what they're missing.",
    does: [
      { title: "Mine, Contributing, All", text: "Choose whose items show. FocusTime remembers your choice.", go: { href: "#/ahead", label: "Open Ahead" }, tour: "ahead" },
      { title: "Grid and Gantt", text: "Grid is a table of state, dates, owner and size, edited in place. Gantt is the timeline: drag a bar to move its dates.", go: { href: "#/ahead/gantt", label: "Open Gantt" } },
      { title: "Gaps", text: "Items missing stories, a target date, an owner or a size, near the top of each backlog. Each row has one next step.", go: { href: "#/ahead/fix", label: "Open Gaps" } },
      { title: "Backlog and Stale", text: "Each client's backlog in its own order. Stale marks open items nobody changed in DevOps for 6 weeks.", go: { href: "#/ahead/backlog", label: "Open Backlog" } },
      { title: "Changes wait until you save", text: "Edits collect as \"N changes to save\". Review shows before and after; Save writes them to DevOps, with Undo." },
    ],
    faqs: [
      "What are Ahead's Grid, Gantt and Gaps?",
      "What does Gaps list, and in what order?",
      "What is Ahead's Backlog?",
      "What does Stale mean?",
      "What can I do with several items at once in Backlog?",
      "When do my Ahead changes reach DevOps?",
      "What can I change in Ahead?",
      "Why doesn't Ahead show everything in a client's DevOps project?",
      "Someone shows as Ext-Name in DevOps. Is that one of us?",
    ],
  },
  inbox: {
    lead: "The Inbox is one list of what needs a decision: conversations from client chats, your promises, work sent to you and your captures.",
    does: [
      { title: "Views and clients", text: "Needs you, Promises, Waiting on, In progress, Captures and drafts, Handled by teammates, Done and Chatter. Tick clients on the left.", go: { href: "#/inbox", label: "Open the Inbox" }, tour: "inbox" },
      { title: "Why it's here", text: "Each row says why it needs you: you said you'd do it, you own it, nobody picked it up, or it's due. Late ones come first." },
      { title: "The open item", text: "On the right: its summary, the messages, the linked item, commitments and every action, the main one first." },
      { title: "Create a DevOps item", text: "From a conversation or promise without one. With AI allowed for the client the form is drafted for you. Nothing is written until you confirm the preview." },
      { title: "Close the loop", text: "Send the update from the promise: Teams, email, a DevOps comment or a call note. FocusTime drafts it, you edit it, and the preview shows who will see it before anything is sent. Close without sending still works." },
    ],
    tryIts: ["inbox"],
    faqs: [
      "How is the Inbox laid out?",
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
      { title: "Into DevOps", text: "Create in DevOps shows your words and the AI version side by side. Edit, choose the parent, confirm the preview.", go: { href: "#/inbox/captures", label: "Open Captures and drafts" } },
      { title: "Break down", text: "On an item that needs stories, AI proposes the child items. Edit the cards; nothing is created until Create all." },
    ],
    faqs: ["Quick capture from anywhere?", "What does Break down do?", "What is sent to the AI?", "What do I choose in Prepare?", "What is the house style?", "How do I review the proposals?", "What happens when I press Create all?", "Why can't I break an item down?"],
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
      { title: "On your phone", text: "Today, Week, the round + to capture, the Inbox and Ask in the bar at the bottom. The dot at the top shows how your sources are. Plan is read only there, with Copy link; Ahead asks first.", go: { href: "#/today", label: "Open Today" } },
      { title: "Invite teammates", text: "Admins only: Admin › People shows who's set up, and Invite opens a message for you to send in Teams or Outlook.", go: { href: "#/settings/admin-people/whos-set-up", label: "Open Who's set up" } },
      { title: "Send feedback", text: "⋯ › Send feedback: an idea, a problem or a question, as a story in the FocusTime backlog, after a preview." },
      { title: "Diagnostics", text: "Counts only, for your own chats, when a promise you expected is missing.", go: { href: "#/settings/data/diagnostics", label: "Open Diagnostics" } },
    ],
    extras: ["keys"],
    faqs: [
      "What works on a phone?",
      "What does the dot at the top mean?",
      "Why does Ahead ask first on a phone?",
      "How do I install it?",
      "How do notifications work?",
      "What do they say on my lock screen?",
      "Does it work offline?",
      "How do I find a setting in a short window?",
      "Do I need to save in Settings?",
      "Where do I add my DevOps write access?",
      'What does "Set by your FocusTime admin" mean?',
      "What can a FocusTime admin do?",
      "How do I see who's set up?",
      "How do I invite a teammate?",
      "Where does my level come from?",
      "Why isn't one of our accounts in my client list?",
      "Who shows as a Cooptimizer?",
      "How do I send an idea, a problem or a question?",
      "What is Diagnostics?",
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
    calendars: { title: "Your personal calendar", text: "Optional. Connect Google Calendar so personal events count against your free time.", go: { href: "#/settings/connections/sources", label: "Open Accounts and calendars" } },
    devops: { title: "DevOps write access", text: "A personal access token per client lets FocusTime update DevOps when you confirm. Without one, that client stays read only.", go: { href: "#/settings/devops/devops-write", label: "Open DevOps" } },
    notify: { title: "Notifications", text: "Turn on Notify this device, or let FocusTime message you in Teams.", go: { href: "#/settings/notifications/devices", label: "Open Notifications" } },
    week: { title: "Plan your week", text: "Week › Plan: one client at a time, then Confirm week.", go: { href: "#/week/commit", label: "Open Week › Plan" }, tour: "plan-week" },
    today: { title: "Plan today", text: "Put stories on today's blocks, then Confirm today.", go: { href: "#/week", label: "Open the Board" }, tour: "board" },
  } satisfies Record<string, { title: string; text: string; go: { href: string; label: string }; tour?: string }>,
  states: { done: "Done", todo: "To do", skipped: "Skipped in setup", unknown: "" },
  progress: (n: number, of: number) => `${n} of ${of} done`,
  loading: "Checking your setup…",
  signedOut: "Sign in to see which of these are done for you.",
  demo: "In the demo these aren't checked: the demo's person is made up. Signed in, this list shows your own setup.",
  problem: "Your setup can't be read just now. Every link still works.",
  never: "This list only checks whether each one is set. It never shows a token or a key.",
  faqTitle: "Questions people ask on day one",
  faqs: ["Where do my clients and blocks come from?", "Can anyone else see my plan?", "What does FocusTime change in DevOps or Outlook?", "First run: what was that setup?", "Do I need to connect my personal calendar?", "Does FocusTime use AI?", "How fresh is what I see from DevOps?"],
};

/** UI-5: one list of names that changed. The command menu still finds every old one. */
export const RENAMED = {
  lead: "Names that changed. The command menu ({key:Ctrl K}) still finds the old ones.",
  was: "Was",
  now: "Now",
  rows: [
    ["Coopilot", "FocusTime"],
    ["Plan the day", "Plan today, on Week's Board"],
    ["Commit (in Week)", "Plan, and Confirm week"],
    ["Roadmap", "Ahead, and its Grid"],
    ["Plan ahead", "Ahead › Gantt"],
    ["Fix next", "Ahead › Gaps"],
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
    sub: "Drag a story onto one of Northwind's blocks, or use its Move to buttons. The block shows the fit as you go.",
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
    fit: (planned: number, free: number) => (planned > free ? `about ${Math.round((planned - free) / 60)}h over` : `${Math.round(planned / 60)}h of ${Math.round(free / 60)}h free`),
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
