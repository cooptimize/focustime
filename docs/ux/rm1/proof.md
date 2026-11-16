# RM-1 STEP 0: what each removed part could still reach, and what it left behind

On `main` at 8e233104 (the branch point). For each feature: every way a person, a job or other code could reach it
(screen, button, command, key, address, assistant tool, Teams command, notice, job, tick, another feature's code),
whether that way was open, hidden or gone, the files only it used, and everything that imported them.

How reach was checked: every action name was searched for outside tests and outside the registry, the dispatcher
and the command menu's own runner (`git grep '"<name>"' -- ui server assistant`, and for names built at run time
`` `<prefix>.${ `` and `"<prefix>." +`, none found); every export of a removed file was searched for outside its own
file and tests (`scratchpad orphans.mjs`, run before and after each commit); the typecheck (`tsc` on the browser and
the Node configs, which include tests) proves no import is left.

**Reading used throughout.** RM-1's list names two things that could still be opened by hand: Team (its address,
`#/week/team`) and DevOps patterns (for people an admin switched on). Both count as "taken off the screen" here,
because the list asks for exactly them, "address handling beyond a redirect" and "hidden entry" included. Anything a
drawn button, an offered assistant tool, the Teams bot, a tick or a job reaches stays, even when it was on the list
or on NM-2's hollow list. Those are in "What stayed" below.

## 1. Small leftovers (commit 0291579c)

| Part | Ways in on main | Open? | Proof |
|---|---|---|---|
| `roadmapRowMenu` (`ui/roadmapmenu.ts`) | Only `ui/Roadmap.tsx`, removed in NM-2 | Gone | No import outside its own test |
| `ui.first_launch` | `ui/App.tsx` called it on every open and it wrote the `first_launch` mark, but since BR-1 removed Lumen's first-launch moment nothing read its answer or the mark | Called, unread | The call and the action go together; the marks already stored stay. Not in the assistant allowlist or Teams commands |
| `--brand-ghost` | BR-1's removed mark | Gone | No `var(--brand-ghost)` anywhere |

## 2. Work templates, TP-1 (commit 09d05314)

`plan/work-templates.ts` and `store/work-templates-store.ts`. TP-1b removed Admin › Work templates and the Settings
view (their addresses already redirect). On main only their own tests imported them (orphans list); no action,
job, tick or screen names `work_templates`. The shape of `draft_stories.brief` moves to `test/builders` because
TP-1b still reads old drafts' answers and tests plant them.

## 3. DevOps patterns page, WP-1 to WP-3 (commit fd30dc63)

| Way in | State on main |
|---|---|
| `#/patterns` | Hidden: drawn only for a person with the Admin › People Rule `devops_patterns` on; for everyone else it opened Today |
| 13 `patterns.*` actions | Reached only from `ui/patterns/` and the command menu's runners, which were gated by the same Rule |
| Jobs and ticks | None: runs started from the page; `config/background-policy.ts` lists no patterns job |
| Assistant, Teams, notices | None (not in `assistant/allowlist.ts`, no notice kind) |

Removed: `ui/patterns/`, `plan/patterns/`, `actions/patterns*.ts`, `store/patterns-store.ts`, its DevOps reader and
limiter wiring in `server/main.ts`, the item-history read only it used, and their tests. After removal `#/patterns`
opens Today for everyone, and Admin › People no longer offers the switch (the key stays parsed).

## 4. Team view and Ask a lead to look, SW-1 (commit 49c4c937)

| Way in | State on main |
|---|---|
| `#/week/team` | Hidden: no tab, key, switch or menu entry (NM-2); reachable only by typing it |
| `team.view` | Called only by `TeamView` |
| `look.ask`, `look.reply` | Drawn only inside Team and the "all" part of From your team, which no caller requests |
| Notices `look_ask`, `look_reply` | Sent only after a `look.ask` or `look.reply` |

Removed: TeamView, `team.view`, `look.ask`, `look.reply`, the two notices and their tick branches, the store's
`addLook`, `look`, `reply`, the demo's seeded ask, the Guide answer. `#/week/team` and the Team notice route open
Week. Kept: Send to (Suggested and Must, Accept, Accept and schedule, Pass to, Can't this week, Withdraw), client
priorities, `publishWeek` and `week_commitments` (the status report), and the read of my own unanswered asks in
Inbox › Waiting on (for their 14-day window). A lead's reply to an old ask was drawn only in the removed Team and
Ask to look views, so old replies no longer show anywhere; their rows stay in `look_asks`.

## 5. The week list from before the block panel (commit 7d2826b8)

`weekplan.commit`, `planday.commit` (Confirm, gone in CF-1, answered "nothing to confirm"), `weekplan.set_tier`,
`weekplan.reorder`, `weekplan.headsup`, `weekplan.nothing`, `feature.mark_breakdown`, `followup.ask_priorities`,
`planday.carry_hint` and the carry `hint` flag. For each: no caller in `ui/`, `server/`, `assistant/` outside the
command menu's own runner and NM-2's hollow list; not in the assistant allowlist, Teams commands, any notice route,
job or tick. The assistant's and Teams' own "nothing to confirm" replies (`plan/no-confirm.ts`) stay.

## 6. The old Inbox's tracking (commit 416b7d2d)

Ownership (claim, give, add helper, release, take over), merge, unmerge, move and split, resolve, reopen, not a
request, hide, close out, seen, count; the held-back and Chatter lists' commands (held, held_bulk, held_not_work,
this_is_work); `inbox.hide`, `inbox.snooze`, `inbox.looked`; the requests list's context, resolve, reopen, search,
sort_again, show, refresh; `followups.review`; the merge summary and follow-through comment AI tasks. IB-4 took
every one of them off the screen, and NM-2 took them out of the command menu. Each name was searched in `ui/`,
`server/`, `assistant/` (allowlist and tools), `server/teams/` and the notice routes: only the menu's runners, the
dispatcher and the registry named them. The AI tasks had no caller left once their actions went (the comment
drafting task had none even on main). In the same files, a few things already dead on main went with them because
they belonged to this tracking: `ui/Owners.tsx` (the owner photo stack), `NotRequest`, `PRIMARY_WORD` and
`wakeWords`. Other exports dead on main, outside these features, were left (see What stayed).

## What stayed, and the line between live and removed

| Kept | Why |
|---|---|
| `conversations.undo_ownership` | Undo of an assistant `conversation_owner` proposal confirmed before IB-4; confirmed proposals live 24 hours, so a deploy soon after an older build may still need it |
| `conversations.not_work`, `not_work_undo`, `list`, `refresh`, `messages`, `link`, `unlink`, `suggestions`, `dismiss`, `undismiss`, `search_items`, `sort_unsorted`, `search`, `draft`, `suggestions.skip`, `my_promises.*` | Drawn in From chats or Promises, or offered to the assistant |
| `requests.list`, `requests.purge` | Settings › Client chats |
| `inbox.seen`, `inbox.today`, `inbox.count`, `followup.snooze` | The open promise's seen mark, the tab count, the assistant's inbox read, Snooze… on a promise row in Close out |
| `markInbox`, `seeConversation`, `resolveRequest` | Used by the DevOps create path |
| `inbox.list` reading `lastLooked` and old snooze and hide marks | So old marks keep their effect |
| `weekplan.add_draft`, `weekplan.draft_tier` | Hollow since WD-2 but not on RM-1's list |
| Holding, its reasons, the count, `held_recheck` and every boundary check | The client boundary stays whole; only sorting held messages by hand went |
| `NOTHING_TO_CONFIRM_DAY`, `NOTHING_TO_CONFIRM_WEEK` | The assistant's and Teams' answers |
| Send to, Suggested and Must, To place | RM-1 says so |
| Dead exports already dead on main (`pinLabel`, `pickDoneFrom`, `otherStoriesLine`, `planBudget`, `pinnedToPto`, `weekModeStatus`, `addSuggestion` and others in the orphans list) | Not behind a hidden feature; listed for a later step |

## Data each feature wrote, and Export, Delete my data and retention

No table, column, index, stored value or migration changed (`git diff 8e233104 -- store/migrations` is empty).
`USER_TABLES`, `PARENTS_FIRST`, `NOT_EXPORTED` and the retention cleanups are unchanged, so Export, Delete my data
and retention cover what they covered. `server/rm1-legacy.test.ts` plants a row of each removed feature's user
tables (week_quiet, breakdown_marks, the carry hint marker, inbox_marks hide and snooze, inbox_last_looked,
conversation_views hidden) as the removed actions wrote them, loads every tab, Settings and every Admin section with
no error, checks the old marks still apply, and that Export carries the rows and Delete my data removes them.
`store/isolation.test.ts` still fills every table (`test/fill.ts` writes the rows the removed store calls wrote).
What nothing writes any more, and what still reads it: `docs/cleanup-step-2.md`, section RM-1.

## CLAUDE.md hard rules that describe something removed

- **GD-2 point 3** says a held-back message is "visible (Part 2) and sortable by hand". Holding and the reasons are
  unchanged, but the held list's commands (Sort, Not work, bulk) were already off the screen and are now removed,
  so a held message stays held until an admin changes a client's names (`held_recheck`) or retention deletes it.
  The rule is not edited; the product owner decides its wording or whether sorting by hand comes back.
