# CF-1: confirm and musts, where they were and what happens to them

CF-1 removes confirming a plan (a day's and a week's) and musts. Work comes on and off freely. The stored confirm times (`day_plans.committed_at`, `week_plans.committed_at`) and tiers (`week_features.tier`, `week_drafts.tier`, `week_commitments.tier`) stay in the database unread and unwritten, so the idea can come back (no migration, no dropped column, no deleted row).

Written before the change (Step 0) and updated to what was done. "Now" is before CF-1; "After" is what CF-1 does.

## 1. A day's confirm time (`day_plans.committed_at`, `DayPlan.committedAt`)

| Where | Now | After |
|---|---|---|
| `store/plan-store.ts` `commit(date)` | Writes the day's confirm time | Removed; nothing writes it |
| `store/plan-store.ts` `removePick` | Unconfirmed day: the to-do is deleted (a carried copy goes back to its day). Confirmed day: kept as dropped | Always as an unconfirmed day did: taken off. A past day still keeps it as dropped (`pick.remove`'s past rule, unchanged) |
| `store/plan-store.ts` `week()` (`PlanWeek`) and `day()` | Return `committedAt` per day | `committedAt` is no longer part of the day the app reads (`PlanWeek`); `DayPlan` keeps the stored field for Export only |
| `actions/plan-actions.ts` `planday.commit` | Confirms a day | Changes nothing; answers "There's nothing to confirm now. Your plan is what's on your day." (F3) |
| `actions/plan-actions.ts` `planday.start` (auto) | The automatic open happens once a day and never on a confirmed day | Once a day (C4) |
| `actions/plan-actions.ts` `committedNear` and the carry-over target (`plan/days.ts` `carryTarget`) | Unfinished work goes to the earliest day that isn't confirmed | The next day that can take work (C4) |
| `actions/followup-rules.ts`, `plan/followups.ts` | The slip heads-up rule (step 13.5) reads whether the to-do's day was confirmed | The rule is off (E1); open ones stay and close normally (E2) |
| `actions/closeout-actions.ts` | Close out's state carries the day's confirm time | Dropped from the state |
| `actions/dispatch.ts` `planDay.committed`, the Teams brief's `todayConfirmed` | Week's state says whether today is confirmed | Removed |
| `server/ticks.ts` start of day reminder | Fires while today isn't confirmed; closes once it is | Fires while today has no to-dos; closes once it has one (C1) |
| `server/ticks.ts` midday check-in reminder | Fires on a confirmed day not closed out | Fires when today has to-dos and isn't closed out (C2) |
| `plan/notify.ts` `noticeDone` | `plan_day` closes when the day is confirmed | Closes when the day has to-dos |
| `plan/modes.ts` `momentCard`, `dayModeStatus` | The morning card while today isn't confirmed ("Today isn't planned yet") | Only when today is a workday and its blocks have no to-dos: "Nothing on today yet" with Add work (B4) |
| `plan/now.ts` `nowStrip` | `draft` (dimmed counts) and no "over" before a confirm | As a confirmed day did: no draft state, over shows |
| `ui/App.tsx` `commitDay`, `timeboxDay` | Confirm <day>; Timebox my day confirms first ("Confirm and timebox") | Removed; Timebox my day just timeboxes (B1) |
| `ui/menu.ts` day header ⋯ | Confirm <day> / Confirm <day> again; "Confirm and timebox" | Removed; "Timebox my day" (B1) |
| `ui/Today.tsx` | "Confirm and timebox" button; Check-in's "Today isn't planned yet" line; the Plan card's "Today isn't planned yet" | "Timebox my day"; the line goes; the card reads "Nothing on today yet" (B4) |
| `ui/TodayTimeline.tsx`, `ui/DetailPanel.tsx`, `ui/WeekGrid.tsx`, `ui/planview.ts`, `ui/PhoneToday.tsx` | A to-do ticks only on a confirmed day; the "draft" tag beside to-dos; the block's fit and Start focus wait for a confirm; a confirmed day collapses the block's suggestions | Ticks on today and past days with no confirm; no draft tag; fit and Start focus as a confirmed day (B2, B3) |
| `ui/Carry.tsx` | "Adds to a confirmed day" hints on Keep | Removed (B3) |
| `server/teams/rhythm.ts`, `server/teams/render.ts`, `server/teams/cards.ts` | The morning card says "Today is confirmed" / "Today isn't confirmed yet" with Confirm today | Removed. An old card's Confirm today answers "There's nothing to confirm now. Your plan is what's on your day." (F1) |
| `assistant/allowlist.ts`, `assistant/service.ts`, `assistant/context.ts` | `confirm_day` proposes `planday.commit` | Removed from tools, allowlist and glossary (F2) |
| `scripts/screenshot-phone.ts`, `e2e/mb1-helpers.ts` | Confirm a day as setup | The confirm step goes |

## 2. A week's confirm time (`week_plans.committed_at`, `WeekPlanRecord.committedAt`)

| Where | Now | After |
|---|---|---|
| `store/plan-store.ts` `commitWeek`, `committedWeeks` | Writes and lists confirmed weeks | Removed; `weeksWithWork` answers "has this week anything placed" instead |
| `store/plan-store.ts` `touchWeek` | Moves the week's change time, one second after a confirm in the same second (WD-1) | Touches the change time only (no confirm to beat) |
| `store/plan-store.ts` `undoWeekAdd` | Undo of an add takes back its feature and restores the week's change time | Takes back the feature only (A2) |
| `actions/weekplan-actions.ts` `weekplan.commit` | Confirms the week | Changes nothing; answers "There's nothing to confirm now. What's on your week is your plan." (F3) |
| `actions/weekplan-actions.ts` `weekPlanView.changed` | "Changed since you confirmed" | Removed |
| `plan/addwork.ts` `weekTag`, `confirmLabel` | Draft / Confirmed / Changed since you confirmed; Confirm week / Confirm again | Removed (A1) |
| `ui/App.tsx` Week header | The tag and Confirm week; "Week confirmed" notice; the Look ahead offer after confirming next week | Removed (A1) |
| `ui/keys.ts`, `actions/registry.ts`, command menu | C confirms the week; "Confirm the week", "Confirm the day" commands | Removed (A1, B1) |
| `actions/dispatch.ts` `weekCommitted`, `weekNudge`, `aheadDue` | From confirmed weeks | From weeks with anything placed (C3) |
| `server/ticks.ts` Monday's "Add work to the week", Thursday's and Friday's "Look ahead" | Fire while that week isn't confirmed | Fire while that week has nothing placed (C3) |
| `plan/rituals.ts` Look ahead 4 weeks | Due once next week is confirmed | Due once next week has something placed |
| `actions/roadmap-actions.ts` | Plan ahead's "seen" mark and `committed` per week read the confirm time | Read whether the week has work |
| `actions/team-actions.ts` `publishWeek`; `actions/dispatch.ts` after `weekplan.commit` | The Team snapshot (`week_commitments`) is written on confirm (and on accepting a send into a confirmed week) | Written on every change to which features are on the week, never for a past week (D1) |
| `store/team-store.ts` readers, Team view, the status report's "active this week" | Show a person's week only once they confirmed it | Show it when they're on FocusTime and have anything on it (D2) |
| `assistant/*` `confirm_week` | Proposes `weekplan.commit` | Removed (F2) |
| `sources/demo/seeds/week-plan.ts` | The demo confirms this week | Publishes it instead (no confirm) |

## 3. A feature's tier on the week (`week_features.tier`: must or nice)

| Where | Now | After |
|---|---|---|
| `actions/weekplan-actions.ts` `weekplan.set_tier` | Moves a feature between Must and Nice to have; a dropped confirmed must offers a heads-up | Changes nothing; answers "Every feature on the week counts the same now." (F3) |
| `weekplan.remove`'s `headsUp` and `weekplan.headsup` | The heads-up offer and the "heads-up to <client> about the slip" promise | No offer; `weekplan.headsup` creates nothing (E1). Existing promises stay and close normally (E2) |
| `weekplan.add`, `pick.add` (`placeFeature`), sends, Plan it in Backlog, Ahead's Add to week | Write "nice" or "must" | The store still fills the column (its default) for the idea to come back; nothing reads it |
| `weekplan.reorder` (Move up / Move down in the panel) | Orders within a tier | Not offered; the panel lists features in backlog order (G3) |
| `plan/fit.ts`, `plan/weekclients.ts`, `plan/rules.ts`, `plan/estimate.ts`, `plan/weekplan.ts` | Budget against musts; a separate musts line | One total: every feature on the week counts the same (G2) |
| `ui/AddWork.tsx` | The star, musts first, Move up / Move down, "Add to this week · Nice to have" | No star, backlog order, "Add to this week" (G1, G3, G4) |
| `ui/ClientChips.tsx` | "0 of 1 musts done" in the popover | Removed |
| `ui/menu.ts` feature ⋯ | "Make it a must" / "Make it a nice to have", Move up, Move down | Removed |
| `ui/NowStrip.tsx` `MustsSummary`, `ui/WeekMusts.tsx`, Check-in's "Musts this week" foot | Musts left per client, "Still realistic?" | Removed |
| `ui/brand/opening.ts` `mustsDone`, `ui/brand/Opening.tsx` | "Musts done. See you tomorrow." after Close out | "All done. See you tomorrow." when every to-do today is done |
| `ui/Team.tsx` | "· nice to have" beside a teammate's feature | Removed |
| `ui/planview.ts` | A block shows its client's musts not yet placed | Shows its client's features on the week not yet placed |
| `plan/team-types.ts` `Commitment.tier` | Shared with teammates | Still stored, never shown or returned to a teammate (D3) |
| Sends (`plan/sends.ts`, `ui/Team.tsx`, Inbox) | A send's Must or Suggested | Unchanged: the sender's word about priority (G5) |

## 4. Words a person reads

| Word | Where it was | After |
|---|---|---|
| Confirm week, Confirm again, Confirmed, Draft, Changed since you confirmed | Week's header, the Guide, tours, the demo script | Gone |
| Week confirmed, Confirmed <day> | Notices | Gone |
| Confirm <day>, Confirm and timebox, Confirm today | Day header ⋯, Day, the Teams morning card, the assistant | Gone ("Timebox my day") |
| Today isn't planned yet, Today is confirmed, Today isn't confirmed yet | Day's card, Check-in, Teams | "Nothing on today yet" only when today has no to-dos |
| Adds to a confirmed day, draft (beside a to-do) | Carry suggestions, cards | Gone |
| Must, Nice to have, musts done, musts left, Still realistic?, ★ ☆ | Add work, chip popover, Check-in, menus, the Guide, Settings | Gone, except a send's own Must or Suggested (G5) |
| Confirm (on an external write's preview) | DevOps, Close the loop, Teams proposals | Unchanged |
