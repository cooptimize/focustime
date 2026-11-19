## TY-1: Today timeline and timeboxing on the timeline (Nov 8)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | TY-1: the timeline is off by default and remembered per person (`[ui] today_timeline`). The phone has its own setting (`today_timeline_phone`), so turning it on at a desk doesn't change MB-1's phone layout. Older builds ignore both keys. |
| - | Done | TY-1: one timeline: the hour grid, event layout, now line and event cards moved out of `ui/WeekGrid.tsx` into `ui/Timeline.tsx`, and Week and Today both draw it. Today adds only what Week doesn't have: the tray, the placeholders and the edits (`ui/TodayTimeline.tsx`). `ui/ty1.test.ts` fails if a second copy appears. |
| - | Done | TY-1: an hour on Today is 94 px at Default, the height of an hour on the Board at 1920, scaled by Text size. |
| - | Done | TY-1: the switch is on Today only in the view it applies to. Check-in and Close out stay lists, and a weekend day stays WK-3's plain list. A PTO day shows Week's hatched cell. Holidays have no separate form on Week (PTO or an all-day item), so Today shows them the same way. |
| - | Done | TY-1: 3840's older day timeline beside the list stays while the switch is off and hides while it is on. |
| - | Done | TY-1: dragging works without Confirm on today and future days, and not on past days, PTO days or a block that has ended. With Use timeboxing off there are no trays or bands. |
| - | Done | TY-1: a to-do drops only into its own block, because the block is its client. Dropped on the other block it says "That's the <half> block. Move the to-do there first". |
| - | Done | TY-1: a dragged or resized timebox may overlap a meeting, as a custom time always could; it draws above events. A Timebox my day placeholder may not: it stays inside an open gap of its block, clear of meetings and other timeboxes, the rule `planMyDay` already follows (a show-as-free event doesn't block). Dragged onto a meeting, it goes back with "A suggestion stays clear of meetings and other timeboxes". |
| - | Done | TY-1: T takes the first free stretch that fits the to-do's length, from now on when the block is under way (`nextFreeSpan`). |
| - | Done | TY-1: Timebox my day has no popup. Every entry point (Today, the day menu, the command menu, after Confirm) confirms the day if it needs to and opens that day's Today timeline with `planMyDay`'s suggestions as placeholders. It shows the timeline for that visit without changing the saved switch. |
| - | Done | TY-1: Timebox my day's per-row Put on Outlook is now one Put on Outlook in the bar, off or on from the same default. Outlook events still go through the one combined preview after Accept all, and nothing reaches Outlook without it. A ✓ on one suggestion goes through that timebox's own preview. |
| - | Done | TY-1: the didn't-fit panel (Move, Make smaller, Leave untimed) is gone: what didn't fit stays in the tray, the bar says so, and the to-do's ⋯ still has its size and Move. |
| - | Done | TY-1: a suggestion's length: dragging a placeholder keeps its length, and its new time is what Accept saves. Suggestions are never saved until accepted, and leaving the day drops them. |
| - | Done | TY-1: timed promises that aren't late are marks on the hours, as on Week. Late ones are the header's late chip (UI-9). |
| - | Done | TY-1: a to-do's length comes from the shared `pickNeed` and its chip from `sizeChipText`, so the unsized default follows SZ-1 without a change here. Until SZ-1 merges it reads "Size? · 2h". |
| - | Done | TY-1: a drag's end is read from the release, not the last drawn position, so a quick flick lands where it was let go. This also applies to Week's bands. Tray rows and bands aren't text-selectable on a computer, because a selection left by one drag turned the next press into the browser's own drag. |
| - | Done | TY-1: `e2e/ty1.test.ts` adds its overlapping meeting and evening item by intercepting `week.load` on that page, so the shared demo data doesn't change for every other test. |

