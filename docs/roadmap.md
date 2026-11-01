# Coopilot | Roadmap and Vision

November 1, 2026. Planning-chat record. The repo's docs/ folder is the living source for built behavior (spec.md, decisions.md, open-questions.md); this file holds direction and the staged path to it.

## Built so far (Nov 1)

1. Week model and grid (Mon–Thu, Friday overflow, Open half-days, standing Monday AM Cooptimize block, soft day shape, risk rules)
2. Dataverse focus patterns via a read-only application user in its own business unit
3. Outlook and Google calendars, read-only. 3.5 Auto refresh and single risk badge
4. DevOps items assigned to me per client (board order, client isolation, PAT in memory only). 4.5 Responsive layouts (1920x1080 matters: used over Moonlight from the laptop)
5. Morning planning, now **Plan the day**: story-level picks, S/M/L sizing, carry-over, local plan store, reminder, autostart
   - 5.5 Coopilot as an Omarchy app (launcher, Super + Alt + C, autostart), work items open in the client's Edge profile, card polish, Follow-up concept recorded
6. Top bar views, ⋯ menus and Ctrl+K command menu from one action registry, ignition renamed to Plan the day, plan the next workday, PTO from Dataverse, Outlook show-as styling, free time per block
   - 6.1 UX review fixes on a token foundation (AA contrast, status bar by root cause, keyboard legend)
   - **Plan any day**: any date, ← →, date picker, past days settle-only, one carry-over day
   - 6b Themes, time model (working hours per day, lunch, evening, unavailable time, flex sessions), Settings, Now strip, view range
   - 6c Live verification, Settings > Planning sizes, focus timer (Pomodoro, server side), basic Follow-ups list, Reset local plan
   - 6d Focused time on picks and days, calendar refresh while a timer runs, followed clients (DevOps and Open half-days only for clients with current focus time, plus "Keep following")
7. **Check-in and Close out** built around closing loops: follow-up rules, resume notes, borrowed time and payback, walk-on work, two reminders
8. **Plan the week**: features and epics from DevOps, blocks per feature with a fit check, readiness ladder, Coop brief, week commit shown in the week and in Plan the day, Thursday/Friday/Monday nudges
9. **Quick capture**: one box saved locally, @client tags, rule-based routing to a follow-up, draft story or note, notes, `coopilot-open --capture`
10. **Simpler experience and focus mode**:
    - Today as the home view; top bar reduced to Today · Week · Plan · Inbox
    - One Plan button that opens the right ritual for the moment
    - Inbox merges follow-ups and unsorted captures
    - Quieter cards with one status (At risk / Too much planned / Fits); details behind a click; plain wording
    - Week → day → focus flow: Plan the week grid on top with click-to-filter and Place, "Break down #id" picks in Plan the day, "This week: #id" on cards
    - Calm focus screen and a top-bar timer on every view
    - Focus sounds made in the app (brown, pink, rain, binaural), saved Spotify/YouTube playlists, optional music pause via playerctl
    - Global capture key Super + Alt + N
11. **Plan the week by client** (DevOps first): each client's Must and Nice to have lists from DevOps in stack rank order (local reorder), optional pins, fit per client on musts, one-click re-planning with a heads-up offer for a dropped committed must, "Anything shifted?" in Check-in, "2 of 4 musts done" and a midweek "Still realistic?" question, Plan the day drawing from the week, DevOps health at the top of Plan the week

12. **Write framework and timeboxing**: named external writes with preview, confirm, read back, audit log and undo; timeboxes on the day strip with optional Put on Outlook (marker-owned events only)
13. **Calendar editing tiers and the collaboration finder**: Coopilot events fully editable and synced both ways (conflicts ask), my own no-attendee events movable with preview, meetings only opened in Outlook; "Needs help from…" ranks Cooptimizers by client, finds free times in everyone's working hours (free/busy only) and sends an invite after preview, undo cancels

13.5. **Follow-ups overhaul, capture simplification and a keyboard fix**: Loop renamed Follow-up; Close the loop, Not needed, Snooze and Delete; a follow-up form with client and Who suggestions; due badges in words and color, due order; follow-ups on week cards, Today, Plan the day (pickable) and Close out; a narrower heads-up rule that says where it came from; capture sorts into follow-up, draft story or draft feature, and notes moved into "where I left off"; shortcuts never act while typing or under a dialog; Add hours or Move anyway; Coopilot events deleted in Outlook kept as "Removed in Outlook"

In progress: nothing. Step 13.5 is built; open questions Q73, Q75 and Q76–Q79 in docs/open-questions.md.

## Calendar editing rule (agreed Nov 1, built in step 13)

