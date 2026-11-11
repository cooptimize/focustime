# WD-2: what the two panels, the block menu and Day's card did, and where it went

WD-2 replaced the Add work panel (`ui/AddWork.tsx`) and the Details panel (`ui/DetailPanel.tsx`) with one block panel (`ui/BlockPanel.tsx`), trimmed the block's ⋯ menu (`ui/menu.ts`), and rebuilt Day (`ui/Today.tsx`, now `ui/Day.tsx`) on Week's block card (`ui/BlockCard.tsx`). Each row below is something one of those did before. "Where now" says where it lives after WD-2, or "Dropped" with the reason. Every change to my plan still goes through a named action on FocusTime's own plan store; nothing new is written outside FocusTime. One action was added, `pick.take_off` (Take off the plan), because nothing covered it.

The "before" screenshots are in `docs/ux/wd2/before/`.

## The Add work panel (Week, from "+ Add", A, P, W, a day header or Review)

| What it showed or did | Where now |
|---|---|
| Title "Add to <client> · Tue AM" | The block panel's header, "<client> · Tue AM" (no "Add to": the panel is the block, not only adding) |
| The block's room ("1h 45m free", "a little over", "about 2h over") | The header's second line, after the block's hours: "12:30 to 5:00 · 1h 30m free" |
| The client chooser on an Open half-day or a catch-up block | The same chooser, under the header |
| To place, one collapsed line at the top (open from Review): unfinished to-dos and their suggested cards, From last week, sends to answer | "N to place", collapsed at the bottom; it opens when Review opened the panel. It also lists the client's drafts with no feature that aren't on a block (where a plain to-do goes when it is taken off) |
| This week's features, each with its stories and drafts, "+" per row, "N of M placed" | ADD › This week's features, first in the list, "2 of 3 on". Every story stays listed and says where it is ("On this block", "Thu PM") |
| "+" on a feature: a placeholder on the block ("Needs stories · Break down") | The same "+" on the feature's row |
| A feature's ⋯ (Move up and down, Estimate, Pin to a block, Mark done, Ask to collaborate, Send to…, Set target date, Coop brief, Create drafts in DevOps, Remove from this week) | The same ⋯ on the feature's row |
| A draft row's Create in DevOps | The same, on the draft's row |
| Promises with "+" and the due badge | ADD › Promises. A promise's words open it in the Inbox |
| More from DevOps: a search box, then the rest of my work grouped under its parent, "Add to this week" on a parent | ADD › Other work assigned to you, collapsed with a count. The search box became the one Add box |
| Drafts with no feature, under More from DevOps | Under To place ("Not in DevOps") |
| Also this week: the other clients with features, one chip each, moving the panel to that client's next block | Dropped. Clicking another block is how you switch (the brief) |
| You sent and Ask a lead to look, one collapsed group at the bottom | "You sent", collapsed at the bottom, with the same content |
| The type box pinned at the bottom: Enter a draft story, Shift+Enter a plain to-do; choosing a search result adds that item | The one Add box. While typing, the last rows are always "New to-do: <text>" and "New draft story: <text>" (under a feature chosen beside it). Enter takes the highlighted row; with no match it starts on "New to-do" |
| Drag a row onto any block on the grid | The same |
| "+" on a row placed on another block that day was hidden | "+" on a row placed elsewhere moves it here ("Move it here from Thu PM"), with Undo |
| Esc: first leaves the box, then closes | Esc in the Add box clears the text, then closes the panel; anywhere else it closes. Focus goes back to the block |
| A past week: the panel didn't open | The panel opens on a past block to tick and move work forward, with no Add section |
| The phone: a bottom sheet | The same sheet, with the block panel's content |

## The Details panel (Week and Day, from a card's body, a due badge, Enter or ⋯ › Details)

