# Coopilot | Roadmap and Vision

October 31, 2026. Planning-chat record. The repo's docs/ folder is the living source for built behavior; this file holds direction and the staged path to it.

## Built so far (Oct 31)

1. Week model and grid (Mon–Thu, Friday overflow, Open half-days, standing Monday AM Cooptimize block, soft day shape, risk rules)
2. Dataverse focus patterns via a read-only application user in its own business unit
3. Outlook and Google calendars, read-only
3.5 Auto refresh and single risk badge
4. DevOps items assigned to me per client (board order, client isolation, PAT in memory only)
4.5 Responsive layouts (1920x1080 matters: used over Moonlight from the laptop)

5. Morning planning ("ignition", being renamed Plan the day): story-level picks, S/M/L sizing, carry-over, local plan store, autostart

In progress: Step 5.5, Coopilot as an Omarchy app, work items open in the client's Edge profile, card polish, Loop concept recorded.

## Next, in order

6. Navigation and menus, rename to the new rhythm, plan the next workday, PTO, Outlook status styling, total free time per block
6b. Time model: working hours per day, lunch, unavailable time, flex sessions (local), view range toggle, weekend columns, settings screen
7. Plan the week (feature commitments, readiness ladder, target-date fit)
8. Check-in and Close out, built around closing loops
9. Write framework with guardrails, then DevOps writes (create stories from drafts, change state, comment)
10. Timeboxing committed picks on Outlook (Coopilot-tagged events only)
11. Schedule a meeting for an item (pre-filled Outlook first)
12. Quick capture and heads-up drafts; chat panel on the same actions
Later: Ownership area (epics/features I own, contributors, target-date risk); browser access from machines that can't run Moonlight; Remmina launch/resume.

## Rhythm and naming (agreed Oct 31, replaces "ignition")

- **Plan the week** (end of week, e.g. Thursday or Friday): commit which features you're working on per client for the week ahead.
- **Plan the day** (morning): commit stories per block against real free time. This is what step 5 built as "ignition"; rename in UI and code.
- **Check-in** (midday): what's slipping, what walked in.
- **Close out** (end of day): wrap up and close your loops.

## Two levels of commitment and the readiness ladder

- The **week plan commits features**; the **day plan commits stories**. Future weeks may stay at feature level; a day may not.
- Readiness flags, shown together as a short list in Plan the week, each with one next action:
  - **Epic needs features** before it is planned into future weeks.
  - **Feature needs stories** before the day it is worked ("needs breakdown"; stays open like a loop until stories exist in DevOps).
  - **Block needs work**: focus time booked with a client but nothing open assigned to you there. Becomes a loop: reach out to the client lead or team about priorities.
- Breakdown itself usually happens with **Coop** on the client VM, which knows the code, data and current state. Coopilot notices, flags and can hand off a short brief; Coop shapes the stories.
- **Target dates** (start and target/estimated completion, field names may differ per client process) are treated as a promise to the client: Coopilot checks whether planned blocks still fit and flags early. Feeds the future Ownership area.
- Goal: build the habit of keeping DevOps healthy (decomposed, dated, reviewed) by making planning depend on it.

## Built for any Cooptimizer

Currently tailored to Tanner, but nothing person-specific belongs in code: identity, blocks, roles, Edge profiles and preferences come from Dataverse and config. Roles differ (lead owns epics/features; others mainly stories), so views adapt to what the person has assigned.

## Queued features

- **PTO from Dataverse**: read the time-off tables (`coop_timeofftracker` / `coop_timeofftracker detail`, schema to confirm); show PTO days as off in the week; suppress risk flags on them. Needs Read added to the Coopilot role. PTO is self-entered, no approval flow.
- Visible navigation: top bar with views, "⋯" menus on cards and picks, a command menu (Ctrl+K) listing every action with its shortcut.
- Plan the next workday (e.g. Monday on Thursday evening).

## Time model (agreed Oct 31)

- **Working hours:** a default start and end per weekday (e.g. 9:00–5:00), editable per day for squeezed days (e.g. 9:00–4:00 plus 8:00–10:00 pm). Capacity is computed from working hours, not a fixed half-day assumption.
- **Lunch:** an optional default window, adjustable per day. It also serves as the AM/PM split.
- **Unavailable:** time blocked in Coopilot for things on no calendar. It counts against capacity.
- **Flex session:** planned work outside normal hours (deployments, evenings, weekends), with client and optional DevOps item. Opens a "post the update" loop afterwards. Once the write step exists, it auto-blocks Outlook as a Coopilot-tagged event.
- **View range:** a toggle between business hours, 12h and 24h. The view auto-expands to show anything planned outside the current range. Saturday and Sunday appear only in weeks where something is planned on them.
- **Settings area** in the app for all configuration (see below), so nothing requires editing config files by hand.

## Settings area (agreed Oct 31)

Sections: You (identity from Dataverse, time zone) · Working hours (per weekday, lunch, day overrides, Friday overflow) · Standing blocks · Planning (S/M/L durations, carry-over, reminder times, pickable types) · Risk rules (thresholds) · Clients (nickname, color, Edge profile, DevOps identity, "treat as open" states) · Connections (status, connect/reconnect/disconnect, credential expiry) · Display (default view range, theme) · Data (export, audit log, reset local plan).

Rules: the UI reads and writes the same validated config file, so file and screen never disagree; changes apply live with a backup on save; values owned by Dataverse are shown read-only with where to change them; secrets are entered only in masked fields that go straight to the keyring and are never displayed again.

## Concept: Loops ("closing the loop")

A loop is something Tanner owes someone (an update, answer or follow-through): who, what, channel, optional due date, open until closed.
- Opened by rule (pick done but DevOps not updated; block slipped and someone is affected; item blocked; promise noted in capture) or manually.
- Closed automatically where a signal proves it (DevOps state/comment changed, a Coopilot-drafted message confirmed sent) or intentionally marked closed with an optional note.
- Waiting-on loops (others owe Tanner) are wanted, ideally detected rather than hand-entered.

## North star: synthesized intelligence

Tanner's stated goal: AI that interprets Teams, email and DevOps activity to detect loops in both directions and maintain a synthesized picture of his work, acting as orchestrator, personal assistant and project manager.

Staged path, each stage useful on its own:
- A. Deterministic loops: rules plus manual close. No AI.
- B. Signals without AI: DevOps changes auto-close loops; message metadata (unanswered threads, who is waiting) from reachable mailboxes and chats.
- C. AI interpretation with explicit scope: proposes loops, summaries and per-client working notes. Tanner confirms. Notes are inspectable, editable, exportable.
- D. Orchestrator: proposes plans, drafts updates, flags delivery risk. Always through the same named actions, previews and confirmations; never acts silently.

Boundaries to settle before B/C:
- Which communications are reachable: Cooptimize tenant (Tanner is admin) vs client tenants (e.g. his W&C account), which need each client's consent and policies.
- AI provider data terms for message content (stricter than calendar metadata already approved).
- Noise control, cost, and retention of synthesized notes.
