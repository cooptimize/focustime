# MC-6: Calls, before and after

Measured on the demo (a fictional person and fictional calls, Thursday Nov 5, 2026 4:30 PM ET, Pocket connected with the demo key) by `e2e/shot-scripts/mc6-shots.ts`, before on main at `69c94950` and after on this branch. The measures are MC-5's (`docs/ux/mc5/after.md`) plus MC-6's own three: week row titles cut, lines under a call's title that start with a separator, and "N of M decided" in the window.

## Counts

| | 1440 by 900, before | 1440 by 900, after | 1280 by 800, before | 1280 by 800, after | 390 by 844, before | 390 by 844, after |
|---|---|---|---|---|---|---|
| Words in the list | 131 | 129 | 131 | 121 | 98 | 93 |
| Calls visible in the list without scrolling | 9 of 9 | 9 of 9 | 9 of 9 | 8 of 9 | 5 of 9 | 5 of 9 |
| Lines per Needs you row | 2 | 2 | 2 | 2 | 2 | 2 |
| Lines per week row | 1 | 1 or 2 | 1 | 2 or 3 | 2 | 2, or 3 for a long title |
| Week row titles cut | 6 | 0 | 8 | 0 | 3 | 0 |
| Words on the call's page | 277 | 275 | | | 148 | 122 |
| Proposals visible without scrolling | 4 | 4 | | | 0 | 0 |
| Times the call's count is on screen | 3 | 3 | | | 1 | 1 |
| Group heads' counts beside the chips' | 3 | 0 | | | 3 | 0 |
| Stuck header (and a group's head) | 86 px (and 33) | 86 px (and 33) | | | 218 px (and 49) | 243 px (and 49) |
| Lines under the title that start with a separator | 0 | 0 | | | 2 | 0 |
| "N of M decided" in the window | yes | yes | | | no | yes |
| Skip all on screen with a call open | 2 (its row and its header) | 1 (its header) | | | 1 | 1 |
| A chat call's client choices | 4 (every client) | 2 (Northwind, Cooptimize) | | | | |

"Times the call's count is on screen" counts "11" on the call's page and its row ("11 left", "0 of 11 decided" and the All chip's hover); MC-6 changed none of them. The group heads' own counts went (item 6): each kind's number is on its Show chip only.

## What is worse, and why

- **At 1280, one row fewer shows without scrolling** (8 of 9). A whole title takes more lines than a cut one (item 2): the three chat calls' "Call in Northwind Delivery Team (Cooptimize)" take two lines with the picker and mark under them.
- **At 390 the call's stuck header is 25 px taller** (243 against 218): the "N of M decided" line item 4 asks for, under the Show chips, where it was past the right edge before.

## Every row in Open, and its way out in one press

| Row | Before MC-6 | After |
|---|---|---|
| A calendar call nobody asked FocusTime to read (a week row or in the fold) | Hide, with Undo | unchanged |
| A repeating meeting's row | Hide every one, from its menu | unchanged |
| A Pocket recording's own row | Hide, with Undo | unchanged |
| A chat call nobody kept yet | Hide, with Undo | unchanged |
| A kept call with proposals left (Needs you) | Skip all, with Undo | unchanged; the open call's is in its header |
| A kept call with no transcript (Add transcript, Use Pocket recording) | none | Dismiss, with Undo: removed when I added it by hand, else closed as No transcript |
| A kept call whose AI pass failed with nothing proposed (Try again) | none | none (it has a transcript; Dismiss refuses it) |
| A kept call I only look at | none | none (its reviewer decides) |
| A kept call waiting on Teams | none | none (no button yet) |
| A registered client call with no transcript | No transcript this week, in its menu | unchanged |