Coopilot only edits what it created or what only I can see. Coopilot events (marked) are fully editable and follow changes made in Outlook; my own events with no other attendees can be moved, resized and shown as free or busy, never retitled or marked; meetings with anyone else are never edited (Open in Outlook). Every write goes through the write framework. Backlog: RSVP (accept, tentative, decline with a note) behind preview and confirm.

## Principle #1: DevOps first (agreed Nov 1)

We plan, track and show work in DevOps. If it isn't in DevOps, it isn't planned yet. Coopilot makes the healthy path the easy path, without policing: it guides toward decomposed, dated, prioritized DevOps work and never makes re-planning feel like failure.

## Step 11, week plan by client (agreed Nov 1, built Nov 1)

- Plan the week is per client, not per half-day: each client gets a weekly list of DevOps features/stories in stack rank order, split into **Must** and **Nice to have**. Local reordering only; nothing written back to DevOps.
- A must means "should be completed this week, definitely touched". It is a target, not a contract: moving or swapping is one click with no reason required; dropping a promised must offers a heads-up follow-up.
- Pinning to a day is optional (dependencies). Progress is measured against the current plan. Check-in asks "anything shifted?" in a questioning tone, never an alarm.
- Plan the day offers the client's unfinished musts first.
- Built on step 8's week plan (placements became pins, committed features became musts, migration 8 with a backup) and step 10's layout (block grid on top, list panel, filter by client).

## After step 11 (agreed Nov 1)

12. Write framework (preview, confirm, audit log, undo) + timeboxing: drag picks onto the day timeline (local first); per-timebox "Put on Outlook" toggle; Coopilot edits only its own events.
13. ~~Collaboration finder~~ (built): "Needs help from…" ranks Cooptimizers (1) on the client that same day per Focus Time, (2) on the client per Account Worker, (3) anyone else; PTO shown as "away" only; Graph free/busy finds real overlap within each person's working hours and time zone; invites only after preview and confirm. Reads teammates' focus time and PTO (decided: not sensitive at Cooptimize).
14. DevOps writes: update state, comment, drafts become real stories.

Later: schedule a meeting for an item (pre-filled Outlook first); chat panel on the same actions as the command menu; Ownership area (epics/features I own, contributors, target-date risk); browser access from machines that can't run Moonlight; Remmina launch/resume.

## Direction: hosted for other Cooptimizers (later, needs buy-in)

Interest from other Cooptimizers. A hosted version would use Azure with per-user Entra sign-in, Key Vault for secrets, a per-user database, and normal link opening (Edge profile switching would need an optional local helper). Cost estimate and secure design to be explored in a separate thread before any resources are created. Rule from now (a principle in CLAUDE.md since step 11): nothing machine-specific in the core modules; OS integrations stay behind thin host adapters.

## Rhythm and naming (agreed Oct 31, built)

- **Plan the week** (end of week, e.g. Thursday or Friday; W): commit which features you're working on per client for the week ahead.
- **Plan the day** (morning; P): commit stories per block against real free time.
- **Check-in** (midday; M): what's slipping, what walked in.
- **Close out** (end of day; E): wrap up and close your follow-ups.
- **Focus** (any time): one story at a time on the focus screen.
- Since step 10 the top-bar **Plan** button (3) opens whichever of these fits the moment; chips inside switch to another.

## Two levels of commitment and the readiness ladder (built in step 8)

- The **week plan commits features**; the **day plan commits stories**. Future weeks may stay at feature level; a day may not.
- Readiness flags, shown together as a short list in Plan the week, each with one next action:
  - **Epic needs features** before it is planned into future weeks.
  - **Feature needs stories** before the day it is worked ("needs breakdown"; stays open like a follow-up until stories exist in DevOps). Since step 10, Plan the day offers a "Break down #id" pick with "Copy Coop brief" beside it.
  - **Block needs work**: focus time booked with a client but nothing open assigned to you there. Becomes a follow-up: reach out to the client lead or team about priorities.
  - **No target date** (soft) and **captures to sort**.
- Breakdown itself usually happens with **Coop** on the client VM, which knows the code, data and current state. Coopilot notices, flags and hands off a short brief; Coop shapes the stories.
- **Target dates** (field detected per client process) are treated as a promise to the client. Blocks-vs-free-time fit is built; checking planned blocks against target dates is still to come and feeds the Ownership area.
- Goal: build the habit of keeping DevOps healthy (decomposed, dated, reviewed) by making planning depend on it.

## Built for any Cooptimizer