| What it showed or did | Where now |
|---|---|
| Client, date and the block's hours | The block panel's header |
| The block's ⋯ in the panel header (Details, Add work…, Add an intention, Add a work item, calls) | The panel's ⋯: Start (or Join) a call in the client's chats, and Timebox this day |
| "Whole day off" on PTO | The same line |
| The risks, each with At risk or Watch and its reason | The same list under the header (today and later) |
| "Also booked: <client>" | The same line |
| A live call with Join, else Start a call (CW-1) | The panel's ⋯ (Join the call in <chat> · live now, Start a call in <chat>). A live call's Join is also on the card, as before |
| Agenda: meetings, personal events, timeboxes and free gaps | The meetings line ("3 meetings · 2h") opens the same agenda in place |
| Plan: the block's to-dos as full rows (checkbox, title, size, + time, ⋯), Start focus on the first to do today | ON THIS BLOCK, the same rows. Start focus on the first one still to do, on today's blocks |
| Week: a to-do's row drags to another block; Move to… | The row drags to another block or onto the panel (Take off the plan); Move is in the row's ⋯ |
| "Left off: …" for the client | The same line under ON THIS BLOCK |
| Week: Your stories for <client>: my open stories grouped by feature, this week's first, "Planned · Thu AM", "Add to this block" | ADD: This week's features with their stories, then Other work assigned to you. Each row has "+" and says where it is |
| Week: a story's size and state on its row | The row's tooltip (type, number, state); the size is on the to-do once it is on a block |
| Week: a story's ⋯ (Copy link, Add to…, Move from… to…, Send to…) | The story's ⋯ in the Add list (the item's menu), and the to-do's ⋯ once it is on a block |
| Week: "No stories for you yet" on a feature with none of mine: Add a story for me, Break down, teammates' stories with Take one | Break down is on the feature's row ("Needs stories · Break down"). A teammate's story under one of this week's features is a row with its owner and **Take one** (the same write, with its preview and Undo). Add a story for me is "New draft story" in the Add box under that feature, then Create in DevOps on the draft. Dropped: the row of teammates' faces with "N open stories by <name>" |
| Day: This week's features with "N of M stories planned", Needs stories, Break down, Coop brief | ADD › This week's features ("2 of 3 on", Needs stories · Break down). The Coop brief is in the feature's ⋯ |
| Promises for the client as full rows (Close the loop, Due, Done and more) | ADD › Promises: "+" puts one on the block, and its words open it in the Inbox, where every action is |
| Day: "Assigned to you, not planned" | ADD › Other work assigned to you |
| Opened on a to-do or a promise (a due badge): scrolled to it and marked it | The same: a due badge opens the panel on that promise's row |
| Esc and × close it and return focus | The same |
| The phone: full screen with Back | The bottom sheet |

## The block's ⋯ menu

| Entry | Where now |
|---|---|
| Details (Enter) | Dropped as an entry. Clicking the block's header or empty space, Enter, A or "+ Add" opens the block panel. The menu keeps one entry, **Open** |
| Add work… (A) | Dropped. "+ Add" on the block, A, or Open |
| Add an intention | Dropped. Type in the panel's Add box and press Enter on "New to-do" |
| Add a work item | Dropped. The panel's Add list and search |
| Start a call in <chat>, Join the call in <chat> (CW-1) | Kept in the menu (and in the panel's ⋯), so a right-click on a card still reaches it |

What the block's ⋯ has now: **Open**, then the client's chats (Join the call or Start a call), when there are any.

The command menu's two entries ("Details of the selected half-day", "Add work to the selected block") are one, "Open the selected block", which still answers to details and add work. A day header's ⋯ keeps what it had; its "Details of AM", "Details of PM" and "Details of the evening" read "Open AM", "Open PM" and "Open the evening".

## Day's own block card (inside `ui/Today.tsx`) against Week's (`ui/BlockCard.tsx`)

| What Day's card did that Week's didn't | Where now |
|---|---|
| The block's meetings and events as rows in time order among the to-dos | The card's meetings line ("3 meetings · 1h 30m · 2h free", opening the list), the panel's meetings line and agenda, and Day's Timeline |
| The now row inside the list | The now line at the top of the block under way (Week's card has it) |
| My promises due during the block, as rows at their time | The card's "N late" chip and due badges (Week's), the chips line above the blocks ("1 promise due"), and the marks on Day's Timeline |
| The next to-do highlighted | The same on Week's card on Day today, with Start focus (or the running timer with Done and +15) on that row |
| "What's next" above the blocks: the block under way, its next to-do and Start focus | Dropped from above the blocks (the brief: the urgent strip, the chips and the moment card, nothing else). Start focus is on the next to-do's row, in the block panel, in a to-do's ⋯ and under the top bar's Focus |
| The status with its reason spelled out ("At risk · Dentist 12:00") | Week's one status chip; the reason is in its tooltip and in the panel's risks |
| "Nothing planned. + Add" on an empty block | "+ Add" as the last row of every block that can take work |
| "Left off: …" on the current and the next block | The block panel, under ON THIS BLOCK |
| A due badge on a promise's to-do | Week's due badges on the card |
| "+ time" always on a row, the time editor | Week's row (+ time on hover and in ⋯), the panel's rows, and Day's Timeline |
| Dragging a row onto a free gap of the 3840 day timeline to timebox it | Dropped with that timeline (below). Timeboxing in place is Day's Timeline (TY-1, TY-2) |
| A click on the card opened Details, focused on the row clicked | A click on the header or empty space opens the block panel; a row, a checkbox or a chip doesn't |
| A PTO half: muted, "Off this morning", read only | Week's PTO card; a PTO day's to-dos show under it, read only |
| Check-in's card (what's left, fits or doesn't, one suggested move) | `ui/Checkin.tsx`, unchanged |
| Close out's card (what isn't done with "→ <day>", counts) | `ui/CloseOut.tsx`, unchanged |

## The rest of Day

| What it did | Where now |
|---|---|
| "Today <date>" or "Tuesday <date> · past" as the heading, ‹ ›, Back to today | One header row: ‹ › "Wed, Nov 11", a Today chip on today or a Today button on another day ("past" or "ahead" beside it) |
| The Timeline toggle | Cards \| Timeline in the header (B still switches) |
| Timebox my day, on its own line above the blocks | In the header row |
| The urgent strip | Unchanged, first above the blocks |
| The attention line (promises due, the VM's morning prompt, an expiring secret; on the phone a source that needs reconnecting) | One line of chips, second above the blocks |
| The moment card (Nothing on today yet, Midday check-in, Close out) | Unchanged, third above the blocks. "Nothing on today yet" has "+ Add", which opens the block panel on Day |
| "2 setup steps left" | Unchanged (only until setup is finished) |
| "A day ahead: its plan so far." with Add work | Dropped (the brief). A day ahead is a day: its blocks have "+ Add" |
| "A past day, read only." with Close out <day> | A past day's blocks open the panel to tick and move work forward. The line under the blocks keeps Close out <day>, which is also in Day's ⋯ |
| "This week" chips under the blocks | Dropped (the brief). The panel's feature list carries it ("2 of 3 on", Needs stories · Break down) |
| All-day events, Before your blocks, After your blocks | Week's day column: all-day chips, the early line, and the Evening band or the late line |
| The 3840 day timeline on the left of the cards | Dropped. Day's Timeline (TY-1) shows the same hours at every width, and the old timeline's drop target took Day's own row drag, which Week's card doesn't have |
| A detail panel under the cards at 3840 | The block panel on the right, at every width |
| Weekend days, PTO days, days with no hours | Unchanged ("Weekend" list, "You're off", "Nothing scheduled") |
| The phone's today (the Now card, Needs you, To-dos by block, Next up, promises) | Unchanged, plus "+ Add" under each block that can still take work |
| Midday check-in and Close out as flows over the page, the wrap-up sheet, the DevOps preview and confirm | Unchanged (their code moved to `ui/Checkin.tsx` and `ui/CloseOut.tsx`) |

## New in WD-2

| What | How |
|---|---|
| Take off the plan | Drag a to-do from a block onto the panel, or its ⋯ › Take off the plan. `pick.take_off`, with Undo |
| The panel opens as the drop area | Start dragging a to-do with the panel closed and it opens on that block |
| Day on any date | ‹ ›, [ and ], a day header on Week. Today and later take work; a past day ticks and moves forward |
| Day's panel address | `#/day/<date>/<half>`; open or closed is remembered on the device |
| A day header on Week | Opens Day on that date (it opened Add work on the day's first block) |

## What Take off the plan does, by kind of to-do

| The to-do | After Take off | Undo |
|---|---|---|
| A DevOps story | Off its block; back in its feature's list in the panel, not placed (a "+" again) | On its block again |
| A draft story | Off its block; still a draft, not placed | On its block again |
| A promise | Off its block; still in Promises, not placed | On its block again |
| A plain to-do (not in DevOps) | Off its block; its words kept under To place ("Not in DevOps"), from where "+" puts it on a block | A plain to-do on its block again, and the kept copy goes |
| One moved or carried here from another day | Off its block; it doesn't go back on the day it came from | On its block again, linked to where it came from |
| One with a timebox | The timebox goes with it. If the timebox is on Outlook: refused, "Remove the timebox first" | The to-do comes back without its time |
| A done to-do | Refused: "A done to-do stays on its day" | |
| A past day's to-do | Refused: "A past day keeps its record. Move the to-do to today instead" | |
| A story with time on it | Refused: "It has time on it. Move it to another block instead" | |
| A deployment | Refused: "A deployment keeps its window. Move it or drop it instead" | |

None of these marks a to-do dropped. Drop is still its own entry in the to-do's ⋯.

## Follow-up (Nov 11): the Add list, the header, no browser controls

| Before the follow-up | After |
|---|---|
| ADD › This week's features (features on my week, with their stories) | ADD › **Assigned to you**: my open features and my open stories for the client, each story under its feature, even when the feature isn't mine ("No feature" last) |
| ADD › Other work assigned to you (collapsed) | Part of Assigned to you |
| A week feature that isn't mine, with no story of mine | Still in **Assigned to you** (it is on my week), saying whose it is |
| Nothing listed other people's work unless it was under my feature | **More in <client>** (collapsed): everything else open in the client's DevOps; the search covers it |
| A feature's teammates' stories listed among mine | Folded behind "2 more in this feature" (with Take one) |
| "2 of 3 on" on every feature with stories | Only once the feature has work on this week |
| Backlog order only | The panel's ⋯: Sort by target date / Sort by backlog order, remembered on the device |
| Target date not shown | On hover, with the state and FocusTime's size ("M · 2h"); sorting by it, a story with none uses its feature's |
| Two risk sentences above the to-dos | One line under the time ("At risk · 2 reasons"); reasons on hover and on a click |
| A browser select for "New draft story"'s feature; selects in Check-in's walk-on and Close out's "+ Another client" | The app's own menu and picker |

