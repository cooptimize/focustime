## SZ-1: unsized work counts as 1 hour, a setting (Nov 8)

Unnumbered until merge. Changes D448's "an unsized story counts as 2h everywhere".

| # | Status | Decision |
|---|---|---|
| - | Done | SZ-1: the one value. `plan/estimate.ts` holds `DEFAULT_UNSIZED_MINUTES` (60) and `UNSIZED_CHOICES` (30, 60, 120, 180). The person's value travels in the existing `sizes` scale as `sizes.unsized` (`SizeScale`, in `cfg.plan.sizes` and `planning.sizes`), read through `storyMinutes(size, scale)`. Every function that counts unsized work now requires the scale, with no default argument, so the type-checker finds a caller that forgets it. |
| - | Done | SZ-1: the copies removed: `UNSIZED_MINUTES` in `plan/estimate.ts` and a second 120 in `plan/reach.ts`, every `sizes[size ?? "M"]` (agenda, picktime, timer, todayorder, pickNeed, Close out's borrow, the timebox dialog), `?? 120` in todayorder, Close out's stale `{ S: 60, M: 120, L: 210 }` fallback, `sizes.M` on the phone's to-do sheet, BreakDownPanel's own hours table, and the text "2h" in focus labels, Didn't fit, Clear's hint, Ahead's size hint and the Guide. `plan/unsized.test.ts` scans the code so a new copy fails. |
| - | Done | SZ-1: S, M and L stay fixed (E2, D446), so they are shown read-only beside the choice ("S 1h · M 2h · L 4h"). |
| - | Done | SZ-1: where a size has to be named (shortest useful time, Timebox my day's sort), unsized is the smallest size that holds the assumption (`namedSize`): 30 min and 1h are S, 2h is M, 3h is L. So a short assumption is never asked for a stretch longer than itself. |
| - | Done | SZ-1: 30 min is the one value not in whole hours, on the chip and in Clear's hint ("Size? · 30 min"), because "1h" would misstate the setting. Totals stay whole hours as E2 says, so one 30 minute story reads "about 1h". |
| - | Done | SZ-1: `[plan] unsized_minutes`, a person's setting (settings rows, no migration). A file without it loads as 1h. An older build skips it as an unknown `[plan]` key (BH-1) and saving there keeps it. A value outside the four choices is refused like any other bad setting. |
| - | Done | SZ-1: not changed: a draft story with no size chosen is still created as M (`DEFAULT_SIZE`): that is a real size on the draft, not an assumption. Readiness and Gaps read the DevOps size field only, so unsized items stay Unsized; nothing here reaches DevOps. Timeboxes and a to-do's own minutes win over the assumption as before. |
| - | Done | SZ-1 and TY-1: Today's timeline uses the same scale: the tray's chip is `sizeChipText`, a dragged to-do's length is `pickNeed`, T's next free stretch and Timebox my day's placeholders are `timeChoices` and `planMyDay`. TY-1 removed Make smaller, so `smallerSize` is gone. |
| - | Done | SZ-1: effect on existing plans: anyone who never changed the setting sees unsized work count 1h less the next time their week loads, so some "A little over" warnings go away. It is display only; nothing stored changes. |

