## AP-1 (Nov 4)

The scope's open questions (`docs/scope/asks-and-promises-scope-v0.1.md`), with what this step learned:

- Q-AP1-1 (scope 1): One delivery chat per client, or several? AP-1 supports several per client, one client per chat, each with its own Read for asks switch (Part A). AP-2 kept Allow AI per client (D501): a client's chats all share it. Still open: whether anyone needs AI on for one chat of a client and off for another.
- Q-AP1-2 (scope 2): Asks from external people who aren't the client lead? Treated the same, author shown with External. Guests count as external (by tenant, D485). Still open: should a second-tier contact (vendor, contractor from a third tenant) be shown differently?
- Q-AP1-3 (scope 3): Keep unmatched messages 14 days? Yes (D492): Show context needs them. Each person's copy is separate, so a chat read by three people is stored three times; fine at this size, but a shared per-client store would need a different access model. Purging across people has no admin path yet (runbook).
- Q-AP1-4 (scope 4): Polling interval, and pause during focus? Every 5 minutes in working hours, not on PTO days, and it keeps reading during focus; AP-1 sends no notification for asks at all. About 12 Graph calls per chat per hour at the default (one page of up to 50; more only for busier chats, at most 5 pages). AP-2 answered: only asks sorted "now" notify, once each, held during focus unless "Let urgent asks through" is on (D504).
- Q-AP1-5 (new): Chat.Read is per-person incremental consent (D490). If the tenant ever turns off user consent, an admin grant is needed; nobody has tested that path yet.
- Q-AP1-6 (new): Edited messages: a message edited after it was read comes back (the filter is on last modified) and is skipped because it was created before the last read. Should an edit that turns a message into an ask be picked up?
- Q-AP1-7 (new): Replies in a group chat have no thread; "reply to" only exists as a quoted message reference, which AP-1 doesn't treat as an attachment and doesn't follow. AP-2 doesn't follow it: the earlier messages give the AI enough to say what a promise answers (D505). Still open for AP-3's auto-close suggestions.
- Q-AP2-1 (new): Urgent asks found by Refresh show on Today but don't notify (only the scheduler's read does, so one ask never notifies twice). Is that what people expect when they press Refresh during focus?
- Q-AP2-2 (new): The walk-on chip stays on Today while the ask is open, even past its 2-hour "now" window (then it also counts in Check-in). Should it leave Now once the window ends?
- Q-AP2-3 (new): The 50 open items the AI sees are the most recently changed; for a client with hundreds of open items, the matching one may be older. Should the list be narrowed by words from the message first (no AI), or is "Looks like" only a hint?
- Q-AP2-4 (new): Promise phrases are English only and match anywhere in the message, so without AI "let me know" and "see you tomorrow" make promises too (with AI they are usually "not a promise"). How noisy is it with real chats, and should the default list be narrower?
- Q-AP2-5 (new): A promise answered by a later message (the file was sent) stays open until its follow-up or item is done (D506). AP-3 proposes suggesting a close; until then, people close it by hand.

