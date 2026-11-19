## Part 0: a shared owner and state per conversation (Nov 9)

Unnumbered until merge. Up for grabs is a person's view here; the spec's Up for grabs requests don't exist as a separate kind in the code yet, so the record is on conversations.

| # | Status | Decision |
|---|---|---|
| - | Done | Part 0: State is never stored. Closed is `closed_at`, Owned is `claimed_by`, otherwise Open, so the two can't disagree. Every change appends a row to `conversation_events`, an app table with ids and names only, never message text, and goes through the store's `viewer(userId)`, so visibility is what it was. |
| - | Done | Part 0: `owner_id` stays the AI's guess at who is driving a conversation and never makes anything Owned. Only a person's action (or a Give to, or the backfill) sets `claimed_by`. |
| - | Done | Part 0: Behavior change: an Open conversation where someone said "I'll do it" shows as Up for grabs to their teammates until that person taps I'll take it. Before, it went straight to Handled by teammates. This is what "never claims silently" asks for. |
| - | Done | Part 0: The offer "You replied. Take this?" (or "You said you'd do it. Take this?") shows in the detail pane only while nobody has it. A claim from it is recorded on its history row (`via`), so the timeline says "took it after replying". |
| - | Done | Part 0: Handled by teammates is now Teammate has it (the address and code name stay `teammates`), folded out of Everything's active part and its count. |
| - | Done | Part 0: Claim: a conditional `UPDATE ... WHERE claimed_by IS NULL` inside the transaction. No row changed means someone else won, and the loser gets "<First name> has this" (409), reloading the item. |
| - | Done | Part 0: Give to and Release: the owner or one of the client's leads, and Give to by anyone while nobody has it. Give to and Add helper offer the Cooptimizers on that chat who use FocusTime and follow the client, so the new owner can always see it. |
| - | Done | Part 0: Helpers only once someone has it. A helper sees You're on it and is told through the notification gate. Anyone who can see a conversation can Close it out, as with Resolve before. |
| - | Done | Part 0: Undo: only the newest change still in force, and only by whoever made it. Otherwise "That's changed since". It restores the record from the row's `before_json` and marks the row undone; rows are never deleted. |
| - | Done | Part 0: A new message on a Closed one reopens it only when its author is neither the last owner nor whoever closed it, so the people who closed it can still write in the chat. It reopens to the last owner, with "Reopened: <Name> asked again". On an Owned one, the owner is notified (`conversation_activity`, once per latest work message) and it stays with them. |
| - | Done | Part 0: Assistant and Teams: `conversation_owner` is a proposal with Confirm and Undo, not at once, because the hard rule says every write the assistant offers runs only on Confirm. The person comes from the chat's own team list, by name, never an id from the model. The buttons apply at once. |
| - | Done | Part 0: An Open conversation with a linked DevOps item stays In progress (CV-5), unless a suggestion is waiting for me. |
| - | Done | Part 0: Backfill: one job, once (`job_claims`, job `conversation_ownership_backfill`, period `once`, kept out of that table's purge). Only an unclaimed conversation is ever written, so a claim made meanwhile stands. Closed stays Closed; a linked item or a New one stays Open. What's left goes to the AI's owner, an open commitment's author or the last Cooptimizer who spoke, unless its messages name another Cooptimizer (that one stays Open: it's the Asked you signal). No teammate to find means it stays Open. Counts are logged as `ownership_backfill` and kept in `counts_json`. |
| - | Done | Part 0: A promise keeps its own person-owner. A conversation can be Closed while a promise from it is open, and the promise box says so. |
| - | Done | Part 0: Close out is in the action row when it's mine, and under ⋯ otherwise. Not work-related, Not a request and Resolve now go through the same record, so they appear in the history. |
| - | Done | Part 0: HeldBack stays on screen while open, so "Nothing held back now." can be read after the last one goes. It used to unmount as soon as the count reached 0. |

