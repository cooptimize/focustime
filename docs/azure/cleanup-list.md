# Cleanup list (HK-4, Nov 6)

Read only: nothing here is dropped. Migrations only add (D468), so each item gets a two-step plan: **step 1** stops
using it in a release (the code that reads or writes it goes, a test keeps it gone); **step 2**, in a later release
and only with the product owner's OK, drops it in a new migration with a `safe-drop: <reason>` comment, so rolling
back to the step 1 release still works against the database.

## Method

- **Code.** Every non-test, non-migration `.ts` file was searched for SQL that reads (`FROM`, `JOIN`) or writes
  (`INSERT INTO`, `UPDATE`, `DELETE FROM`) the table, then each store method holding that SQL was traced to its
  callers outside the store. "No live use" means no caller outside the store and its tests, or only the cleanup that
  deletes the rows.
- **Rows.** A freshly migrated database (SQLite in memory, as the tests open it) has 0 rows in every table below,
  and still has `teams_message_images.bytes`. A fresh database only shows that nothing writes them at setup; prod's
  counts need a counts-only check (Diagnostics style) before step 2.

## Items

| # | What | Evidence | Step 1 (now, when approved) | Step 2 (later release, with OK) |
|---|---|---|---|---|
| 1 | `teams_message_images.bytes` (CV-4) | Cleared by `20261107T1400_images_no_bytes`; no code outside migrations writes it (`store/images-bytes.test.ts` enforces it); `store/teams-store.ts` never selects it. Column still present | Already done in CV-4 | Drop the column (`safe-drop: CV-4 stopped writing it, Nov 7`) |
| 2 | `delivery_chats` (user table, T-2) | AP-1 moved chats to `client_chats` (app table). Its store methods (`addDeliveryChat`, `deliveryChats`, `setAsksOn`, `recordAsksRead`, `setDeliveryChatKind`, `setDeliveryChatMembers`, `removeDeliveryChat`) have no callers outside `store/plan-store.ts` | Remove the methods; take the table out of the export with a version note | Drop the table and its `USER_TABLES` entry |
| 3 | `chat_messages` (user table, AP-1's per-person copy) | `addChatMessages` and `chatMessage` have no callers; the only live use is `purgeChatText`, the daily `asks_cleanup` that deletes from it (`server/ticks.ts`). Messages now live once in `teams_messages` (app table) | Remove the unused methods and the cleanup's part for it | Drop the table |
| 4 | `asks` (user table, AP-1's per-person asks) | `addAsk`, `ask`, `asks`, `resolveAsk`, `setAskShown`, `setAskSort` have no callers; only `purgeChatText` deletes from it. Requests (`requests`, app table) replaced it | As 3 (same cleanup) | Drop the table |
| 5 | AP-1's rules pass in the poll | `actions/request-poll.ts` `rules` still writes `requests` and the `promises` table on every poll and calls `asks.classify` and `promises.extract` beside CV-1's pipeline, which places the same messages into conversations and commitments. `requests.list` is still read by Settings › Delivery chats and `promises.list` by the command menu, so it isn't dead: needs a product decision (Q-HK4-3) | Decide what still needs Requests; if nothing, stop the pass (saves its AI calls) | Then the `promises` rows CV-1's backfill marked moved, and `requests` if unused |
| 6 | `my_promises.followup`, `promises.followup` | IB-1 (D808) removed Make it a follow-up from the UI and the menu (`ui/menu.ts` `NOT_IN_MENU`); the actions stay on the server "until slice 4 takes them out of the assistant" | Remove them from the registry and the assistant once slice 4 lands | Nothing to drop (no table) |
| 7 | `dedupe_log` (user table) | Written and read only inside the numbered migrations (the week features dedupe); no live code reads it | None needed (no code) | Drop the table |
| 8 | `[ai] use`, `monthly_cap_usd`, `allowed_clients` in a person's settings | `ai/types.ts` says they are read (for the one-time org bootstrap) and never enforced since ADM-1 | Stop reading them once every environment's org bootstrap has run | Remove the keys from the settings model (no column) |
| 9 | `teams-bot-store` `sweep()` and `teams-store` `purgeChats()` | No callers (the retention purge now removes old cards; `purgeChats` is reached only through `purgeClient`) | Remove `sweep`; keep `purgeChats` (used inside the store) | Nothing to drop |

## Status after CL-1 (Nov 7)

Step 1 is done where an item was dead; details and the reasons for each choice are under "CL-1" (D1037 to D1047) in `docs/decisions.md`,
and step 2's list with the drop SQL is `docs/cleanup-step-2.md`.

| # | Step 1 | Notes |
|---|---|---|
| 1 | Done in CV-4 | On the step 2 list |
| 2 | Done | Store methods removed; the table stays in Export and Delete my data until step 2 |
| 3, 4 | Done, except the 14-day cleanup | The cleanup keeps deleting the rows still there (client chat text) until step 2's release 2a |
| 5 | Not changed | Still read; waiting on D910 |
| 6 | Done | Both actions removed; follow-ups already made from promises keep working |
| 7 | Not changed | Live on SQLite (frozen migrations); drop on SQL Server only |
| 8 | Not changed | Still read by the one-time org bootstrap (Q-CL1-3); not in Settings |
| 9 | Done | `sweep` removed; `purgeChats` kept |
