# FocusTime wording guide

Step 15 (D270). Applies to every string a person sees: views, buttons, menus, hints, notices, notifications and the command menu. Code names (`planday.commit`, `slot`) stay as they are; only visible copy follows this guide. Terms follow the glossary in `CLAUDE.md`.

## Three rules

1. **Plain.** Words a teammate would use out loud. "Morning", not "AM slot". "Where you left off", not "resume note". "Done", not "commit".
2. **Short.** One line. Cut "please", "currently", "in order to", and anything the layout already says. A button is a verb or a verb and an object ("Add work", "Close the loop").
3. **Calm.** Say what is true and what you can do next, never what went wrong with the person. Re-planning is normal: "Move to Tue", not "Slipped". Questions only where a choice is real, and only in the ritual that asks it ("Still realistic?" is Check-in's alone).

## Color goes with words, never alone

| Tone | Use for | Examples |
|---|---|---|
| Neutral (muted text) | Facts and fit that is fine | "Fits", "Room for about 45m more", "2 of 3 picks done" |
| Amber (`--watch`) | Worth a look, not a problem | "About 1h over", "Due tomorrow" |
| Orange (`--due`) | Due today | "Due today" |
| Red (`--risk`) | Real problems only | "Overdue 2 days", "At risk", a source down, a write that failed |

Fit is never red. Being over plan is a choice to make, not a failure.

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
