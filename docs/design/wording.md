# FocusTime wording guide

Step 15 (D270). Applies to every string a person sees: views, buttons, menus, hints, notices, notifications and the command menu. Code names (`planday.commit`, `slot`) stay as they are; only visible copy follows this guide. Terms follow the glossary in `CLAUDE.md`.

## Three rules

1. **Plain.** Words a teammate would use out loud. "Morning", not "AM slot". "Where you left off", not "resume note". "Done", not "commit".
2. **Short.** One line. Cut "please", "currently", "in order to", and anything the layout already says. A button is a verb or a verb and an object ("Add work", "Close the loop").
3. **Calm.** Say what is true and what you can do next, never what went wrong with the person. Re-planning is normal: "Move to Tue", not "Slipped". Questions only where a choice is real, and only in the ritual that asks it ("Still realistic?" is Check-in's alone).

## Color goes with words, never alone

| Tone | Use for | Examples |
|---|---|---|
| Neutral (muted text) | Facts, free time | "1h 45m free", "No free time", "2h 30m free this afternoon", "2 of 3 picks done" |
| Amber (`--watch`) | Worth a look, not a problem | "Due tomorrow" (QT-2: never how much is planned, anywhere but Backlog's Gantt weeks) |
| Orange (`--due`) | Due today | "Due today" |
| Red (`--risk`) | Real problems only | "Overdue 2 days", "At risk", a source down, a write that failed |

Fit is never red. QT-1 and QT-2: nothing a person reads says they planned too much (Day, Week, the panel, the midday check-in, the assistant, Teams, notices, the Guide); they say the free time. The plan is a punch list. The one exception is Backlog's Gantt weeks ("about 2h over"), a forward-planning view and an open question.

## Words to avoid in visible copy

| Avoid | Say |
|---|---|
| commit, committed, uncommitted | Done, Planned, not planned yet |
| slot, half-day slot | morning, afternoon, evening, block |
| capacity, free share | free time, "4h 30m free" |
| carry target, carry-over target | the next day that can take work (CF-1) |
| unprocessed capture | capture to sort |
| resume note | where you left off |
| ignition | Add work (WD-1; was Plan the day) |
| Board (Week's view) | Week (WD-1) |
| Commit, Plan (Week's mode) | Add work (WD-1; CF-1: nothing to confirm) |
| Confirm week, Confirm again, Confirmed, Draft (a week) | nothing: what's on the week is the plan (CF-1) |
| Confirm today, Confirm <day>, Confirm and timebox | nothing; "Timebox my day" (CF-1) |
| Today isn't planned yet | "Nothing on today yet", only when today has no to-dos (CF-1) |
| Must, Nice to have, musts done, musts left, Still realistic? | nothing: every feature on the week counts the same (CF-1). A send's own Must or Suggested stays |
| Plan the week | Add work to the week (WD-1) |
| Plan the day, Plan today | Add work to today, or to a day (WD-1) |
| Today (the tab) | Day (WD-1; the moment card still says "today") |
| loop (for a follow-up) | follow-up ("Close the loop" stays as the action) |
| Details (a panel, a menu entry) | nothing: a block opens its panel (WD-2) |
| Add work… , Add an intention, Add a work item (a block's ⋯) | "+ Add" on the block; the Add box in its panel (WD-2) |
| Add work (the panel's name), "Add to <client> · Tue AM" | "<client> · Tue AM": the panel is the block (WD-2) |
| Back to today | Today (a button beside the date, WD-2) |
| This week (Day's chips), A day ahead: its plan so far | nothing: the panel's feature list, and "+ Add" on a day ahead's blocks (WD-2) |
| Full, a little over, about 2h over, Too much planned, Fits, Room for … more, overloaded, fits / doesn't fit, Move one?, Over your <day> hours by … (anywhere a person reads) | "1h 45m free", "No free time", "2h 30m free this afternoon", "Wednesday PM: 3h free" (QT-1, QT-2) |
| Keep open for walk-ins, Plan up to (on screen) | nothing (QT-1; stored values stay) |
| em dashes | a comma, a period or a middle dot (·) |

## Patterns

- Status lines: facts joined with " · " ("7h of work · 6h 15m free").
- Counts: "1 capture", "2 captures"; never "capture(s)".
- Durations: "45m", "1h", "1h 30m"; blocks in halves ("half a block", "1.5 blocks").
- Times: "9:00 AM–12:30 PM" in headings, "9:00–11:00" on pick rows.
- Empty states say what to do next in one line: "Nothing yet. Add from the right."
- Disabled menu items say why in a few words: "Enable DevOps writes first".

## WD-1 words (Nov 10)

- **Day**: the first tab (was Today). Inside it, "today" stays a plain word ("Add work to today", "Back to today").
- **Add work**: the panel beside Week on one block ("Add to Northwind · Tue AM"), its "+ Add" buttons, and the command menu's "Add work to today", "Add work to a day…" and "Add work to the week".
- **To place**: what waits for a block in the panel, and the line above the grid ("3 to place: 1 unfinished, 2 from last week").
- ~~**Confirm week**, **Confirm Tue, Nov 3**~~: retired in CF-1 (Nov 11). Work comes on and off freely; "Confirm" is only on an external write's preview.
- Retired from visible copy: Board, Commit, Plan the week, Plan the day, Plan today. The command menu still finds them by those words.

## WD-2 words (Nov 11)

- **+ Add**: the button, on every block that can take work (Week, Day's cards and timeline, the phone) and in Week's and Day's header. It opens the block's panel with the cursor in its Add box.
- **A block's panel**: how the Guide and messages name the one side panel ("opens its panel", "in a block's panel"). In code and the glossary it is the block panel. Its title is the block, "<client> · Wed AM", never "Add to" or "Details".
- **On this block**, **Add**, **To place**, **You sent**: the panel's section labels. "Nothing here yet." when the block is empty.
- **New to-do: <text>**, **New draft story: <text>**: the last two rows while typing in the Add box.
- **Assigned to you**: the Add list's first section (the follow-up; was This week's features and Other work assigned to you): my open features and my open stories for the block's client, and any feature on my week, each story under its feature. "No feature" for a story with none. "2 more in this feature" folds a feature's other stories.
- **More in <client>**: the folded list under Promises: everything else open in the client's DevOps (was More from DevOps).
- **Sort by target date**, **Sort by backlog order**: the panel's ⋯. A target date is never text on a row: it is on hover, with the state and size.
- **At risk · 2 reasons**: the header's one status line; the reasons are on hover and open under it.
- **2 of 4 on**: a feature's stories that are on a block this week (was "N of M placed"), shown once it has work on this week.
- **Take off the plan**: off its block and back to not placed, with Undo. Never "Drop", which marks a to-do dropped. The notice reads "Taken off Wed AM: <title>".
- **Today** as a button beside Day's date comes back to today (was "Back to today"); on today it is a chip.
- **Cards | Timeline**: Day's two views.
- **Open**: the block's ⋯ entry and the command "Open the selected block" (they answer to details and add work).
- Still plain words, not names: "Add work to today", "Add work to your week" (Setup's last button, was "Plan your week").
- Retired from visible copy: Details (as a name), Add work… , Add an intention, Add a work item, More from DevOps, Also this week, This week (Day's chips), A day ahead, Back to today, What's next (as a card on Day).

## QT-1 words (Nov 11)

- **"1h 45m free"**, **"No free time"**: a block panel's time line ("12:30 to 5:00 · 1h 45m free"). Never "Full", "a little over" or "about 2h over".
- **"2h of 3h free"**, **"1h free"**, **"No free time left"**: the tip while dragging onto a block, neutral.
- **At risk**: a card's one chip, only when the calendar cuts into the block. Watch has no chip; its reasons are a hover.
- **"2 done · 1 not done"**, **"Nothing planned"**: a past day's folded card.
- Retired from visible copy on Day, Week and the panel: Full, a little over, about N hours over, Too much planned, Fits, Room for … more, Keep open for walk-ins, Plan up to, the client chips. (QT-2 retired them everywhere else too, below.)

## QT-2 words (Nov 11)

- **"2h 30m free this afternoon"**, **"No free time this afternoon"**: the midday check-in's header, once ("this evening" or "the rest of today" when an evening is still ahead). Free time after meetings and personal events, never what's planned against it.
- **"Move to PM"**, **"Move to Thu"**, **"Move to Mon"**: on every unfinished to-do in the check-in; **Tonight** only for one whose promise is due today.
- **"What's done and what's left"**: the check-in's moment card, reminder and push (was "what still fits").
- **"Wednesday PM: 3h free"**, **"Wednesday PM: no free time"**: the assistant's move preview note (was "Over your Wednesday PM hours by 1h").
- **"Wed PM: at risk, <reason>, 45 min free"**: the assistant names a block only when the calendar puts it at risk. **"3h of meetings, 5h free for focus"**: a day's facts when asked about one day.
- Retired from visible copy everywhere: fits, doesn't fit, About N hours over. Move one?, A little over, overloaded blocks, too much planned, Over your <day> hours by …. Backlog's Gantt keeps "about 2h over" per week for now (open question).

## QC-1 words (Nov 11)

- **+ New** (Backlog's header), **+ New under** (a row), **New <type>** (the command menu, in the process's own word: "New feature", "New epic", "New domain"), **New work item in DevOps** (the menu's general one). Never "Create feature" or "Add item".
- The form's title: **New in <client>'s DevOps**, or **New work item** before a client is chosen. Labels: Client, Level, Title, Parent, Assigned to, Target date; **More: description and size**. The title's placeholder: "What is this feature?" in the chosen type.
- **Create in DevOps** (opens the preview; nothing is created until it is confirmed: "Nothing is created until you confirm the preview."), **Save as draft** ("Saved in FocusTime only."), **Cancel**.
- Without a write PAT: **"DevOps is read-only for <client> until you add your own write PAT. Add it in Settings"**. Never "disabled" or "not allowed".
- The parent: "Optional. Any open feature or capability" (the types one level up), "A domain is at the top: no parent". Refusals say the rule: "A User Story doesn't go under an Epic in this process. Under an Epic go: Feature".
- Backlog after a create: **"Created #5101"**, or **"Created #5101. Shown until you leave Backlog. Hidden by: Assigned to me"**.
- The block panel: **"New feature: <text>"** beside New to-do and New draft story; Break down: **"Add one by hand…"**.

## RB-1 words (Nov 12)

- The panel is **Code**; its header always shows the client's name and color, the repo, and **Read only**. Menus: **Code**, and **Code: <client>** in Commands.
- Choosing: **Choose a client** (the picker), **Your clients** and **Other clients**, **Choose a repo**, **Choose a file in the tree, or find one by name.**, **Find a file**, **"2 matches"**, **No file name matches.**, **"Only the first 20,000 file names are searched."**
- A client set to its team only: **"Only <client>'s team can open this"** (greyed in the list, and as the reason on its page). Never its repo names.
- Buttons: **Copy** (the whole file as it is), **Copy formatted** (only while Format is on), **Copy path**, **Copy DevOps link**, **Copy link**; switches **Wrap** and **Format**; **Copied**.
- The log line, once at the foot of the left side: **"Opening a file is logged for FocusTime admins: who, which file and when."**
- States, always with the reason: **"FocusTime can't read <client>'s code yet. The company DevOps token for <client> needs Code (read)."**; **"<client> has no DevOps set up in Dataverse, so there's no code to show."**; **"This repo is empty: nothing has been pushed to it yet."**; **"This repo is disabled in DevOps, so it can't be read."**; **"This is a binary file (23 bytes), so it isn't shown here."**; **"This is an image (40 KB). Images aren't shown here."**; **"This file is 3.4 MB. Files over 1 MB aren't shown here."**; **"This file is a Git LFS pointer. It's shown as it is; the file it points to isn't read."**; **"Coloring is off for large files."**
- Admin: **Who can read this client's code** (Rule): **Whole company** or **Its team only**; **Can FocusTime read it?** with **"Code: readable · 3 repos"**, **"Can't read yet: the token needs Code (read)"** or **"No DevOps set up"**, and **Check**. Admin › Audit: **Code views**, **Opened the repo**, **Opened a file**, **Used Find**, **"Last 30 days: <client> 12 · …"**, **Every client**, **Everyone**.
- Avoid: "browse", "source code", "codebase" in visible copy; say **code**, **repo**, **file**, **folder**.

## TP-1b words (Nov 12)

- The three questions, always these words and in this order: **Where is it?**, **What should change?**, **How will we know it's right?** Their grey text: **"The report and page, model, table or pipeline"**, **"Before and after, or the rule"**, **"One example and the answer it should give"**. No other hint, help mark, example or choice.
- Written to DevOps as short paragraphs with a bold label: **"Where: …"**, **"What should change: …"**, and, only when the type has no acceptance field, **"How we'll know it's right: …"**. The preview says so: "<type> has no acceptance criteria field in <project>'s process, so "How will we know it's right?" goes in the description."
- The phone's toggle: **"More: details, description and size"**.
- A TP-1 draft's other words, at the end of its description under **"From your earlier draft:"**, one per line: "Environment: …", "Touches: …", "Checked by: …", "How far and who signs off: …", "Done when it is: …", "Signed off by: …", "Not without asking: …".

## TP-1 words (Nov 12, retired by TP-1b)

The words below are no longer shown: the New form, the draft editor and the card don't use them, and Admin › Work templates is hidden. Kept as a record.

- **The four lines**, always these names and in this order: **What and where**, **What changes**, **How we'll check**, **How far and who signs off**. Never Target, Change, Control or Boundary (the studies' earlier names, only read).
- **Request type** (the New form's label; "No type" when none), **Add the four lines** (without a type), **See a full example** / **Hide the full example**, and in it **"A full example: <type>"** with "Made up, to show what each line holds. Nothing here is copied into your form."
- Under a line while it has focus: **"Example: …"**. The help mark's label: **"Why <line> matters"**.
- Choices: **Environment**, **Touches**, **Checked by**, **Done when it is**, **Signed off by**, **Not without asking**; **Not set**, **Other…**, **A role (type it)** ("A role, like the finance lead").
- Written to DevOps: the line names as headings, then "Environment: Test.", "Touches: Data, Model.", "Checked by: <who>.", "Done when it is: in test. Signed off by: <who>. Not without asking: deploy to production."
- The tag: **type:<tag>**, lower case with hyphens. Refused: **"DevOps didn't let you add the tag type:<tag> in <project> (adding a new tag there needs the Create tag definition permission). Nothing was created. You can create it without the tag"**, and the button **Create it without the tag**.
- The card: **Ready**, or **"Missing: What changes, How we'll check"**; an empty line in the block says **"Not written yet"**; the rest of the description under **"The rest of the description"**.
- Admin › Work templates: **No type chosen**, **Why each line matters**, **Choice lists**, **+ Add a type**, **Take off the form** / **Offer it again**, **"Kept when you rename it"**, **"<n> items created · <n> with all four lines"** or **"None created yet"**, **Why (one line, for the audit)**, **Save**, **Discard changes**, **Reload theirs**. Settings: **"Set by your FocusTime admin."**

## WP-1 words (Nov 11)

- **DevOps patterns**: the page's name, in the command menu and its heading. **DevOps patterns (preview)**: the switch in Admin › People.
- **Run inventory**, **Estimate**, **Run classification (N items, about $X)**, **Resume inventory**, **Resume classification**: the page's buttons. Run classification always names the estimate it runs for.
- **Stopped: the server restarted or scaled down**, **Waiting for DevOps budget**, **Giving way to FocusTime's own DevOps check**, **DevOps asked FocusTime to wait**, **DevOps is delaying requests**: a run's states in plain words.
- **Allow AI is off for this client (its page in Admin › Clients)**: a client the estimate and the classification skip.
- **Request type**, **layer**, **readiness as written**, **missing**, **confidence**, **feature shape** (the layers a parent's children touch, in order): the classification's words. **Check by hand**: 30 items with their labels, only for clients you're on.
- **Platform**: Azure, Fabric, Both or Not set, set on the page.

## SG-1 words (Nov 11)

- **Suggested**: the small word over a block's offers ("Suggested · Keep all · Clear"); its hover says they're offers and nothing is planned until kept. A row's hover gives its reason: "Unfinished from Mon", "Next in <client>'s backlog", "Target date Fri", "Needs breakdown".
- **"5 suggested · Keep all · Clear"**: a day's line, in Day's header row and in the day's header on Week.
- **Keep**, **Keep all**: make the offer an ordinary to-do (a feature: placed on the block). The notice says "Kept <title>" or "Kept 3 to-dos for Tuesday", with Undo.
- **Clear**: a row, "not this one this week"; a block, "no suggestions on this block for the rest of the day"; a day, "no suggestions on Tuesday". The notice says "Cleared …" with Undo.
- **"3 suggestions are in your blocks."**: the morning card's line under "Nothing on today yet", with Keep all.
- **Suggestions**: the switch under Day's and Week's View options; **Suggest work for empty blocks** in Settings › Day and Week.
- Retired: the dashed "From Mon" cards' Keep here, "N unfinished to-dos suggested in your next blocks · Keep all · Review".

## PS-1 words (Nov 11)

- **Times**: `9:00–12:30` everywhere a block or event shows its hours (the panel said "9:00 to 12:30", the timeline "9–12:30"); "All day" for an all-day event.
- **Dates**: long "Tue, Nov 3", short "Tue 3" inside a week.
- **Needs stories**: a feature with no stories (the board's suggestion reason said "Needs breakdown").
- **unfinished**: a past day's to-dos not done ("2 done · 1 unfinished"; the check-in's "2 unfinished. Move them, or leave them for Close out.").
- **N done**: a busy card's folded done to-dos; a click shows them.
- **+N**: more chips than fit on a card; it opens the block.
- **Cards**, **Timeline**: the two layouts of Day and Week (Week's single "Timeline" toggle before).
- **Holiday**: the day header's pill on an observed holiday; the day's cell, Day's header line and the panel say its name, "Thanksgiving Day (observed)", or "Holiday" when it has none. "Dataverse: holidays weren't read" with Retry when they couldn't be read.

## WK-5 words (Nov 12)

- **Show Friday**, **Show weekend**: Week's ⋯, group **Days** (the catch-up day by its own weekday name). **Every weekend day** (WK-3, was Weekend) stays under them while Show weekend is on. **Days on Week**: the same two switches in Settings › Display.
- **"Fri hidden · 2 to-dos"**, **"Fri, Sat, Sun hidden · 3 to-dos · 1 promise due"**, **"Today (Fri) is hidden"**: the one note under Week's header, only when a hidden day has open to-dos or promises due or is today; **Show** after it (read as "Show hidden days") brings them back until you leave Week.
- **Today**: the small mark on a folded day's strip that is today.
- **"→ Thu"**, **"→ Mon 16"**: where a past day's moved to-do went. **"N more"**: a past block's rows past six; it opens the block. **"Nothing planned"**: a past block with none.
- **"10:30–11:30 · 1h"**, **"· Outlook"**: a to-do's line under its title on Week's cards.
- Retired from visible copy: QT-1's past-day line ("2 done · 1 unfinished", "1 moved on") on Week and Day's cards.

## Backlog (BL-1)

- The tab is **Backlog** (never Ahead in what a person reads; Ahead is the code name). Its views are **Grid** and **Gantt**.
- The toolbar, left to right: the client chips, **People** (Mine, Contributing, Everyone), **Needs attention** with its count, **Search**, **Filter** with a count ("Filter · 2"), then **⋯** ("More: rows and view"). Never "Readiness", "Not ready only" or "Mixed".
- People across clients that differ names who gets what: **"Everyone for Northwind Foods, Mine for the rest"**.
- The line under the toolbar only off the defaults: **"Showing 33 of 583"**, then one chip per filter ("Needs attention", "Needs stories", "Stale", "Stories only, in rank order", "Next 4 weeks"), each with ×, and **Clear filters**.
- Status: one chip per row in the words of `plan/backlog-status.ts` (Blocked, At risk, Not scoped, Stalled, Watch, Needs a date, On track, Needs stories, No target date, Unassigned, Unsized, Stale), the rest as **"+2"**. An empty cell is **"+ date"**, **"+ owner"**, **"+ size"** on hover or focus, never a dash.
- The fix beside a reason: **Break down**, **Set dates**, **Assign**, **Size**, and **Skip** (Unskip in the Skipped list).
- The header: **"Backlog · 42 items"**, or with Needs attention on **"12 need attention"**; the change set **"3 changes to save"** with **Review**.

## ED-1 words (Nov 12)

- **Edit** (E) on the story card; **Save** (Ctrl+Enter) and **Cancel** at the foot, with "Nothing is written until you confirm the preview. Ctrl+Enter saves." The preview's button: **Save in DevOps**, **Move in DevOps**.
- **Add acceptance criteria**, a quiet button; its box's grey text: "One example and the answer it should give".
- The format buttons: **B**, **I**, **•**, **1.**, **Link** (read as Bold, Italic, Bullets, Numbers, Link); the look under the box: **"How it will read in DevOps"**; for a Markdown field: "Kept as Markdown, as DevOps stores it".
- "Fonts and colors from the old text will be removed." in Edit and the preview.
- A field that isn't a box says why in one line: "This has a table or an image, so it can't be changed here without losing it." (and "embedded content", "This mentions someone, … without losing the mention.", "formatting FocusTime can't keep"), then **Add to the end** and **Copy DevOps link**.
- **"Discard your changes?"** with **Discard** and **Keep editing**.
- **"This changed in DevOps since you opened it."** Nothing was written. Your words are still in the boxes. DevOps has now: … then **Save again**.
- **Move…** beside the parent and in the card's ⋯; "Now under: …", "Find a feature", **No parent**, "(now)", "Only the parent link changes. Area, iteration, state, dates, assignee and backlog order stay as they are.", then **Preview**.
- The owner's note: **"<name> edited #<id>"**. The preview: "Assigned to <name>, not you. They get a quiet note in FocusTime that you edited it."
- The write log: **Edited**, **Moved**, **Undo: edit put back**, **Undo: moved back**.

## IB-4 words (Nov 12)

- The Inbox's lists: **From chats**, **Promises**, **Captures**, each with its count. Never "Needs you", "Waiting on", "In progress", "Handled by teammates", "Chatter" or "Everything" in what a person reads now.
- A suggestion's actions: **Create item**, **Already covered**, **Dismiss** (toast **"Dismissed for you"** with **Undo**); under ⋯ **Add as my promise**, **This isn't work** (toast "Not work: closed for everyone on the chat", with Undo), **Open in Teams**. Its line: **"Why it needs an item: …"** and **"Suggested as a story: “…”"** (the client's own type name).
- The foot of From chats: **"Chats last checked 9:25 AM. A conversation shows here once it has been quiet for 4 working hours."** with **Refresh**; **"Northwind can't get suggestions now: AI is off for FocusTime."** with its fix.
- A conversation that isn't a suggestion: **"This conversation isn't waiting for anything."** with Open in Teams.
- Promises' foot: **"Cleared on their own · 2"**; each line says why: **"#2216 was finished"**, **"Not touched for 7 days"**, with **Put back** (toast "Put back: it stays until you close it"). The first look: **"3 older promises from chats were cleared."** with **Show**.
- The late filter from Week: **"Late promises for Northwind only."** with **Show all promises**.
- Captures' sections: **To sort** and **Drafts**.
- Empty states: **"Nothing from your chats needs an item."**, **"No promises open."**, **"Nothing to sort."**
- Day's chip: **"From chats · 2"**.
- Retired from visible copy: "N more in Inbox", "Up for grabs", "Asked you", "You're on it", "Teammate has it", "I'll take it", "Give to…", "Add helper", "Release", "Take it over", "Waiting on <Name>", "Unclaimed", "Snooze…", "Wake it now", "Hide for me", "Not a request", "Not work-related", "Merge into…", "N messages held back", "Sort unsorted", "Filtered as chatter (N)", "Post comment or Skip".

## NM-1 words (Nov 13)

The app's own words use the names the screens use. A string a person reads never uses a name on the Renamed list (`ui/guide/retired.ts`) and never writes a control as a character (⋯ ‹ › × or a lone +): `npm run guards` fails on one. An old name lives on only where people search: a setting's `old` names, a command's `aka`, search `keywords`, and the Renamed list. A word that is also an ordinary word ("Today" the day, "Loop closed") is on the guard's short allow list with its reason (`NAMES_ALLOWED` in `scripts/words-guard.ts`).

- A control is named: **More** (the top bar's menu, a to-do's or a row's menu), **View options** (Week's and Day's), **Actions** (a day's menu on Week, a suggestion's), **Previous**, **Next**, **Add**, **Close**. A path reads "More › Send feedback", "Settings › Activity".
- Tab tooltips, one line each: **"Day: what's next, what's urgent and the day's blocks"**, **"Week: the week's blocks, with a block's panel beside them"**, **"Backlog: every client's DevOps on one screen: Grid, Gantt and Needs attention"**, **"Status: this week's feature updates for Monday's status report"**, **"Inbox: From chats, Promises and Captures"**.
- Settings: the section **Day and Week** (was Today and Week); **Needs attention nudges** with the switch "Show Needs attention nudges" (was Readiness nudges); **Look-ahead rituals** (was Plan ahead rituals), "Both open Backlog › Gantt"; **"Let urgent requests through"** (was Let urgent asks through).
- Admin rules: **"Needs attention looks at the top N of each backlog"**, **"What Needs attention counts"**, **"Needs attention nudges"** (the level column).
- **Back to Day** on the phone's Backlog notice, the Focus screen and Close out. The notice: "Grid, Gantt and Needs attention need room for the whole backlog."
- Where a line points at Settings it names the section as it is today: **Settings › Activity** (Undo, Retry, what was logged), **Settings › Your data** (Export, Delete), **Settings › Accounts and calendars** (Outlook, Microsoft permissions), **Settings › DevOps** (a write PAT), **Settings › Focus** (break length), **Settings › Day and Week** (timeboxing, the level's defaults), **Settings › AI and assistant** (the assistant's history).
- The key list's Inbox row: "Inbox: what needs you, in three lists: From chats, Promises and Captures". Its rows say "a block's panel", never "the block panel" or "Add work" for the panel.
- Notices: "Click to open Day.", "Click to open Backlog's Gantt." with **Open Gantt**; the push title **"Promises due"**. Teams: "N more blocks on Day".
- Client calls: the heading **Promises**; a commitment from the client's side reads **"noted with this call"** (was "in your Waiting on").
- The command menu: the group **From chats** (was Requests), "Backlog › Gantt: the next 12 weeks" (was Plan ahead), "Timeline on Day", "Add a promise to Day", "Inbox items for Day and Week".

## NM-2 words (Nov 14)

- The command menu: the group **Send work** (was Team for sends and priorities), **"Sent to you and client priorities"** (was From your team); under **From chats**: **"Refresh From chats"**, **"Show a suggestion's messages"**, **"This isn't work"**, **"Undo This isn't work"**, **"Already covered: link a suggestion to an item"**, **"Find an item for a suggestion"**, **"Create an item from a suggestion"**, **"Sort chat messages waiting for AI"**; under **Promises**: **"Create a DevOps item from a promise"**, and Close the loop's steps **"Close the loop: draft the message"**, **"…: preview the message"**, **"…: send the message shown"**, **"…: check a sent message again"**, **"…: mark the message sent"**, **"…: messages sent"**; **"Remove from this week"**, **"Inbox list and clients"**. A check-in command not run from the menu says **"At the top of the Midday check-in and Close out"** or **"At the end of Close out"**.
- Client chats: **Asking phrases** (Settings: **My asking phrases**, **Team asking phrases**), "A message that is only these (and emoji) is **never checked**", **Client chats FocusTime reads**, a chat's **Start reading** and **Stop reading**, **"Not read: reading is off"**, **"New messages are read for what they ask and promise."** Admin: the section **Client chats**, **"Keep chat messages nothing was found in (days)"**, Status's **"Delete chat messages nothing was found in"**, Flex's **"Checking client messages"**, AI off stops **"chat sorting"**.
- **Client chats**, never Delivery chats; the kinds **Delivery team** and **Customer collaboration** keep their names.
- The chat permission: **"Client chats: chat names and members, never messages"**; Chat.Read's later: **"A FocusTime admin adds a client's chats in Admin › Clients"**.
- Needs attention nudges' hint: **"The readiness flags on Backlog's Gantt rows."**
- Pointers: **"It can show in Inbox › From chats again."**, **"Choose your VM first (Settings › Accounts and calendars)"**, **"Sign in with Microsoft (Settings › Profile) to use Teams status."**, **"Settings › Profile › Run setup again"**, **"Add it to a block on Week."**, **"sees it in To place, in a block's panel on Week"**. Notices: **"Click to open From chats."** with **Open From chats**; Ask to look and a Must that can't be taken: **Open Week**.
- The phone's day bar: **Previous day** and **Next day** as icons; Week's screen-reader name **"Week. Left and right arrows change the day, …"**.

## RB-2 words (Nov 14)

- The switch inside a client: **Files** and **By kind**. By kind's groups, in this order: **Reports**, **Semantic models**, **Pipelines**, **Notebooks**, **Dataflows**, **Lakehouses and warehouses**, **SQL**, **Other Fabric items**, **Other**. A row is the name, then what it is ("Report", "Semantic model · 3 tables", "Data factory pipeline", "Table in dbo", "YAML"), then the repo when the client has more than one. A model's caret is named **"Tables of <model>"**.
- By kind: **Filter by name**, **"Show all 120"**, **"Reading the file names…"**, **"Choose something in the list to open its file."**, **"Sorted by file and folder names only. No file is opened to sort them."**, **"<repo>: only the first 20,000 file names were read."**, and a repo that can't be read as **"<repo>: <the reason Code already gives>"**. With a file open: **"In <repo>, <folder>"** and **Show in files**.
- The search: **Search names** (the box and the command "Code: search names"), **Search**, **This client** and **All clients**, **All kinds**, **"Type a name, then press Enter or Search. Folder names count too."**, **Back to results** on a file opened from them (the phone's Back says **Results**), and under the box **"Searches names only. Measures, columns and report pages live inside files and aren't searched."**
- Results: **"Read 3 of 5 clients…"**, **"12 results"**, **"No name matches."**, **"Showing the first 200. Narrow your search."**, **"Left out: <client>. Only its team can read its code."**, a table as **"Table in <model>"**.
- The log line is now **"Opening a file is logged for FocusTime admins: who, which file and when. Listing by kind and searching names are logged too: who, which client and when, never the words."** Admin › Audit › Code views: **Listed by kind**, **Searched names**, with **All its repos** in the Repo column.
- Say **names**, never "index" or "catalog": nothing is kept between visits.

## BL-2 words (Nov 14)

Backlog lists the level chosen in Filter › Levels, in that level's own rank order.

- Filter › **Levels**: **Epics**, **Features**, **Stories** (each in the client's process's own words); each button's tooltip **"Features, in rank order"**. No checkbox under it.
- A client's header says what is listed and how: **"Features, in backlog order"**, or for a project with no order field **"Features by target date (no backlog order)"**.
- The Item column's heading **"Rank · Item"**; the rank number before each row at the level (its tooltip **"Rank 3 in this backlog"** and the last change in DevOps); rows under it have none.
- A row's parent is a quiet label at the end of its title (its type's icon and title); its tooltip **"In Epic #3305. Show only what's under it"**. Pressing it sets the Epic filter, whose chip names the parent's type when it isn't an epic (**"Feature: Shipment tracking dashboard"**).
- The command menu: **"Backlog: every client's DevOps in rank order, Grid"**, **"Backlog: stories in rank order"**.
- After a create at a level that isn't listed: **"Created #5101. Not shown here: Levels lists features"**.
- Retired: "One level as a list", "Stories only, in rank order" (the chip), "Show down to features" (the old Levels tooltip).

## RB-4 words (Nov 14)

- The search's switch: **Names** and **Inside files**. The box says **Search names** or **Search inside files**; the command is **"Code: search inside files"**.
- Under the box, Names: **"Searching names. To find where a table or column is used, switch to Inside files."** Inside files: **"Each client's DevOps is asked which files hold the words. FocusTime reads no file to search it."** then the one line of help: **"Plain words find files with all of them, as whole words. "A phrase in quotes", a * at the end of a word, and AND, OR and NOT in capitals work too."**
- Before a search inside files: **"Type what to look for, then press Enter or Search. A table or column name finds every file that uses it."** While asking: **"Asked 2 of 5 clients…"**. After: **"10 files"**, **"No file holds those words."**, **"No file of that kind holds those words. Try All kinds."**, when some clients couldn't answer **"10 files. 3 of 5 clients could be searched."**, and the clients that answered with nothing **"Nothing in Atlas and Tailspin."** Names under a kind: **"No name of that kind matches. Try All kinds."**
- A result is a file: its name, what it is, **"4 matches"** ("1 match"; nothing when DevOps counted none) and its path. Over the limit: **"Showing the first 100 of 340. Narrow your search."**, under a kind **"3 of this kind in the first 100 of 2,340 files. Narrow your search."**, and after changing the kind **"Press Search again to look for this kind in the whole search."** A search DevOps narrowed: **"DevOps was asked for SQL files only, by file type."**, under another kind **"This search was narrowed to one kind. Press Search again to look for this one."** Files on other branches: **"2 more files aren't listed: DevOps found them on another branch."**
- What a client says instead: **"<Client>'s DevOps doesn't have code search turned on, so FocusTime can't search inside its files. An administrator of that DevOps organization can add Microsoft's Code Search extension to it."**, **"DevOps is still indexing <Client>'s code, so there is nothing to search yet. Try again later."**, with results **"DevOps is still indexing this client's code, so some files may be missing."**, **"DevOps couldn't run that search as written. Check the quotes and brackets, and put a * only at the end of a word."**, and RB-1's lines for a token without Code (read), busy and unreachable. The quiet line: **"Only each repo's default branch is searched. Forks aren't searched."**
- In an opened file: **"1 of 4"**, **Previous match**, **Next match**, and when nothing could be marked **"DevOps found the words in this file, but none is marked here: it may match them in another way."**
- Names: a thing inside an item says its item, **"Table in dim · Gold warehouse"**; an item with things inside **"Warehouse · 4 inside"** and opens with **"Inside Gold"**; a file found only by its own name sits under **Files** as **"File in Sales semantic model"**. A SQL object says **"Table"** alone unless the path shows a schema.
- The log line: **"Opening a file is logged for FocusTime admins: who, which file and when. Listing by kind and searching are logged too: who, which client and when, never the words."** Code views: **"Searched inside files"**.
- RB-5, SQL objects in folders: the switch is **Group by** with **Schema** and **Type**. Type folders, in this order: **Tables**, **Views**, **Stored procedures**, **Functions**, **Schemas**, **Security**, **Shared queries**, **SQL projects**, **Scripts**. One of each, where a row or a result says it: Table, View, Stored procedure, Function, Schema, Security object, Shared query, SQL project, SQL script. A schema folder is the schema's own name as its folder spells it; an object with none sits under **No schema**. In the SQL group a database is **"Gold warehouse"**, **"Returns SQL database"**, **"Warehouse SQL project"** (with **" · <repo>"** when the client has more than one repo), and loose files sit under **Not in a database**. **Expand all**, **Collapse all**, **"Show all 150"**. A folder is read as **"dim, 12"**. A file in no database says **"In /scripts"**. "Stored procedure", never "sproc".

## ED-2 words (Nov 14)

- On a Grid row: the edit button's name **Rename** (F2); the row's menu **Rename**, **Move…** (M), **Edit description…** (E), and, while one is staged, **Undo rename** and **Undo move**.
- The title box is named "Title of #3313". Its refusals are ED-1's: "Type a title", "A DevOps title is at most 255 characters. This one is 260".
- A staged row says **Renamed, not saved** and **Moved, not saved**; hover: "Not in DevOps until you save. DevOps has: <old title>" and "In DevOps it is under #3350 <title>. Its place in the backlog order doesn't change".
- Move…'s popover: **Move under**, the box "Find a feature" (the level's own name), **No parent**, the parent now marked **now**, the button **Move**; under the list: "Only <client>'s own open items one level up (Feature). Only the parent link changes: area, iteration and the backlog order stay as they are. Nothing is written until you save."
- A drag: the pointer and the lit row say **"Move under <title>"**; over anything else "Drag onto a lit row to move #3354"; with nothing to take it "No row here can take it. Use Move… (M)". A screen reader hears "Dragging #3354 <title>. 2 rows can take it. Escape cancels.", then "#3354 <title> moves under <title>. Not saved until you save." or "Move cancelled."
- A refused move says why, with no "a" or "an" before a type's name (UC-2): "In <project>'s process, Epic isn't the level above User Story", "#130 is Done; FocusTime moves items only under open parents", "In <project>'s process, Epic is the top level, so it has no parent to change".
- The bulk bar: **Assign to…**, **State…**, **Size…**, **Move to…**. After one: "Assign to Dana Reyes: staged 3, skipped 2. Nothing is written until you save.", "State Active: staged 4, skipped 0. …", "Size 5: staged 1, skipped 1. …", "Move under <title>: staged 2, skipped 0. …", then **Why 2 items were skipped**.
- Skips: "Already assigned to Dana Reyes", "Already Active", "Closed isn't a state of Feature in <project>'s process", "Feature has no size in <project>'s process", "Already that size", "Already under it".
- A button that can't open for these rows says why when pressed: "Move to… needs rows at one level, so one parent fits them all", "Move to… needs rows from one client. A move never crosses clients", "Assign to… needs rows from one client: each client has its own people".
- State… on mixed types (UC-2): every state any ticked row's type takes is listed; one only some take shows "1 of 2: Feature" beside it, and the note says "The selection has 2 types (Feature, User Story). A state that fits only some rows sets those rows; the others are skipped. Nothing is written until you save." Picked, the result is "State On hold: staged 1, skipped 1." with each skipped row's reason ("On hold isn't a state of User Story in Logistics's process").
- Review's rows: **Title** and **Parent**, before → after ("#3350 Carrier rate alerts → #3310 Shipment tracking dashboard", "No parent"). Saved: "#3313 <title> Title · in DevOps", "not confirmed yet", "not written".
- The preview's line for a change set write: "Change this item in DevOps" (it listed dates, state, size and owner before; the rows under it say which fields); its undo: "Undo: put what this change set changed back".
- A title edit thrown away by a click elsewhere is said to a screen reader: "Title of #3313 not changed. Enter keeps an edit; a click elsewhere cancels it."
- Review's foot once everything is saved: "Nothing is waiting to be saved."

## RB-6 words (Nov 15)

- **Code** is a tab (the sixth, key 6), not a panel: say "the Code tab" or "Code in the top bar"; on the phone "More › Code". It has no Close.
- The one box: **Search code** (its placeholder and name). Its choices: **Names** and **Inside files**, **This client** and **All clients**, **All kinds** and the groups, **Search**. The line under them: **"Searches names only. Measures, columns and report pages live inside files: switch to Inside files for those."** or **"Each client's DevOps is asked which files hold the words. FocusTime reads no file to search it."**
- By kind's groups, in this order: **Reports**, **Semantic models**, **Pipelines**, **Notebooks**, **Dataflows**, **Lakehouses**, **Databases**, **SQL scripts**, **Other Fabric items**, **Other**. A database's row: **"Warehouse · 42 objects"**, **"SQL database · 12 objects"**, **"SQL project · 30 objects"**; an object inside one: **"Table in dbo · Gold warehouse"**. Retired: **Lakehouses and warehouses**, **SQL** (as a group).
- Empty right side, one line each: **"Choose a client to look around its code, or search above."**, **"Choose a repo on the left."**, **"Choose a file in the tree, or search for one above."**, **"Choose something in the list to open its file."**
- The log line, one line at the foot of every Code screen: **"FocusTime admins can see who opened, listed or searched which client's code, and when. Never the words."**
- Retired: **Find a file** (on Code's left side; a file is found with Search code), **Search names** as the box's name (the command "Code: search names" stays).

## RB-3 words (Nov 16)

All in one place in code: `WHERE_TEXT` in `plan/where-lookup.ts`. The three questions' labels and grey text are unchanged.

- The button at the end of **Where is it?**: **"Browse <client>'s code"** (its name and tooltip), or **"Choose a client first"** before a client is chosen; pressed then, the line under the box: **"Choose a client first, then you can choose from its code."**
- A row: the name as the repo has it, then what it is in a few words (**"Table · Gold warehouse"**, **"Report"**, **"Data factory pipeline"**), then the repo's name when the client has more than one. Under the list: **"12 more. Keep typing to narrow it."** The list's name: **"Names in <client>'s code"** while typing, **"Browse <client>'s code"** by kind.
- A row that opens: **Pages** (a report), **Measures and columns** (a model's table), **Open** (a model, a database, a schema or a type). The first row of a deeper level: **Back**.
- What a pick writes: **"dim.Customer (table, Gold warehouse)"**, **"Sales (report)"**, **"Customer (table, Sales semantic model)"**, a page **"Margin by region (page, Sales report)"**, a measure or column **"Total Sales (measure, Sales table, Sales semantic model)"**.
- Screen readers: **"5 names match. Press Down to choose one."**, **"1 name matches. Press Down to choose it."**, **"40 in the list."**, **"Added dim.Customer."**
- The quiet line under the box, one at a time: **"Reading Northwind's code…"** (browsing before the names are in), **"Still reading Northwind's code. Type as usual; names show when they're in."**, **"Only Fabrikam's team can read its code, so no names are offered. Type the name."**, **"Code is for Cooptimizers, so no names are offered. Type the name."**, **"FocusTime can't read Harbor's code yet, so no names are offered. Type the name."**, **"Contoso has no DevOps set up, so there are no names to offer. Type the name."**, **"Contoso has no code in DevOps yet, so there are no names to offer. Type the name."**, **"Contoso's code has no reports, models, tables or pipelines to offer. Type the name."**, **"Contoso's code couldn't be read just now. Type the name, or try again."** with **Try again**, **"Names from archive couldn't be read."**, **"There's no room for that in this answer."**
- Inside a second level: **"Reading the file…"**, **"This file is too large to list. Type the name."**, **"This report has no pages to list."**, **"This table has no measures or columns to list."**, **"This file couldn't be read. Type the name."**, **"This file wasn't read because FocusTime couldn't record that you opened it."**
- Admin › Audit › Code views: **"Listed names for Where is it? (New form)"** and **"Listed names for Where is it? (draft editor)"**.

## RB-3b words (Nov 16)

All in one place in code: `PICKS_TEXT` in `plan/where-picks.ts` (a client change) and `WHERE_TEXT` in `plan/where-lookup.ts` (the lookup).

- After a client change took out picked names, one line under the Client field: **"Took out 2 names picked from Northwind's code."** (**"1 name"** for one; **"Northwind's and Atlas's code"** when they came from two) with **Undo** (its name for a screen reader: **"Undo: put back the 2 names"**). After Undo: **"Put back 2 names. They're from Northwind's code, not Atlas's."** (**"It's"** for one). Screen readers hear each line once.
- A row that opens: **Pages** for a report in either format, **Tables** for any semantic model (review 3: TMDL models said **Open** before), **Measures and columns** for a table (a one-file model's table too).
- The browse button's tooltip: **"Browse Northwind's code (Alt+Down)"** (its name for a screen reader stays **"Browse Northwind's code"**, with Alt+Down as its key shortcut).
- A hidden page's row: **"Page of Region review · Hidden"**; what its pick writes: **"Store drill-through (hidden page, Region review report)"**. A one-file model's table writes **"Returns (table, Returns semantic model)"**, like any model table.
- While a second level is read: **"Reading the report's pages…"**, **"Reading the table…"**, **"Reading the model…"** (replacing "Reading the file…").
- Inside a second level, one line: **"1 page couldn't be read."** (**"2 pages couldn't be read."**), **"Some of this table's measures are kept in files that couldn't be read."**, **"This model keeps measures in more files than FocusTime opens here, so some may be missing."**, **"This report has more than 60 pages to list. Type the page's name."**, **"This model is too large to list. Type the table's name."**, **"This model has no tables to list."**, and, when the row can't be written, **"These names weren't listed because FocusTime couldn't record that you listed them."** (replacing the file line).
- Admin › Audit › Code views, What: **"Pages listed"**, **"Measures and columns listed"**, **"Tables listed"**, with the repo and the report's, table's or model's file under File. Its line: **"Who opened which client's code in Code, and when: the repo, the file, Find, or a report's pages and a model's tables or measures listed for Where is it? Never any of the code."**

## UC-1 words (Nov 15)

- A deployment saved with no title: **"Deployment - <client's name> - <date>"**, spaces around plain hyphens (never an em dash), the client's short name as its chip shows it, the date as everywhere ("Sat, Nov 7"; no year). Typed words are the title as typed.
- The capture box with Deployment chosen and nothing typed: the hint is that title; under the kinds: "Enter saves it as "Deployment - Northwind - Sat, Nov 7" · ↓ to its details". With no client: "A deployment needs a client · ↓ to its details".
- The Inbox's client chips: the name, then its number when something needs me there ("Northwind 3"); read aloud as "Northwind, 3 need you", "Harbor, 1 needs you", "All clients, 5 need you". No number when nothing does.
- A chip's hover line: "3 need you in Northwind: suggestions from chats, and promises late or due today. The same count as the Inbox tab's".

## UC-2 words (Nov 16)

- A deployment left untitled, wherever it is made (capture, Plan a deployment…, the assistant): **"Deployment - <client's name> - <date>"**, as UC-1.
- A sentence never quotes that made title; it names the day: **"The Sat, Nov 21 deployment is done."**, **"Tell Northwind the Sat, Nov 21 deployment is done"**, the assistant's **"Plan the Sat, Nov 21 deployment, 9:00–11:00"**. A typed title is used as typed: **"Release 4.2 is deployed."**, **"Tell Northwind it's deployed: Release 4.2"**.
- A deployment too narrow for its title (Week's weekend column, a narrow card): the client's short name and the window, the full title (and the window) on hover and for a screen reader.
- The Inbox's chip for things with no client: **"No client"** with its number, read aloud **"No client, 1 needs you"**; hover **"1 needs you with no client: …"**.
- Code: the second choice under Databases: **"Show"** (labelled so in By kind and in Search code) with **"All types"**, **"Tables"**, **"Views"**, **"Stored procedures"**, **"Functions"**; named **"Object type"** for a screen reader, in By kind and beside Kind in Search code.
- Backlog's bulk State… on mixed types: see ED-2 words (rewritten for UC-2).
- The move rule: **"In <project>'s process, Epic isn't the level above User Story"**, **"In <project>'s process, Epic is the top level, so it has no parent to change"**. No "a" or "an" before a type's name.
- Admin: **"Client chats"** (never "Delivery chats"); the missing Chat.Read line: **"A FocusTime admin adds a client's chats in Admin › Clients"**.

## VM-3 words (Nov 17)

- The reasons, one list (`OUTCOMES`, `plan/vm-autostart.ts`), each "Left off today: …": **"it is PTO"**, **"it is a holiday"**, **"FocusTime couldn't read your PTO"**, **"your Azure sign-in needs renewing"**, **"FocusTime couldn't find your VM"**, **"Azure refused the start"**, **"FocusTime wasn't running at the time"**. Not told, only shown: **"Started today"**, **"Started today, after your day began"**, **"Already on today"**, **"Not a day you chose"**, **"Skipped today"**, **"Paused"**.
- What to do next, after the reason: **"Start it from the VM menu if you need it today."**, **"Choose Allow Azure access in the VM menu, then start it if you need it."**, **"Choose your VM again in Settings › Accounts and calendars › My VM."**, **"Start it from the VM menu; if Azure refuses again, Settings › Activity has what it said."**
- Notes: **"Holidays couldn't be checked."**, **"Your PTO couldn't be read just now, so FocusTime used what it read earlier."**
- Settings' line after the planned time: **"Started today at 8:55 AM. Next: Tue, Nov 3 at 8:55 AM"**, **"Left off today: it is PTO. Next: …"**, **"Today's start (8:55 AM) hasn't run yet. Next: …"**. Unread days: **"Your PTO couldn't be read, so a day off may still show a time."**
- The notice: **"Your VM was left off"** with the reason and what to do (Start is in the VM chip's menu). VM-2's **"Auto-start couldn't sign in to Azure"** and **"Auto-start couldn't start your VM"** are kept for those two.
- Admin › Health: **"Background passes"**; **"<pass> has been running for N minutes, past its N minutes limit. The next pass runs anyway; the work that is stuck is named in the log."**; **"<pass> hasn't finished for N minutes while someone is using FocusTime."**

## MC-1d words (Nov 17)

- A call's states, the same on its meeting's mark, Client calls and its page: **"Waiting for the transcript"**, **"Review 6 proposals"** (an attendee: **"6 proposals to review"**), **"Nothing proposed"**, **"Reviewed"**, **"Upload the transcript"**, **"No transcript this week"**, **"Couldn't read the transcript"**, **"The AI step failed"**.
- A call's actions, in its meeting's menu (before Open in Outlook) and on its page: **"Review proposals"** (or **"Open the call"**), **"Read the transcript"**, **"Propose again"**, **"Upload a transcript"**; on a proposal **"Show in transcript"**; in More **"Client calls"** with **"1 need you"**.
- The mark for a screen reader: **"<call>: <state>. Review proposals"** (or **"Open the call"**).
- A failed step on the page: **"The AI step failed"**, then why, in the app's words for that failure ("The AI service didn't answer in time."), FocusTime's own reasons in its own words (**"FocusTime couldn't read this client's DevOps items to send with the call."**, **"AI isn't on for this client. A FocusTime admin allows it on the client's page in Admin › Clients."**), and for a call sent in parts **"The call was sent in 3 parts and part 2 failed, so nothing was proposed: a reviewer never confirms from half a call."**
- What happens next: **"FocusTime tries again by itself at 3:15 PM (1 of 3). A reviewer can Propose again now."**, **"FocusTime tried again 3 times and stopped. A reviewer can Propose again."**, **"FocusTime doesn't try this one again by itself: once that's fixed, a reviewer presses Propose again."**, **"A reviewer can Propose again."** (where nothing retries by itself).
- The reviewer's note (in the app and Teams): **"Northwind's call: the AI step failed"**, **"Nothing was proposed. Open the call to see why, then Propose again."**, button **"Open the call"**.
- The Transcript view: tabs (MC-1e: the segmented switch) **"Proposals"** and **"Transcript"** with their counts; **"Filter the transcript"** (placeholder **"Words or a name"**); **"2 of 8 lines"**, **"No line has "<words>""**; a marked line **"Proposal"** (read as **"A proposal rests on this line: <proposal>"**); **"Kept 30 days, for this call's reviewers and attendees only. Read only."**; **"The transcript is kept 30 days after the call. This one is gone; the proposals and what was done stay."**
- Last 20 requests: **"Failed · HTTP 400"**; the meeting task is **"Read a client call"**.

## MC-2 words (Nov 17)

From `plan/call-words.ts` (`CALLS_TEXT`, `FETCH_WORDS`).

- The area: **"Calls"** in More, the command menu (**"My calls"**, still found by "client calls"), the phone and the heading, with **"The calls you were on, and what to do about them."** Its lists: **"Client calls"** (**"Your clients' registered weekly calls"**) and **"Your other calls"** (**"Calls on your calendar in the last 14 days. Only you see this list."**). Empty: **"No client calls for you."**, **"No calls on your calendar in the last 14 days."**
- A row: its name, **"Mon, Nov 2 · 3:00 PM · 1 h"**, **"4 people"**, its state **"Not reviewed"** or a call's states, then **"Review"** or **"Open"**. A hand-added row says **"Added by you"**.
- **"Add a call"**: **"For a call that wasn't on your calendar. Only you see it."**, **"Name"**, **"Day"**, **"Start"**, **"Length"**, **"About"**, **"Add and upload the transcript"**, **"Cancel"**.
- The setup: **"Review <call>"**, **"Which client is this call about?"** (**"FocusTime suggests one. You choose; one client per call."**), an option **"Northwind (suggested)"**, **"Pick a client"**; **"Where does the transcript come from?"**: **"Get it from Teams"** (**"FocusTime asks Teams once, with your sign-in, for this call only."**) or **"Upload a file"**; a call Teams can't be asked for says why under the choice. **"Continue"**.
- Get it from Teams on the page, and what came of it: **"Got the transcript from Teams (42 lines). 6 proposals to review."**; **"Teams has no transcript for this call. Transcription may not have been on. Upload a file instead."**; **"This call is organized outside Cooptimize, so FocusTime doesn't ask Teams for it. …"**; **"Microsoft didn't let your sign-in read this call's transcript. The organizer may have turned transcripts off for attendees. Ask the organizer for the file and upload it here."**; **"This call isn't on your calendar, so FocusTime can't read it for you."**; **"This isn't a Teams meeting. Upload a transcript or recording instead."**; and the sign-in, consent, busy and unreadable cases, each ending at the upload.
- The summary: **"What was said"**, at most 5 lines, above the proposals on every call.
- Who sees: **"You and the Cooptimizers on the invite can see this call. Only you act on it."**; a hand-added one **"Only you can see this call."**; another viewer **"Only <name>, who asked FocusTime to review this call, can act on it. You can look."**
- A meeting's menu: **"Review this call"** (hint **"choose its client first"**), under **"Call"**.

## MC-3 words (Nov 17)

From `plan/call-words.ts` (`CALL_LIST`). A row's state keeps MC-1d's and MC-2's words (`CALL_STATE`, `CALLS_TEXT.notReviewed`); nothing was reworded.

- The tab: **"Calls"**, between Inbox and Code, its title **"Calls: review the calls you were on (6)"**, its count read as **"1 needs you"** / **"3 need you"**. The command menu says **"Calls"** (still found by "my calls" and "client calls"). Key 6 is **"Calls: the calls you were on, by day, with the one you choose beside the list"**; 7 is Code.
- The list's head: **"Calls"**, **"The calls you were on, newest first"**, **"Add a call"**, **"Hide the list"** (and **"Show the list"** beside the call when it is hidden).
- Filters: **"All"**, **"To review"**, **"Not reviewed"**, **"Done"**, each with its count; their titles **"Every call in the list"**, **"Calls waiting for you: proposals to review, a transcript to upload or a step that failed"**, **"Calls nobody has reviewed yet, or that wait for a transcript or for their reviewer"**, **"Calls that were reviewed, had nothing to propose or had no transcript"**. Client chips: **"All clients"**, each client, **"No client yet"**.
- Day headings: **"Today"**, **"Yesterday"**, then **"Mon, Nov 2"**.
- A row's second line: the client or **"No client yet"**, **"45 min"**, **"6 people"**, and where the transcript comes from: **"Transcript from Teams"**, **"Transcript uploaded"**, **"Read from Teams after the call"**, **"Uploaded by a reviewer"**, **"From Teams or a file"**, **"Upload only"**; a registered call adds **"Weekly · Weekly status call"** with the repeat mark.
- Folds at the foot: **"Earlier calls (2)"** (**"Calls from before the last 14 days that don't need you. Each goes when its transcript does, 30 days after the call."**) and **"Client calls (1)"** (**"Weekly calls a FocusTime admin registered. Their calls from the last 14 days are in the list above."**), each **"Reviewed by Priya, Alex"**.
- States of the list: **"Loading calls…"**, a failure's own words with **"Try again"**, **"No calls in the last 14 days. A call on your calendar shows here once it has started."**, **"No calls here. Choose All to see every call."**; under the list **"Only you see the calls from your calendar, and FocusTime keeps nothing about one until you review it."**
- Beside the list with no call at all: **"Calls turns what was said on a call into DevOps items, promises and comments you confirm. Review any call you were on, or add one that isn't on your calendar."** with **"Add a call"**.
- Two steps (narrow and the phone): **"Calls"** as the Back button, read as **"Back to Calls"**.

## PH-1 words (Nov 17)

- The phone's bar: **"Day"**, **"Week"**, **"Capture"**, **"Inbox"** (read aloud **"Inbox, 5"**), **"More"** (read aloud **"More: a source needs attention"** or **"More: new notifications"** with its dot). The VM: **"VM Stopped"**, **"VM Running"**. The top bar: the date (**"Mon, Nov 2"**), the VM's word, **"Ask"** (**"Ask the assistant"**).
- The Now card: **"Now"**, **"until 12:30"**, **"3h left · a 45 min meeting at 11:00"**, **"In Proposal review with Jordan until 11:45"**, the bar read as **"14% of the block has gone"**, **"Done: <title>"** for the box, **"Start focus"**, **"Focusing"**, **"Done"**, **"Stop"**, **"Nothing planned for this block."** with **"Add"** (**"Add to <client>"**). After the day: **"Close out"**.
- Next: **"Next"**, then **"11:00 AM Proposal review with Jordan · 45 min"**, **"12:30 PM Northwind · At risk · Dentist 12:00"**.
- The one thing: **"Needs you"** (**"Inbox"** since PH-2), then **"Late"**, **"Due today"**, **"From a chat"** or **"Needs you"**, its title, **"1 of 5"**. Then **"Today"** over the to-dos.
- More: **"Backlog"**, **"Status"** with **"2 features need your update"**, **"Calls"** with **"1 call to review"** (MC-2: was **"Client calls"**), **"Code"**, **"My VM"** with its state or **"Not set up"**, **"Settings"**, **"Guide"**, **"Everything else"**, **"Desktop version"** with **"The whole app as on a computer"**.
- Everything else: **"Notifications"** (**"2 new"**), **"Sources"** (**"All sources live"**, **"Some data is older"**, **"A source needs attention"**), **"Focus"** (**"Start a session or a break"**), **"Midday check-in"**, **"Close out"**, the person's name, **"Install app"**, **"Technical docs"**, **"About"**, **"Admin"**, and **"Back to More"**.
- The way back: **"Phone version"** (**"Back to the phone version"**).

## MC-1e words (Nov 17)

Every word below is in `plan/call-words.ts`.

- The filter row: **"All"**, **"New in DevOps"**, **"Promises"**, **"Comments"**, each with its count to review; beside it the switch **"Proposals"** (with the same count) and **"Transcript"**. The page's line: **"11 to review · 1 done · 2 skipped"**.
- Section headers: **"New in DevOps"**, **"Promises"**, **"Comments on stories"**, each with **"3 to review"** and **"Select all"** (**"Clear"** when all are ticked).
- A row's own buttons: **"Create in DevOps"**, **"Add comment"**, **"Add to Promises"** (a Cooptimizer's) or **"Note with this call"** (the client's), **"Skip"**; a failed one **"Try again"**; a skipped one **"Bring back"**. Folded at a section's foot: **"2 done"**, **"5 skipped"**.
- A new item's fields, as the New form says them: **"Level"**, **"Parent"** (**"Optional. Any open feature"**, **"No parent yet. Choose one, or leave it without"**, **"An epic is at the top: no parent"**), **"Assigned to"**, **"Target date"** (**"Optional"**), **"More: description, size and details"**. A field the process requires: the mark **"Needed"**, **"Required by this client's process"** beside it (filled or not), and on the row **"Target Date is needed: this client's process requires it on a new item of this type."**. One the form can't fill: **"Portal's process needs Risk on a new User Story, which FocusTime doesn't fill. Create this one in DevOps, then skip it here."**.
- A refusal after the check: **"DevOps says Target Date is needed on a new Epic. Fill it in on this row and try again, or create this one in DevOps and skip it here."**; otherwise **"DevOps refused one of this item's fields. Check the row's fields and try again."** or **"DevOps refused this change. Check the row and try again."**. Never DevOps's own error text.
- A stored comment above story level: **"This comment is on a Feature, above story level. Status is reported on features, so a call's comment never goes there: it won't be sent. Skip it."**. "In Monday's report" is gone.
- A promise kept: **"Added to Alex's Promises"** or **"Noted with this call: Dana Brooks"**, with **Undo**.
- The bar for ticked rows: **"3 selected"**, **"Send 3 to DevOps"**, **"Add 2 to Promises, Note 1 with this call"**, **"Skip"**, **"Clear"**; **"DevOps changes go 10 at a time: the first 10 of 14 now, the rest stay ticked."**; **"1 needs something on its row first"**; without write access **"Enable DevOps writes"**.
- Several skipped at once: **"7 skipped"** with **Undo**.
- From a transcript line: **"Proposal"** or **"2 proposals"** (opening a short list), named for a screen reader **"Go to the proposal: <words>"**.
- Propose again: **"7 new proposals to review. 3 left out: the same as ones already done, skipped or failed here."**, or **"Nothing new to propose."**.
- Back: **"Week"**, **"Day"**, **"Calls"** and the rest, named **"Back to Week"** or **"Back to client calls"**.

## PK-2 words (Nov 17)

Every word below is in `plan/pocket-words.ts` (the failures' too; the server and the page say the same).

- The section: **"Pocket recorder"** in Settings › Accounts and calendars.
- What connecting does: **"Connecting lets FocusTime count your Pocket recordings when you press a button here, so you know the key works. It never reads a recording's title, words or audio. Bringing in a recording for a client call comes later."**
- The steps, under **"How to connect"**: **"In Pocket, make an API key for yourself, from your own Pocket account. Don't use a key someone shares with a team."**, **"Choose what the key may do: tick only reading recordings (recordings:read). Pocket gives a key every permission when none is ticked. If Pocket asks for an expiry date, any date is fine; when the key expires, paste a new one here."**, **"Copy the whole key. It starts with pk_ (often pk_live_), and Pocket may show it only once."**, **"Paste it below and press Check and save. Nothing is saved unless Pocket accepts it."**, then **"Your key stays on FocusTime's server, encrypted, for you alone. Nobody else sees it or whether you connected, admins included, and it never goes to the AI or the logs."** and the link **"Pocket's guide to API keys"**.
- The field: **"Your Pocket key"** (a password field), its hint **"pk_…"**; the button **"Check and save"**, **"Checking with Pocket…"** while it waits.
- Connected: **"Connected"**, then **"checked just now"** (**"checked 5 min ago"**, **"checked 2 h ago"**, **"checked Nov 12"**) and **"6 recordings in the last 7 days"** (**"1 recording"**); **"FocusTime keeps your key encrypted, only for you, and never shows it again. It asks Pocket only when you press a button here."** Buttons **"Check again"**, **"Use a new key"** (**"The new key replaces this one only if Pocket accepts it."**, with **"Cancel"**) and **"Disconnect"**.
- Disconnect asks first (the row's buttons step aside while it asks): **"Disconnect Pocket? FocusTime forgets your key now. Your recordings stay in Pocket; you can also delete the key there."** with **"Disconnect"** and **"Keep it"**.
- After a press: nothing more after connecting (the Connected line says it), **"New key checked and saved."**, **"Checked. Pocket answered."**, **"Disconnected. FocusTime forgot your key."**
- The failures, each ending **"Nothing was saved."** (Check and save) or **"Your connection is kept as it was."** (Check again):
  - **"Pocket didn't accept this key. Check that you copied all of it, or make a new one in Pocket and paste that."**
  - **"Pocket didn't answer in time. Try again in a few minutes."**
  - **"Pocket is busy right now. Try again in a few minutes."**
  - **"Pocket answered in a way FocusTime doesn't understand; Pocket may have changed how it answers. Try again later, and tell your FocusTime admin if it keeps happening."**
  - Before Pocket is asked: **"Paste your Pocket key first"**, **"That doesn't look like a Pocket key: it is one line with no spaces"**, **"That doesn't look like a Pocket key: Pocket's keys start with pk_"**.

## VM-4 words (Nov 17)

The VM chip's words are in one place, `READ_PROBLEM` and `CHECKING` in `plan/vm.ts`; an unexpected failure's in `server/unexpected.ts`.

- While a read fails: the chip keeps its state with a hollow mark, its title **"Last read 1 minute ago"**, and the menu's first line **"Checking…"** with **"Read 1 minute ago"**. Ages: **"just now"**, **"40 seconds ago"**, **"1 minute ago"**, **"3 minutes ago"**, **"2 hours ago"**. After a restart, before the first read: **"Checking…"** alone.
- After 2 minutes, on the chip's face and the menu's first line, then the sentence:
  - **"Can't reach Azure"**: "FocusTime can't reach Azure to read your VM's state. It keeps trying; nothing to do unless this lasts."
  - **"Azure is busy"**: "Azure is busy and asked FocusTime to wait. It keeps trying; nothing to do."
  - **"Sign in to Azure again"**: "Azure wants you to sign in again before FocusTime can read your VM. Choose Allow Azure access."
  - **"Azure refused"**: "Azure refused to show your VM's state. If this lasts, check in the Azure portal that you can still see the VM, or tell an admin."
  - **"Can't reach FocusTime"** (the page's own request failed): "FocusTime isn't answering, so it can't check your VM. It keeps trying; nothing to do unless this lasts."
- Under the reason in the menu, what to do (`READ_NEXT`): **"Check your connection; FocusTime keeps trying"**, **"Nothing to do; FocusTime keeps trying"**, **"Your access may have changed: check the Azure portal or ask an admin"**. A sign-in is one item, **"Sign in to Azure again…"**, that signs in. The chip's face keeps the state's one word: **"Stopped · Azure refused"**; on the phone the state and the "!".
- **"Unknown"** only when Azure answers with no state.
- The automatic start: **"Today's start is waiting: FocusTime couldn't read your VM's state yet"** (shown, not told), and at the late limit **"Left off today: FocusTime couldn't read your VM's state"** with **"Start it from the VM menu if you need it."**
- An unexpected failure: **"That didn't work: FocusTime ran into a problem it didn't expect. Try again, and if it keeps happening, tell an admin (reference K7QH2M)."** A request that can't be read at all: **"FocusTime couldn't read that request. Reload the page and try again."**

## OP-1 words (Nov 17)

Every word below is in `plan/preview-parts.ts` (`partsLine`, `PREVIEW_WORDS`). The one preview's other words (Where, Writes as, Who can see it, Not now, Retry, Reload and review again, the flag and Replace) are unchanged.

- Before the first preview, when the changes take more than one: **"11 lines go in 2 previews, 10 at most in each."**, **"4 lines go in 3 previews, one client at a time."**, **"21 lines go in 4 previews, one client at a time and 10 at most in each."** Status says "lines", the timebox check-in "updates".
- The preview's head when it is one of several: **"Add comment in DevOps · Preview 2 of 3"**, or **"3 DevOps changes · Preview 1 of 2"**.
- Its Confirm for the kinds OP-1 brought to it: **"Save comment in DevOps"**, **"Delete comment in DevOps"**, **"Set Remaining Work in DevOps"**. GD-2's flag says where the text goes: **"Northwind's DevOps and Monday's report"** on Status.
- The timebox check-in after the preview: the heading **"Time left, in DevOps"**, and rows **"Saved"** with **Undo**, the refusal in the framework's words, **Retry** when the answer was lost, **"Not sent"** when Not now stopped the rest, **"Nothing to change"**.
- Break down: **"Preview 5 items…"** opens the one preview; afterwards **"Created 5 items under #1120:"**, **"Not created yet (2):"** with each reason, **"Retry the rest"**; **"Every kept story is in DevOps already, or waiting for Retry"**. "Create all" is gone.
- Send feedback's preview, in the same parts: the head **"Send feedback"**; Where **"DevOps · <org> · <project>"**, Writes as the person (or **"Not set up yet"**); the new item's **Title**, **Description** and **Tags**; Who can see it; **"Send feedback"** (Ctrl+Enter) and **"Not now"** (back to the text); **"Sent once; nothing is retried on its own."**

## PK-1 words (Nov 17)

Every word below is in `plan/call-words.ts` (`POCKET_TEXT`, `CALL_ROW`) or, for refusals, `actions/transcript-file.ts`.

- The upload area: **"Upload the transcript"**, then where to get it, **"Recorded it on Pocket? Export the transcript from Pocket and upload the download as it is."**, and **"FocusTime takes a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)."** Its buttons: **"Choose a file"** **"or drop it here"**, **"No transcript this week"**. The call's **"Upload a transcript"** button says the same in its tip.
- While a file is dragged over the call's page: **"Drop the file here"** (the upload area), or **"Drop the file here to replace the transcript"** (the call's actions, when there's no upload area). Several files: **"One file at a time: drop just the transcript."**
- A drop onto a call that already has a transcript asks, in Propose again's words: **"Replace this call's transcript? The open proposals are replaced, with any words you changed. The ones done, skipped or failed stay, and the same thing again is left out."**
- The date: **"This Pocket recording is from Sun, Nov 1, 27:02 long. This call is Mon, Nov 2. Use it for this call?"** with **"Use it for this call"** and **"Don't use it"** (then **"Nothing was kept. Upload the recording from this call's day."**).
- After an upload: **"Read 8 lines. 7 proposals to review."**
- Once, above the proposals and above the Transcript: **"From a Pocket recording. Speakers aren't named, and Pocket can mix them up."** The page's line says **"From the transcript (8 lines)."** (no count of people). Speakers are **"Speaker 1"**, **"Speaker 2"**; no time on a line or a quote.
- A promise whose words don't say whose it is: **"Pocket didn't say who · noted with this call"**; kept: **"Noted with this call. Pocket didn't say who"**; in Waiting on it is from **"Someone on the call"**.
- Where a call's source is shown (Admin › Clients › <client> › Calls): **"Pocket export uploaded by a reviewer Nov 17, 3:05 PM"**.
- Refusals, by kind and count, never a name: **"That file isn't one FocusTime reads. FocusTime reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)"**; **"That zip has no transcript in it (2 other files). …"**; **"That zip holds 2 PDFs. FocusTime reads one transcript at a time: upload a zip with one in it, or the file by itself"**; **"That zip has another archive inside it. FocusTime opens a zip with the transcript file directly in it"**; **"That zip holds 24 files. FocusTime opens a zip of at most 20, with the transcript in it"**; **"That zip is over 20 MB unpacked. …"**; **"That zip can't be opened: it may be damaged or locked with a password"**; **"That PDF has no text in it: it may be a scan. …"**; **"FocusTime found no transcript in that PDF. …"**; **"That PDF has 612 pages. FocusTime reads a PDF of up to 500"**; **"That PDF took over 10 seconds to read, so FocusTime stopped. Nothing was kept"**; **"That PDF is locked with a password. Export it from Pocket again without one"**; **"That PDF can't be opened: it may be damaged"**.

## EV-1 words (Nov 17)

Every word below is in `ui/appenv.ts` (`SITE_MARKS`, `SITE_WORDS`) or, for the page and the manifest, `server/site-env.ts`.

- The top bar's mark: **"Dev"** on the dev site, **"Local"** in the developer loop; nothing on production. Its tip and what a screen reader says: **"This is FocusTime's dev site, not production."** and **"This is FocusTime's developer loop on this computer, not production."**
- The browser tab: **"Dev · FocusTime"**, **"Local · FocusTime"**; production's stays **"FocusTime"**.
- The installed app: **"FocusTime Dev"**, **"FocusTime Local"**; production's stays **"FocusTime"**.
- About (Settings › About and the About dialog): **"Site: Dev · <address>"**, with **"Local"**, **"Production"** or **"Demo"** for the others.

## RQ-1 words (Nov 17)

The needed-field words are in `plan/needed.ts` (`NEEDED_WORDS`); a call's own buttons in `plan/call-words.ts` (`CALL_ROW`).

- A field the client's process needs, as DevOps says when it checks the new item: the mark **"Needed"** beside its label, and **"Required by this client's process"** under it, kept once it's filled. Other fields still say **"Optional"**. An empty needed date reads **"Choose a date"**.
- A call's row now names the type: **"Target Date is needed: this client's process requires it on a new Feature."** (was "…on a new item of this type.").
- The line under a form while its preview waits: **"Target Date is needed: this client's process requires it on a new Feature. Fill it in, then preview again."**.
- A field FocusTime has no control for: **"Northwind's process needs Risk on a new User Story, which FocusTime doesn't fill. Create this one in DevOps, or save it as a draft."** (a call's row keeps **"…then skip it here."**).
- The draft editor, for a field only the New form has: **"Size is needed by this client's process. Create in DevOps opens the New form to fill it in."**.
- The New form shows **"Start date"** only when the process needs one.
- Break down's Review: above the cards, **"Target Date"** with **"Needed"**, a date, **"Use for all"** and **"Target Date starts from the feature's. Change any one, or use one for all."** (or **"Required by this client's process"** when the feature has none); on each card the same field with **"Needed"** until it has a value; under the total **"5 stories need a value before the preview"**, and Preview waits.
- A refusal at Confirm, or one stored from before: **"DevOps says Target Date is needed on a new Feature. Fill it in and try again."**, or **"DevOps refused one of this item's fields. Check the fields and try again."**. Never DevOps's own text (no "TF401320").
- A call's feature-tier row: **"Create and break down"** beside **"Create in DevOps"**, its tooltip **"Creates it through the preview, then opens Break down on it and starts Run. Nothing more is created until you confirm the stories."**; a feature created from the call keeps **"Break down"**.
- The three questions show at story level only. Above it the fold reads **"More: description and size"**.

## NT-1 words (Nov 17)

- Settings › Notifications › Quiet hours, the field **"Days off"** with the switch **"Quiet on days off"** and the hint **"PTO and company holidays from Dataverse."** (`DAYS_OFF_WORDS`, `plan/notify.ts`, the one place the screen and Settings search read). The stored setting is unchanged (`[notify] quiet_pto`); search still finds the old **"Quiet on PTO days"**.
- A day off, wherever notices are described: **"a day off"**, said once as **"PTO or a company holiday"**. In Messages in Teams' hint: **"never in quiet hours, on days off or weekends"**.
- Nothing new is shown or told: a day off quiets what it did before, and now holidays count.

## DY-1 words (Nov 17)

The meeting words are in one place, `MEETING_WORDS` in `plan/call-words.ts`; the folded line's in `foldWords` (`plan/day-fold.ts`).

- Day's menu: **"Fold blocks that have ended"**, ticked to start. The command menu finds it as "Fold ended blocks" too.
- A folded block's line: the client, the times, then **"2 done"**, **"1 not done"** (in the late color once the block has ended), **"3 meetings"** (**"1 meeting"**), and a call still to review as its mark. A block with nothing planned: **"Nothing planned"**.
- The arrow: **"Fold <client>"** and **"Unfold <client>"** for a screen reader; on hover **"Fold this block to one line"** and **"Unfold this block"**. The folded line says **"Unfold this block"** on hover.
- A meeting that is one of a series on the calendar: the repeat icon, **"Repeats"** to a screen reader and on hover. Where a rail has no room for it, its hover ends **"· Repeats"**.
- A registered call: its type beside its state, **"Weekly status call · Review 11 proposals"** (the type gives way first where it is narrow); its label **"Weekly status call, Northwind weekly status call: Review 11 proposals. Review proposals"**; its menu's first group is the type; the menu title **"<meeting> · Weekly status call · Review 11 proposals"**. A call never also shows Repeats.
- The register form, under the type: **"Both types are read the same way. The type is how the call is named on Day, Week and the call's page."**

## PH-2 words (Nov 17)

All in `plan/phone-week.ts` (`WEEK_TEXT`) and `plan/phone-now.ts` (`PHONE_TEXT.one`).

- Week's header: the dates (**"Nov 2–6, 2026"**, read as **"Week of Nov 2–6, 2026"**), **"Previous week"**, **"Next week"**, **"This week"**. Rows read as **"Days of the week. Tap a day or a block to open it; swipe sideways to change the week."**
- A row: **"Tue"**, **"Nov 3"**, then the due badge's words: **"Due today"**, **"Due tomorrow"**, **"Due Fri · 2"**.
- A tile: the client, **"Open"**, **"Catch-up"**, **"PTO"**, **"No working hours"**; its line: **"Now · 2 to-dos"**, **"At risk · Dentist 12:00"**, **"1 done · 2 not done"**, **"3 to-dos"**, **"1 to-do"**, **"1 of 3 to-dos done"**, **"3 done"**, **"Nothing planned"**. One tile across: **"You're off"**, the holiday's name over **"You're off"**, **"Weekend"** with **"7:00 Deploy · 2 more"**. **"Evening"** with its first thing. Read as **"Tuesday, November 3, morning: Northwind. Now · 2 to-dos. Open Tue"**.
- A day: **"Wed, Nov 4"**, **"Previous day"**, **"Next day"**, **"Today"**, **"Week"** (**"Back to Week"**). A section's name read as **"Northwind, morning: open the block"**; **"At risk · <reason>"**; **"Done: <title>"**; the size (**"1h"**, or what's left); **"Nothing planned"**; **"Nothing planned Tuesday."**; the card's **"3 meetings · 2h 30m · 1h 45m free"** or **"No meetings"**; **"Add"** (**"Add to Northwind"**); **"Evening"**.
- The Inbox one at a time: **"Inbox"**, **"1 of 5"**, the lists **"From chats 2"**, **"Promises 7"**, **"Captures 2"**, **"For Marcus Bell"**, the actions' own names (**"Close the loop"**, **"Create item"**, **"Dismiss"**…), **"More"** (**"More actions for <title>"**), **"Previous"**, **"Next"**, **"Up next"**, **"Nothing needs you now."**, and on the lists **"Back"** (**"Back to what needs you, one at a time"**).
- Settings › Display on the phone: **"Day on this phone"**, **"Show Day as a timeline"**, **"The hours beside each block, with Timebox my day. Only this phone; your computer keeps its own."**

## DP-3 words (Nov 18)

The screen words are in one place in code: `PEOPLE_WORDS`, `HOLD_WORDS`, `LEFT_HOLD`, `STALE_SAVE` and the helpers in `plan/shared-deploy.ts`.

- The field on every form that makes or edits a deployment: **"People"**, me first as **"You"** (not removable), each other person a chip with **"Take <name> off it"**; the picker **"Add someone at Cooptimize"** (labelled **"Add someone"**), its groups as everywhere (**"On <client>"**, **"Everyone at Cooptimize"**); chosen from the list, never a typed name (**"Choose someone from the list"**).
- Refused on the server: **"Only Cooptimizers can be on a deployment. Choose someone from the list"**, **"<Name> hasn't signed in to FocusTime yet, so it can't show in their plan"**.
- Who is on it, where it opens: **"On it: You and Jordan Lee"**, **"On it: Alex Rivera, You and Priya Shah"**, **"Only you are on it"**; for the person added: **"· Added by Jordan"** (a first name). On a row: the people mark and the number (**"2"**), hover **"On it: Alex Rivera and Jordan Lee"**, read as **"2 people on it: Alex Rivera and Jordan Lee"**.
- Who a change is for, one line on the form: **"This changes it for Jordan Lee too"**, **"This changes it for Jordan Lee and Priya Shah too"**. Nothing when only I am on it.
- The undo line after a change for everyone: the usual line and **"· for all 3 on it"** (**"Deployment saved · 19:00–21:00 · for all 3 on it"**, **"Moved to Tuesday · Release 4.2 · for all 2 on it"**).
- Two saves at once, the later one: **"Someone else on this deployment changed it while you had it open. Nothing of yours was saved. Look at what changed and save again. It is now: Release 4.3, Sat, Nov 21, 10:00 AM to 12:00 PM · note "Reports too" · changed by Jordan Lee"**. The form keeps what I typed; Save again saves it.
- ⋯: **"People on it…"** (hint **"3 on it"** or **"only you"**), **"Take me off"** (hint **"stays for Jordan and Priya"**), **"Delete for everyone…"** in place of Drop (which, with others on it, says **"Others are on this deployment. Take yourself off it, or delete it for everyone"**). Undo lines: **"Took you off "Release 4.2""**, **"Deleted "Release 4.2" for all 3 on it"**.
- Delete's question names the others: **"Delete it for everyone? Jordan Lee is on it too, and it comes off their plans."** (**"…Jordan Lee and Priya Shah are on it too…"**), then **"Delete it for everyone"** or **"Keep it"**.
- My own Outlook only, one line and its one offer: **"Not on your Outlook"** · **"Put on my Outlook"**; **"On your Outlook"** · **"Take off my Outlook"**; **"Your Outlook still shows the old time"** · **"Update my Outlook"**; **"Going on your Outlook"**; **"Your hold was deleted in Outlook"** · **"Put it back"** (and **"Take me off"** with others on it); **"You moved your hold in Outlook"** · **"Move the deployment for everyone"** (with others on it) or **"Put my hold back"**.
- A hold left on my Outlook: **"A hold for a deployment you're no longer on is still on your Outlook: Release 4.2"** · **"Remove it"**; several: **"2 holds for deployments you're no longer on are still on your Outlook"** · **"Remove them"**.
- Notices (Settings › Notifications › **"Deployments you're on"**): **"Jordan added you to a deployment"**, **"Jordan moved a deployment you're on"**, **"Jordan took you off a deployment"**, **"Jordan deleted a deployment you were on"**; the body **"Northwind: Release 4.2, Sat, Nov 21, 9:00 to 11:00 AM."** then **"Click to see it in Week."** or **"It's off your plan. Check your Outlook if it was there."**
- The demo: Settings › Your data › **"See the demo as"**, **"Alex Rivera (you)"** and the teammates who use FocusTime.


## SA-2 words (Nov 18)

- **One name per setting.** A setting's label lives in `ui/settings/registry.ts`; its row, search, links and the Undo message ("Focus length saved.") read it. A label makes sense without its help; a switch's label says what on means and isn't repeated beside the switch.
- **Ask before changing my own timebox events** is the timebox switch: ticked when FocusTime asks first (it stores `confirm_own` as it always did).
- **Midday check-in** is the notice kind (was "Check-in"), as on Today and in Teams.
- **Team values:** "Set by your FocusTime admin". A team default the person changed: "Team default: <value>." with **Reset** (its name for a screen reader: Reset to team default).
- **More about this** holds the rest of a help line, word for word.
- **Saved**, **Saving…**, **Couldn't save. Retry** are the one saved mark.
- Rewritten so no Renamed name shows: the Needs attention flags on Backlog's Gantt rows (was "readiness flags").
- Renamed labels (each keeps its old name in `old` so search still finds it): Profile photos; Put new timeboxes on Outlook; Let urgent requests through during focus; Devices that get notifications; Offer Break down on features that need stories; Show Needs attention nudges; Carry over unfinished to-dos from the last (days); Offer DevOps updates at the end of the day; Add a Teams meeting to help sessions; Play a sound when focus or a break ends; Set my Teams status while I focus; Plain focus sets my status to; Pause music when focus ends; Stale after, Stalled after and Watch within with their units; Break down looks back (months); Show the catch-up day; Use the demo as; Send me reminders and Teams messages from this test site.

## SA-4 words (Nov 18)

- **Admin's places:** Clients, People, Team defaults, Health (was Status) and Audit. Team defaults' tabs: AI, Client chats, Planning and new people, Standards. A client's tabs: Overview, Chats, Calls, AI, Code, Deployments, Backlog rules. People's tabs: People, Who's set up, Client logins, Levels, Admins. Audit's: Settings changes, Code views. Written "Admin › Team defaults › AI", "Admin › Clients › <client> › Calls".
- **One name in Admin and Settings** for a team value: Promise phrases; Thanks and short replies; Help invites go only to; Never suggested, for everyone; Watch at; At risk at; Shortest useful focus window. A number's unit sits beside the box ("minutes", "days", "US dollars"), never in its label.
- **A switch says what on means:** "Use Flex for <task>", its help "Flex: half price, slower" or "Standard: full price"; AI for FocusTime's help "On: AI runs where a client allows it. Off stops every AI request at once."
- **A client's marks** on the list and its page: "2 chats read", "No chats", "1 call", "AI allowed", "AI off", "Code: whole company", "Code: its team only", "DevOps read", "DevOps not read".
- **Which accounts:** Customers N, All accounts N. **Find a client** (by name or other name). **See changes** opens Audit filtered to the client.
- **Signed in and set up** is People's one column: "Last sign-in Nov 2", "Setup: Done", "Dataverse: Matched", "Sources: Microsoft".
- **Which items count** is the scope row on Backlog rules: Automatic, Whole project, By team, By area path, each with its count where known.
- Someone who isn't an admin, at any Admin address: "Admin is only for FocusTime admins (the "FocusTime Admins" group in Entra)." with where Settings shows the team's values.

## CO-1 words (Nov 18)

- **When**, with "times in <zone>" ("times in Eastern Time"); **Day**, **Start**, **End**, the length chips.
- **Check who is free**; while it runs "Checking who is free…"; before anyone is chosen "Choose who to ask first"; Who's legend "N chosen" or "choose who to ask".
- The answer, one line each: **"Everyone is free"** or **"2 of 3 are free"**; "You: free", "You: a day off", "You: outside your working hours (8:00–5:00)", "You: Design review 10:00–10:45" (my own events by name; "Lunch"); "<Name>: Free", "<Name>: Free (hours not shared, 9:00–5:00 assumed)", "<Name>: Busy 10:00–11:00", "<Name>: Outside their working hours (8:00–4:00 Pacific Time, 11:00–7:00 your time)", "<Name>: Outside their working hours (not a working day for them)", "<Name>: Away that day", "<Name>: Couldn't read their calendar".
- Refusals: "That start has passed. Pick a later start", "The end is before the start. Pick a later end", "A help session is 15 minutes to 2 hours. Change the end or the length", "Times are to the minute"; at Confirm "That start has passed. Pick a later start and preview again".
- **Or let FocusTime find a time** (Find times folded under When); "Times when everyone is free inside their own working hours and yours. Free/busy only, no event details. Pick one to put it in When."; "<length>, the length in When"; suggestions read "Mon, Nov 2, 2:00–2:30 with Jordan Lee".
- The footer: "Check who is free first. Nothing is sent until you confirm the preview." until checked, then "Nothing is sent until you confirm the preview."
- The preview: **"Not everyone is free then. You can still send it."** above its fields, with the lines; "Couldn't check who is free just now".

