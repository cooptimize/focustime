# U4 counts beside U1

This uses the same demo week as U1 to U3: a throwaway demo-mode server with fictional data and the clock set to Mon Nov 2, 9:30 AM. Plan the day shows Monday planned through the app's own actions. Plan the week is shown for next week (Nov 9, not planned yet) and for this week (Nov 2, with lists).

The method is U1's: UI words count the whole page except the top bar, titles are counted separately, controls hidden until hover don't count, and neither do `aria-hidden` decorations. Raw numbers are in `screens/before/metrics-*.json` and `screens/after/metrics-*.json`. "Before" is the code at 249c7fa, the end of U3.

## 1920x1080, dark, demo, 9:30 AM

| Screen | UI words U1 → before → U4 | Titles before → U4 | Elements U1 → before → U4 | Buttons before → U4 | Text styles before → U4 | Scroll before → U4 |
|---|---|---|---|---|---|---|
| Plan the week, next week | 476 → 454 → **144** | 273 → 96 | 140 → 134 → **78** | 96 → 63 | 16 → **7** | 2 more pages → none |
| Plan the week, this week | n/a → 341 → **243** | 61 → 137 | n/a → 101 → 109 | 75 → 87 | 15 → **9** | 1663 / 985 px → 1070 / 985 px |
| Plan the week, feature panel open | 275 | 145 | 119 | 94 | 12 | |
| Plan the week, next week, health panel open | 161 | 115 | 83 | 66 | 11 | |
| Plan the day (Monday) | 136 → 125 → **93** | 93 → 80 | 78 → 76 → **53** | 55 → 39 | 21 → **9** | none |

Notes:

- **Light theme:** the numbers are the same, with one or two fewer colors.
- **3840x1600 (dark):** the numbers match 1920. Plan the week shows three columns of cards instead of two, and nothing scrolls.
- **This week has more elements than before.** Add from DevOps is now open by default, three rows per client with "+ Must" and "Nice". Before, it was folded. Title words rise for the same reason. In exchange, the grid, the summary strip, the tier sublines and the Story chips are gone.
- **Word guards** (`e2e/planning.test.ts`, on their own seeded data): Plan the week next week stays under 200, and Plan the day under 100.
- **Type scale:** both screens use only 11, 12, 13 and 15 px at 400, 500 and 600. That holds at 1920 and 3840, with and without the panel (`e2e/planning.test.ts`).

## Clicks (demo, from the tab)

| Job | U1 | U4 | How |
|---|---|---|---|
| Add a must | 5 to 6 + a scroll (Plan the week, scroll to the client, Add from DevOps, + Must, Done) | **3** | Plan the week, + Must (Add from DevOps is open, first three rows), Done |
| Reorder a must | 1 drag (no visible handle) or ⋯ → Move up per step | **1 drag** | by the handle ⋮⋮ |
| Pin a must to a half-day | 1 drag onto a grid cell | **1 drag** | onto a block chip; the chips grow while dragging |
| Finish Plan the week | 3 | **2** | Plan the week, Done |
| Add a story to a block | 3 to 5 | **2** | Plan, then + on the story under its feature (the selected block is the target) |
| Finish Plan the day | 2 + one offer | **1** | Done. The Timebox my day offer after it is optional |
| Type a story | type + Enter made a plain intention, not a story | **type + Enter** | Enter makes a draft story under the chosen feature and plans it; Shift+Enter makes a plain note |
