# GU-1: the app as it is (what the Guide is checked against)

Taken from the code on `origin/main` at 2f4c0ea1 (after RS-1), by reading the lists the app itself draws from. Where a list is built in code the file is named, so a later check can read the same place. `ui/guide/app-names.test.ts` reads these same sources, so the Guide fails a test when it uses a name the app doesn't have.

## Tabs and their switches

`ui/nav.ts` (`TABS`, `TAB_NAMES`, `MODES`, `INBOX_LISTS`), the top bar in `ui/App.tsx`.

| Key | Tab | Icon | Address | Switches and header controls |
|---|---|---|---|---|
| 1 or T | Day | day | `#/day`, `#/day/<date>`, `#/day/<date>/<AM or PM>` (the panel on a block), `#/day/checkin`, `#/day/closeout` | Previous day and Next day (round icon buttons), the date, the Today pill, Today (a small button, on another day); Cards and Timeline (a switch, B); Timebox my day (quiet); Add (the filled button); View options for Day (round, the More icon) |
| 2 | Week | week | `#/week`, `#/week/<monday>`, `#/week/day/<date>/<AM or PM>` (the panel on a block), `#/week/add` | Previous week and Next week; the week's title; This week (on another week); Cards and Timeline (a switch, B); Add (filled); View options for Week (round, the More icon) |
| 3 | Backlog | backlog | `#/backlog`, `#/backlog/gantt`, `#/backlog/item/<id>`; `#/backlog/attention` and `#/backlog/stories` turn a filter on | Grid and Gantt (a switch, P); Refresh; New; "N changes to save" with Review; client chips; Mine, Contributing, Everyone (a switch); Needs attention (a chip with its count); search (Titles or #id); Filter; More: rows and view |
| 4 | Status | status | `#/status`, `#/status/needs` | Edit and Preview (a switch); My features and <Client> report (a switch, the client's side a list); Push all; per client Draft all; per feature Add a line and Draft |
| 5 or L | Inbox | inbox | `#/inbox`, `#/inbox/chats`, `#/inbox/promises`, `#/inbox/captures`, `#/inbox/item/<key>` | From chats, Promises, Captures (a switch with counts); client chips (All clients, then each client) |

On the phone the bottom bar is Day, Week, the round Capture button, Inbox and Ask; Status and the rest are in More (`ui/Phone.tsx`, `ui/App.tsx`).

## The top bar

| Control | Name in the app | What it is |
|---|---|---|
| The mark and FocusTime | Day (its tooltip) | opens Day |
| Demo data | Demo data | a tag in the demo; opens Settings › Your data |
| VM chip | "VM <state>" | a quiet pill; its menu: Start, Stop…, Allow Azure access…, Auto-start: <when>, Skip this one, Refresh, Choose another VM… or Find my VM… (`ui/Account.tsx`) |
| Focus | Focus (F) | outlined, with the focus icon; running, it is the countdown |
| Capture | Capture (N) | outlined, with the capture icon |
| Ask | Ask (Ctrl J) | outlined, with the ask icon |
| More | "More: the Guide, commands and keyboard shortcuts" | round, the More icon |
| The photo | "Signed in as <name>" | its menu: Settings (,), Sign out |

## More (the top bar's menu)

`ui/App.tsx`. On a computer: Notifications, Commands (Ctrl K), Guide (?), Technical docs, Code (when there is code to read), Keyboard shortcuts, Send feedback, Admin (admins only), Install app (when the browser offers it), About.

On the phone: the person's name (Settings, Sign out), Status, Notifications, Start focus or Focus screen, Settings, Admin (admins only), Guide, Technical docs, Code, Install app, About.

Settings is not in More on a computer: it is in the photo's menu, the comma key, and the command menu. Client calls is not in More: it opens from a call's mark on Week, its note, the command menu (My client calls) and `#/meetings`.

## View options (the round More button in Day's and Week's header)

Week ("View options for Week", `ui/App.tsx`): Timelines (Business hours, 12 hours, 24 hours; V); Show: Personal events (G), Suggestions, Timeline (B); Days: Show <catch-up day's name>, Show weekend, Every weekend day.

Day ("View options for Day", `ui/Day.tsx`): Personal events (G), Suggestions, Timeline (B).

## Menus on things

| Thing | The button's name | Where |
|---|---|---|
| A block | "Actions for <day> <AM or PM>" (the More icon on the card's header) | `ui/BlockCard.tsx`; the menu is `slotMenu` in `ui/menu.ts` |
| A day (Week's day header) | "Actions for <day>" | `ui/WeekGrid.tsx`; `dayMenu` |
| A to-do, a story, a feature, a promise, an Inbox row | "More for <title>" | `ui/PickRow.tsx`, `ui/BlockPanel.tsx`, `ui/FollowUps.tsx`, `ui/inbox/` |
| The block panel | "More for <block>" | `ui/BlockPanel.tsx` |
| A story card | "More for this item" | `ui/StoryCardEdit.tsx` |
| Backlog's toolbar | "More: rows and view" | `ui/ahead/Toolbar.tsx` |

## Screens with their own address

`ui/nav.ts` (`hashOf`, `parseHash`).

| Screen | Address | Opens from |
|---|---|---|
| Day, Week, Backlog, Status, Inbox | as above | the tabs, 1 to 5 |
| Midday check-in | `#/day/checkin` | Day's moment card, M |
| Close out | `#/day/closeout`, `#/day/closeout/<date>` | Day's moment card, E |
| The focus screen | `#/focus` | the running timer in the top bar, F |
| A story card | `#/item/<client>/<id>` | any work item's title |
| Settings and Admin | `#/settings`, `#/settings/<section>`, `#/settings/<section>/<setting>`, `#/settings/client/<key>` | the photo's menu, the comma key; Admin from More |
| Guide | `#/guide`, `#/guide/<section>`, `#/guide/contents` (the phone's list), `#/guide/tour/<id>` | More › Guide, ? |
| Technical docs | `#/docs`, `#/docs/<page>/<heading>` | More › Technical docs |
| Code | `#/code`, `#/code/<client>/<repo>/<path>` | More › Code |
| Client calls | `#/meetings`, `#/meetings/<occurrence>` | a call's mark on Week, the command menu |
| DevOps patterns | `#/patterns` | the command menu (when turned on for the person) |
| Team | `#/week/team` | hidden for now (WD-1); its address still opens |

Not addresses (they open over a screen): the block panel beside Week or Day (its address is the block's), the command menu (Ctrl K), Capture (N), the assistant (Ctrl J), the New form (Shift N), Notifications, Keyboard shortcuts, Send feedback, About.

## Icon buttons and their names

Round buttons with only an icon; the name is what a screen reader says and what the tooltip shows. From every `<button>` in `ui/` whose only child is an icon.

| Icon | Names |
|---|---|
| more | More (the top bar); View options for Day, View options for Week; Actions for <block>, Actions for <day>; More for <title> (a to-do, a story, a feature, a promise, an Inbox row); More for this item (a story card); More: rows and view (Backlog); More: Expand all, Collapse all |
| back, next | Previous day, Next day; Previous week, Next week; Previous month, Next month (the date picker); Back (a menu's step, Send feedback) |
| add | Add <title> or Move <title> here (a row in the block panel); Place <feature> on this block; Keep <title> (a suggestion); More: <hours> (the hours stepper); Capture (the phone's round button) |
| minus | Less: <hours> (the hours stepper) |
| close | Close (dialogs and panels, Esc); Dismiss (a note or an offer); Clear <title> (a suggestion); Clear the search; Remove <name>; Unlink #<id>; Drop <title> (a timebox suggestion) |
| done | Accept <title> (a timebox suggestion) |
| enter | Save (Capture) |
| arrow-up, arrow-down | Move up, Move down (Break down's cards; a deployment's items) |
| closed, open | Show or Hide what's under <title> (Backlog's rows); folds everywhere |
| bold, italic, bullets, numbers, link | Bold, Italic, Bullets, Numbers, Link (the story card's edit boxes) |

Buttons with an icon and a word: Add (Day's and Week's header, each block), New (Backlog), New under (a Backlog row), Add a line and Add a feature (Status), Focus, Capture, Ask, Join (a live call).

## Settings and Admin sections

| Group | Section | Address | Settings in it |
|---|---|---|---|
| You | Profile | `#/settings/you` | Signed in; Photos; Email; Dataverse user; Dataverse environment; Run setup again |
| You | Working hours | `#/settings/hours` | Hours per day; Lunch; Time zone; One-day changes; Standing blocks |
| You | Notifications | `#/settings/notifications` | What to notify me about; Status report times; Urgent requests during focus; Quiet hours; Quiet on PTO days; Send a test notification; Notify this device; Show details in notifications; Let FocusTime message me in Teams; What FocusTime sends in Teams |
| You | Display | `#/settings/display` | Theme; Text size; Timelines; Show personal events; Reduce motion |
| Planning | Today and Week | `#/settings/planning` | Your level; Offer Break down; Readiness nudges; Count unsized work as; Shortest useful time per size; Carry-over (days back); Suggest work for empty blocks; Add work reminder; When I tick a story; Midday check-in reminder; Close out reminder; Week nudges; Plan ahead rituals; Use timeboxing; Put timeboxes on Outlook; Ask before changing my own timebox events; Help session length; Teams meeting for help sessions; Days to search for help; Never suggested, for everyone; People I exclude; Invites go only to; At-risk blocks |
| Planning | Focus | `#/settings/focus` | Focus length; Break length; End sound; Set Teams status during focus; Plain focus sets; Default sound; Volume; Fade in and out; When a break starts; Pause and resume music; Playlists |
| Planning | Backlog | `#/settings/ahead` | Stale after (weeks); Stalled after (days); Watch within (weeks) |
| Clients | Clients | `#/settings/clients` | Keep following after focus time ends; Your clients |
| Clients | Client (a client's own page) | `#/settings/client` |  |
| Clients | Client chats | `#/settings/chats` | My request phrases; My acknowledgements; My promise phrases; Team phrases; Client chats read for requests |
| Connections | Accounts and calendars | `#/settings/connections` | Sources; Calendars added by link; Outlook calendar changes; Microsoft permissions; My VM; Start without a preview; Start my VM before my day; FocusTime in Teams; Send feedback |
| Connections | DevOps | `#/settings/devops` | DevOps per client; DevOps write access; Find an item |
| Connections | AI and assistant | `#/settings/ai` | AI for FocusTime; This month's AI spend; Break down looks back (months); Test AI; What is sent to AI; Last 20 AI requests; Assistant history |
| Data | Activity | `#/settings/activity` | Outlook write log; DevOps write log; Azure write log; Teams status log; Close the loop sends |
| Data | Your data | `#/settings/data` | Export my data; Reset my plan; Delete my data; Diagnostics; Show demo data; Reset demo |
| Data | About | `#/settings/about` | Version; Open the Guide; Style guide |
| Admin (admins only) | Clients | `#/settings/admin-clients` | |
| Admin (admins only) | AI | `#/settings/admin-ai` | |
| Admin (admins only) | Conversations | `#/settings/admin-conversations` | |
| Admin (admins only) | People | `#/settings/admin-people` | |
| Admin (admins only) | Organization | `#/settings/admin-organization` | |
| Admin (admins only) | Standards | `#/settings/admin-standards` | |
| Admin (admins only) | Status | `#/settings/admin-status` | |
| Admin (admins only) | Audit | `#/settings/admin-audit` | |

## Every command in the command menu (Ctrl K)

389 commands, by the menu's groups, with a key where one has it. Plus, built by the menu itself: "Show me: <tour>" for each tour, "Guide: <section>" for each Guide section, "Technical docs: <page>", "Code: <client>", and a Settings entry per section.

| Group | Commands |
|---|---|
| Week (25) | Refresh all sources (R); Add work to the week; Plan a feature for the week; Pin to a block; Add to the week; Set estimate; Set story size; Take off the week; Mark done for the week; Type a feature for the week; Draft feature on or off the week; Nothing this week; From last week; Keep, drop or watch a row; Accept all from last week; Move or remove a check-in; Status report; Client status report; Suggest status lines; Draft status updates; Stop watching; Copy Coop brief; Mark as being broken down; Create a promise: ask about priorities; Start a call |
| Sources (11) | Show source status; Connect Outlook; Calendars added by link; Check a calendar link; Add a calendar by link; Change a calendar link's settings; Replace a calendar link; Remove a calendar link; Connect Google Calendar; Disconnect a calendar; Reconnect Outlook with calendar changes |
| Settings (43) | Who's signed in; Sign in with Microsoft; Sign out; Send a test notification; Send a sample notification; FocusTime in Teams; Send me a test in Teams; Notifications; Mark notifications read; Push on this device; Notify this device; Remove a device; Setup status; Setup: your day; Setup: record a step; Setup: start over; Open Settings (,); Change a setting; Reset my plan; Client chats; Pick a client chat; Add a client chat; Read a client chat or not; Mark a client chat as a Social chat; Label a client chat; Remove a client chat; Refresh client chat members; Delete a client's stored chat messages; A client's house style; Edit a client's house style; AI; Test AI; Microsoft permissions; Export the plan; Export my data; Diagnostics; Delete my data; Check Outlook write access; Preview an Outlook change; Confirm an Outlook change; Retry an Outlook change; Show the write log; Clear assistant history |
| Help (8) | Send feedback; Send the feedback shown; Feedback setup; Your first day; Technical docs; Ask to collaborate; Find help session times; Preview a help invite |
| My VM (11) | My VM; Find my VM; Choose my VM; Start my VM; Confirm a VM change; Not today (VM prompt); Skip the next VM auto-start; Resume the VM auto-start; VM auto-start notice seen; Start my VM now; Show the Azure write log |
| Work items (24) | Plan ahead; Move a bar on the timeline; Backlog (3); Backlog's items; Who can be assigned; Change a date, state, size or owner; Change target dates or owners of several items; Remove a pending change; Discard all changes; Resolve a conflict; Backlog filters; Remember Backlog filters; Skip in Needs attention; Unskip in Needs attention; Draft a feature; Choose a parent for a draft; Delete a draft; Edit a draft; Add a draft story; What can be created for a client; Save a new item as a draft; Save a draft's level, parent and owner; Open a work item's card; Open in browser |
| Team (13) | Who can I send this to; Send to…; Cancel a send; Accept sent work; Pass to…; Can't this week; Withdraw a Must; Sent to me; From your team; Make it a client priority; Not a client priority; Add to my week; Ask a lead to look |
| Day (6) | Add work to a day; Unfinished to-dos; Dismiss the suggested to-dos hint; Suggested to-dos; Clear suggestions; Bring suggestions back |
| Close out (10) | Close out (E); Timeboxes to check in; Answer a timebox check-in; All went to plan; Undo a check-in answer; Finish the DevOps offer; Finish Check-in; Finish Close out; Write a resume note; Mark borrowed time paid |
| To-dos (20) | I'll make it up; Add to the plan; Set size; Move to-do; Mark done or not done; Plan a deployment; A client's deployment items; Change a client's deployment items; Change the kind of a to-do; Drop to-do; Take a to-do off the plan; Put back a to-do taken off the plan; Put back an unfinished to-do; Put back a dropped to-do; Wrap it up; Preview a wrap-up; Confirm a wrap-up; Wrap up a story (from Teams); Tick a story done or in progress; Suggest a wrap-up comment |
| Display (16) | Change theme; Demo status; Simulate a teammate's DevOps change; Run the VM auto-start (demo check); Reset demo; Demo mode; First launch; Tour link; Reduce motion; Text size (Ctrl +, Ctrl −, Ctrl 0); Timelines (V); Inbox view, clients and grouping; Timeline (B); Timeline on Today (B); Days on Week; Personal events (G) |
| Code (5) | Code; Code: a client's repos; Code: a folder; Code: find a file; Code: a file |
| Time (6) | Set working hours for a day; Use usual hours for a day; Block time as unavailable; Remove unavailable time; Add a flex session; Remove a flex session |
| Focus (14) | Start focus timer (F); Pause the timer; Resume the timer; Stop the timer; Add 15 minutes; Done with this session; Next to-do; Deep focus; Teams status during focus; Profile photos; Teammates' presence; Show the Teams status log; Open a focus playlist; Check media control |
| Requests (12) | Requests; Refresh requests; Show a request's context; Resolve a request; Undo a request's resolution; Find an item for a request; Sort a request again; Show a hidden request; Promises; Mark a promise done or dismiss it; Undo a promise's Done or Dismiss; Link a promise to a DevOps item |
| DevOps (37) | Break down: AI and write access; Break down with AI; Run Break down; Regenerate the proposals; Save the reviewed proposals; Preview creating the items; Create all; Retry the items that weren't created; Enable DevOps writes for a client; Turn off DevOps writes for a client; How fresh DevOps is; Check DevOps now; Find an item; Check DevOps write access; List an item's states; Preview a DevOps change; Confirm a DevOps change; Retry a DevOps change; Show the DevOps write log; Offer to update DevOps with progress; What Edit and Move… offer for an item; What Wrap it up offers for an item; Offer to update DevOps for a to-do; Offer to undo a to-do's DevOps update; DevOps patterns; DevOps patterns: access; DevOps patterns: run inventory; DevOps patterns: estimate; DevOps patterns: run classification; DevOps patterns: resume; DevOps patterns: set a client's platform; DevOps patterns: set a client's scope; DevOps patterns: set a type's kind; DevOps patterns: check by hand; DevOps patterns: download; DevOps patterns: change the request types list; DevOps patterns: ignore a suggestion |
| Conversations (45) | Conversations; Conversations that need you (count); Refresh conversations; Show a conversation's messages; Mark a conversation seen; Resolve a conversation; Not work-related; Undo Not work-related; Not a request; Open a conversation again; Hide a conversation for me; Move or split a message; This is work; Link a conversation to a DevOps item; I'll take it; Give to…; Add helper; Release; Close out a conversation; Undo the last change to who has it; Take it over; Show held-back messages; Sort or file all held messages of a client; Mark a held message not work-related; Sort unsorted messages; Find an item to link; Unlink a conversation's item; Unlink a promise's item; Find an item for a conversation; Create the DevOps item (a promise); Merge into…; Preview a merge; Undo a merge; Draft the DevOps item; Promises; Add a promise to Today; Find an item for a promise; Link a promise to a DevOps item; Mark a promise done; A promise isn't needed; Change a promise's due day; Change whom a promise is to; Close the loop on a promise without sending; Open a promise again; Skip a suggested update |
| Inbox (12) | From chats; Dismiss a suggestion; Bring a suggestion back; Put a cleared promise back; Note older promises cleared; Inbox items; Inbox items for Today and Week; Inbox count; Hide an Inbox item for me; Snooze an Inbox item; Mark the Inbox timeline looked at; Mark Inbox items seen |
| Admin (17) | Am I an admin; Open Admin; Change a team setting; Override a level or a client lead; Read levels and leads again; Remove a person who has left; Admin audit; Link a client DevOps login; Code views; Check a client's code access; Sync the standards now; Invite to FocusTime (Who's set up); Can I send invites from FocusTime; Preview an invite; Send the invite shown; Retry an invite; Status row action |
| Capture (7) | Quick capture (N, C); Show captures; Sort a capture; Undo a capture; Prepare a draft for DevOps; Show a draft; List a client's features and epics |
| Promises (19) | Show promises; Add a promise; Edit a promise; Close the loop without sending; Close the loop with someone; Draft a loop update; Check text for another client's name; Preview a loop update; Send the loop update shown; Check a loop update again; Mark a loop update sent; Undo promise kept; Loop updates sent; Not needed; Snooze a promise; Delete a promise; Choose a person; Suggest who; Review heads-ups |
| Timebox (6) | Timebox…; Timebox my day; Move or resize a timebox; Remove a timebox; Put a timebox on Outlook; Choose a version |
| Calendar (1) | Open in Outlook |
| Meetings (13) | A client's registered meetings; Find a meeting to register; Register a client meeting; Change a registered meeting; Stop reading a meeting; My client calls; Review a call; Change a proposal; No transcript this week; Preview a call's changes; Confirm a call's changes; Check a call now; Propose again |
| Assistant (8) | Ask the assistant (Ctrl J, /); Confirm the assistant's change; Undo the assistant's moves; Cancel the assistant's change; Assistant history; What's next; What I did on a day; Look up a work item |

## Keys (ui/keys.ts)

| Keys | What the app says they do |
|---|---|
| ←, →, ↑, ↓ | Move between blocks on Week and on Day (↓ from the afternoon reaches the evening); with the block panel open it follows |
| A, Enter, Space | Open the selected block: its panel on the right (what's on it, its meetings, and Add). A puts the cursor in the Add box |
| Esc | Close the block panel and go back to its block |
| Tab, Shift Tab | Items and menus of the selected half-day, then on to the next part of the window |
| F6 | Next region: top bar, week, panel, status bar |
| Shift F6 | Previous region |
| O | Open the focused work item in your browser |
| Shift F10, Menu | Actions (⋯) for what has focus |
| 1, T | Day: what's next, what's urgent and the day's blocks |
| 2 | Week: the week's blocks, with the block panel beside them |
| 3 | Backlog: every client's DevOps on one screen, Grid and Gantt (was Ahead) |
| 4 | Status: this week's feature updates for Monday's status report |
| 5, L | Inbox: what needs you, in one list with views (Needs you, Promises, Waiting on, Captures and drafts and more) |
| P | Week with the block panel open (again: closed); on Backlog, Grid and Gantt (I also works) |
| N, C | Quick capture from anywhere: one line, saved at once; then sort it into a promise, a draft story or a draft feature |
| Shift N | New work item in DevOps: a story, feature, epic or any level the client's process has, from one form (Enter in the title opens the preview). On a Backlog row: new under that row |
| W | Week with the block panel open; again to close it |
| Drag | Work from the block panel onto a block: it goes on. A to-do from a block onto the panel: it comes off the plan |
| ↑, ↓, Enter | In the block panel's Add box: move through the matches and take one. With no match, Enter makes a new to-do |
| J, K | Next or previous row in the Inbox |
| Enter | In the Inbox: open or close the row |
| C | In the Inbox, From chats: create an item for the open suggestion |
| L | In the Inbox, From chats: already covered, link an item |
| X | In the Inbox, From chats: dismiss for me |
| D | In the Inbox, Promises: done |
| Drag | In Week: a row from Add work onto any block to place it there |
| [ | Previous week |
| ] | Next week |
| R | Refresh: check DevOps now for the clients on screen and reread every source, on every tab; says what it found |
| V | Week: Timelines, the hours the rails show (business hours, 12 hours, 24 hours); H also works; also in Week's ⋯ |
| B | Week: show or hide the timeline (the slim hour rail beside each card); also in the header and in ⋯ |
| B | Day: show or hide the timeline; also beside the header and in ⋯ |
| G | Week and Day: show or hide personal events (they still count in risk and free time); also in ⋯ |
| Ctrl K | Command menu |
| Ctrl J, / | The assistant: ask what's next or about an item, or ask for a change you then confirm (/ when no text field has focus) |
| Ctrl +, Ctrl −, Ctrl 0 | Text size: larger, smaller, or back to Default (not while typing) |
| F | Focus timer: start one, or pause, +15, done, next to-do or stop |
| M | Day › Midday check-in: what's done, the free time left and Move to… on each unfinished to-do; again to go back |
| E | Day › Close out: its side panel (where you left off, DevOps updates, promises due); again to go back |
| , | Settings (Esc goes back) |
| ? | The Guide: start here, your first day, every area, tours and every key (not while typing) |
| Esc | Close the menu or dialog on top, or Add work; in a flow, back without saving |

