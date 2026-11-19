## TD-1

Not verified (who could confirm):
- How long dev waits before scaling to zero: the Bicep sets no cooldown, so it is Container Apps' default; the runbook says 300 seconds (whoever runs Azure, from the portal's scale settings).
- Each line of Admin › Status against the code (an engineer, with an admin account on dev).
- The exact error text Azure shows when a resource provider isn't registered (whoever next sees it).
- Which Dataverse columns are read beyond those the adapters name, and whether Dataverse's own audit records FocusTime's reads (Cooptimize IT, Dataverse admin).
- How far behind a calendar added by link can be: the provider decides how often its feed changes (none to confirm; a note for people).
- Which Web Push services a person's browser uses and what they keep (the browser vendors' terms; IT if it matters).
- Encryption at rest of Azure SQL (on by default in Azure SQL; whoever runs Azure, from the portal).
- The 32,000 character comment limit in the Coop contract against a real DevOps comment (the Coop owner).

Where the code looked wrong (the pages say what it does; nothing changed):
- Settings › Notifications still shows switches for `commitment_item` and `taken_over`, and the notifier still lists `conversation_given` and `conversation_activity`, but nothing sends any of the four. Remove the kinds and the switches?
- `conversations_upkeep` still runs after each chat read on prod and does nothing; the background policy's description still names escalation, reminders and follow-through drafts. Drop the job or fix its description?
- The client boundary's point 3 says a held message is visible and sortable by hand; since the slim Inbox no list shows held messages (the rows are kept and re-sorted when an admin edits a client's names). Is that the intent?
- Urgent requests are still picked out by the chat poll and still remind people (the `asks` kind), while the Inbox no longer shows requests. Keep the reminder, or show it somewhere?
- Send feedback creates a DevOps item in Cooptimize's own project (`FOCUSTIME_FEEDBACK_*`, a preview, 10 a day). The hard rules don't name this write. Add it to the rules, or is Cooptimize's own project outside "external systems"?
- `@microsoft/teams.cards` is installed with the Teams SDK and nothing imports it. Remove it from `package.json`?
- The in-app Guide still says "Delivery chats" where the screens say "Client chats" (the Guide is GU-1's).
- The Coop contract sits beside the technical docs but isn't in the panel (`scripts/tech-docs.ts` lists seven pages). Add it to the panel?

Kept but not written:
- `chat_messages`, `asks` (the retention purge still deletes old rows), `delivery_chats` (neither read nor written) and `dedupe_log` (only counted at a SQLite start). Each can go in a later release through a `safe-drop:` migration once nothing reads it. Who decides when?

Should `docs/architecture.md` and `docs/spec.md` be cut down now that `docs/technical/` is the reference for how FocusTime works? Both still describe old screens in detail; this step left them alone.

From the IT review (TD-1):
- Azure SQL, Key Vault, the registry and the bot use public endpoints with no private endpoints. Is that acceptable to Cooptimize IT, or should A6 add private networking?
- A person's outside-write log (Settings › Activity, `loop_sends`) goes with Delete my data, and `admin_audit` is kept forever. Should outside writes have an audit trail people can't erase, and should `admin_audit` have an age limit?
- OpenAI: the pages say only `store: false`. Who records the data region, the provider's retention and the data processing agreement?
- Every Cooptimizer can read every client's code by default (Code access: Whole company). Do client contracts allow that, and who checks?
- No rotation schedule is written down for `ft-data-key` or the OpenAI key. Who owns rotation?

