# U3: Week overhaul and the shared detail panel

U3 builds the Week part of the U1 plan (`docs/ux/U1/report.md`, the designer prompt and its mockups), plus one detail panel shared by Week and Today, a type scale for Today and Week, and a quieter status bar. Where the step's prompt and the mockup differed, the prompt won.

Screenshots come from demo mode only:

- `screens/before/`: Week at the end of U2 (032ca28), 1920 dark and light (with `-p2` for the part below the fold) and 3840 dark.
- `screens/after/`: 1920 dark and light, 3840 dark; Week and Today › Now, each with and without the panel.

## What changed

### Week header

- Title "Week of Nov 2–6, 2026".
- Musts as a swatch plus "0/2" per client. Amber when the client's week is tight, muted otherwise. The client names moved to the tooltip.

### Day headers

- Weekday, date and the Today pill.
- A **Plan** chip only on days not planned yet. "Planned ✓" is gone.
- A **PTO** pill, with the reason on hover.
- ⋯ shows on hover, and when the day holds the selection.
- No ALL DAY, BEFORE or AFTER labels. All-day events are chips under the header, and before and after events are one small line, only when there are any. Their rows stay empty otherwise so cards still line up across days.

### Cards

- **Header:** swatch, client, a muted "9:00–12:30" and ⋯ on hover. Then the one status pill with its reason ("At risk · Dentist 12:00"). No AM/PM labels anywhere on the grid.
- **The rail is the one home for meetings.** The in-card meeting and personal lists are gone. At 1920 the rail is always on and wider: 186 px, or 140 or 96 px on narrow cards. Full titles show on hover. Drag and resize are unchanged.
- **Picks:** title, plus the size chip, + time and ⋯ on hover. A timed pick always shows its time. Done picks collapse to "N done" on days other than today.
- **Follow-ups** show only as due badges, for follow-ups due this week or overdue, once in the week (`weekDueBadges`). A badge opens the panel on that follow-up. The FOLLOW-UP lines are gone.
- **+ Add work** on hover.
- **One features line:** "2 features · 1 needs stories" for the client's features on this week's list. It opens the panel on the features. The THIS WEEK lines are gone.
- A **PTO day** is one hatched cell. **Friday** is one dashed "Catch-up" column holding the work moved there and its calendar items. "Not a working day" and "PTO · nothing planned" are gone.

### The detail panel (`ui/DetailPanel.tsx`)

- On the right: 440 px at 1920, 560 px at 3840. Week and Today use the same panel.
- **Opens from:** a card's body (on a pick row it opens on that pick), the features line, a due badge, or Enter on the selected card.
- **Closing:** Esc closes it unless a menu is open above it.
- It is not modal. The arrow keys keep moving the selection and the panel follows. F6 treats it as the panel region.
- **Contents:**
  - client, date, time range and the block's ⋯;
  - risk reasons in full sentences;
  - the agenda with free gaps (Plan the day's `Agenda`);
  - picks as full rows, with Start focus on the first pick still to do, today only;
  - where you left off;
  - the client's features this week, with story counts and Draft stories and Coop brief;
  - the client's follow-ups;
  - DevOps items assigned to me and not planned this week.
- It replaces Week's Details dialog (`ui/Details.tsx`, deleted) and Today's 3840 pick detail.

### Type scale

- Four sizes and three weights on Today and Week:
  - 11, 12, 13 and 15 px (`--fs-1` to `--fs-4`);
  - 400, 500 and 600.
- Uppercase only for section labels.
- Text styles: Week 23 → 9, Today › Now 27 → 8.
- Recorded in `docs/design/style-guide.md` section 4 and on `/styleguide`. Checked at 1920 and 3840 by `e2e/week.test.ts`.

### Status bar

When everything is live, it shows a green dot and Refresh only. A source's age shows only beside a stale or failed source.

### Bugs

- **THIS WEEK lines:** removed. They repeated stories beside their feature on every card of a client, which is what U1 saw as duplicates.
- **Week plan duplicates:** the store already refused a second row for the same week, client and item (a UNIQUE key since migration 8), so I found no true duplicates. To be safe:
  - adding an item now matches the client key in any letter case;
  - migration 21 removes rows that differ only in letter case, keeps the oldest, moves its pins, and records each removal in `dedupe_log`;
  - the server logs the count once.

## Counts and clicks

See `counts.md`. Headline numbers (1920 dark demo, UI words):

| Screen | U1 | U3 |
|---|---|---|
| Week | 280 | 102 |
| Today › Now | 157 (U2: 72) | 65 |

- Week elements: 185 → 73.
- Text styles: Week 23 → 9, Now 27 → 8.
- Clicks:

| Job | Clicks |
|---|---|
| See why a block is at risk | 0 |
| Open a block's details | 1 |
| Add work | 2 |
| Plan an unplanned day | 1 |
| Open the features list | 1 |

## Deviations, with reasons

1. **The Timelines switch is gone** (V, Week's ⋯, Settings > Display and the `ui.set_timelines` action). The rail is now the only place meetings appear on a card, so it can't be turned off. `[ui] show_timelines` in config is still read and ignored.
2. **At 3840 the hour timeline was already wide.** The card's text column went from 330 to 300 px rather than giving the timeline everything.
3. **An event that crosses the noon seam shows on both rails** (the demo dentist, 12:00 to 1:00, in the AM and PM cards). Each card's rail is its own block's hours.
4. **The panel adds text styles.** With it open, a screen has 14 (its section labels, agenda times and rows), above the "fewer than 12" target that applies to Week and Now themselves.
5. **Start focus in the panel** shows only on the first pick still to do, today, on a committed day with no timer running. This is Today's one-Start-focus rule.
6. **The quiet status bar is a dot, not a word.** The dot is a button labeled "All sources live. Show each source's status", and its tooltip gives the oldest data's age.
7. **Due badges, not rows.** A card no longer lists follow-ups without a due date this week. The Inbox and the panel still list them.
8. **The 3840 Today pick detail is gone.** Clicking a pick on Today opens the shared panel focused on that pick.

## Not done or not checked

- Light 3840 shots were not taken, as in U2. The step asked for 1920 dark and light and 3840 dark.
- Plan the day, Plan the week, Roadmap and Settings keep the older type steps until their own pass.
- I didn't try the panel by hand in the running app. The browser tests cover opening, Esc, ticking, focus targets and Today.
