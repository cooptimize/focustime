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
| Amber (`--watch`) | Worth a look, not a problem | "Due tomorrow" (QT-2: never how much is planned, anywhere but Ahead's Gantt weeks) |
| Orange (`--due`) | Due today | "Due today" |
| Red (`--risk`) | Real problems only | "Overdue 2 days", "At risk", a source down, a write that failed |

Fit is never red. QT-1 and QT-2: nothing a person reads says they planned too much (Day, Week, the panel, the midday check-in, the assistant, Teams, notices, the Guide); they say the free time. The plan is a punch list. The one exception is Ahead's Gantt weeks ("about 2h over"), a forward-planning view and an open question.

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
- Retired from visible copy everywhere: fits, doesn't fit, About N hours over. Move one?, A little over, overloaded blocks, too much planned, Over your <day> hours by …. Ahead's Gantt keeps "about 2h over" per week for now (open question).
