# TD-1 Step 0

Nov 13, 2026, on `2f4c0ea` (main after RS-1, PR #149).

1. **Branch and pull request.** No `chore/td1-technical-docs` branch existed and no pull request for this step. The only "TD-1" pull request (#71, "pick reads to-do") is an older, merged step with the same id; this one starts fresh.
2. **RS-2 and GU-1.** Neither has a branch or a pull request on GitHub, so neither has merged. Nothing of theirs is described. `origin/main` is merged again before the final check and the pages are stamped with that commit.
3. **The protected sections.** CLAUDE.md's Principles, Hard rules, Working style and Completion report per increment were copied before any edit (66 lines, SHA-256 `5eec074fc3ede28a6b15e4fc583642ded77cd19ac0d5a0b955e9b8aea8bc71f4`) and compared at the end.
4. **The ledger.** [ledger.md](ledger.md): 1,197 rows across the eight pages, built before the rewrite.
5. **What main has that no page mentions.** Listed below and covered by the rewrite unless noted.

## What main has that no page mentions

**Folders.** `assets/` (brand sources and the Teams package's icons), `links/` (the DevOps URL parser), `public/` (icons, the manifest, the legal page), `sources/calendar/` (the shared calendar HTTP helper), `sources/google/`, `ui/brand/`, `ui/docs/`, `ui/meetings/`, `ui/plan/` (four leftover planning components), `ui/settings/`. CLAUDE.md's folder map was missing `assets/`, `links/`, `public/`, `ui/ahead/`, `ui/code/`, `ui/inbox/`, `ui/meetings/`, `ui/patterns/` and `ui/settings/`, and described `ui/plan/` as the planning layout of two screens that are gone.

**Tables.** `ahead_state_changes` (Backlog's pending state changes), `loop_sends` (Close the loop's sends), `standards_articles` and `standards_sync` (named on Integrations, not on Data).

**Tables kept but no longer written.** `chat_messages`, `asks` and `dedupe_log` (nothing writes them; the daily cleanup still deletes old `chat_messages` and `asks` rows), `delivery_chats` (neither written nor read). The Data page listed them as live.

**Background work.** The policy's `conversations_upkeep`, `conversation_ownership_backfill` and `maintenance` jobs, the tick parts and the start-up work were not on Architecture's job table (Operations had them).

**Reminders.** Four notification kinds are never sent now (`commitment_item`, `taken_over`, `conversation_given`, `conversation_activity`); two of them still have a switch in Settings › Notifications. The urgent request notice (`asks`) is still sent from the Requests rules. Operations listed all of them as live.

**Outside calls.** Three DevOps writes: deleting my own comment in the status report window (`comment_delete`), the end of day Remaining Work update (`remaining_work`), and Send feedback's create in Cooptimize's own DevOps (`feedback`, with a 10 minute preview). Each read's timeout (Graph 10 to 30 seconds by call, DevOps reads 15, DevOps writes and Code 20, Dataverse, Google, Azure and GitHub 20, calendar links 15, OpenAI 30 standard and 120 Flex).

**Settings and configuration.** The app's environment variables (`FOCUSTIME_*`, set in `infra/modules/app.bicep` and read by `server/appconfig.ts`); only `FOCUSTIME_HOST`, `FOCUSTIME_ENV`, `FOCUSTIME_ADMINS` and `FOCUSTIME_REQUESTS_POLL` were named.

**Rules.** The icon family (`ui/icons.tsx`, from `lucide-react`) and style guide section 11 (RS-1).

**Dependencies.** No page listed them. 15 runtime and 10 build dependencies in `package.json`; `@microsoft/teams.cards` is imported by nothing in FocusTime's code (kept at the Teams SDK's version, D1046).

**Mismatch between the code and CLAUDE.md** (the hard rules aren't edited in this step; it is in docs/open-questions.md): Send feedback creates a story in Cooptimize's own DevOps through the write framework, and the hard rules' DevOps list doesn't name it. The VM rule, `comment_delete` and `remaining_work` match the hard rules.
