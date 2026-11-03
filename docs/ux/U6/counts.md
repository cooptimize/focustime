# U6 counts beside U4

The demo week is the same one used in U1 to U5: a throwaway demo-mode server with fictional data and the clock set to Mon Nov 2, 9:30 AM. Plan the day shows Monday as planned through the app's own actions. Plan the week shows next week (Nov 9, not planned yet).

The method is U1's:
- UI words count the whole page except the top bar.
- Names and titles are counted separately.
- Controls hidden until hover don't count, and neither does anything marked `aria-hidden`.

Raw numbers are in `screens/before/metrics-1920-dark.json` and `screens/after/metrics-1920-dark.json`. "Before" is the code at the end of U5.1 (f27fbaf).

## 1920x1080, dark, demo, 9:30 AM

| Screen | UI words U4 → before → U6 | Titles before → U6 | Elements before → U6 | Buttons before → U6 | Text styles before → U6 | Scroll before → U6 |
|---|---|---|---|---|---|---|
| Plan the week, next week | 144 → 178 → **144** | 96 → **38** | 84 → **57** | 67 → **48** | 8 → 9 | none → none |
| Plan the day (Monday) | 93 → 107 → **107** | 84 → 84 | 54 → 54 | 40 → 40 | 9 → 9 | none → none |

Notes:

- **Plan the day is unchanged**, number for number. It moved onto the shared layout with no behavior change. U5's type-size work had already raised it from U4's 93 words to 107.
- **Plan the week.**
  - Before, there was one card per client, each with three Add rows. Now there is one open card, and the other clients are one line each.
  - Titles drop from 96 to 38 words because only the open client's DevOps rows are listed.
  - The extra text style is the grid's day number.
- **Light theme:** the numbers are the same. **3840x1600 dark:** the numbers match 1920, and the right pane is 520 px.
- **Word guards** (`e2e/planning.test.ts`, on their own seeded data): Plan the week next week stays under 120, down from 200. Plan the day stays under 100.
- **Type scale:** both screens use only 11, 12, 13 and 15 px, at weights 400, 500 and 600. This is checked at 1920 and 3840 (`e2e/planweek.test.ts`).

## Clicks (demo, from the tab)

| Job | U4 | U6 | How |
|---|---|---|---|
| Add a must | 3 | **3** | Plan the week, then "+ Must" on a FROM DEVOPS row in the right pane, then Done |
| Go to the next client | scroll to its card | **1** | "Next client: X ›", or J, or a click on its grid cell or line |
| Pin a must to a half-day | 1 drag onto a chip | **1 drag** | Drag onto its client's grid cell. Other clients' cells and PTO refuse the drop |
| Finish Plan the week | 2 | **2** | Plan the week, then Done (in the header, or on the last client's card) |
| Type a feature | not possible | **type + Enter** | Enter makes a draft feature as a must. Shift+Enter makes it a nice to have |
| Add a story to a block (Plan the day) | 2 | **2** | unchanged |
| Finish Plan the day | 1 | **1** | unchanged |
| Type a story (Plan the day) | type + Enter | **type + Enter** | unchanged |
