# IB-4 Step 0: the Inbox before, and what this step does with each part

Demo data, Mon Nov 2, 9:30 AM (the demo's pinned clock). Screenshots in `before/` (dark and light, 1440 by 900 and the
phone at 390 by 844), counts in `before/counts.json` (rows: list items on screen; controls: buttons, links and inputs on
the page).

## 1. Branches

No `feat/ib4-slim-inbox` branch or IB-4 pull request existed; this branch was started from main. `feat/ib4-suggestions`
was not touched.

## 2. RB-1

RB-1 (PR #146) was open. IB-4 stays out of its files except where the step can't be done without them: a few lines in
`actions/registry.ts` (the new actions), `ui/nav.ts` (the three lists and the old addresses), `ui/menu.ts` (the Inbox
keys), `server/demo.ts`'s seeds and the docs. On Day only the chips line ("From chats · N") and the urgent strip changed.

## 3. Before, in numbers (1440, dark)

| View | Rows | Controls on the page |
|---|---|---|
| Everything | 22 | 61 |
| Needs you | 11 | 55 |
| Needs you, one conversation open | 11 | 54 |
| Promises | 7 | 45 |
| Captures and drafts | 2 | 43 |

## 4. Everything the Inbox let a person do, and what IB-4 does with it

Nothing a person typed or made is deleted, and no column or table is dropped: every row below that is "removed from
view" keeps its data.

| Before | IB-4 |
|---|---|
| Views: Everything, Needs you, Promises, Waiting on, In progress, Captures and drafts, Handled by teammates, Done, Chatter (the rail, with counts) | Three lists in one switch: From chats, Promises, Captures. The old addresses land on the nearest list (Needs you, Waiting on, Chatter, Everything: From chats; In progress, My promises: Promises; Captures: Captures) |
| Clients in the rail, with counts | Client chips over the list (shown with two or more clients) |
| Group by client, due date or kind | Always by client; Promises late first, then by due |
| A conversation's card: summary, people, status, Show messages, Open in Teams | Kept only for a suggestion, open in place: why it needs an item, the summary, the messages like Teams, Open in Teams. Any other conversation's address says "This conversation isn't waiting for anything." with Open in Teams |
| Create DevOps item on a conversation | Create item (C) on a suggestion; the same create-from-conversation form, preview and confirm |
| Link to item on a conversation | Already covered (L) on a suggestion: the same search of the client's items |
| Resolve, Mark done (item closed), Reopen on a conversation | Removed from view. A suggestion goes when an item covers it, it winds down, it is dismissed, or 7 days pass |
| Hide for me | Dismiss (X), mine only, with Undo |
| Not a request, Not work-related (shared) | "This isn't work" under a suggestion's ⋯, shared, with Undo |
| Merge into… with its preview and Undo | Removed from view (the merge action and its undo stay on the server; nothing calls them from the Inbox) |
| Ownership: I'll take it, Release, Give to…, Add helper, Take it over, Waiting on <Name>, Unclaimed | Removed from view, with the chasing that went with it (no escalation, no "Waiting on" reminders). The columns stay |
| Follow-through: the suggested DevOps comment after a pause (Post comment or Skip) | Removed (no new ones are made; upkeep is a no-op). Comments still go through Link's "Also add a comment" and the create preview |
| Held back messages (GD-2) with Sort by hand and Mark all not work-related | Removed from view; held messages stay held, and the GD-2 rules for every exit to client eyes (the Close the loop and DevOps flags) are unchanged |
| Unsorted (N) with Sort unsorted | Removed from view; the From chats foot says when a client can't get suggestions now (AI off, no budget) |
| Chatter list with This is work | Removed from view; Diagnostics still counts where my chats' messages were sorted |
| Promises: Close the loop, Create DevOps item, Due, Who, Add to my week / Today, Done, Not needed, Link to item, Unlink, Open in Teams | Kept, on the open row |
| Promises: Snooze…, Wake it now | Removed from view (the column stays; a snoozed promise shows again) |
| A send to my week: Accept, Accept and schedule, Pass to…, Can't this week, Cancel the send | Kept on Week (To place); Day's line for a send opens Week |
| Captures: the capture box, Sort (kind chips), Delete | Kept in Captures, under To sort |
| Drafts: Create in DevOps, Edit draft, Prepare again, Delete draft | Kept in Captures, under Drafts |
| Keys J, K, Enter, C, L, F, W, H, N, E, ? | J, K, Enter, C (Create item), L (Already covered), X (Dismiss), D (Done on a promise), ?. None fire while typing |
| Today's urgent strip, with "N more in Inbox" | Late promises and ones due within 2 hours, sends waiting for my answer; at most 3 lines; no "N more" line. "From chats · N" in the chips line |
| The tab's count (Needs you) | Suggestions plus late or due-today promises |
| Notifications about conversations (new request, waiting, follow-through) | No longer made; promise and send notices unchanged |
| The assistant and the bot: inbox views, snooze and ownership proposals | Their inbox read is From chats, Promises and Captures; the snooze and ownership tools are gone; nothing else changed |

## 5. What the sorting step already knew, and what it is told now

It already returned, per conversation: `wrapped_up` (wound down), `likely_item` (an open item that is the same work), the
link to an item once one is made, and per commitment `implies_item`. A suggestion reuses all four: wound down, a likely
item or a linked item each mean no suggestion. It was told one more thing, in the same request and the same schema:
`item_needed` (why, a title, and a level: story, feature or epic), null when the conversation is a status update, a
"what I'm doing next", an answered question, scheduling, thanks, or already tracked. A malformed or missing value leaves
no suggestion. No extra AI request.

## 6. Where a promise comes from, and what counts as touched

A promise found in a chat is a `commitments` row (`message_ids`, a conversation or none); one added by a person or a
rule is a `follow_ups` row (`by_hand`, its rule). Before IB-4 nothing recorded "touched". IB-4 counts a chat promise as
touched when I set its due day or who, put it on my week or Today, linked or created an item, closed the loop, made it a
follow-up, or put it back (a mark in `inbox_marks`). The clearing rule: a finished linked item clears it as done; one
found in a chat that I never touched expires 7 days after its due day (or after it was found, without one) as not
needed, never as done or broken. Promises I added by hand never expire. Every cleared one shows for 14 days under
Cleared on their own, with Put back.
