# NM-1: proof for each removed part

STEP 0.4: for each part in C, every place that could send, schedule, read or draw it, and what was found. Searched with `grep -rn` over the whole repo (code, tests, docs, workflows, Bicep), on `main` at `13972a6a`.

## 1. Four notification kinds: `commitment_item`, `taken_over`, `conversation_given`, `conversation_activity`

| Where it could be | Found |
|---|---|
| Built | `plan/notify.ts`: one builder each (`notices.commitmentItem`, `takenOver`, `conversationGiven`, `conversationActivity`). |
| Sent | Nothing calls any of the four builders: no `notices.commitmentItem(`, `notices.takenOver(`, `notices.conversationGiven(` or `notices.conversationActivity(` anywhere. The tick that sent them, `conversationsTick` in `server/ticks.ts`, is `async () => {}` since IB-4, with a comment saying so. |
| Scheduled | No job or tick part names them. |
| Read | `config/schema.ts` reads a saved switch per kind in the list; `config/settings.ts` saves them. Nothing else reads the kinds. Stored notices are drawn from their title and body, never their kind (`ui/Notices.tsx`). |
| Drawn | `ui/Settings.tsx`: the Client chats group in Settings › Notifications, two switches (`commitment_item`, `taken_over`). The other two had labels and hints but no switch. |
| Same words, other things (kept) | `taken_over` is also a Teams nudge kind (`plan/teams-rhythm.ts`, sent). `commitment_taken_over` and `conversation_given` are log names in `actions/conversation-actions.ts`. Neither is a notification kind. |

Dead. Removed: the four kinds, labels, hints and builders, and the Client chats group (it held only those two switches). A person's saved choice stays in their settings: `RETIRED_KINDS` makes the reader skip those keys. (The reader already ignored unknown keys by default; in its strict mode they were an error, and no longer are for these four.)

## 2. The `conversations_upkeep` job

| Where it could be | Found |
|---|---|
| The work | `actions/conversation-upkeep.ts`: `upkeep()` is one line, `return { escalated: 0, suggestions: 0 }`. Its comment: IB-4 removed escalation and follow-through; "the job still calls this, so it stays, does nothing and spends no AI". |
| Called | `server/main.ts`: `pollDeps.upkeep = (now) => jobs("conversations_upkeep", {}, () => upkeep(now))`, whose `upkeep` builds the dependencies and calls the function above. `actions/request-poll.ts`: `pollCycle` calls `deps.upkeep` after the chats are read, unless told `upkeep: false` (Refresh on a test site). No other caller. |
| Scheduled | Not a scheduler job of its own: it rides on the chat poll. |
| Policy | `config/background-policy.ts`: a row saying "escalation, reminders, follow-through drafts", `effect: "ai"`, and the chat poll's override applied to it too. |
| Tests | `actions/conversation-actions.test.ts` called it to show nothing happens; `actions/request-poll.test.ts` counted calls; `config/background-policy.test.ts` listed the name. |
| Docs | `docs/technical/architecture.md` and `operations.md` each had a row saying it runs and does nothing. |

Dead. Removed: the file, the hook on the poll, the wiring in `server/main.ts`, the policy row and the docs rows. A new test checks every name left in the policy is used by something that runs.

Seen and left: `conversationsTick` in `server/ticks.ts` (the part named `conversation_notices`) is also empty. It was not on this step's list; it is in the open questions.

## 3. The package `@microsoft/teams.cards`

| Where it could be | Found |
|---|---|
| Imported | Nowhere: no `teams.cards` in any `.ts`, `.tsx`, `.mjs`, the Dockerfile or a workflow. The bot's cards are plain JSON (`server/teams/cards.ts`). |
| Needed beside the Teams packages | `@microsoft/teams.api@2.1.1` lists `@microsoft/teams.cards` `2.1.1` in its own dependencies; `@microsoft/teams.apps` does not. So it stays installed through `teams.api`. |

FocusTime's own line was unused. Removed from `package.json`; the lock file loses that one line and the package is still installed, at the same version, as `teams.api`'s dependency (`npm ls @microsoft/teams.cards`). `npm ci` is unchanged in what it installs.

## 4. Style rules that match nothing

`.dp-calls .lc-starts`, `.dp-calls .lc-start`, `.dp-calls .lc-start::before`, and on the phone `.app.phone .dp-calls .lc-start` (twice, once shared with `.live-call .lc-join`).

| Where it could be | Found |
|---|---|
| Drawn | No element has the class `dp-calls`, `lc-start` or `lc-starts`: the three names appear only in `ui/styles.css`. No class name is built from "dp-" or "lc-" plus a variable in a way that could make them (`dp-box`, `dp-chip`, `dp-day` are the date picker's; `lc-dot`, `lc-text`, `lc-line`, `lc-by`, `lc-join` are the live call's and are used). |

Dead. Removed the five selectors. The neighbors `.live-call …` and `.now-live` are used and stay.