Currently tailored to Tanner, but nothing person-specific belongs in code: identity, blocks, roles, Edge profiles and preferences come from Dataverse and config. Roles differ (lead owns epics/features; others mainly stories), so views adapt to what the person has assigned.

## Queued features

Done since the last update:

- ~~PTO from Dataverse~~ Built in step 6 (my rows only; every PTO day is a whole day off, no risks or picks).
- ~~Visible navigation~~ Built in step 6, simplified in step 10 (Today · Week · Plan · Inbox, ⋯ menus, Ctrl+K).
- ~~Plan the next workday~~ Built, extended to "plan any day".
- ~~Plan the week layout~~ Built in step 10 (grid pinned on top, right-hand panel when wide, click a block to filter and place, chips and search, readiness folded). Plan the day shows one block's candidates at a time.
- ~~Focus timer~~ Built in steps 6c/6d (timebox a pick, end notification with Done / +15 / Next, meeting warnings, focused time per pick); step 10 added the focus screen and sounds.

Open (step 10 questions, see docs/open-questions.md):

- Q57 Install `playerctl` (official repos) so focus can pause and resume music. Not installed yet.
- Q58 A default playlist that opens on every focus start.
- Q59 Show every block's candidates at once on very wide screens?
- Q60 Should Plan switch to Check-in once the day is committed, even in the morning?
- Q61 Should Done on the focus screen offer a break first?
- Calibrate S/M/L sizes from recorded focus time.

## Time model (agreed Oct 31, built in step 6b)

- **Working hours:** a default start and end per weekday, editable per day for squeezed days (e.g. 9:00–4:00 plus 8:00–10:00 pm). Capacity is computed from working hours, not a fixed half-day assumption.
- **Lunch:** an optional default window, adjustable per day. It also serves as the AM/PM split.
- **Unavailable:** time blocked in Coopilot for things on no calendar. It counts against capacity.
- **Flex session:** planned work outside normal hours (deployments, evenings, weekends), with client and optional DevOps item. Opens a "post the update" follow-up afterwards. Once the write step exists, it auto-blocks Outlook as a Coopilot-tagged event.
- **View range:** a toggle between business hours, 12h and 24h. The view auto-expands to show anything planned outside the current range. Saturday and Sunday appear only in weeks where something is planned on them.

## Settings area (agreed Oct 31, built in step 6b)

Sections: You · Working hours · Standing blocks · Planning (S/M/L durations, carry-over, reminders, timer, week nudges, follow grace days, pickable types) · **Focus** (default sound, volume, fade, break chime, music pause, playlists; step 10) · Risk rules · Clients (nickname, color, browser profile, DevOps identity, "treat as open" states, keep following) · Connections · Display (view range, theme) · Data (export, reset local plan; audit log comes with the write framework).

Rules: the UI reads and writes the same validated config file, so file and screen never disagree; changes apply live with a backup on save; values owned by Dataverse are shown read-only with where to change them; secrets are entered only in masked fields that go straight to the keyring and are never displayed again.

## Concept: Follow-ups ("closing the loop")

A follow-up is something Tanner owes someone (an update, answer or follow-through): who, what, channel, optional due date, open until closed.

- Built (step 7 and on): opened by rule (DevOps update after a pick is done, slip heads-up, blocker nudge, flex session ended, ask about priorities, a promise in a capture) or manually; closed by a signal that proves it (DevOps state or comment changed) or by "Mark as told" with an optional note. Listed in the Inbox; due ones show on Today.
- Not built yet: closing on a Coopilot-drafted message confirmed sent (needs the write framework), and waiting-on follow-ups (others owe Tanner), ideally detected rather than hand-entered.

## North star: synthesized intelligence

Tanner's stated goal: AI that interprets Teams, email and DevOps activity to detect follow-ups in both directions and maintain a synthesized picture of his work, acting as orchestrator, personal assistant and project manager.

Staged path, each stage useful on its own:

- A. Deterministic follow-ups: rules plus manual close. No AI. **Built.**
- B. Signals without AI: DevOps changes auto-close follow-ups (built); message metadata (unanswered threads, who is waiting) from reachable mailboxes and chats (not started).
- C. AI interpretation with explicit scope: proposes follow-ups, summaries and per-client working notes. Tanner confirms. Notes are inspectable, editable, exportable.
- D. Orchestrator: proposes plans, drafts updates, flags delivery risk. Always through the same named actions, previews and confirmations; never acts silently.

Boundaries to settle before B/C:

- Which communications are reachable: Cooptimize tenant (Tanner is admin) vs client tenants (e.g. his W&C account), which need each client's consent and policies.
- AI provider data terms for message content (stricter than calendar metadata already approved).
- Noise control, cost, and retention of synthesized notes.
