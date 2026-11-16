# BT-1: checks removed or moved, and the proof for each

A check is removed only when another test makes the same check on the same behavior. The proof for each row: the app code was broken on purpose in a copy of the tree, the surviving test was run and failed with the message shown, and the code was put back (`git diff` of the copy against the branch is empty after each). Every survivor is a browser test, as the removed check was: nothing moved down a level. None of these checks touches the client boundary, secrets, who can see what, the background policy, Export or Delete my data, retention, the preview and confirm before an outside write, the code log or the content security policy.

| # | Removed check (file › test) | Surviving test (file › test) | Broken on purpose | The survivor's failure |
|---|---|---|---|---|
| 1 | `e2e/week/now-mark-catch-up.test.ts` (was `nm1-now-mark`) › "a block under way still has its mark, and only that block": Wednesday 10:03, Week's cards, exactly `["2026-11-04:AM"]` marked | `e2e/day/now-mark.test.ts` (was `nl1-now-mark`) › "at 10:03 AM: Week and Day, Cards and Timeline, then the phone": the same clock and screen, the same exact list, then Day, the Timeline and the phone | `plan/nowline.ts` `nowSpot`: the mark on the other half (`half: half === "AM" ? "PM" : "AM"`) | `Week, Cards: expected [ '2026-11-04:PM' ] to deeply equal [ '2026-11-04:AM' ]` |
| 1b | (same) | (same) | `nowSpot`: no mark on the block under way (`return { kind: "none" }`) | `Week, Cards: expected [] to deeply equal [ '2026-11-04:AM' ]` |
| 2 | `e2e/shell/tab-order.test.ts` (was `rf1`) › "the tabs read Day · Week · Backlog · Status · Inbox; 4 opens Status and 5 the Inbox" (the list, 4, 5, T) | `e2e/shell/tabs-and-addresses.test.ts` (was `nav`) › "six tabs in order … 1–6 and T switch them": the same exact list, every key 1 to 6 with its address, and now T (moved in from the removed test: no other test pressed T for Day) | `ui/nav.ts`: Status and the Inbox swapped in `TABS` | `expected [ 'Day', 'Week', 'Backlog', …(3) ] to deeply equal [ 'Day', 'Week', 'Backlog', …(3) ]` |
| 2b | (same: T opens Day) | (same) | `ui/nav.ts` `tabForKey`: only capital T opens Day | `expected 'Inbox5' to match /^Day/` |
| 3 | `e2e/shell/navigation.test.ts` (was `navigation`) › "tabs and keys, Day's cards, …": its first block, the five tabs present in any order and 1 to 5 opening their addresses (the rest of the test stays) | `e2e/shell/tabs-and-addresses.test.ts` › "six tabs in order …" (exact order, 1 to 6) | `ui/nav.ts` `tabForKey`: keys 4 and 5 swapped (the tabs' order unchanged) | `expected 'Inbox5' to match /^Status/` |
| 4 | RM-1 leftovers: `#/week/team` in `e2e/shell/demo-names.test.ts`'s screens and in `e2e/phone/bottom-bar-and-sheets.test.ts`'s "no sideways scroll" screens (and `#/week/team`, `#/patterns` in the `restyle-scan` tool, which checks nothing). RM-1 removed Team; the address now opens Week, which both loops already visit as `#/week` | `e2e/week/board.test.ts` (was `wd1`) › "every old address lands where it should" (`#/week/team` → `#/week`), and `e2e/week/send-work.test.ts` (was `sends`) › its RM-1 line | `ui/nav.ts`: `#/week/team` lands on Status | `#/week/team: expected '#/status' to be '#/week'` |
| 5 | `e2e/week/board-shots.test.ts` (was `uib-shots`, which runs only with `FOCUSTIME_SHOTS`, so never in CI) › "in the gap before the day": no now mark on today at Wednesday 7:30 AM | `e2e/day/now-mark.test.ts` › "at 6:30 AM": no mark on Week's or Day's cards or Timeline, or anywhere, on the phone too (the same rule: before the day's first block) | `nowSpot`: a mark on the first half even outside its hours | `Week, Cards: expected [ '2026-11-04:AM' ] to deeply equal []` |

## Moved, not removed

| Check | From | To | Proof |
|---|---|---|---|
| On a 390 px phone with a 17 px root font, mid-block (Wednesday 1:30 PM), Today and Week are no wider than the screen | `uib-shots` › "phone" (never ran in CI) | `e2e/week/suggest-unfinished.test.ts` › "on a 390 px phone with a 17 px root font, Today and Week are no wider than the screen" (same clock; CI runs it) | `ui/styles.css`: `body { min-width: 430px }` fails it: `Today is wider than the phone: expected 40 to be less than or equal to 0` |
| The UI-B screenshots | `e2e/uib-shots.test.ts` | `e2e/shot-scripts/uib-shots.ts` (run with `npm run shots`) | screenshots only; no check left in it |

## Looked at and kept

`docs/ux/bt1/step0.md` 0.6 lists the candidates that stay, each with why (a different size, state or screen, or a browser-only measurement nothing else makes).
