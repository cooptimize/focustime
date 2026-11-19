## SG-1

- Kept rows are remembered only for the visit (in the page). After a reload a block that has only kept to-dos is an ordinary block with work and offers nothing more. Should a kept suggestion keep the rest of its block's offers across reloads?
- A draft story (local, not yet in DevOps) never makes a feature "has stories": a feature with only drafts is still offered as Needs breakdown. Count drafts?
- On a Thursday the next working day is Monday of next week, which Day shows but Week (this week) doesn't. Fine?
- Keep all is the existing actions one after another, not one server transaction: a failure part way keeps what worked and says how many couldn't be kept, and Undo takes back what was kept. Worth one batch action later?
- A cleared row is cleared for the week it was suggested in; next week it can come back. Right length?
- `planday.carry` and `planday.carry_hint` are no longer used by the UI. Remove them in a later release.
- From the review: on a Thursday, this week's view suggests on Thursday and Day on Monday shows next week's: an unfinished to-do can be offered on both at once, and a row cleared Thursday (for this week) can show Monday. Compute over today and the next working day whatever week is shown?
- From the review: Keep from a stale tab adds the story even when another tab placed it on another day this week (`pick.add` checks only the same day). Refuse a second placement in the week?
- From the review: dragging a suggestion onto its own block makes a to-do that isn't "kept", so the block's other offers go, where clicking Keep leaves them. Same rule for both?
- From the review: cleared choices (`markers` kind `sg_clear`) are never pruned. Remove ones older than two weeks in the daily cleanup?
- A block whose free time the calendar fills still gets one suggestion (A4's "at least one"). Offer none there?

