# FocusTime | AI and Teams Integration Scope v0.2

> Reference copy, word for word except that real names are replaced (the owner's name by "the owner", a client by "Fabrikam") as the repo's names rule requires. The AP-1 step prompt wins wherever this differs.

November 2, 2026. Supersedes v0.1. Decisions from the owner's answers (Nov 2, 9:47) are marked **[confirmed]**; everything else is a proposal. Nothing here is authorized to build until a step prompt says so.

## Why

The core loop (plan the week, plan the day, focus, check in, close out, follow up, keep DevOps current) works without AI. AI and Teams should remove the remaining friction: clicking through actions you could just say, writing the same updates by hand, and missing asks and promises that live in Teams and email.

## Principles

1. AI proposes; FocusTime's named actions execute, with the same previews and confirmations as the UI.
2. Every core view works with AI off or unavailable.
3. Send only what a task needs. Never secrets, tokens, PATs, VM contents or client code.
4. One client's data never goes into another client's prompt or post.
5. Every post is previewed and confirmed. Nothing posts automatically unless a message type is explicitly switched on later.
6. Everything AI-suggested is visible, editable and dismissable.

## Decisions (Nov 2)

| ID | Status | Decision |
|---|---|---|
| AI-D1 | Confirmed | Provider: **OpenAI API**. Built behind a provider adapter so it can change later. |
| AI-D2 | Confirmed | Data policy: anything FocusTime holds may be sent to the provider (calendar, DevOps text for all clients, internal Teams), one client per request. the owner: the business terms exclude training, and no client contract restricts the data FocusTime holds. |
| AI-D3 | Set up in AI-0 (Nov 4) | **AI-0:** one OpenAI project and key per environment (FocusTime dev, FocusTime prod) in the Cooptimize API organization, each with a hard monthly spend limit; the key only in that environment's Key Vault as `ft-openai-key` (infra/scripts/openai-key.sh, never printed); requests sent with `store: false` (no application state kept by OpenAI; abuse monitoring logs up to 30 days; API data not used for training); zero data retention not requested yet. Caps in FocusTime too: 10 USD a person and 100 USD for the app each month (D495 to D499, runbook › AI). Original text: **API access is separate from ChatGPT Business.** OpenAI's Business FAQ: a Business subscription does not include API usage; the API platform is billed separately. Need: which API organization/project and key (Cooptimize org vs personal), and confirm its data controls (training off by default for API; retention window; zero-retention option if wanted). Key lives in Key Vault only. |
| T-D1 | Confirmed | Each client's delivery thread is usually a **Teams group chat with internal and external people**, e.g. "Fabrikam Delivery Team (Cooptimize)". Not a channel. |
| T-D2 | Open | Posting to chats that include external people. Proposal: allowed, never automatic; preview lists everyone who will see it with external people flagged; a client-safe filter keeps internal planning details out (see below). |
| T-D3 | Confirmed | Post types: slip heads-up, deployment done, weekly status, loop closed, all of them. And "more intelligence than templates": FocusTime should notice when a post is worth making and draft it with AI. |
| T-D4 | Confirmed | Signals: **Teams first, Outlook email after.** |

## Client-safe filter (proposal, for chats with external people)

Posts to a mixed chat may include: that client's DevOps items, dates, status, and what the owner did or will do. They never include: other clients, capacity or budget numbers, borrowed time, PTO reasons, risk rule internals, internal notes, or teammates' schedules. The AI prompt states this, and a deterministic check scans the draft for other clients' names and items before the preview shows.

## "More intelligence" for posts (proposal)

- **Notice:** rules spot the moment (a must slipped, a deployment item moved to Done, Thursday afternoon for weekly status, a loop closed) and offer a post. No AI needed to notice.
- **Draft:** AI writes the post from that client's context only (DevOps changes, plan, calendar), in the owner's voice, short.
- **Decide:** the owner edits, sends or dismisses. Dismissals teach nothing automatically yet.
- **Later (T-4/AI-4):** read the delivery chat for asks of the owner and promises he made; propose follow-ups and waiting-ons.

## Staged plan

1. **T-2 Register delivery chats.** Settings > Clients: pick each client's chat from your Teams chats; show members with external people flagged; link to open in Teams. Read-only.
2. **AI-0 Provider foundation.** OpenAI adapter, key in Key Vault, model and limits in settings, request log without content, cost estimate per request, AI on/off switch, client-scoping guard.
3. **T-3 Post with preview.** The four post types as rule-triggered offers with AI drafts, client-safe filter, preview showing audience, confirm, read-back, audit log; delete own message as undo where Graph allows.
4. **AI-1 Chat panel.** Natural language over the action registry; writes show the normal preview.
5. **AI-2/AI-3** Smarter capture and drafting elsewhere (heads-ups by email, Close out summary, Coop briefs).
6. **T-4/AI-4** Read delivery chats, then email, for asks and promises; propose follow-ups and waiting-ons. (Now Asks and Promises, see asks-and-promises-scope-v0.1.md.)
7. **AI-5** Per-client briefings at Plan the day and Plan the week.

Likely Graph permissions (verify when building): Chat.ReadBasic, Chat.Read, ChatMessage.Send, ChatMember.Read; Mail.Read later. Some may need admin consent; the owner is the Cooptimize admin.

## Open questions

1. AI-D3: which OpenAI API org/project and key, and its retention settings. (Set up in AI-0, see AI-D3 above; the owner creates the projects and keys.)
2. T-D2: posting to mixed internal/external chats as proposed?
3. Does each client have exactly one delivery chat, or sometimes several?

## Added Nov 3: Draft stories with AI (folded into AI-0 and AI-3)

Decision: a DevOps-only "break it down" capability lives inside FocusTime, using the AI provider, instead of a separate durable Coop worker (option 1 of the three considered; Coop's in-VM pickup stays for code-aware breakdowns; a Pi worker only if real use shows FocusTime's drafts are too shallow and manual Coop pickup too slow).

- **Where:** "Draft stories" on any Needs stories row (Plan the week, Plan the day, Today's This week row, the detail panel). Also "Estimate" and "Prep me" later, same path.
- **Input:** that feature's DevOps fields (title, description, acceptance, tags, parent epic, existing child stories, linked wiki or doc text the user picks), the client's process names (story type, states), and the user's note. One client per request; the client-safe filter applies.
- **Output:** story proposals in the Coop v1 proposal schema (stable proposal ids, title, description, acceptance, dependencies, optional size), so the same preview and create path serves FocusTime's drafts and Coop's.
- **Publish:** preview, edit, batch create with the user's write PAT through the write framework, read back, link under the feature, record proposal ids (replay-safe). Never automatic.
- **Policy:** per-client switch "Allow AI drafting" off by default; provider request log without content; cost shown per draft.
- **Order:** AI-0 foundation first (adapter, key in Key Vault, switch, cost, scoping), then Draft stories as the first AI feature, before the chat panel.
