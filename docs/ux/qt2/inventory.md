# QT-2: every place a person was still told they planned too much, and what each says now

Written from `origin/main` at e975d34d (Nov 11), starting from `docs/ux/qt1/inventory.md`'s last table and then searching the whole app: the screens, the check-in, the assistant's answers and previews, the Teams cards, reminders, notices and pushes, the Guide, the shortcut list and the helpers behind them. The "after" screenshots are in this folder (the demo on Wednesday Nov 4, 2:30 PM, Wednesday afternoon planned with three 4h to-dos against 2h 30m free).

QT-2's rule: nothing a person reads tells them they planned too much. Free time is said as a fact. The calendar still decides At risk, and a day heavy with meetings can still be called out.

## Found and changed

| Where | What it said before | What it says now |
|---|---|---|
| Midday check-in, each to-do (`ui/Checkin.tsx`, `plan/checkin.ts` `fits`) | "M · fits" (muted) or "M · doesn't fit" (amber), and a dashed amber edge on a to-do that doesn't fit (`.nofit`) | Nothing about fit. Each unfinished to-do has its one move ("Move to PM", "Move to Thu", or Tonight for one owed today), not only the ones that didn't fit |
| Midday check-in, each block (`c.overBy`) | Amber "About 2 hours over. Move one?" or "A little over. Move one?" | Gone |
| Midday check-in, each block's header | "Afternoon · about 2 hours left after meetings" | "Afternoon" (the free time is said once, in the page header) |
| Midday check-in, the page header (`checkLeft`) | "about 4 hours left today" | "2h 30m free this afternoon" (or "this evening", "the rest of today", "No free time this afternoon") |
| Midday check-in, an ended block | Amber "2 not done. Move them, or leave them for Close out." | The same words, not amber |
| Midday check-in, Move to… when this week has no working day left | Fell back to "Tonight" (borrowed time) for every to-do | The next working day, next week if need be ("Move to Mon") |
| Day's moment card for the check-in (`ui/Day.tsx`) | "What still fits this afternoon, with one suggested move each." | "What's done, what's left, and the free time this afternoon." |
| The shortcut list, M (`ui/keys.ts`) | "today's cards show what still fits, with one suggested move each" | "what's done and what's left, the free time left and Move to… on each unfinished to-do" |
| The check-in reminder (`plan/notify.ts` `notices.checkin`, `server/notify.ts` `CHECKIN_MESSAGE`) | "Midday check-in: what still fits this afternoon." | "Midday check-in: what's done and what's left." |
| The check-in push without details (`plan/push.ts`) | "A look at what still fits today." | "What's done and what's left." |
| The assistant, "what should I look out for" (`assistant/answer.ts` `overloaded`, `planCheck`) | A block with more planned than free: "Wed PM: about 10h planned, 5h free", and "Move the Tailspin to-dos from Wed PM to Fri AM" for it | A block is named only when the calendar puts it at risk: "Wed PM: at risk, <reason>, 45 min free". The same Move suggestion is offered for an at-risk block's to-dos when its meetings leave under an hour free |
| The assistant, when nothing stands out | "no overloaded blocks, late promises, …" | "no blocks at risk, late promises, …" |
| The assistant, asked about one day ("anything I should know about today?") | Meetings only from 4h, free time only under 2h | The day's meetings and free time always, as facts ("3h of meetings, 5h free for focus"), then at-risk blocks, promises, gaps |
| The assistant, "what's on my plate" (`agenda`) | "PM: Tailspin block, 5h free, about 10h planned" | "PM: Tailspin block, 5h free" (the to-dos are listed below it) |
| The assistant's move preview (`assistant/service.ts`, `plan/days.ts` `overNote`, `plan/weekdrop.ts` `shortBy`) | "Over your Wednesday PM hours by 1h" | Where it goes is the row; the note is that block's free time after meetings: "Wednesday PM: 3h free" or "Wednesday PM: no free time" |
| The assistant's answers to a general question (the AI, `QUESTION_INSTRUCTIONS`, `forClient`) | The model saw each block's planned minutes and had no rule about it | It no longer gets a block's planned minutes, and its instructions say never to call a block or day over, overloaded or full |
| The assistant's card type's comment (`assistant/types.ts`) | "At risk · Dentist 12:00", "Fits", "Too much planned" | "2 of 3 done" (what the code already sends) |
| The Teams bot | The same answers and previews as the panel (TB-3's parity) | Follows the panel; no Teams card had its own fit words |
| The Guide's day steps (`ui/guide/content.ts`) | "After lunch, re-fit what's left. Anything that won't fit gets one suggested move." | "After lunch: what's done and what's left, the free time left, and Move to… on anything unfinished." |
| The Guide's Ask examples | "Late promises, blocks with too much planned, items not ready, …" | "Days heavy with meetings, blocks at risk, late promises, items not ready, …" |
| The Guide's FAQ "Does FocusTime tell me I planned too much?" | "…it never says you're over." | "…nothing warns you about how much is on it, not the midday check-in and not Ask." |
| The Guide's sizing try-it title | "Try it: how much fits in a block?" | "Try it: how much time is free in a block?" |
| The Guide's sizing try-it bars | Amber bars for hours past the block's free time | Neutral bars |
| A Guide tour step on dragging | "The block shows the fit as you drag" | "The block shows its free time as you drag" |
| Unused helpers that still made the words (`plan/fit.ts` `fitWords`, `blockFitWords`, `dayHeadline`, `dayTotals`, `trimCandidates`; `ui/planday.ts` `fitLabel`; `plan/estimate.ts` `overLine`) | "Fits", "Room for about 2 hours more", "About 2h over", "A little over", "too much: 30m more than the free time", "About 2h more than Northwind's free time this week. Move one to another week" | Removed (nothing called them) |
| Ahead's budget inputs (`plan/estimate.ts` `budgetWords`, `plan/weekplan.ts` `weekBudget`, `planBudget`, `plan/carry.ts` `PlanBits`, `actions/carry-actions.ts` `planBitsFor`) | Took "Plan up to" (`plan_share`) and "Keep open for walk-ins" (`keep_open`) as parameters, read from the person's guidance and sent with every week load. The Gantt itself already called `budgetWords` without them | Free time as it is. Neither setting is read or sent any more; the stored values stay |

## Found and kept

| Where | What it says | Why it stays |
|---|---|---|
| Ahead's Gantt weeks (`ui/ahead/Gantt.tsx`, `.pa-capcell.over`, `.over-word`) | "8h free · 10h planned · about 2h over", amber | A forward-planning view (QT-2 point 4). Open question for the product owner |
| At risk on a block, the assistant's at-risk lines | "At risk", "Wed PM: at risk, 2h 45m of meetings, 45 min free" | The calendar cuts into the block |
| A day heavy with meetings in the assistant | "Tue, Nov 10: 6h of meetings" | A calendar fact |
| Week's drop tip and the panel (QT-1) | "2h of 3h free", "No free time left", "No free time" | Free time as a fact |
| Week's drop refusal on a past day (`plan/weekdrop.ts`) | "Can't drop here · Already over" | "Over" here means the day has ended, not the plan |
| The Teams check-in card | "This morning's to-dos. Tap Done for what's finished.", Move the rest to… | Nothing about fit |
| `ui/Roadmap.tsx` | "Over-booked weeks" | Nothing imports the file; left for a cleanup (open question) |
| The style guide page (`ui/StyleGuide.tsx`, `/styleguide`) | Samples "fits, 1h spare", "over by 30m" | Development builds only; never in the hosted app |
| Other words with "over" or "fit" | "Overdue", "Take it over", "Carry over", "Start over", "Break over", a layout that "doesn't fit", "the next free time that fits" | Not about how much is planned (`test/over-words.ts` lists each) |

## Searched, nothing found

Morning brief, close out, nudges, status report and client call Teams cards; the focus screen; Close out; the urgent strip; reminders other than the check-in; notifications' labels and hints; `docs/guide.md` (it describes how the Guide is built, not the app); `docs/technical/`.
