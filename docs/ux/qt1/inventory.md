# QT-1: what tells a person they planned too much, what makes a block at risk, and what each does after QT-1

Written before any change (Nov 11), from `origin/main` at 1c7629c1. The "before" screenshots are in `docs/ux/qt1/before/` (the demo on Wednesday Nov 4, 2:30 PM: Monday and Tuesday past, Wednesday's morning over, Wednesday afternoon planned past its free time).

QT-1's rule: Day, Week and the block panel say how much time is free and what the calendar does to a block. Nothing on them says the person planned too much, and nothing turns amber because of how much is planned. Outside Day, Week and the panel, nothing changes in this step; those places are listed last so the next step can decide.

## Over-planning and fullness on Day, Week and the block panel

| Where | What it says or does now | After QT-1 |
|---|---|---|
| A block card's status chip (Week, and Day's cards, through `ui/BlockCard.tsx` and `plan/blockstatus.ts`) | From the plan: "About 10 hours over" or "A little over" (amber chip, `too_much`), "Fits" (`tight`), "Room for about 2 hours more" (`fits`); the tooltip "More planned than the block's free time. Shrink or move a to-do" | Gone. The chip shows only "At risk" from the calendar (part B). A block's free time is already on its meetings line ("1 meeting · 15m · 4h 15m free") |
| Day's Timeline block status (`ui/DayTimeline.tsx`, the same `blockStatus`) | The same fit words and amber | Gone, as on the card |
| The panel's header second line (`plan/blockpanel.ts` `panelWhen`, `plan/addwork.ts` `roomWords`) | "12:30 to 5:00 · 1h 45m free", "· Full", "· a little over", "· about 10h over" (amber, `.bp-when.over`) | "12:30 to 5:00 · 1h 45m free", or "· No free time" once the to-dos take it all. Never amber, never "Full" or "over" |
| Week's client chips in the header (`ui/ClientChips.tsx`, `plan/addwork.ts` `clientChip`) | "Northwind · 4h over" (amber), "Harbor · Full", "Cooptimize · 2h free", a badge counting features that need stories; "+N" for the ones that don't fit | Removed, with "+N" |
| The client chip's popover | "4h over · 13h planned · 9h free in its blocks"; Not ready with Break down; Keep open for walk-ins (None to 50%) | Removed. The fit and "over": gone. Not ready · Break down: already on the feature's row in the panel ("Needs stories · Break down"), nothing more. Keep open for walk-ins: off the screens; the stored value stays (`keep_open`) and still feeds the budget where it is read elsewhere (Ahead) |
| Week's drop tip while dragging (`plan/weekdrop.ts` `dropCheck`, `ui/WeekStories.tsx`) | "2h of 3h free" (neutral), or amber "Over your Wednesday PM hours by 1h" (`overNote`) | "2h of 3h free", or "No free time left" in the same neutral style. Never amber, never refused for being full |
| Adding from the panel ("+", Enter in the Add box, a feature's "+") and `pick.add`, `pick.move` | Never refused for being full (AS-2); the drop tip above was the only warning | Unchanged: never refused or warned for being full |
| Settings › Planning, "Plan up to (% of free time)" (`ui/Settings.tsx`, `ui/settings/registry.ts`) | Moves the amber over line on Week's client chips | Removed from the screen and from Settings' search. The stored value (`plan_share`) stays, unused by Day, Week and the panel |
| Admin › Organization's levels table, "Plan up to (% of free time)" per level (`ui/settings/Admin.tsx`) | The team's default for each level | Removed from the screen (the column it set fed only the chips' amber line). The stored values stay |
| The Guide's sizing try-it legend (`ui/guide/content.ts` SIZING) | "Too much? It turns amber. Move something, or keep it. Your call." | "Hours are a guide. Plan what you like; what doesn't get done moves forward." |
| The Guide's drag try-it (`TRY.drag.fit`) | "about 2h over" on its example block | "No free time left" / "2h of 3h free", as the real drop tip |
| The Guide's FAQ | 'Why is "over" amber and not red?'; "What is Keep open?" (in the client's chip on Week) | The first becomes "Does FocusTime tell me I planned too much?" (no: free time only). The Keep open entry goes |
| Day's chips line, urgent strip, moment card | Nothing about fullness | Unchanged |

## Over-planning outside Day, Week and the panel (not changed in QT-1; listed for the next step)

| Where | What it says |
|---|---|
| The midday check-in (`ui/Checkin.tsx`, `plan/checkin.ts`) | Each to-do "M · fits" or amber "M · doesn't fit" (`.pr-fit.watch`), a dashed amber edge (`nofit`) with one suggested move, and per block "About 2 hours over. Move one?" |
| The assistant's answers (`assistant/answer.ts` `overloaded`) | "What needs attention" lists a block with more planned than fits ("overloaded blocks"); `assistant/types.ts` documents a status "Too much planned" |
| Ahead's Gantt weeks (`ui/ahead/Gantt.tsx`, `plan/estimate.ts` `budgetWords`, `planBudget`) | Per week "about 2h over" in amber (`.over-word`); Plan up to and Keep open still move that line |
| Ahead's Gaps and capacity cells (`.pa-capcell.over`) | Amber when a week's features need more than its free time |
| `plan/estimate.ts` `overLine` | "Northwind is about 2h over this week" (no caller found in the UI) |
| The Guide's sandbox for the sizing try-it (`ui/guide/sandbox.ts` `blockFitWords`) | "About 2h over" (amber) on the example block |
| Reminders (`plan/notify.ts`) and the Teams cards (`server/teams/`) | Nothing about over-planning found: the notices name what's on the plan (Add work to today, Midday check-in), not fit |

## At risk and Watch: where each rule comes from

Every risk is made in one place, `week/risks.ts` `evaluateRisks`, for a half-day with a focus block. `plan/blockstatus.ts` then adds the plan's fit on top for the chip.

| Rule | Severity | Comes from | After QT-1 |
|---|---|---|---|
| `meeting_load`: meetings inside the block at or over the thresholds | Watch from the watch threshold, At risk from the at-risk threshold | The calendar (Outlook meetings) | Kept |
| `personal_conflict`, timed: a personal (Google) event overlapping the block's working time | At risk | The calendar (personal events) | Kept |
| `personal_conflict`, all day: an all-day personal event on the day | Watch | The calendar | Kept as Watch (no chip) |
| `out_of_office`: Outlook out of office over the block, timed or all day | At risk | The calendar | Kept |
| `all_day_busy`: an all-day Outlook event shown as busy | Watch | The calendar | Kept as Watch (no chip) |
| `no_focus_window`: the longest free stretch, after meetings and events, under the minimum focus window | At risk | The calendar (time boxes and events with no one else are free here) | Kept |
| `double_booked_block`: two focus blocks on one half-day | At risk | Focus Time in Dataverse and standing blocks (the schedule, not the plan layer) | Kept (it is the calendar of focus blocks, not what's planned; open question) |
| "About N hours over", "A little over" (`too_much`) | Amber chip | The plan (to-dos against free time, `planFit`) | Dropped: no chip, border or reason |
| "Fits" (`tight`), "Room for about N more" (`fits`) | Neutral chip | The plan | Dropped |

What a card and the panel show after QT-1:

- **Card chip**: "At risk" only when an At risk rule fires (all from the calendar). Watch alone shows no chip; its reasons are on hover over the card's header.
- **Card tooltip** on the At risk chip: the at-risk reasons, then any Watch reasons.
- **Panel status line** (`riskLine`): "At risk · 2 reasons" only when the block is at risk; the reasons listed include the Watch ones. Watch alone shows no status line; its reasons are on hover over the header's time line.
- **A past day's blocks**: no chip and no status line (part D collapses them).

## Past days and blocks that have ended (parts C and D)

| What | Now | After QT-1 |
|---|---|---|
| A block that ended earlier today: the server (`actions/plan-actions.ts` `placeAt`) | `pick.add` takes it (it refuses only a day before today); `pick.move` refuses "This morning has already ended. Move it to a later block" | `pick.move` takes it too. Only a day before today refuses |
| A block that ended earlier today: Week's drop rule (`plan/weekdrop.ts`) | Refuses "Already over" | Takes it, with the block's free time words |
| A block that ended earlier today: "+ Add" and the panel | "+ Add" shows (today can take work) but the drop refuses and a move is refused | "+ Add", the panel, drag and move all take work |
| The panel's default block (`defaultAddBlock`) | Skips ended blocks when nothing is asked | Unchanged: "+ Add" in the header still opens on the block under way or the next |
| A past day's cards on Week (this week) | Full cards: meetings line, free time, At risk, every to-do | Collapsed to one line per block: the client, then "2 done · 1 not done" (or "Nothing planned"). A click opens the panel to tick, wrap up and move forward, as before |
| A past day on Day | Full cards with "A past day: tick what got done…" | The same collapsed cards; the panel opens on a click |
| A past week | Full cards | Collapsed the same way (every day of it is past) |
