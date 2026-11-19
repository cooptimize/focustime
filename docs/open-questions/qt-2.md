## QT-2

- **For the product owner: Ahead's amber.** The Gantt's weeks still say "8h free · 10h planned · about 2h over" in amber when a week's features need more than its free time. It's the one place left that says "over" about a plan, kept because it's a forward-planning view (QT-2 point 4). Keep the amber, show only "8h free · 10h planned" in the neutral style, or drop the planned hours there too?
- The check-in's "2h 30m free this afternoon" is the free time after meetings and personal events, not after what's planned (the block panel's "1h 45m free" subtracts the to-dos, QT-1). Saying the afternoon's time as a fact seemed the simpler reading of "the afternoon's free time"; subtracting the plan would bring "No free time" back as a fullness signal. Is that the right reading?
- Every unfinished to-do in the check-in now has its move button. On a block with many to-dos that's a column of "Move to Thu". Fine, or show it on hover only?
- The assistant's "Move the <client> to-dos from Wed PM to Fri AM" is now offered for a block the calendar puts at risk (it was for an over-full one). It's the same step a person relied on, for a calendar reason. Keep it, or drop suggestions from "what should I look out for" altogether?
- Week's drop refusal on a past day still reads "Can't drop here · Already over" (QT-1's ground, not changed here). "Over" there means the day has ended. Reword to "That day has ended" in a later Week step?
- The stored `plan_share` and `keep_open` values are no longer read anywhere. Settings' autosave still names "Plan up to" in its saved notice, but no control on screen can change it. Remove the stored values in a later release (a column drop needs `safe-drop`), or keep them in case Ahead's capacity wants them again?
- `plan/addpane.ts` still picks a default block that isn't "over" (`BlockChoice.fit`); nothing shows a word for it. Left alone.
- The style guide page (`/styleguide`, development builds only) still shows "fits, 1h spare" and "over by 30m" samples. Left as it is; it never ships to the hosted app.
- From the review: the check-in's Move button is on every unfinished row, including the to-do under way in the open block. With two open blocks (an 11 AM check-in) only the total free time shows, not which block has it. A move keeps its half, so "Move to Thu" can land on another client's Thursday block and be refused (as before QT-2, now on more rows).
- `ui/Roadmap.tsx` still says "Over-booked weeks", but nothing imports it. Delete the file in a cleanup step?

