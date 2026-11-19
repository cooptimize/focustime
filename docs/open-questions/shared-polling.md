## Shared polling (Nov 4)

- Q-SP-1: Q-AP1-3 and Q-AP1-6 are answered by D516 (one copy per message; an edit replaces the stored text, but never makes a new Request). Should an edit that turns an unmatched message into a request become one? Not in this step (no rule changes).
- Q-SP-2: The token owner's request phrases decide the candidates (D518), so a chat's candidates can change when the token moves to another follower with different phrases. Make the phrases a client setting, or the app's?
- Q-SP-3: "Needs reconnecting" retries every 5 minutes inside working hours with nobody's token working (one cheap check per follower). Back off after a day, or tell the registering person by notification?
- Q-SP-4: Delete stored messages now removes a client's unmatched messages for everyone who sees its chats. Should that need the registering person, or an admin?
- Q-SP-5: The assignee column is in place (D518); who may assign, and does an assigned Request show only to its assignee on Today?
- Q-SP-7: Answered by D523: every chat is registered; reading stays on only where someone had switched it on, the rest wait for an admin.
- Q-SP-8: A catch-up read takes the newest 250 messages per chat (5 pages of 50, as since AP-1) and moves the watermark past them, so a chat with more than that since its last poll (dev after a long scale-to-zero, a very busy night) skips the older ones. Page further for catch-up, or say so on the chat?
- Q-SP-6: The per-person AP-1 tables (`delivery_chats`, `chat_messages`, `asks`) are no longer read. Drop them (with `safe-drop`) in the release after this one is in prod.

