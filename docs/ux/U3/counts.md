# U3 counts beside U1

Same demo day as U1 and U2: a throwaway demo-mode server with fictional data, the clock at Mon Nov 2, 9:30 AM, and Monday planned through the app's own actions (four Cooptimize picks with one done, four Northwind picks), then committed. Tuesday to Thursday are not planned.

The method is U1's: UI words cover the whole page including the status bar and excluding the top bar, and titles are counted separately. Following U2, controls hidden until hover don't count. One addition for U3: decorations marked `aria-hidden` (the rail's hour marks) don't count either. Raw numbers are in `screens/before/metrics-*.json` and `screens/after/metrics-*.json`. "Before" is the code at 032ca28, the end of U2.

## 1920x1080, demo, 9:30 AM

| Screen | UI words U1 → before → U3 | Title words before → U3 | Elements U1 → before → U3 | Buttons before → U3 | Text styles U1 → before → U3 | Colors before → U3 | Scroll before → U3 |
|---|---|---|---|---|---|---|---|
| Week (dark) | 280 → 276 → **102** | 233 → 83 | 185 → 184 → **73** | 120 → 55 | 23 → 23 → **9** | 56 → 54 | the grid scrolled 60 px → none |
| Week (light) | n/a → n/a → 102 | 83 | 73 | 55 | 9 | 52 | none |
| Week with the panel open | 164 | 140 | 112 | 79 | 14 | 61 | none |
| Today › Now | 72 (U2) → **65** | 78 | 59 | 30 | 27 (U2) → **8** | 26 | none |
| Today › Now with the panel | 125 | 135 | 95 | 51 | 14 | 31 | none |

- The Week word guard is under 120 (`e2e/week.test.ts`, on its own seeded week). On the demo day it is 102.
- Today › Now dropped 7 words because the status bar's "All sources live · updated 4 h ago" is now a dot and Refresh.
- Title words on Week fell from 233 to 83: meeting titles are now only on the rail (they were also listed inside the cards), and the THIS WEEK lines are gone.
- Text styles: 23 → 9 on Week, 27 → 8 on Now, both under the 12 target. The open panel brings its own section labels and rows, so a screen with the panel open has 14.

## 3840x1600, demo, 9:30 AM

| Screen | UI words before → U3 | Title words before → U3 | Elements before → U3 | Text styles before → U3 |
|---|---|---|---|---|
| Week | 379 → **197** | 184 → 77 | 166 → 73 | 27 → 9 |
| Week with the panel | 259 | 134 | 112 | 14 |
| Today › Now | 111 (U2) → 104 | 92 | 60 | 9 |
| Today › Now with the panel | 164 | 149 | 96 | 14 |

At 3840 the hour timeline is the rail, and its hour marks and "free" gaps are text the reader uses, so they count. That is most of the gap between 197 and 102.

## Clicks for the Week jobs (demo, from opening Week)

| Job | U1 | U3 | Note |
|---|---|---|---|
| See why a block is at risk | 2 (⋯ → Details, or select + Enter) | **0** | "At risk · Dentist 12:00" on the pill; the full sentence is in the panel |
| Open a block's details | 2 (⋯ → Details) | **1** | A click on the card body, or Enter on the selected card |
| Add work to a block | 3 + typing (⋯ → Add work… → type → choose) | **2** | + Add work (shown on hover), then choose the item from the list; typing only to search |
| Plan an unplanned day | 1 | **1** | The Plan chip, only on days not planned yet |
| Open the features list | not on Week | **1** | The features line opens the panel on the features |
| See a follow-up due this week | 0 (repeated on every card) | 0 | One due badge, on its day; 1 more click opens it in the panel |
| Tick a pick done | 1 | 1 | On the card or in the panel |
| Change the hours shown | 2 (Week ⋯) or H | 2 or H | Unchanged; the Timelines switch is gone (the rail always shows) |
