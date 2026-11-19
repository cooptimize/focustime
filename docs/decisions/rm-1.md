## RM-1: Remove the code behind hidden features (Nov 15)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | A part is removed only when nothing live reaches it: no drawn button, offered assistant tool, Teams command, notice route, job or tick. A hidden address or a hidden per-person switch counts as off the screen (Team, DevOps patterns). The proof per feature is in `docs/ux/rm1/proof.md` |
| - | Done | One commit per feature, each typechecked and tested on its own: small leftovers, work templates (TP-1), the DevOps patterns page (WP-1 to WP-3), the Team view and Ask a lead to look, the week list from before the block panel, the old Inbox's tracking |
| - | Done | No table, column, index, stored value or migration is dropped or changed. Export, Delete my data and retention cover exactly what they did; `server/rm1-legacy.test.ts` checks a person with rows from every removed feature |
| - | Done | Old addresses land on a live place with no error: `#/patterns` opens Today, `#/week/team` and the Team notice route open Week |
| - | Done | Ask to look's notice kinds `look_ask` and `look_reply` join `RETIRED_KINDS`: a saved switch stays in the settings text, unread |
| - | Done | The org setting `devops_patterns` stays defined so old values and Admin › Audit rows still read; Admin › People no longer shows it |
| - | Done | Old marks keep their effect: hidden and snoozed Inbox items, hidden conversations, merged conversations, Nothing this week and Mark as being broken down |
| - | Done | Kept though hidden: `conversations.undo_ownership` (Undo of an assistant proposal confirmed before IB-4), `weekplan.add_draft` and `weekplan.draft_tier` (not on RM-1's list), the store's ownership backfill |
| - | Done | Kept as live: Send to (Suggested, Must, Accept, Pass to, Can't this week, Withdraw), To place, client priorities, the status report's week snapshot, reading chats, From chats suggestions, promise finding, holding messages and every client-boundary check |
| - | Done | Held-back messages can no longer be sorted by hand (the commands were off the screen since IB-4). They stay held until an admin changes a client's names or retention deletes them. CLAUDE.md GD-2 point 3 is not edited; it is listed for the product owner |
| - | Done | The merge summary and follow-through comment AI tasks leave the tiers, Admin › AI's labels, the demo and the eval; their stored outputs stay |
| - | Done | The background policy is unchanged: no removed feature ran on its own |
| - | Done | CLAUDE.md: the Team and Ask to look glossary rows move to the Renamed list's "Gone" line; the hard rules are not edited |

