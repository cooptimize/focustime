## UC-3: Cleanup round (Nov 18)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | 1. The Teams bot's calls note and the assistant's links say "Open Calls" and point to `#/calls` (a call's note to `#/calls/<id>`). `#/meetings` still lands on Calls (MC-3). The note's header keeps "Client calls", the name of its switch in Settings (open questions). |
| - | Done | 2. "a" or "an" before a type's name goes by how it sounds (`vowelSound`, `plan/quick-create.ts`): "a User Story", "an Epic", "an MVP", "a UAT Task", "an Hour Block". Spelling rules only, no type's name in the code. |
| - | Done | 3. The New form's parent rule (drafts and the create's `new_item`) uses the move rule's words from UC-2: "In Logistics's process, Epic isn't the level above User Story. Under Epic go: Feature" ("In this process" where the project isn't known), and "In Logistics's process, nothing goes under Product Backlog Item". |
| - | Done | 4. The Inbox's group headings count what needs me, by the same rule as the chips and the tab, and add their rows when they differ: "1 needs you · 3", "2 need you", "none need you · 3". Captures' headings, where nothing counts, show their rows. The tab, the All clients chip and the headings' sum are one number. |
| - | Done | 5. The phone's Inbox has the No client chip, shown only while something in its lists has no client, without a number like the phone's other chips. It filters to those rows. |
| - | Skipped, already done | 6. Backlog's bulk State… on a state only some ticked rows take was made pickable by UC-2 (item 8): the rows that take it are staged, the line says how many it left and why, Review lists only those, and Save writes them through the usual preview and Confirm. UC-3 adds `e2e/backlog/bulk-state-some-rows.test.ts` (the save, the one item written, no order field, every row in its place); UC-2's check is in `e2e/backlog/grid-grooming.test.ts`. |
| - | Done | 7. Every tab's tooltip ends with "Press 1" to "Press 7" ("Calls: review the calls you were on. Press 6"), never the key in brackets; Status's reason, when it has one, comes before it. |
| - | Done | 8. After a client change took picked names out, Undo puts the client back with them, and the level, parent and owner the change reset ("Put back 2 names and the client, Northwind."). The draft editor's Undo, the same hook, puts its client and parent back too. Picked names are still taken out on every client change, so they never sit under another client. A name picked under the new client ends that Undo (the review pass), and an Undo before the first client's options were read lets its defaults fill in again. |
| - | Done | No write changes, no stored data, no migration, no new setting. Words in `docs/design/wording.md` (UC-3 words), the Guide's answers on the Inbox and Where is it?. |

