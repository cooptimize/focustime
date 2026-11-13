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
- **Allow AI is off for this client (Admin › AI)**: a client the estimate and the classification skip.
- **Request type**, **layer**, **readiness as written**, **missing**, **confidence**, **feature shape** (the layers a parent's children touch, in order): the classification's words. **Check by hand**: 30 items with their labels, only for clients you're on.
- **Platform**: Azure, Fabric, Both or Not set, set on the page.

## SG-1 words (Nov 11)

- **Suggested**: the small word over a block's offers ("Suggested · Keep all · Clear"); its hover says they're offers and nothing is planned until kept. A row's hover gives its reason: "Unfinished from Mon", "Next in <client>'s backlog", "Target date Fri", "Needs breakdown".
- **"5 suggested · Keep all · Clear"**: a day's line, in Day's header row and in the day's header on Week.
- **Keep**, **Keep all**: make the offer an ordinary to-do (a feature: placed on the block). The notice says "Kept <title>" or "Kept 3 to-dos for Tuesday", with Undo.
- **Clear**: a row, "not this one this week"; a block, "no suggestions on this block for the rest of the day"; a day, "no suggestions on Tuesday". The notice says "Cleared …" with Undo.
- **"3 suggestions are in your blocks."**: the morning card's line under "Nothing on today yet", with Keep all.
- **Suggestions**: the switch in Day's and Week's ⋯; **Suggest work for empty blocks** in Settings › Planning.
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
