## TY-2: Today timeline checklist beside each block (Nov 8)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | TY-2: the checklist is the list view's `PickRow` (density "today") with one new prop, `checklist`: the time, or else the size chip ("Size? · 1h" by default, SZ-1's setting), is always shown instead of on hover. The ticking is `PlanCtx.toggle`, the same call the list view makes, so PK-1's offer, its Undo and the done state on both sides come with it. |
| - | Done | TY-2: breakpoints. 1100 px and wider: timeline 3fr, checklist 2fr (60/40), level with the top of the hours, under the block's header, which spans both. Under 1100 px (`max-width: 1099px`, the window's width): the checklist sits between the header and the hours, and folds with "To-dos · N" (open by default, not remembered). The phone width is unchanged from TY-1. |
| - | Done | TY-2: the timeline's width cap goes from 1200 px to 2400 px, so the right side is no longer empty at 1920; the column stays 60/40 at 3840 without stretching past 2400. The phone keeps 1200. |
| - | Done | TY-2: the column is sticky at the top of Today's scroll area, below the Timebox my day bar when that shows, and scrolls on its own when it is taller than the window. |
| - | Done | TY-2: on a computer the tray is gone and the whole column is the drop target for taking a time off. The phone keeps TY-1's tray, as the brief says; `.tt-tray` is only drawn there. |
| - | Done | TY-2: a to-do with a Timebox my day suggestion stays on the checklist under Not timeboxed yet, because nothing is saved until accepted, with a dashed "Suggested 1:30–3:00" tag. If it gets a real time another way (a drag, T, + time), its suggestion goes away. |
| - | Done | TY-2: from a checklist row, Up, Down, Shift+Up, Shift+Down and Backspace act on that to-do's band or suggestion, and T gives a to-do with no time its next free stretch (TY-1's keys). T on one that has a time does nothing. |
| - | Done | TY-2: only "Not timeboxed yet" rows drag; done rows don't. A row with a time is moved on the hours, as the brief describes. A timebox with no to-do (an older free-standing one) stays on the hours only; dragging it to the column removes it with Undo, as the tray did. |
| - | Done | TY-2: hour labels: `hourMarks` gained `includeStart` and `Timeline` gained `firstHour`. Today's computer layout puts them in a left gutter (52 px, scaled by Text size) in Week's type. Week and the phone keep theirs on the right, with no label on the first line. |
| - | Done | TY-2: the dashed look came from the base `.tbox` border, which Week's rail overrides. Today now overrides it the same way (solid, the client's colour, 3 px left edge), on the phone too. Through `:where`, so a band out of step with Outlook stays dotted and a conflict stays red: those mark a problem, not a suggestion. A drag's ghost is solid as well; only `.tt-ph` is dashed. |
| - | Done | TY-2: Week has no per-event double-booking mark (its "Double-booked" is a block with two clients), so the marker is the brief's small amber "Overlaps" tag, on Today's computer layout only. Two events overlap when they truly share time inside the block: back to back doesn't count, and a show-as-free event or unavailable time neither gets it nor causes it, as a free event doesn't block (TY-1). It blocks nothing. |

