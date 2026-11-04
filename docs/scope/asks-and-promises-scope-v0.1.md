# FocusTime | Asks and Promises Scope v0.1

> Reference copy, word for word except that real names are replaced (the owner's name by "the owner", a client by "Fabrikam") as the repo's names rule requires. The AP-1 step prompt wins wherever this differs.

November 3, 2026. Narrows T-4/AI-4 from *AI and Teams Scope v0.2* to the registered delivery chat per client and pulls it earlier in the order. Decisions from the owner's answers (Nov 3, 17:58) are marked **[confirmed]**; everything else is a proposal. Not authorized to build until a step prompt says so.

## Why

Client requests arrive in the per-client delivery chat (a screenshot of a report that looks wrong, "add this column", "refresh failed in prod"). Some are handled on the spot and never reach DevOps, so the work is invisible in reporting and the team can't see it. The same chat also holds the owner's own promises ("I'll look tonight") that nothing tracks. Asks and Promises makes DevOps the record for both, with a human decision on every item.

## Decisions (Nov 3)

| ID | Status | Decision |
|---|---|---|
| AP-D1 | Confirmed | Delivery chats are cross-tenant: client people are federated users with no account in the Cooptimize tenant. "External" = chat member whose tenantId is not the Cooptimize tenant. No name lists. |
| AP-D2 | Confirmed | Promise capture is in scope: the user's own outbound messages that commit to something become follow-ups (AP-2). |
| AP-D3 | Confirmed | When an ask becomes a DevOps item, FocusTime offers a "Tracked as #1234" reply in the chat by default. Still preview and confirm (T-3), never automatic (AP-3). |
| AP-D4 | Proposed | Name: **Asks**. A tab in Inbox: "Asks" (inbound) and later "Promises" (outbound). |
| AP-D5 | Proposed | Polling, not Graph change notifications, for the first slice. Teams message subscriptions need broader permissions and may be metered; verify current docs before revisiting. |
| AP-D6 | Proposed | Asks ships before Draft stories and the chat panel: tight output, every result reviewed by a person, immediate value. |

## Glossary

| Term | Meaning |
|---|---|
| Delivery chat | A registered Teams group chat for a client (T-2), internal and external members |
| Ask | An inbound message from an external member that reads as a request, bug, question or incident |
| Promise | An outbound message from the user that commits to an action or a date |
| Candidate | A message that passed the rules (eligible for AI classification from AP-2) |
| Resolution | How an ask ends: DevOps item created, linked to an existing item, handled with no item, or dismissed |
| Tracked reply | The "Tracked as #1234" message posted back to the chat (AP-3) |

## Pipeline

Three layers. AI is only the last, and only for candidates.

1. Fetch (no AI). For each registered delivery chat with Asks switched on, poll messages newer than the last seen message every few minutes during the user's working hours (default 5 min; off outside hours and on PTO days). Delegated access on the user's sign-in. Store per message: id, chat id, author id and tenant id, created time, plain-text body, attachment flags (image, file), reply-to id. Unmatched messages expire after 14 days; messages that became asks or promises are kept with the resolution.

2. Candidate rules (no AI, deterministic, testable). Inbound candidate if the author is external and any of: @mentions a Cooptimizer, contains a question mark, contains request phrasing ("can you", "could you", "please", "add", "doesn't look right", "not working", "error", "failed", "urgent"), or has an attachment. Not a candidate if it is reaction-only or a short acknowledgement ("thanks", "sounds good", "ok"), or a reply to a FocusTime-posted message with no new request. Outbound candidate (promise, AP-2) if the author is the user and the text contains commitment phrasing ("I'll", "I will", "let me", "I can", "by Friday", "tomorrow", "tonight", "end of day", "next week"). Rules are per-user settings with these defaults.

3. Classify and draft (AI, AP-2). One request per candidate, that client's context only (client-safe filter). Input: the candidate, up to 5 previous messages, the client's process names, and open DevOps item titles for that client. Output JSON with: kind (bug, request, question, incident, promise, none), urgency (now, this_week, backlog), item_type, title, description, likely_existing_item {id, confidence}, promise {what, due_hint, answers_message_id}, reason (one sentence). "none" hides the card but marks the message classified. Per-client "Allow AI on delivery chat" switch, off by default.

## What the user sees

Asks tab: one card per ask with client, author, time, message text, attachment indicator, (AP-2: AI kind, urgency and reason, likely existing item). Actions: Create bug / Create story / Create feature, Link to existing item, Handled (no item, optional note), Dismiss, Show context (previous messages, collapsed by default), Open in Teams. (AP-2: urgent asks offer Start focus now and appear in Today's Now strip as a walk-on.)

Promises tab (AP-2): one card per promise with what, to whom, due hint, the ask it answers. Actions: Make it a follow-up (who, what, channel = that chat, due), Link to DevOps item, Done, Dismiss.

Tracked reply (AP-3): after an item is created, a preview "Tracked as Bug #1234: <title>. <link>" to the chat, members listed with external people flagged. Confirm posts via T-3 and resolves the ask; Decline resolves without the reply.

No thread view. Context is on demand per card.

## Actions (illustrative)

| Action | Input | Side effects | Notes |
|---|---|---|---|
| asks.poll | client | Reads chat, stores messages, runs rules, queues candidates | Scheduled; also manual Refresh |
| asks.classify | candidate id | AI request, stores result | AP-2; skipped when AI off |
| asks.resolve | ask id, resolution, optional item id or note | Store; message id → item id | Replay-safe |
| asks.create_item | ask id, item type, fields | DevOps write via the write framework with the user's PAT; read back; link | AP-3 then offers asks.reply_tracked |
| asks.reply_tracked | ask id, item id | Post to chat via T-3 preview and confirm | AP-3; never automatic |
| promises.to_followup | promise id | Creates a follow-up | AP-2 |

## Closing loops

- An ask closes by resolution. A tracked reply is the visible close for the client.
- A promise closes when its follow-up is done, its linked DevOps item changes state, or a later message matches it as the fulfilment (proposed, confirm on card). Manual close always available.
- Asks open past their urgency window surface in Check-in as "walked in, not resolved".

## Data and policy

- Chat text is stored in FocusTime per user and client, and (AP-2) may go to the AI provider per AI-D2. Separate per-client switches for reading and for AI; both off by default.
- Attachments: phase one links to the message only.
- Member list (external detection) read on the registered chat and cached with freshness.
- Only external authors are asks in the first slice.
- Provider request log without content, cost per classification, as in AI-0.

Graph permissions to verify when building: Chat.Read (or Chat.ReadBasic plus message read), ChatMember.Read, ChatMessage.Send (T-3 only). Some may need admin consent; the owner is the Cooptimize admin.

## Order

1. T-2 Register delivery chats.
2. AP-1 Fetch + rules + Asks tab with manual resolution and Create item. No AI.
3. AI-0 Provider foundation.
4. AP-2 AI classify and draft; Promises tab; follow-ups.
5. AP-3 Tracked reply via T-3; promise auto-close suggestions.
6. Later: attachments to work items; internal teammates' asks; email as a source.

## Open questions

1. One delivery chat per client, or several? (AP-1 supports several.)
2. Treat asks from external people who aren't the client lead the same? (Proposal: yes, author shown.)
3. Keep unmatched messages 14 days, or discard after rules run? (Proposal: 14 days, so Show context works.)
4. Polling interval, and pause during focus? (Proposal: keep polling; no notification during focus unless urgency = now.)
