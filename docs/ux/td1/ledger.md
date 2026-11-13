# TD-1 ledger: the technical docs checked against the code

Built before the rewrite, from the pages as they were on `2f4c0ea` (main, Nov 13, 2026). One row per checkable claim: every name, file, table, action, column and setting in backticks (checked by script: a path must exist, a table must be in `USER_TABLES` or the isolation test's `APP_TABLES`, an action must be in `actions/registry.ts`, a name must appear in the code), then the prose claims checked by hand (limits, schedules, screen names, lists, what is missing).

Verdicts: **right** (true in the code), **wrong** (the code says otherwise; fixed in the rewrite), **gone** (the thing is gone, or missing from the page where it should be; removed or added), **can't confirm** (not in the code, the Bicep, the scripts or the workflows; marked Not verified on the page).

## Totals

| Page | Right | Wrong | Gone | Can't confirm | Rows |
|---|---|---|---|---|---|
| README.md | 12 | 4 | 1 | 1 | 18 |
| architecture.md | 404 | 4 | 7 | 1 | 416 |
| data.md | 271 | 8 | 0 | 0 | 279 |
| integrations.md | 147 | 3 | 3 | 1 | 154 |
| security.md | 76 | 7 | 1 | 0 | 84 |
| operations.md | 78 | 6 | 3 | 3 | 90 |
| development.md | 29 | 3 | 3 | 0 | 35 |
| coop-contract.md | 133 | 1 | 0 | 2 | 136 |
| **All** | 1150 | 36 | 18 | 8 | 1212 |

## Checked by hand

The prose claims, and the mechanical rows whose name wasn't found as written.

### README.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| (top) | Checked against 13cd461 on Nov 7, the only stamp |  | wrong | Re-stamped against the merged main commit |
| (top) | The docs open from "⋯ › Technical docs" | ui/App.tsx (More menu, label "Technical docs") | wrong | The menu is More (RS-1); now "More › Technical docs" |
| (top) | "Inbox of client chat conversations" | ui/inbox/InboxPage.tsx, ui/nav.ts INBOX_LISTS | wrong | The Inbox is three lists: From chats, Promises, Captures |
| (top) | Writes back to the person's own Azure VM | sources/azure/client.ts ALLOWED | right | Start and deallocate only |
| The pages | Six pages listed | scripts/tech-docs.ts TECH_PAGES | right | Seven in the panel with the Overview; the Coop contract page is outside the panel (open question) |
| Glossary | Product words are in the Guide's Renamed section | ui/guide/ | can't confirm | Not checked here (the Guide is GU-1's); the line now points to CLAUDE.md's Renamed list |
| Keeping these docs current | docs:check fails on links, Checked lines, Graph permissions, diagrams, secrets | scripts/tech-docs.test.ts | right | TD-1 adds five more checks |
| Keeping these docs current | "A page you didn't re-check keeps its old line" |  | wrong | Led to stamps with exception lists; now one stamp, set only after re-checking the whole page |
| (added) | Names in the code | ui/nav.ts, actions/registry.ts | gone | Missing; added |

### architecture.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| (top) | Stamp with a list of branches |  | wrong | One stamp now |
| The parts | Tabs Day, Week, Backlog, Status, Inbox | ui/nav.ts TABS | right | Code ids today, week, ahead, status, inbox |
| The parts | Full-window panels: Settings, the Guide, these docs | ui/PanelShell.tsx, ui/docs/TechDocs.tsx | right | Code panel (RB-1) and story card overlay missing; added |
| The parts | AI: a stub in the developer loop | ai/stub.ts, server/main.ts | right |  |
| The parts | Icon module and icon package not mentioned | ui/icons.tsx, lucide-react | gone | Missing; added (RS-1) |
| Running in Azure | 0.5 vCPU, 1 GiB, port 8080, /healthz, single revision, max 1 replica | infra/modules/app.bicep:126-164 | right |  |
| Running in Azure | Dev scales to zero after 300 seconds | infra/dev.bicepparam minReplicas 0; infra/modules/app.bicep | can't confirm | minReplicas 0 is in the Bicep; the 300 s cooldown is Container Apps' default, not set in infra/; Not verified |
| Running in Azure | Dev S0, prod S1 | infra/main.bicep sqlSku, infra/prod.bicepparam | right |  |
| Running in Azure | Log Analytics 30 days | infra/modules/monitoring.bicep retentionInDays 30 | right |  |
| Background jobs and job_claims | Fast pass 5 s, slow pass 30 s | server/scheduler.ts:151 | right |  |
| Background jobs and job_claims | Only while used in the last 15 minutes, else sleeps to the stored due time | server/scheduler.ts | right |  |
| Background jobs and job_claims | Six app jobs listed | server/main.ts, config/background-policy.ts BACKGROUND | wrong | The policy names nine jobs (adds conversations_upkeep, conversation_ownership_backfill, maintenance) plus tick parts and start-up work; the page now lists them all |
| Background jobs and job_claims | standards_sync hourly while in use | server/standards-job.ts:1 | right |  |
| Module map | host boundary enforced by host/boundary.test.ts | host/boundary.test.ts | right |  |
| The planning rules | Risk thresholds 90 / 150 / 90 minutes | week/risks.ts, config defaults | right |  |
| The planning rules | Per-step bullets (WK-3, TY-1, WD-1, WD-2, CF-1, DP-2, AH-6, AH-7, SR-1, SR-3, RF-1, SG-1) |  | wrong | Read as a change log ("was", "removed", "until"); rewritten as the present, shorter |
| The planning rules | "Plan the week and Plan the day were removed" | ui/nav.ts | gone | Change-log line; removed |
| The planning rules | SG-1 at most four suggestions a block | plan/boardsuggest.ts MAX_PER_BLOCK = 4 | right |  |
| The planning rules | Status: at most 60 features a client | plan/status-report.ts reportCandidates cap = 60 | right |  |
| The planning rules | Status: fallback when the watermark is older than 35 days | plan/status-report.ts:59 | right |  |
| The planning rules | Status suggestions held 6 hours | actions/status-actions.ts SUGGEST_TTL_MS | right |  |
| The planning rules | Status dot reads every 30 minutes, again after 10 | ui/StatusMark.tsx | right |  |
| The planning rules | "Kat's watermark" (a person's name) | plan/status-report.ts KAT_ZONE | wrong | A person's first name on a page bundled into the app; now "the report's last send" |
| Cooptimize's standards in the AI (KB-1) | Matched articles up to 6,000 tokens | plan/standards.ts | right |  |
| A normal request | Guard, session, CSRF, dispatch, scope | server/guard.ts, server/app.ts, actions/dispatch.ts, store/scope.ts | right |  |
| An external write | Preview held 5 minutes (PREVIEW_MS) | actions/timebox-actions.ts, actions/devops-write-actions.ts, actions/vm-actions.ts | right | Feedback's preview is 10 minutes (actions/feedback-actions.ts); added |
| An external write | Exceptions: presence no preview, VM start no undo | actions/presence-actions.ts, actions/vm-actions.ts | right | VM-2's unattended start has no preview; added |
| The Inbox | Three lists, SUGGEST 4 working hours, 7 days, cleared 14 days | plan/slim-inbox.ts | right |  |
| The Inbox | inbox_marks.suggested_at, cleared | store/migrations (IB-4) | right | Columns exist |
| The assistant | CONTEXT_LIMITS 14 days, 40 to-dos, 12 promises... | assistant/context.ts:21 | right |  |
| The assistant | 16,000 characters | assistant/context.ts CONTEXT_MAX_CHARS | right |  |
| The assistant | Memory 2 hours | assistant/types.ts CONVERSATION_MINUTES = 120 | right |  |
| One Assistant, two renderers | Teams card limit 24 KB | server/teams/render.ts MAX_MESSAGE_BYTES | right |  |
| The story card and Wrap it up (FN-1) | Card kept a minute per person | actions/item-card-actions.ts CACHE_MS | right |  |
| The story card and Wrap it up (FN-1) | Latest 50 comments | plan/item-card.ts COMMENTS_MAX | right |  |
| The story card and Wrap it up (FN-1) | Edit (ED-1) on the card not described | ui/StoryCardEdit.tsx, actions/item-edit*.ts | gone | Missing; added |
| The rhythm's check-ins (TX-1) | checkin.* actions | actions/registry.ts | right |  |
| (missing) | Code panel (RB-1) | ui/code/, actions/code-actions.ts, actions/code-git.ts | gone | Missing from Architecture; added |
| (missing) | New form (QC-1) and the three questions (TP-1b) | ui/NewItem.tsx, ui/ThreeQuestions.tsx | gone | Missing; added |
| (missing) | DevOps patterns page (WP-1 to WP-3) | ui/patterns/, plan/patterns/ | gone | Only on Integrations; added a line |
| (missing) | Style rules' home | docs/design/style-guide.md section 11 | gone | Missing; added |

### data.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| (top) | Stamp with eleven exceptions |  | wrong | One stamp now |
| One database, two kinds of table | USER_TABLES in store/scope.ts; isolation test | store/scope.ts, store/isolation.test.ts | right | 60 user tables, 65 app tables |
| Tables by area | Every table listed | store/scope.ts USER_TABLES, store/isolation.test.ts APP_TABLES | wrong | ahead_state_changes, loop_sends, standards_articles and standards_sync were missing; added |
| The plan | week_plans.committed_at and tier kept but unread | plan/no-confirm.ts | right |  |
| The plan | inbox_marks IB-4 columns | store/migrations/*slim_inbox* | right |  |
| Outside systems and their logs | A DevOps write-kind note sat in the middle of the table, splitting it in two |  | wrong | Moved under the table |
| Client chats and meetings | chat_messages, asks, dedupe_log: "the older per-person Requests rows" | store/plan-store.ts:3500 (CL-1: nothing writes chat_messages or asks) | wrong | Kept, no longer written; only deleted by the daily cleanup. Now said plainly, with what would remove them |
| Client chats and meetings | delivery_chats listed as live ("who registered them") | store (no writes outside migrations) | wrong | Kept, not written or read since shared polling; said plainly |
| Client chats and meetings | requests listed as live | store/teams-store.ts addRequest, actions/request-poll.ts:277 | right | Still written by the poll's rules (and feeds the urgent-request notice) |
| Admin and team | work_templates hidden, kept | store/work-templates-store.ts | right |  |
| Retention | RETENTION_RULES table | store/retention.ts | right | All rows match |
| Retention | conv.retention_days 14 (1 to 90) | config/org.ts | right |  |
| Retention | chat_calls 48 hours | actions/request-poll.ts | right |  |
| Retention | Delete my data 30 days | store/user-data.ts HARD_DELETE_AFTER_DAYS | right |  |
| Retention | Backups 7 and 14 days | infra/main.bicep sqlRetentionDays, infra/prod.bicepparam | right |  |
| Deployment items (DP-2) | Catalog in config/deploy-catalog.ts | config/deploy-catalog.ts | right |  |
| Time spent, time left and check-ins (TX-1) | picks.spent_minutes, remaining_minutes, done_removed, size_xs; timeboxes.settled_* | store/migrations | right |  |
| Time spent, time left and check-ins (TX-1) | RF-1 setup_through mark | plan/setup.ts SETUP_THROUGH_MARK | right |  |
| Export | kv is not in Export | store/user-data.ts (NOT_EXPORTED) | wrong | kv is a user table and is exported; only user_secrets, push_devices, the Teams bot tables and calendar links are not |
| Export | Export schema version 26 (glossary) | store/user-data.ts | wrong | Version 41; import reads 26 to 41 |
| (found in the rewrite) | Settings › Data | ui/settings/registry.ts | wrong | The section is Settings › Your data |

### integrations.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| Azure DevOps | _apis/connectionData | sources/devops/write.ts:62 | right |  |
| Azure DevOps | vso.code | the DevOps token scope name, not in code | can't confirm |  |
| Calendar links (ICS) | text/plain | sources/ics/fetch.ts:62 | right |  |
| Calendar links (ICS) | application/octet-stream | sources/ics/fetch.ts:62, sources/devops/git.ts:48 | right |  |
| GitHub (Cooptimize's standards) | cooptimize/coop-standards | plan/standards.ts:8 | right |  |
| GitHub (Cooptimize's standards) | standards.yml | plan/standards.ts | right |  |
| (top) | Stamp with a paragraph of branches and doc checks |  | wrong | One stamp now; the Microsoft Learn checks stay where the code cites them |
| Microsoft Entra ID and Microsoft Graph | Permission table matches the code and the script | plan/permissions.ts, infra/scripts/app-registration.sh, sources/oauth/oauth.ts | right | docs:check enforces it |
| Microsoft Entra ID and Microsoft Graph | Read timeouts not stated | sources/graph/*.ts | gone | Added: 20 s calendar and writes, 15 s chats, presence and photos, 30 s chat images, 10 s groups and the mailbox check |
| Microsoft Entra ID and Microsoft Graph | Registration reads 5 weeks, at most 40 series masters | sources/graph/meetings.ts:183-187 | right |  |
| Azure DevOps | Write list | plan/devopswrite.ts ChangeKind, actions/devops-write-actions.ts | wrong | comment_delete (SR-3), remaining_work (TX-1) and Send feedback's create were missing; added |
| Azure DevOps | Open pages ask for versions every 30 seconds | ui/DevOpsFresh.tsx VERSIONS_MS | right |  |
| Azure DevOps | Patterns: one request at a time, 2 seconds apart | actions/patterns-run.ts gapMs | right |  |
| Azure DevOps | Code: file read at most 1 MB, Find 20,000 names, memory 5 minutes | sources/devops/git.ts TEXT_MAX_BYTES, FIND_MAX; actions/code-git.ts CODE_MEMORY_MS | right |  |
| Azure DevOps | Read timeouts not stated | sources/devops/source.ts 15 s; write.ts, git.ts 20 s | gone | Added |
| Azure DevOps | identity check _apis/connectionData | sources/devops/write.ts:62 | right |  |
| Dataverse | Read only; client credentials | sources/dataverse/source.ts | right | Timeout 20 s added |
| Google Calendar | calendar.events.readonly | sources/oauth/oauth.ts | right | Timeout 20 s added |
| Calendar links (ICS) | 15 s, 5 MB, 3 redirects, 8 weeks back, 26 ahead, 15 minutes | sources/ics/link.ts, sources/ics/source.ts | right |  |
| Azure Resource Manager (My VM) | ALLOWED, start and deallocate, api-version 2026-04-01 | sources/azure/client.ts | right | Timeout 20 s added |
| The AI provider | gpt-6-luna, gpt-transcribe | server/appconfig.ts DEFAULT_AI | right |  |
| The AI provider | Flex tasks | ai/tiers.ts FLEX_TASKS | right |  |
| The AI provider | Timeouts not stated | server/appconfig.ts timeoutMs 30_000; ai/tiers.ts flex 120_000 | gone | Added |
| GitHub (Cooptimize's standards) | cooptimize/coop-standards by default | plan/standards.ts DEFAULT_STANDARDS_REPO | right | Timeout 20 s added |
| The Teams bot | user-assigned managed identity, no secret | infra/modules/bot.bicep | right |  |
| Web Push | ft-vapid-key | server/webpush.ts | right |  |
| (found in the rewrite) | Settings › Connections | ui/settings/registry.ts | wrong | The section is Settings › Accounts and calendars |

### security.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| Calendar links: the SSRF guard (CAL-1) | text/calendar | sources/ics/fetch.ts:68 | right |  |
| Known gaps | _apis/connectionData | sources/devops/write.ts:62 | right |  |
| (top) | Stamp with exceptions |  | wrong | One stamp now |
| Sign-in and sessions | Tenant check, nonce, PKCE | server/auth/entra.ts | right |  |
| Sign-in and sessions | CSP default-src 'self' | server/app.ts CSP | right |  |
| Secrets | Five secrets and one key in Key Vault | infra/scripts/*.sh, infra/modules/keyvault.bicep | right |  |
| Secrets | "Settings never takes an app secret (removed in ST-1)" |  | wrong | Change-log words; now "Settings never takes an app secret" |
| Client boundaries | GD-2 rule 3: held messages listed under "N messages held back" in the Inbox | ui/inbox/InboxPage.tsx (no held list) | wrong | The held list is out of view; held messages stay held and kept (open question from IB-4) |
| The one exception: client code (RB-1) | Who: notCooptimizer, team-only Rule, view log 12 months | plan/person-match.ts, actions/code-actions.ts, store/retention.ts | right |  |
| Admins, guests and automation accounts | Admins are the FocusTime Admins group or FOCUSTIME_ADMINS | actions/admin.ts | right |  |
| Who sees a client's draft status report (SR-2) | "(Week › Status before WD-1)", "Team (hidden since WD-1)" |  | wrong | Change-log words; removed |
| Who sees a client's draft status report (SR-2) | No delete is added | actions/devops-write-actions.ts comment_delete (SR-3) | wrong | SR-3 added a delete of my own comment in the window; corrected |
| External writes and the audit log | Azure: start only, never stopped | sources/azure/client.ts deallocate (VM-2) | wrong | Start and deallocate (Stop after a preview); corrected |
| External writes and the audit log | DevOps undo: refused when the item changed since | actions/devops-write-actions.ts | right |  |
| External writes and the audit log | Teams: LP-1 messages and emails, IN-2 invites not in the table | actions/loop-actions.ts, actions/invite-send.ts | gone | Added rows |
| Threat model | Azure: "never stop" | sources/azure/client.ts | wrong | Stop (deallocate) after a preview; never the schedule |
| The VM and its auto-shutdown | Reads, starts and stops (deallocates) the one VM | sources/azure/client.ts | right | Matches the hard rule: never stops on its own |
| Test sites (ENV-1) | config/background-policy.ts fails safe on FOCUSTIME_ENV | config/background-policy.ts | right |  |

### operations.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| What runs on its own (ENV-1) | feat/env1-background-policy | a branch, not code | wrong |  |
| Troubleshooting | NotRegistered | Azure's error code, not in code | can't confirm |  |
| (top) | Stamp with exceptions |  | wrong | One stamp now |
| Environments | Groups FocusTime-dev and FocusTime, Central US, apps ft-dev-app and ft-prod-app | infra/*.bicepparam | right |  |
| Environments | Budgets 30 and 60 USD | infra/dev.bicepparam, infra/prod.bicepparam | right |  |
| Environments | Dev sleeps 300 s after the last request | infra/dev.bicepparam minReplicas 0 | can't confirm | Container Apps' default cooldown; Not verified |
| What runs on its own (ENV-1) | "checked against the code on feat/env1-background-policy" |  | wrong | Branch reference; removed |
| What runs on its own (ENV-1) | Reminders list names urgent requests, promises waiting on an item, taken over, conversations given or active | plan/notify.ts builders; server/ticks.ts | wrong | commitment_item, taken_over, conversation_given and conversation_activity are never sent now; urgent requests still is (asks, from the Requests rules). Fixed; the leftover switches are an open question |
| Deploys | deploy-dev on push to main, deploy-prod manual with PROD_DEPLOYERS | .github/workflows/deploy-dev.yml, deploy-prod.yml | right |  |
| Deploys | "⋯ › About" | ui/App.tsx More menu | wrong | More › About |
| Rollback | prod's first commit a347188 | .github/workflows/deploy-prod.yml | right |  |
| Scripts | nine scripts in infra/scripts/ | infra/scripts/ | right |  |
| The Teams package | scripts/teams-package.ts | scripts/teams-package.ts | right |  |
| Troubleshooting | Six browser shards, CI-2 cache | .github/workflows/ci.yml, ci-webkit-deps.yml | right | ci-webkit-deps.yml wasn't named; added |
| What runs on its own | Conversation upkeep: escalations and follow-through no longer made | actions/conversation-upkeep.ts | right | upkeep returns at once; the policy's description still names escalation and drafts (open question) |
| What runs on its own | Reminders list includes taken over, conversations given or active | server/ticks.ts | gone | Never sent now; removed from the list; four kinds named as never sent |
| Environments | Dev sleeps 300 s after the last request | infra/modules/app.bicep | can't confirm | No cooldown in the Bicep: Container Apps' default; marked Not verified |
| Deploys | About is under ⋯ | ui/App.tsx | wrong | More › About |
| (added) | App configuration: the FOCUSTIME_* variables | server/appconfig.ts, infra/modules/app.bicep | gone | Missing from the page; added |
| (added) | Workflows table incl. ci-webkit-deps.yml | .github/workflows/ | gone | Missing; added |

### development.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| One step, one worktree, one PR | origin/main | a git ref, not code | right |  |
| (top) | Stamp with an exception |  | wrong | One stamp now |
| Local setup | Node 26 or newer | package.json engines | right |  |
| Local setup | npm run db:up, npm run dev | package.json scripts | right |  |
| Tests and CI | Commands | package.json scripts | right | test:zones, demo:check, docs:diagrams, check, build were missing; added |
| Tests and CI | CI runs typecheck, guards, unit and store with SQL Server, UI build, six browser shards, Bicep, image | .github/workflows/ci.yml | right |  |
| Tests and CI | "Known flaky tests. HK-5 found and fixed ... (D932 to D939: an Ahead test ...)" |  | wrong | History; shortened to the rule |
| (missing) | Dependency list | package.json | gone | Added with what each is for and its license |
| (added) | Dependencies with purpose and license | package.json | gone | Missing; added (27 packages) |
| Commands | test:zones, demo:check, docs:diagrams, check, build | package.json | gone | Missing; added |
| Adding a Graph permission | Settings › Connections shows it | plan/permissions.ts | wrong | Settings › Accounts and calendars › Microsoft permissions |

### coop-contract.md

| Heading | Claim | Where in the code | Verdict | Note |
|---|---|---|---|---|
| The comment format | renderedText | DevOps comment field named in the contract; not read by FocusTime (not built) | can't confirm |  |
| Proposal | cooptimize/coop-agent | Coop's repo, outside this one | can't confirm |  |
| (top) | "Proposed, not built" | config/background-policy.ts coop_mailbox kind reserved; no code posts or parses a brief beyond folding the labels | right | FocusTime only folds "[Coop brief v1]" and "[Coop update v1]" comments into one line (plan/stories.ts, plan/status-report.ts); said so |
| (top) | Checked against c667e9e on Nov 9 |  | wrong | Re-stamped |
| (top) | FocusTime's test is scripts/coop-contract.test.ts | scripts/coop-contract.test.ts | right |  |
| (top) | Schemas and fixtures in coop-contract/ | docs/technical/coop-contract/ | right |  |
| What this doesn't cover | Only the readers exist on FocusTime's side | plan/stories.ts, plan/status-report.ts, config/background-policy.ts | right | Added the reserved coop_mailbox note |

## Checked by script

Every backticked name on each page, by heading. Kind: file (a path in the repo), table, column, action or key, name (an identifier in the code).

### README.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| FocusTime technical docs | `main` | name | .github/workflows/ci.yml | right |
| What FocusTime is | `ui/guide/` | file | ui/guide/Guide.tsx | right |
| Glossary | `host/types.ts` | file | host/types.ts | right |
| Glossary | `host/azure` | file | host/azure/azure-host.test.ts | right |
| Glossary | `host/local` | file | host/local/config-file.ts | right |
| Glossary | `host/local` | file | host/local/config-file.ts | right |
| Glossary | `user_id` | name | server/people.test.ts | right |
| Glossary | `actions/registry.ts` | file | actions/registry.ts | right |
| Keeping these docs current | `docs/technical/diagrams/` | file | docs/technical/diagrams | right |

### architecture.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| The parts | `ahead` | name | actions/admin-actions.ts | right |
| The parts | `http` | name | .github/workflows/ci-webkit-deps.yml | right |
| The parts | `server/app.ts` | file | server/app.ts | right |
| The parts | `server/main.ts` | file | server/main.ts | right |
| The parts | `actions/registry.ts` | file | actions/registry.ts | right |
| The parts | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| The parts | `host/azure` | file | host/azure/azure-host.test.ts | right |
| The parts | `host/local` | file | host/local/config-file.ts | right |
| The parts | `FOCUSTIME_HOST` | name | host/types.ts | right |
| The parts | `server/scheduler.ts` | file | server/scheduler.ts | right |
| The parts | `server/ticks.ts` | file | server/ticks.ts | right |
| The parts | `server/teams/` | file | server/teams/app-ids.ts | right |
| The parts | `infra/modules/bot.bicep` | file | infra/modules/bot.bicep | right |
| The parts | `ui/Assistant.tsx` | file | ui/Assistant.tsx | right |
| The parts | `server/teams/render.ts` | file | server/teams/render.ts | right |
| Running in Azure | `infra/modules/app.bicep` | file | infra/modules/app.bicep | right |
| Running in Azure | `infra/dev.bicepparam` | file | infra/dev.bicepparam | right |
| Running in Azure | `infra/modules/sql.bicep` | file | infra/modules/sql.bicep | right |
| Running in Azure | `infra/prod.bicepparam` | file | infra/prod.bicepparam | right |
| Running in Azure | `deploy-dev.yml` | file | .github/workflows/deploy-dev.yml | right |
| Running in Azure | `infra/modules/monitoring.bicep` | file | infra/modules/monitoring.bicep | right |
| Background jobs and job_claims | `server/scheduler.ts` | file | server/scheduler.ts | right |
| Background jobs and job_claims | `scheduler_state` | table | store/scope.ts or store/isolation.test.ts | right |
| Background jobs and job_claims | `server/main.ts` | file | server/main.ts | right |
| Background jobs and job_claims | `people_refresh` | name | actions/admin-actions.ts | right |
| Background jobs and job_claims | `retention` | name | .github/workflows/ci.yml | right |
| Background jobs and job_claims | `meeting_capture` | name | actions/meeting-actions.ts | right |
| Background jobs and job_claims | `devops_poll` | table | store/scope.ts or store/isolation.test.ts | right |
| Background jobs and job_claims | `standards_sync` | table | store/scope.ts or store/isolation.test.ts | right |
| Background jobs and job_claims | `requests_poll` | name | actions/admin-actions.ts | right |
| Background jobs and job_claims | `chat_calls` | table | store/scope.ts or store/isolation.test.ts | right |
| Background jobs and job_claims | `job_claims` | table | store/scope.ts or store/isolation.test.ts | right |
| Background jobs and job_claims | `store/retention.ts` | file | store/retention.ts | right |
| Background jobs and job_claims | `claimPeriod` | name | actions/ownership-backfill.ts | right |
| Module map | `host/boundary.test.ts` | file | host/boundary.test.ts | right |
| Module map | `server/main.ts` | file | server/main.ts | right |
| Module map | `server/demo.ts` | file | server/demo.ts | right |
| Module map | `sources/demo/` | file | sources/demo/ai.test.ts | right |
| Module map | `host/no-demo-leak.test.ts` | file | host/no-demo-leak.test.ts | right |
| The planning rules | `week/zone.ts` | file | week/zone.ts | right |
| The planning rules | `week/hours.ts` | file | week/hours.ts | right |
| The planning rules | `week/patterns.ts` | file | week/patterns.ts | right |
| The planning rules | `week/pto.ts` | file | week/pto.ts | right |
| The planning rules | `week/free.ts` | file | week/free.ts | right |
| The planning rules | `week/risks.ts` | file | week/risks.ts | right |
| The planning rules | `evaluateRisks` | name | week/build.ts | right |
| The planning rules | `meeting_watch_minutes` | name | config/config.test.ts | right |
| The planning rules | `meeting_at_risk_minutes` | name | actions/settings-actions.test.ts | right |
| The planning rules | `min_focus_window_minutes` | name | config/config.test.ts | right |
| The planning rules | `week.load` | action or key | actions/registry.ts | right |
| The planning rules | `week/build.ts` | file | week/build.ts | right |
| The planning rules | `weekendPlanned` | name | actions/dispatch.ts | right |
| The planning rules | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| The planning rules | `ui/weekend.ts` | file | ui/weekend.ts | right |
| The planning rules | `WeekendDay` | name | actions/settings-actions.test.ts | right |
| The planning rules | `ui/WeekGrid.tsx` | file | ui/WeekGrid.tsx | right |
| The planning rules | `weekendRows` | name | plan/evening.test.ts | right |
| The planning rules | `plan/evening.ts` | file | plan/evening.ts | right |
| The planning rules | `eveningBand` | name | plan/evening.test.ts | right |
| The planning rules | `ui/Timeline.tsx` | file | ui/Timeline.tsx | right |
| The planning rules | `Timeline` | name | actions/dispatch.ts | right |
| The planning rules | `layoutEvents` | name | ui/BlockCard.tsx | right |
| The planning rules | `EventCard` | name | ui/Timeline.tsx | right |
| The planning rules | `useEventMenu` | name | ui/BlockCard.tsx | right |
| The planning rules | `railNowOf` | name | ui/DayTimeline.tsx | right |
| The planning rules | `ui/WeekGrid.tsx` | file | ui/WeekGrid.tsx | right |
| The planning rules | `ui/DayTimeline.tsx` | file | ui/DayTimeline.tsx | right |
| The planning rules | `ui/ty1.test.ts` | file | ui/ty1.test.ts | right |
| The planning rules | `ui.set_today_timeline` | action or key | actions/registry.ts | right |
| The planning rules | `today_timeline_phone` | name | actions/dispatch.ts | right |
| The planning rules | `PickRow` | name | assistant/over-words.test.ts | right |
| The planning rules | `timebox.add` | action or key | actions/registry.ts | right |
| The planning rules | `update` | name | .github/workflows/ci.yml | right |
| The planning rules | `remove` | name | .github/workflows/deploy-dev.yml | right |
| The planning rules | `plan/timeline.ts` | file | plan/timeline.ts | right |
| The planning rules | `useBandDrag` | name | ui/DayTimeline.tsx | right |
| The planning rules | `ui/Timeboxes.tsx` | file | ui/Timeboxes.tsx | right |
| The planning rules | `BandEditCtx` | name | ui/DayTimeline.tsx | right |
| The planning rules | `planMyDay` | name | plan/agenda.test.ts | right |
| The planning rules | `timebox.add_many` | action or key | actions/registry.ts | right |
| The planning rules | `ui/WeekGrid.tsx` | file | ui/WeekGrid.tsx | right |
| The planning rules | `ui/BlockCard.tsx` | file | ui/BlockCard.tsx | right |
| The planning rules | `ui/Day.tsx` | file | ui/Day.tsx | right |
| The planning rules | `WeekGrid` | name | ui/App.tsx | right |
| The planning rules | `ui/BlockPanel.tsx` | file | ui/BlockPanel.tsx | right |
| The planning rules | `plan/blockpanel.ts` | file | plan/blockpanel.ts | right |
| The planning rules | `plan/addwork.ts` | file | plan/addwork.ts | right |
| The planning rules | `pick.take_off` | action or key | actions/registry.ts | right |
| The planning rules | `docs/ux/wd2/inventory.md` | file | docs/ux/wd2/inventory.md | right |
| The planning rules | `afterPick` | name | actions/dispatch.ts | right |
| The planning rules | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| The planning rules | `docs/ux/wd1/inventory.md` | file | docs/ux/wd1/inventory.md | right |
| The planning rules | `hasWorkOn` | name | plan/modes.test.ts | right |
| The planning rules | `plan/modes.ts` | file | plan/modes.ts | right |
| The planning rules | `weeksWithWork` | name | actions/dispatch.ts | right |
| The planning rules | `WEEK_CHANGES` | name | actions/dispatch.ts | right |
| The planning rules | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| The planning rules | `publishWeek` | name | actions/dispatch.ts | right |
| The planning rules | `plan/no-confirm.ts` | file | plan/no-confirm.ts | right |
| The planning rules | `docs/ux/cf1/inventory.md` | file | docs/ux/cf1/inventory.md | right |
| The planning rules | `config/deploy-catalog.ts` | file | config/deploy-catalog.ts | right |
| The planning rules | `plan/deploy-items.ts` | file | plan/deploy-items.ts | right |
| The planning rules | `actions/deploy-item-actions.ts` | file | actions/deploy-item-actions.ts | right |
| The planning rules | `deploy.items` | action or key | actions/registry.ts | right |
| The planning rules | `deploy.config_save` | action or key | actions/registry.ts | right |
| The planning rules | `ui/DeployItems.tsx` | file | ui/DeployItems.tsx | right |
| The planning rules | `ui/TimeField.tsx` | file | ui/TimeField.tsx | right |
| The planning rules | `DateField` | name | ui/Capture.tsx | right |
| The planning rules | `plan_deployment` | name | assistant/allowlist.ts | right |
| The planning rules | `window_start` | name | store/migrations/20261120T0900_pick_deployments.ts | right |
| The planning rules | `window_end` | name | store/migrations/20261120T0900_pick_deployments.ts | right |
| The planning rules | `links` | name | actions/admin-actions.ts | right |
| The planning rules | `deploy.add` | action or key | actions/registry.ts | right |
| The planning rules | `pick.set_kind` | action or key | actions/registry.ts | right |
| The planning rules | `windowHalf` | name | actions/plan-actions.ts | right |
| The planning rules | `plan/deploy.ts` | file | plan/deploy.ts | right |
| The planning rules | `afterHours` | name | actions/deploy-actions.test.ts | right |
| The planning rules | `plan/deploy.ts` | file | plan/deploy.ts | right |
| The planning rules | `week.load` | action or key | actions/registry.ts | right |
| The planning rules | `afterHours` | name | actions/deploy-actions.test.ts | right |
| The planning rules | `DeployedOffer` | name | ui/App.tsx | right |
| The planning rules | `ui/Deploy.tsx` | file | ui/Deploy.tsx | right |
| The planning rules | `plan_deployment` | name | assistant/allowlist.ts | right |
| The planning rules | `deploy.add` | action or key | actions/registry.ts | right |
| The planning rules | `ahead` | name | actions/admin-actions.ts | right |
| The planning rules | `plan/gantt-tree.ts` | file | plan/gantt-tree.ts | right |
| The planning rules | `ui/ahead/Chevron.tsx` | file | ui/ahead/Chevron.tsx | right |
| The planning rules | `ui/ahead/Gantt.tsx` | file | ui/ahead/Gantt.tsx | right |
| The planning rules | `barTreatment` | name | plan/gantt.test.ts | right |
| The planning rules | `plan/gantt.ts` | file | plan/gantt.ts | right |
| The planning rules | `capText` | name | ai/view.ts | right |
| The planning rules | `ui/ahead/prefs.ts` | file | ui/ahead/prefs.ts | right |
| The planning rules | `ui/ahead/Toolbar.tsx` | file | ui/ahead/Toolbar.tsx | right |
| The planning rules | `filterCount` | name | plan/ahead-view.test.ts | right |
| The planning rules | `ahead.filters` | action or key | actions/registry.ts | right |
| The planning rules | `flat` | name | actions/ahead-actions.ts | right |
| The planning rules | `plan/ahead-view.ts` | file | plan/ahead-view.ts | right |
| The planning rules | `toQuery` | name | plan/ahead-view.test.ts | right |
| The planning rules | `fromQuery` | name | plan/ahead-view.test.ts | right |
| The planning rules | `withQuery` | name | plan/ahead-view.test.ts | right |
| The planning rules | `notHere` | name | actions/code-actions.test.ts | right |
| The planning rules | `peopleWord` | name | plan/ahead-view.test.ts | right |
| The planning rules | `summary` | name | .github/workflows/deploy-prod.yml | right |
| The planning rules | `ui/ahead/Grid.tsx` | file | ui/ahead/Grid.tsx | right |
| The planning rules | `filterRows` | name | plan/ahead-model.ts | right |
| The planning rules | `backlogGroups` | name | actions/devops-fresh-actions.ts | right |
| The planning rules | `plan/backlog.ts` | file | plan/backlog.ts | right |
| The planning rules | `fixGroups` | name | actions/devops-fresh-actions.ts | right |
| The planning rules | `plan/backlog-status.ts` | file | plan/backlog-status.ts | right |
| The planning rules | `ui/ahead/Bulk.tsx` | file | ui/ahead/Bulk.tsx | right |
| The planning rules | `ahead.stage_bulk` | action or key | actions/registry.ts | right |
| The planning rules | `preset` | name | actions/ui-actions.test.ts | right |
| The planning rules | `ui/nav.ts` | file | ui/nav.ts | right |
| The planning rules | `plan/readiness.ts` | file | plan/readiness.ts | right |
| The planning rules | `startHere` | name | plan/readiness.test.ts | right |
| The planning rules | `START_RULE` | name | plan/readiness.test.ts | right |
| The planning rules | `kindCounts` | name | plan/readiness.test.ts | right |
| The planning rules | `toggleKind` | name | plan/readiness.test.ts | right |
| The planning rules | `liveSkips` | name | actions/ahead-actions.ts | right |
| The planning rules | `fills` | name | actions/devops-poll.ts | right |
| The planning rules | `addFixed` | name | actions/devops-write-actions.ts | right |
| The planning rules | `fixedSince` | name | actions/ahead-actions.ts | right |
| The planning rules | `fixClient` | name | plan/ahead-model.ts | right |
| The planning rules | `plan/fixnext.ts` | file | plan/fixnext.ts | right |
| The planning rules | `pending` | name | actions/account-types.ts | right |
| The planning rules | `leaving` | name | e2e/ah7-readiness.test.ts | right |
| The planning rules | `ahead.skip` | action or key | actions/registry.ts | right |
| The planning rules | `ahead.unskip` | action or key | actions/registry.ts | right |
| The planning rules | `kv` | table | store/scope.ts or store/isolation.test.ts | right |
| The planning rules | `ahead_skips` | name | plan/readiness.ts | right |
| The planning rules | `fields` | name | actions/ahead-actions.ts | right |
| The planning rules | `aheadLanded` | name | actions/devops-write-actions.ts | right |
| The planning rules | `ahead_fixed` | name | plan/readiness.ts | right |
| The planning rules | `ahead.load` | action or key | actions/registry.ts | right |
| The planning rules | `AttentionLine` | name | ui/ahead/Ahead.tsx | right |
| The planning rules | `ui/ahead/Toolbar.tsx` | file | ui/ahead/Toolbar.tsx | right |
| The planning rules | `ui/ahead/Ahead.tsx` | file | ui/ahead/Ahead.tsx | right |
| The planning rules | `status.load` | action or key | actions/registry.ts | right |
| The planning rules | `status.report` | action or key | actions/registry.ts | right |
| The planning rules | `actions/status-actions.ts` | file | actions/status-actions.ts | right |
| The planning rules | `plan/status-report.ts` | file | plan/status-report.ts | right |
| The planning rules | `accounts.coop_statuslastsenton` | action or key | actions/status-actions.ts | right |
| The planning rules | `statusSent` | name | actions/dispatch.ts | right |
| The planning rules | `clientReportWindow` | name | actions/status-actions.ts | right |
| The planning rules | `reportWindow` | name | actions/dispatch.ts | right |
| The planning rules | `reportBody` | name | actions/status-actions.ts | right |
| The planning rules | `reportCandidates` | name | actions/status-actions.ts | right |
| The planning rules | `noUpdateYet` | name | actions/status-actions.ts | right |
| The planning rules | `week_commitments` | table | store/scope.ts or store/isolation.test.ts | right |
| The planning rules | `teamPto` | name | actions/collab-actions.ts | right |
| The planning rules | `ptoRuns` | name | plan/status-report-client.test.ts | right |
| The planning rules | `comment` | name | actions/admin-actions.ts | right |
| The planning rules | `comment_edit` | name | actions/devops-write-actions.ts | right |
| The planning rules | `comment_delete` | name | actions/devops-write-actions.ts | right |
| The planning rules | `sources/dataverse/holidays.ts` | file | sources/dataverse/holidays.ts | right |
| The planning rules | `ptoSection` | name | actions/status-actions.ts | right |
| The planning rules | `upcomingRows` | name | actions/status-actions.ts | right |
| The planning rules | `contributions` | name | actions/status-actions.ts | right |
| The planning rules | `plan/status-report.ts` | file | plan/status-report.ts | right |
| The planning rules | `needsYou` | name | actions/chat-images.test.ts | right |
| The planning rules | `status.load` | action or key | actions/registry.ts | right |
| The planning rules | `status.report` | action or key | actions/registry.ts | right |
| The planning rules | `status.suggest` | action or key | actions/registry.ts | right |
| The planning rules | `added` | name | .github/workflows/deploy-dev.yml | right |
| The planning rules | `catalog` | name | actions/deploy-item-actions.ts | right |
| The planning rules | `ui/status-lines.ts` | file | ui/status-lines.ts | right |
| The planning rules | `localStorage` | name | e2e/adm2-shots.test.ts | right |
| The planning rules | `plan/status-dot.ts` | file | plan/status-dot.ts | right |
| The planning rules | `dotDays` | name | actions/dispatch.ts | right |
| The planning rules | `week/build.ts` | file | week/build.ts | right |
| The planning rules | `working` | name | actions/account-types.ts | right |
| The planning rules | `scheduled` | name | actions/patterns-run.ts | right |
| The planning rules | `dotSchedule` | name | actions/status-actions.ts | right |
| The planning rules | `lastKatRun` | name | actions/status-actions.ts | right |
| The planning rules | `nextKatRun` | name | actions/status-actions.ts | right |
| The planning rules | `status.load` | action or key | actions/registry.ts | right |
| The planning rules | `sendsAt` | name | actions/status-actions.ts | right |
| The planning rules | `zone` | name | actions/admin-actions.ts | right |
| The planning rules | `serverNow` | name | actions/devops-fresh-actions.ts | right |
| The planning rules | `dotFor` | name | actions/status-actions.ts | right |
| The planning rules | `actions/status-actions.ts` | file | actions/status-actions.ts | right |
| The planning rules | `workdaysFor` | name | actions/dispatch.ts | right |
| The planning rules | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| The planning rules | `ui/StatusMark.tsx` | file | ui/StatusMark.tsx | right |
| The planning rules | `serverNow` | name | actions/devops-fresh-actions.ts | right |
| The planning rules | `dotText` | name | plan/status-dot.test.ts | right |
| The planning rules | `plan/boardsuggest.ts` | file | plan/boardsuggest.ts | right |
| The planning rules | `markers` | table | store/scope.ts or store/isolation.test.ts | right |
| The planning rules | `sg_clear` | name | actions/plan-actions.ts | right |
| The planning rules | `plan/blockstatus.ts` | file | plan/blockstatus.ts | right |
| The planning rules | `plan/weekplan.ts` | file | plan/weekplan.ts | right |
| The planning rules | `plan/estimate.ts` | file | plan/estimate.ts | right |
| Cooptimize's standards in the AI (KB-1) | `server/standards-job.ts` | file | server/standards-job.ts | right |
| Cooptimize's standards in the AI (KB-1) | `sources/github/standards.ts` | file | sources/github/standards.ts | right |
| Cooptimize's standards in the AI (KB-1) | `standards_articles` | table | store/scope.ts or store/isolation.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `store/standards-store.ts` | file | store/standards-store.ts | right |
| Cooptimize's standards in the AI (KB-1) | `plan/standards.ts` | file | plan/standards.ts | right |
| Cooptimize's standards in the AI (KB-1) | `actions/standards.ts` | file | actions/standards.ts | right |
| Cooptimize's standards in the AI (KB-1) | `retrieveStandards` | name | actions/standards.ts | right |
| Cooptimize's standards in the AI (KB-1) | `layer` | name | actions/admin-actions.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `artifact` | name | .github/workflows/ci.yml | right |
| Cooptimize's standards in the AI (KB-1) | `technology` | name | actions/admin-actions.ts | right |
| Cooptimize's standards in the AI (KB-1) | `d365` | name | actions/admin-actions.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `stories.draft` | action or key | actions/admin-actions.ts | right |
| Cooptimize's standards in the AI (KB-1) | `capture.prepare` | action or key | actions/admin-actions.ts | right |
| Cooptimize's standards in the AI (KB-1) | `conversations.draft_item` | column | actions/admin-actions.ts | right |
| Cooptimize's standards in the AI (KB-1) | `standards` | name | actions/admin-actions.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `shapeItem` | name | actions/story-actions.ts | right |
| Cooptimize's standards in the AI (KB-1) | `standards` | name | actions/admin-actions.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `StandardsUsed` | name | actions/standards.ts | right |
| Cooptimize's standards in the AI (KB-1) | `ui/StandardsNote.tsx` | file | ui/StandardsNote.tsx | right |
| Cooptimize's standards in the AI (KB-1) | `standards` | name | actions/admin-actions.test.ts | right |
| Cooptimize's standards in the AI (KB-1) | `standardsAnswer` | name | assistant/service.ts | right |
| Cooptimize's standards in the AI (KB-1) | `assistant/service.ts` | file | assistant/service.ts | right |
| Cooptimize's standards in the AI (KB-1) | `assistant.standards` | action or key | actions/admin-actions.ts | right |
| A normal request | `server/guard.ts` | file | server/guard.ts | right |
| A normal request | `server/app.ts` | file | server/app.ts | right |
| A normal request | `store/accounts.ts` | file | store/accounts.ts | right |
| A normal request | `actions/dispatch.ts` | file | actions/dispatch.ts | right |
| A normal request | `store/scope.ts` | file | store/scope.ts | right |
| A normal request | `user_id` | name | server/people.test.ts | right |
| An external write | `PREVIEW_MS` | name | actions/devops-write-actions.ts | right |
| An external write | `actions/timebox-actions.ts` | file | actions/timebox-actions.ts | right |
| An external write | `actions/devops-write-actions.ts` | file | actions/devops-write-actions.ts | right |
| An external write | `actions/vm-actions.ts` | file | actions/vm-actions.ts | right |
| An external write | `test` | name | .github/workflows/ci-webkit-deps.yml | right |
| An external write | `write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| An external write | `devops_write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| An external write | `azure_write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| An external write | `teams_status_log` | table | store/scope.ts or store/isolation.test.ts | right |
| The Inbox | `ui/inbox/InboxPage.tsx` | file | ui/inbox/InboxPage.tsx | right |
| The Inbox | `needs_you` | name | actions/conversation-ownership.test.ts | right |
| The Inbox | `promises` | table | store/scope.ts or store/isolation.test.ts | right |
| The Inbox | `captures` | table | store/scope.ts or store/isolation.test.ts | right |
| The Inbox | `ui/nav.ts` | file | ui/nav.ts | right |
| The Inbox | `conversations.suggestions` | column | actions/admin-actions.ts | right |
| The Inbox | `suggestionsList` | name | actions/conversation-actions.ts | right |
| The Inbox | `actions/conversation-actions.ts` | file | actions/conversation-actions.ts | right |
| The Inbox | `isSuggestion` | name | actions/conversation-actions.ts | right |
| The Inbox | `plan/slim-inbox.ts` | file | plan/slim-inbox.ts | right |
| The Inbox | `item_needed` | name | actions/slim-inbox.test.ts | right |
| The Inbox | `item_needed` | name | actions/slim-inbox.test.ts | right |
| The Inbox | `conversations.update` | column | .github/workflows/ci.yml | right |
| The Inbox | `checkItemNeeded` | name | plan/conversations.ts | right |
| The Inbox | `inbox_marks.suggested_at` | column | store/migrations/20261204T0900_slim_inbox.ts | right |
| The Inbox | `outcome` | name | actions/ask-ai.test.ts | right |
| The Inbox | `unsortedLine` | name | actions/conversation-actions.ts | right |
| The Inbox | `inbox.list` | action or key | actions/registry.ts | right |
| The Inbox | `my_promises.list` | action or key | actions/registry.ts | right |
| The Inbox | `inbox.list` | action or key | actions/registry.ts | right |
| The Inbox | `settlePromises` | name | actions/conversation-actions.ts | right |
| The Inbox | `clearsAs` | name | actions/conversation-actions.ts | right |
| The Inbox | `inbox_marks.cleared` | column | actions/account.ts | right |
| The Inbox | `clearedPromises` | name | actions/conversation-actions.ts | right |
| The Inbox | `my_promises.put_back` | action or key | actions/registry.ts | right |
| The Inbox | `put_back_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The Inbox | `capture.load` | action or key | actions/registry.ts | right |
| The Inbox | `inbox.today` | action or key | actions/registry.ts | right |
| The Inbox | `needsYou` | name | actions/chat-images.test.ts | right |
| The Inbox | `needsYou` | name | actions/chat-images.test.ts | right |
| The Inbox | `plan/inbox-items.ts` | file | plan/inbox-items.ts | right |
| The Inbox | `suggestionCount` | name | actions/conversation-actions.ts | right |
| The Inbox | `inbox.today` | action or key | actions/registry.ts | right |
| The Inbox | `todayLines` | name | actions/inbox-today.test.ts | right |
| The Inbox | `actions/conversation-upkeep.ts` | file | actions/conversation-upkeep.ts | right |
| The Inbox | `ui/stamp.ts` | file | ui/stamp.ts | right |
| The Inbox | `ui/Stamp.tsx` | file | ui/Stamp.tsx | right |
| The assistant | `assistant/service.ts` | file | assistant/service.ts | right |
| The assistant | `assistant/allowlist.ts` | file | assistant/allowlist.ts | right |
| The assistant | `assistant/resolve.ts` | file | assistant/resolve.ts | right |
| The assistant | `assistant.intent` | action or key | actions/admin-actions.ts | right |
| The assistant | `plan_check` | name | assistant/answer.ts | right |
| The assistant | `capabilities` | name | assistant/answer.ts | right |
| The assistant | `agenda` | name | actions/types.ts | right |
| The assistant | `promises` | table | store/scope.ts or store/isolation.test.ts | right |
| The assistant | `waiting` | name | actions/ai-tier.test.ts | right |
| The assistant | `readiness` | name | actions/ahead-actions.test.ts | right |
| The assistant | `deployments` | name | actions/deploy-actions.test.ts | right |
| The assistant | `status_updates` | name | assistant/answer.ts | right |
| The assistant | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| The assistant | `calls` | name | .github/workflows/ci.yml | right |
| The assistant | `items` | name | actions/ahead-actions.test.ts | right |
| The assistant | `general` | name | assistant/answer.ts | right |
| The assistant | `assistant.answer` | action or key | actions/admin-actions.ts | right |
| The assistant | `assistant/context.ts` | file | assistant/context.ts | right |
| The assistant | `week.load` | action or key | actions/registry.ts | right |
| The assistant | `ahead.load` | action or key | actions/registry.ts | right |
| The assistant | `status.load` | action or key | actions/registry.ts | right |
| The assistant | `inbox.list` | action or key | actions/registry.ts | right |
| The assistant | `meeting.mine` | action or key | actions/registry.ts | right |
| The assistant | `isMine` | name | actions/boundary-actions.ts | right |
| The assistant | `CONTEXT_LIMITS` | name | assistant/context.ts | right |
| The assistant | `assistant/answer.ts` | file | assistant/answer.ts | right |
| The assistant | `SUGGEST_TOOLS` | name | assistant/allowlist.ts | right |
| The assistant | `move_plan` | name | assistant/allowlist.ts | right |
| The assistant | `confirm_week` | name | assistant/service.test.ts | right |
| The assistant | `general` | name | assistant/answer.ts | right |
| The assistant | `assistant.question` | action or key | actions/admin-actions.ts | right |
| The assistant | `assistant_turns.pending_json` | column | assistant/service.ts | right |
| The assistant | `CONVERSATION_MINUTES` | name | assistant/service.ts | right |
| The assistant | `capabilities` | name | assistant/answer.ts | right |
| The assistant | `assistant/quick.ts` | file | assistant/quick.ts | right |
| One Assistant, two renderers | `assistant.handle` | action or key | server/teams/bot.ts | right |
| One Assistant, two renderers | `ui/Assistant.tsx` | file | ui/Assistant.tsx | right |
| One Assistant, two renderers | `server/teams/render.ts` | file | server/teams/render.ts | right |
| One Assistant, two renderers | `server/teams/cards.ts` | file | server/teams/cards.ts | right |
| One Assistant, two renderers | `assistant/parity.test.ts` | file | assistant/parity.test.ts | right |
| One Assistant, two renderers | `assistant/answers.test.ts` | file | assistant/answers.test.ts | right |
| The story card and Wrap it up (FN-1) | `ui/WorkLink.tsx` | file | ui/WorkLink.tsx | right |
| The story card and Wrap it up (FN-1) | `item.card` | action or key | actions/registry.ts | right |
| The story card and Wrap it up (FN-1) | `wrapup.preview` | action or key | actions/registry.ts | right |
| The story card and Wrap it up (FN-1) | `wrapup.confirm` | action or key | actions/registry.ts | right |
| The story card and Wrap it up (FN-1) | `comment` | name | actions/admin-actions.ts | right |
| The story card and Wrap it up (FN-1) | `state` | name | .github/workflows/ci.yml | right |
| The story card and Wrap it up (FN-1) | `fields` | name | actions/ahead-actions.ts | right |
| The story card and Wrap it up (FN-1) | `wrap_up` | name | assistant/allowlist.ts | right |
| The story card and Wrap it up (FN-1) | `wrapup.apply` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `plan/progress.ts` | file | plan/progress.ts | right |
| The rhythm's check-ins (TX-1) | `sessionRows` | name | actions/progress-actions.ts | right |
| The rhythm's check-ins (TX-1) | `outcomeOf` | name | actions/progress-actions.ts | right |
| The rhythm's check-ins (TX-1) | `planOutcome` | name | actions/progress-actions.ts | right |
| The rhythm's check-ins (TX-1) | `actions/progress-actions.ts` | file | actions/progress-actions.ts | right |
| The rhythm's check-ins (TX-1) | `checkin.sessions` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `checkin.answer` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `checkin.all_to_plan` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `checkin.undo` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `checkin.offer_close` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `settleAll` | name | actions/progress-actions.ts | right |
| The rhythm's check-ins (TX-1) | `ui/TimeboxCheckin.tsx` | file | ui/TimeboxCheckin.tsx | right |
| The rhythm's check-ins (TX-1) | `server/teams/rhythm.ts` | file | server/teams/rhythm.ts | right |
| The rhythm's check-ins (TX-1) | `sessionCards` | name | server/teams/rhythm.ts | right |
| The rhythm's check-ins (TX-1) | `sessionTap` | name | server/teams/rhythm.ts | right |
| The rhythm's check-ins (TX-1) | `devops.progress_offer` | action or key | actions/registry.ts | right |
| The rhythm's check-ins (TX-1) | `remaining_work` | name | actions/devops-write-actions.ts | right |
| The rhythm's check-ins (TX-1) | `comment` | name | actions/admin-actions.ts | right |

### data.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| One database, two kinds of table | `store/sql/migrate.ts` | file | store/sql/migrate.ts | right |
| One database, two kinds of table | `store/migrations/additive.test.ts` | file | store/migrations/additive.test.ts | right |
| One database, two kinds of table | `user_id` | name | server/people.test.ts | right |
| One database, two kinds of table | `store/scope.ts` | file | store/scope.ts | right |
| One database, two kinds of table | `user_id` | name | server/people.test.ts | right |
| One database, two kinds of table | `USER_TABLES` | name | store/claim.test.ts | right |
| One database, two kinds of table | `store/scope.ts` | file | store/scope.ts | right |
| One database, two kinds of table | `store/conversation-store.ts` | file | store/conversation-store.ts | right |
| One database, two kinds of table | `store/isolation.test.ts` | file | store/isolation.test.ts | right |
| People, sign-in and settings | `users` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `sessions` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `auth_requests` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `deletions` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `user_settings` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `setup_state` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `kv` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `account_state` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `push_devices` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `notices` | table | store/scope.ts or store/isolation.test.ts | right |
| People, sign-in and settings | `app_keys` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_plans` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_features` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_feature_slots` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_drafts` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_quiet` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_carry` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_watch` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `week_plans.committed_at` | column | store/migrations/20261106T1100_team_sends.ts | right |
| The plan | `tier` | name | actions/admin-actions.test.ts | right |
| The plan | `day_plans` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `picks` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `timeboxes` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `unavailable` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `borrowed` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `flex_sessions` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `resume_notes` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `focus_log` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `picks.todo_kind` | column | store/migrations/20261120T0900_pick_deployments.ts | right |
| The plan | `deployment` | name | .github/workflows/deploy-dev.yml | right |
| The plan | `window_start` | name | store/migrations/20261120T0900_pick_deployments.ts | right |
| The plan | `window_end` | name | store/migrations/20261120T0900_pick_deployments.ts | right |
| The plan | `links` | name | actions/admin-actions.ts | right |
| The plan | `notes` | name | actions/account-types.ts | right |
| The plan | `deploy_items` | name | actions/deploy-item-actions.ts | right |
| The plan | `follow_ups` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `promises` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `captures` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `draft_stories` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `story_drafts` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `story_draft_writes` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `breakdown_marks` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `house_styles` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `draft_stories.brief` | column | actions/devops-write.test.ts | right |
| The plan | `where` | name | .github/workflows/ci.yml | right |
| The plan | `change` | name | .github/workflows/ci-webkit-deps.yml | right |
| The plan | `check` | name | .github/workflows/ci-webkit-deps.yml | right |
| The plan | `follow_ups.changed_at` | column | store/devops-store.ts | right |
| The plan | `roadmap_dates` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `ahead_changes` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `ahead_halves` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `delivery_snapshots` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `inbox_marks` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `conversation_views` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `suggested_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The plan | `outcome` | name | actions/ask-ai.test.ts | right |
| The plan | `outcome_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The plan | `touched_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The plan | `cleared` | name | actions/account.ts | right |
| The plan | `cleared_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The plan | `put_back_at` | name | store/migrations/20261204T0900_slim_inbox.ts | right |
| The plan | `kv` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `inbox_last_looked` | name | actions/inbox-actions.test.ts | right |
| The plan | `inbox.looked` | action or key | actions/registry.ts | right |
| The plan | `kv` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `assistant_turns` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `assistant_proposals` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `teams_bot_chats` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `teams_bot_cards` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `teams_bot_seen` | table | store/scope.ts or store/isolation.test.ts | right |
| The plan | `teams_rhythm` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `outlook_events` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `markers` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `invites` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `markers` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `sg_clear` | name | actions/plan-actions.ts | right |
| Outside systems and their logs | `write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `azure_write_log` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `teams_status_log` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `calendar_links` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `calendar_link_events` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `sealed` | name | actions/account.ts | right |
| Outside systems and their logs | `write_kind` | name | server/demo-status-sr3.test.ts | right |
| Outside systems and their logs | `write_kind` | name | server/demo-status-sr3.test.ts | right |
| Outside systems and their logs | `before` | name | .github/workflows/ci.yml | right |
| Outside systems and their logs | `devops_identities` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_item_clients` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_items` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_changes` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_poll` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_takes` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_notes` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `devops_edit_notes` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_runs` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_snapshots` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_items` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_labels` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_type_lists` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_platforms` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_layout` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_projects` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_scopes` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_kinds` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_ignored` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `patterns_type_lists.made_by` | column | store/migrations/20261202T0900_patterns_owned_list.ts | right |
| Outside systems and their logs | `base` | name | .github/workflows/deploy-dev.yml | right |
| Outside systems and their logs | `relabel` | name | actions/chat-actions.test.ts | right |
| Outside systems and their logs | `ai_requests` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `app_ai_requests` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `ai_app_spend` | table | store/scope.ts or store/isolation.test.ts | right |
| Outside systems and their logs | `chat_ai_days` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `client_chats` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `client_chat_changes` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `delivery_chats` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `teams_messages` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `teams_message_images` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `chat_calls` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversations` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversation_messages` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `commitments` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversation_suggestions` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversation_merges` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversation_events` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `requests` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `conversations.item_needed_json` | column | store/conversation-store.ts | right |
| Client chats and meetings | `chat_messages` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `asks` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `dedupe_log` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `meeting_series` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `meeting_occurrences` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `meeting_transcripts` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `meeting_proposals` | table | store/scope.ts or store/isolation.test.ts | right |
| Client chats and meetings | `last_read` | name | store/meeting-store.ts | right |
| Admin and team | `org_settings` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `admin_audit` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `admin_seen` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `people_directory` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `directory_accounts` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `people_clients` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `client_leads` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `people_overrides` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `client_logins` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `people_invites` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `sends` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `week_commitments` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `client_priorities` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `look_asks` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `code_views` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `work_templates` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `work_template_uses` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `admin_audit` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `work_templates` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `scheduler_state` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `job_claims` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `schema_migrations` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `schema_version` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `schema_migration_names` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `kv` | table | store/scope.ts or store/isolation.test.ts | right |
| Admin and team | `getState` | name | actions/ahead-actions.test.ts | right |
| Admin and team | `setState` | name | actions/ahead-actions.test.ts | right |
| Admin and team | `ahead_filters` | name | actions/ahead-actions.ts | right |
| Admin and team | `flat` | name | actions/ahead-actions.ts | right |
| Admin and team | `ahead_skips` | name | plan/readiness.ts | right |
| Admin and team | `ahead_fixed` | name | plan/readiness.ts | right |
| Retention | `store/retention.ts` | file | store/retention.ts | right |
| Retention | `RETENTION_RULES` | name | server/retention-job.ts | right |
| Retention | `retention` | name | .github/workflows/ci.yml | right |
| Retention | `job_claims` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `assistant_turns` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `assistant_proposals` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `teams_bot_seen` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `teams_bot_cards` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `teams_rhythm` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `devops_takes` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `devops_notes` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `devops_edit_notes` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `devops_changes` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `delivery_snapshots` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `meeting_transcripts` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `meeting_proposals` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `job_claims` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `code_views` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `conv.retention_days` | action or key | config/org.ts | right |
| Retention | `config/org.ts` | file | config/org.ts | right |
| Retention | `chat_calls` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `actions/request-poll.ts` | file | actions/request-poll.ts | right |
| Retention | `chat_messages` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `asks` | table | store/scope.ts or store/isolation.test.ts | right |
| Retention | `server/ticks.ts` | file | server/ticks.ts | right |
| Retention | `store/accounts.ts` | file | store/accounts.ts | right |
| Retention | `store/user-data.ts` | file | store/user-data.ts | right |
| Retention | `HARD_DELETE_AFTER_DAYS` | name | server/main.ts | right |
| Retention | `host/azure/memory.ts` | file | host/azure/memory.ts | right |
| Retention | `infra/modules/monitoring.bicep` | file | infra/modules/monitoring.bicep | right |
| Retention | `sqlRetentionDays` | name | infra/main.bicep | right |
| Retention | `infra/main.bicep` | file | infra/main.bicep | right |
| Retention | `infra/prod.bicepparam` | file | infra/prod.bicepparam | right |
| What is never stored | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| What is never stored | `calendar_links` | table | store/scope.ts or store/isolation.test.ts | right |
| What is never stored | `localStorage` | name | e2e/adm2-shots.test.ts | right |
| What is never stored | `lastMessagePreview` | name | sources/graph/chats.test.ts | right |
| Who can see what | `store/scope.ts` | file | store/scope.ts | right |
| Who can see what | `store/meeting-store.ts` | file | store/meeting-store.ts | right |
| Deployment items (DP-2) | `config/deploy-catalog.ts` | file | config/deploy-catalog.ts | right |
| Deployment items (DP-2) | `deploy.items` | action or key | actions/registry.ts | right |
| Deployment items (DP-2) | `org_settings` | table | store/scope.ts or store/isolation.test.ts | right |
| Deployment items (DP-2) | `data_platform` | name | actions/deploy-item-actions.ts | right |
| Deployment items (DP-2) | `fabric` | name | actions/deploy-actions.test.ts | right |
| Deployment items (DP-2) | `azure` | name | .github/workflows/ci-webkit-deps.yml | right |
| Deployment items (DP-2) | `deploy_items` | name | actions/deploy-item-actions.ts | right |
| Deployment items (DP-2) | `name` | name | .github/workflows/ci-webkit-deps.yml | right |
| Deployment items (DP-2) | `deploy.config_save` | action or key | actions/registry.ts | right |
| Deployment items (DP-2) | `admin_audit` | table | store/scope.ts or store/isolation.test.ts | right |
| Deployment items (DP-2) | `picks.deploy_items` | column | actions/deploy-item-actions.ts | right |
| Time spent, time left and check-ins (TX-1) | `picks` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `spent_minutes` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `remaining_minutes` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `picks_client_item` | name | store/migrations/20261125T1000_pick_item_index.ts | right |
| Time spent, time left and check-ins (TX-1) | `picks` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `done_removed` | name | store/import.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `picks` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `week_features` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `draft_stories` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `size_xs` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `size` | name | actions/ahead-actions.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `timeboxes` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `settled_as` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| Time spent, time left and check-ins (TX-1) | `partly` | name | actions/devops-write-actions.ts | right |
| Time spent, time left and check-ins (TX-1) | `none` | name | .github/workflows/ci.yml | right |
| Time spent, time left and check-ins (TX-1) | `timeboxes` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `settled_at` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `settle_before` | name | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `timeboxes.settle_before` | column | store/migrations/20261125T0900_timebox_progress.ts | right |
| Time spent, time left and check-ins (TX-1) | `plan/types.ts` | file | plan/types.ts | right |
| Time spent, time left and check-ins (TX-1) | `pickNeed` | name | actions/carry-actions.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `remaining_work` | name | actions/devops-write-actions.ts | right |
| Time spent, time left and check-ins (TX-1) | `markers` | table | store/scope.ts or store/isolation.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `setup_through` | name | plan/setup.ts | right |
| Time spent, time left and check-ins (TX-1) | `SETUP_THROUGH_MARK` | name | actions/setup-actions.ts | right |
| Time spent, time left and check-ins (TX-1) | `plan/setup.ts` | file | plan/setup.ts | right |
| Time spent, time left and check-ins (TX-1) | `setup.mark` | action or key | actions/registry.ts | right |
| Time spent, time left and check-ins (TX-1) | `setup.load` | action or key | actions/registry.ts | right |
| Time spent, time left and check-ins (TX-1) | `through` | name | .github/workflows/deploy-dev.yml | right |
| Time spent, time left and check-ins (TX-1) | `todayLine` | name | actions/inbox-today.test.ts | right |
| Time spent, time left and check-ins (TX-1) | `left` | name | actions/account-types.ts | right |
| Time spent, time left and check-ins (TX-1) | `setup.reset` | action or key | actions/registry.ts | right |

### integrations.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| Integrations | `auth_required` | name | actions/calendar-actions.test.ts | right |
| Integrations | `unreachable` | name | .github/workflows/ci-webkit-deps.yml | right |
| Integrations | `misconfigured` | name | actions/calendar-actions.test.ts | right |
| Integrations | `error` | name | .github/workflows/ci-webkit-deps.yml | right |
| Integrations | `week/types.ts` | file | week/types.ts | right |
| Microsoft Entra ID and Microsoft Graph | `server/auth/entra.ts` | file | server/auth/entra.ts | right |
| Microsoft Entra ID and Microsoft Graph | `sources/oauth/oauth.ts` | file | sources/oauth/oauth.ts | right |
| Microsoft Entra ID and Microsoft Graph | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `plan/permissions.ts` | file | plan/permissions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `GRAPH_SCOPES` | name | infra/scripts/app-registration.sh | right |
| Microsoft Entra ID and Microsoft Graph | `infra/scripts/app-registration.sh` | file | infra/scripts/app-registration.sh | right |
| Microsoft Entra ID and Microsoft Graph | `sources/oauth/oauth.ts` | file | sources/oauth/oauth.ts | right |
| Microsoft Entra ID and Microsoft Graph | `scripts/tech-docs.test.ts` | file | scripts/tech-docs.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `openid` | name | infra/scripts/app-registration.sh | right |
| Microsoft Entra ID and Microsoft Graph | `profile` | name | actions/account.ts | right |
| Microsoft Entra ID and Microsoft Graph | `email` | name | actions/account.ts | right |
| Microsoft Entra ID and Microsoft Graph | `offline_access` | name | infra/scripts/app-registration.sh | right |
| Microsoft Entra ID and Microsoft Graph | `user_impersonation` | name | infra/scripts/app-registration.sh | right |
| Microsoft Entra ID and Microsoft Graph | `sources/oauth/oauth.ts` | file | sources/oauth/oauth.ts | right |
| Microsoft Entra ID and Microsoft Graph | `getSchedule` | name | actions/collab-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `getPresencesByUserId` | name | sources/graph/presence.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `sources/graph/` | file | sources/graph/chats.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `eventDetail` | name | plan/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `callStartedEventMessageDetail` | name | plan/cowork.ts | right |
| Microsoft Entra ID and Microsoft Graph | `callEndedEventMessageDetail` | name | plan/cowork.ts | right |
| Microsoft Entra ID and Microsoft Graph | `messageType` | name | actions/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `systemEventMessage` | name | actions/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `unknownFutureValue` | name | plan/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `eventDetail` | name | plan/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `callEventType` | name | plan/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `callDuration` | name | plan/cowork.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `chat_calls` | table | store/scope.ts or store/isolation.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `plan/cowork.ts` | file | plan/cowork.ts | right |
| Microsoft Entra ID and Microsoft Graph | `webUrl` | name | actions/admin-actions.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `type` | name | .github/workflows/ci.yml | right |
| Microsoft Entra ID and Microsoft Graph | `isOnlineMeeting` | name | actions/step13.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `graphFailureOf` | name | actions/meeting-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `meeting_graph_failed` | name | actions/meeting-actions.test.ts | right |
| Microsoft Entra ID and Microsoft Graph | `meeting_check` | name | server/meeting-job.ts | right |
| Microsoft Entra ID and Microsoft Graph | `setUserPreferredPresence` | name | actions/presence-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `clearUserPreferredPresence` | name | actions/presence-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `sources/graph/send.ts` | file | sources/graph/send.ts | right |
| Microsoft Entra ID and Microsoft Graph | `docs/setup/close-the-loop.md` | file | docs/setup/close-the-loop.md | right |
| Microsoft Entra ID and Microsoft Graph | `actions/invite-send.ts` | file | actions/invite-send.ts | right |
| Microsoft Entra ID and Microsoft Graph | `item_edit` | name | actions/devops-write-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `remove` | name | .github/workflows/deploy-dev.yml | right |
| Microsoft Entra ID and Microsoft Graph | `multilineFieldsFormat` | name | actions/devops-write-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `undo_item_edit` | name | actions/devops-write-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `reparent` | name | actions/devops-write-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `remove` | name | .github/workflows/deploy-dev.yml | right |
| Microsoft Entra ID and Microsoft Graph | `_apis/wit/workItems/<id>` | file | a pattern or URL template; its parts checked | right |
| Microsoft Entra ID and Microsoft Graph | `undo_reparent` | name | actions/devops-write-actions.ts | right |
| Microsoft Entra ID and Microsoft Graph | `BacklogPriority` | name | actions/types.ts | right |
| Azure DevOps | `sources/devops/pat.ts` | file | sources/devops/pat.ts | right |
| Azure DevOps | `coop_devopstoken` | name | actions/devops-actions.test.ts | right |
| Azure DevOps | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `devops_poll` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `sources/devops/` | file | sources/devops/card.test.ts | right |
| Azure DevOps | `devops_items` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `devops_changes` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `actions/devops-write-actions.ts` | file | actions/devops-write-actions.ts | right |
| Azure DevOps | `test` | name | .github/workflows/ci-webkit-deps.yml | right |
| Azure DevOps | `state` | name | .github/workflows/ci.yml | right |
| Azure DevOps | `comment` | name | actions/admin-actions.ts | right |
| Azure DevOps | `create` | name | .github/workflows/deploy-dev.yml | right |
| Azure DevOps | `new_item` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `_apis/wit/workitemtypes/<type>/fields` | file | a pattern or URL template; its parts checked | right |
| Azure DevOps | `alwaysRequired` | name | plan/quick-create.ts | right |
| Azure DevOps | `target_date` | name | actions/devops-poll.test.ts | right |
| Azure DevOps | `description_update` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `description_edit` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `assign_to_me` | name | actions/carry-actions.ts | right |
| Azure DevOps | `fields` | name | actions/ahead-actions.ts | right |
| Azure DevOps | `comment_edit` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `item_edit` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `reparent` | name | actions/devops-write-actions.ts | right |
| Azure DevOps | `canEdit` | name | actions/ahead-actions.ts | right |
| Azure DevOps | `ui/patterns/` | file | ui/patterns/Classification.tsx | right |
| Azure DevOps | `actions/patterns*.ts` | file | a pattern or URL template; its parts checked | right |
| Azure DevOps | `plan/patterns/` | file | plan/patterns/analysis.ts | right |
| Azure DevOps | `patterns_runs` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_snapshots` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_items` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_labels` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_type_lists` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_platforms` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_layout` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_projects` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_scopes` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_kinds` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `patterns_ignored` | table | store/scope.ts or store/isolation.test.ts | right |
| Azure DevOps | `plan/patterns/` | file | plan/patterns/analysis.ts | right |
| Azure DevOps | `store/patterns-store.ts` | file | store/patterns-store.ts | right |
| Azure DevOps | `accountTargets` | name | actions/code-git.ts | right |
| Azure DevOps | `sources/devops/git.ts` | file | sources/devops/git.ts | right |
| Azure DevOps | `ALLOWED` | name | actions/vm-actions.ts | right |
| Azure DevOps | `repositories` | name | actions/code-git.test.ts | right |
| Azure DevOps | `resolveLfs` | name | sources/devops/git.test.ts | right |
| Azure DevOps | `cleanPath` | name | actions/code-actions.ts | right |
| Azure DevOps | `actions/code-git.ts` | file | actions/code-git.ts | right |
| Dataverse | `sources/dataverse/source.ts` | file | sources/dataverse/source.ts | right |
| Dataverse | `coop_workingdayscalendars` | name | actions/plan-actions.test.ts | right |
| Dataverse | `sources/dataverse/` | file | sources/dataverse/devops-targets.test.ts | right |
| Google Calendar | `sources/oauth/oauth.ts` | file | sources/oauth/oauth.ts | right |
| Google Calendar | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| Calendar links (ICS) | `calendar_links` | table | store/scope.ts or store/isolation.test.ts | right |
| Calendar links (ICS) | `server/ics-fetch.ts` | file | server/ics-fetch.ts | right |
| Calendar links (ICS) | `ical.js` | action or key | package-lock.json | right |
| Calendar links (ICS) | `sources/ics/parse.ts` | file | sources/ics/parse.ts | right |
| Calendar links (ICS) | `sources/ics/source.ts` | file | sources/ics/source.ts | right |
| Azure Resource Manager (My VM) | `user_impersonation` | name | infra/scripts/app-registration.sh | right |
| Azure Resource Manager (My VM) | `ALLOWED` | name | actions/vm-actions.ts | right |
| Azure Resource Manager (My VM) | `sources/azure/client.ts` | file | sources/azure/client.ts | right |
| Azure Resource Manager (My VM) | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| The AI provider | `server/appconfig.ts` | file | server/appconfig.ts | right |
| The AI provider | `conversations.update` | column | .github/workflows/ci.yml | right |
| The AI provider | `promises.extract` | column | actions/admin-actions.test.ts | right |
| The AI provider | `asks.classify` | column | actions/admin-actions.test.ts | right |
| The AI provider | `meeting.capture` | action or key | actions/admin-actions.test.ts | right |
| The AI provider | `ai/tiers.ts` | file | ai/tiers.ts | right |
| The AI provider | `ai/types.ts` | file | ai/types.ts | right |
| GitHub (Cooptimize's standards) | `sources/github/standards.ts` | file | sources/github/standards.ts | right |
| GitHub (Cooptimize's standards) | `standards_articles` | table | store/scope.ts or store/isolation.test.ts | right |
| GitHub (Cooptimize's standards) | `standards_sync` | table | store/scope.ts or store/isolation.test.ts | right |
| The Teams bot | `server/teams/sdk.ts` | file | server/teams/sdk.ts | right |
| The Teams bot | `server/teams/gate.ts` | file | server/teams/gate.ts | right |
| Web Push | `server/webpush.ts` | file | server/webpush.ts | right |

### security.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| In short | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| In short | `prod` | name | .github/workflows/ci.yml | right |
| Sign-in and sessions | `server/auth/entra.ts` | file | server/auth/entra.ts | right |
| Sign-in and sessions | `store/accounts.ts` | file | store/accounts.ts | right |
| Sign-in and sessions | `server/guard.ts` | file | server/guard.ts | right |
| Sign-in and sessions | `server/app.ts` | file | server/app.ts | right |
| Sign-in and sessions | `server/app.ts` | file | server/app.ts | right |
| Secrets | `infra/scripts/app-registration.sh` | file | infra/scripts/app-registration.sh | right |
| Secrets | `infra/scripts/google-client.sh` | file | infra/scripts/google-client.sh | right |
| Secrets | `copy-secrets.sh` | file | infra/scripts/copy-secrets.sh | right |
| Secrets | `infra/scripts/copy-secrets.sh` | file | infra/scripts/copy-secrets.sh | right |
| Secrets | `infra/scripts/openai-key.sh` | file | infra/scripts/openai-key.sh | right |
| Secrets | `infra/scripts/vapid-key.sh` | file | infra/scripts/vapid-key.sh | right |
| Secrets | `infra/modules/keyvault.bicep` | file | infra/modules/keyvault.bicep | right |
| Secrets | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| Secrets | `store/user-secrets.ts` | file | store/user-secrets.ts | right |
| Secrets | `calendar_links` | table | store/scope.ts or store/isolation.test.ts | right |
| Secrets | `store/scope.ts` | file | store/scope.ts | right |
| Secrets | `log/logger.ts` | file | log/logger.ts | right |
| The client boundary rule (GD-2) | `plan/boundary.ts` | file | plan/boundary.ts | right |
| The client boundary rule (GD-2) | `chatAudience` | name | actions/conversation-actions.ts | right |
| The client boundary rule (GD-2) | `ai/service.ts` | file | ai/service.ts | right |
| The client boundary rule (GD-2) | `scrub` | name | actions/conversation-actions.ts | right |
| The client boundary rule (GD-2) | `plan/boundary.ts` | file | plan/boundary.ts | right |
| The client boundary rule (GD-2) | `exitCheck` | name | actions/boundary-actions.ts | right |
| The client boundary rule (GD-2) | `mentionsOk` | name | actions/devops-write-actions.ts | right |
| The one exception: client code (RB-1) | `notCooptimizer` | name | actions/admin-actions.ts | right |
| The one exception: client code (RB-1) | `plan/person-match.ts` | file | plan/person-match.ts | right |
| The one exception: client code (RB-1) | `actions/code-actions.ts` | file | actions/code-actions.ts | right |
| The one exception: client code (RB-1) | `admin_audit` | table | store/scope.ts or store/isolation.test.ts | right |
| The one exception: client code (RB-1) | `ui/code/` | file | ui/code/Code.tsx | right |
| The one exception: client code (RB-1) | `code_views` | table | store/scope.ts or store/isolation.test.ts | right |
| The one exception: client code (RB-1) | `plan/common-words.ts` | file | plan/common-words.ts | right |
| The one exception: client code (RB-1) | `held_not_work` | name | actions/conversation-actions.ts | right |
| Admins, guests and automation accounts | `FOCUSTIME_ADMINS` | name | actions/admin.ts | right |
| Admins, guests and automation accounts | `actions/admin.ts` | file | actions/admin.ts | right |
| Admins, guests and automation accounts | `admin_audit` | table | store/scope.ts or store/isolation.test.ts | right |
| Admins, guests and automation accounts | `server/people.ts` | file | server/people.ts | right |
| Admins, guests and automation accounts | `canEdit` | name | actions/ahead-actions.ts | right |
| Admins, guests and automation accounts | `actions/ahead-actions.ts` | file | actions/ahead-actions.ts | right |
| Who sees a client's draft status report (SR-2) | `reportTeam` | name | actions/code-actions.ts | right |
| Who sees a client's draft status report (SR-2) | `actions/team-actions.ts` | file | actions/team-actions.ts | right |
| Who sees a client's draft status report (SR-2) | `status.report` | action or key | actions/registry.ts | right |
| AI: the guard and redaction | `ai/guard.ts` | file | ai/guard.ts | right |
| AI: the guard and redaction | `redact` | name | actions/conversation-images.test.ts | right |
| Cooptimize's standards (KB-1) | `plan/standards.ts` | file | plan/standards.ts | right |
| Calendar links: the SSRF guard (CAL-1) | `sources/ics/link.ts` | file | sources/ics/link.ts | right |
| Calendar links: the SSRF guard (CAL-1) | `sources/ics/fetch.ts` | file | sources/ics/fetch.ts | right |
| Calendar links: the SSRF guard (CAL-1) | `server/ics-fetch.ts` | file | server/ics-fetch.ts | right |
| The meeting rules | `sources/graph/meetings.ts` | file | sources/graph/meetings.ts | right |
| Test sites (ENV-1) | `config/background-policy.ts` | file | config/background-policy.ts | right |
| Test sites (ENV-1) | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| The VM and its auto-shutdown | `ALLOWED` | name | actions/vm-actions.ts | right |
| The VM and its auto-shutdown | `sources/azure/client.ts` | file | sources/azure/client.ts | right |
| The VM and its auto-shutdown | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| The VM and its auto-shutdown | `prod` | name | .github/workflows/ci.yml | right |
| Threat model | `server/guard.ts` | file | server/guard.ts | right |
| Threat model | `server/app.ts` | file | server/app.ts | right |
| Threat model | `store/scope.ts` | file | store/scope.ts | right |
| Threat model | `store/isolation.test.ts` | file | store/isolation.test.ts | right |
| Threat model | `user_id` | name | server/people.test.ts | right |
| Threat model | `user_secrets` | table | store/scope.ts or store/isolation.test.ts | right |
| Threat model | `log/logger.ts` | file | log/logger.ts | right |
| Threat model | `ai/guard.ts` | file | ai/guard.ts | right |
| Threat model | `calendar_links` | table | store/scope.ts or store/isolation.test.ts | right |
| Threat model | `store/migrations/additive.test.ts` | file | store/migrations/additive.test.ts | right |

### operations.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| Environments | `FocusTime` | name | .github/workflows/ci-webkit-deps.yml | right |
| Environments | `main` | name | .github/workflows/ci.yml | right |
| Environments | `infra/dev.bicepparam` | file | infra/dev.bicepparam | right |
| Environments | `infra/prod.bicepparam` | file | infra/prod.bicepparam | right |
| Environments | `infra/modules/app.bicep` | file | infra/modules/app.bicep | right |
| Environments | `job_claims` | table | store/scope.ts or store/isolation.test.ts | right |
| Environments | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| Environments | `prod` | name | .github/workflows/ci.yml | right |
| Environments | `infra/prod.bicepparam` | file | infra/prod.bicepparam | right |
| Environments | `local` | name | .github/workflows/ci.yml | right |
| Environments | `e2e/vm2.test.ts` | file | e2e/vm2.test.ts | right |
| What runs on its own (ENV-1) | `config/background-policy.ts` | file | config/background-policy.ts | right |
| What runs on its own (ENV-1) | `server/main.ts` | file | server/main.ts | right |
| What runs on its own (ENV-1) | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| What runs on its own (ENV-1) | `prod` | name | .github/workflows/ci.yml | right |
| What runs on its own (ENV-1) | `Prod` | name | .github/workflows/deploy-prod.yml | right |
| What runs on its own (ENV-1) | `production` | name | actions/account-types.ts | right |
| What runs on its own (ENV-1) | `prod` | name | .github/workflows/ci.yml | right |
| What runs on its own (ENV-1) | `config/background-policy.test.ts` | file | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `requests_poll` | name | actions/admin-actions.ts | right |
| What runs on its own (ENV-1) | `conversations_upkeep` | name | actions/request-poll.ts | right |
| What runs on its own (ENV-1) | `meeting_capture` | name | actions/meeting-actions.ts | right |
| What runs on its own (ENV-1) | `held_recheck` | name | actions/held-recheck.ts | right |
| What runs on its own (ENV-1) | `notices` | table | store/scope.ts or store/isolation.test.ts | right |
| What runs on its own (ENV-1) | `web_push` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `teams_rhythm` | table | store/scope.ts or store/isolation.test.ts | right |
| What runs on its own (ENV-1) | `teams_status` | name | actions/dispatch.ts | right |
| What runs on its own (ENV-1) | `vm_autostart` | name | actions/vm-actions.ts | right |
| What runs on its own (ENV-1) | `coop_mailbox` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `devops_poll` | table | store/scope.ts or store/isolation.test.ts | right |
| What runs on its own (ENV-1) | `people_refresh` | name | actions/admin-actions.ts | right |
| What runs on its own (ENV-1) | `standards_sync` | table | store/scope.ts or store/isolation.test.ts | right |
| What runs on its own (ENV-1) | `calendar_refresh` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `focus_timer` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `retention_purge` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `conversation_ownership_backfill` | name | actions/ownership-backfill.ts | right |
| What runs on its own (ENV-1) | `maintenance` | name | actions/admin-actions.ts | right |
| What runs on its own (ENV-1) | `notice_sweep` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `chat_text_cleanup` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `startup_upkeep` | name | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `config/background-policy.test.ts` | file | config/background-policy.test.ts | right |
| What runs on its own (ENV-1) | `BACKGROUND` | name | actions/patterns.test.ts | right |
| What runs on its own (ENV-1) | `config/background-policy.ts` | file | config/background-policy.ts | right |
| What runs on its own (ENV-1) | `FOCUSTIME_ENV` | name | actions/dispatch.ts | right |
| Deploys | `.github/workflows/deploy-dev.yml` | file | .github/workflows/deploy-dev.yml | right |
| Deploys | `main` | name | .github/workflows/ci.yml | right |
| Deploys | `.github/workflows/deploy-prod.yml` | file | .github/workflows/deploy-prod.yml | right |
| Deploys | `PROD_DEPLOYERS` | name | .github/workflows/deploy-prod.yml | right |
| Deploys | `infra/scripts/parity.sh` | file | infra/scripts/parity.sh | right |
| Deploys | `dry_run` | name | .github/workflows/deploy-prod.yml | right |
| Deploys | `deploy-prod.yml` | file | .github/workflows/deploy-prod.yml | right |
| Deploys | `store/migrations/additive.test.ts` | file | store/migrations/additive.test.ts | right |
| Rollback | `a347188` | name | .github/workflows/deploy-prod.yml | right |
| Scripts | `infra/scripts/` | file | infra/scripts/admin-group.sh | right |
| Scripts | `bootstrap.sh` | file | infra/scripts/bootstrap.sh | right |
| Scripts | `app-registration.sh` | file | infra/scripts/app-registration.sh | right |
| Scripts | `admin-group.sh` | file | infra/scripts/admin-group.sh | right |
| Scripts | `copy-secrets.sh` | file | infra/scripts/copy-secrets.sh | right |
| Scripts | `google-client.sh` | file | infra/scripts/google-client.sh | right |
| Scripts | `openai-key.sh` | file | infra/scripts/openai-key.sh | right |
| Scripts | `vapid-key.sh` | file | infra/scripts/vapid-key.sh | right |
| Scripts | `parity.sh` | file | infra/scripts/parity.sh | right |
| Scripts | `smoke.sh` | file | infra/scripts/smoke.sh | right |
| Never do a full run of app-registration.sh | `infra/scripts/app-registration.sh` | file | infra/scripts/app-registration.sh | right |
| Never do a full run of app-registration.sh | `GRAPH_SCOPES` | name | infra/scripts/app-registration.sh | right |
| Never do a full run of app-registration.sh | `admin-group.sh` | file | infra/scripts/admin-group.sh | right |
| The Teams package | `scripts/teams-package.ts` | file | scripts/teams-package.ts | right |
| Diagnostics, logs and what is never logged | `log/logger.ts` | file | log/logger.ts | right |
| Troubleshooting | `infra/scripts/openai-key.sh` | file | infra/scripts/openai-key.sh | right |
| Troubleshooting | `infra/scripts/vapid-key.sh` | file | infra/scripts/vapid-key.sh | right |

### development.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| Local setup | `package.json` | file | package.json | right |
| Local setup | `engines` | name | package-lock.json | right |
| Local setup | `scripts/db.ts` | file | scripts/db.ts | right |
| One step, one worktree, one PR | `main` | name | .github/workflows/ci.yml | right |
| One step, one worktree, one PR | `main` | name | .github/workflows/ci.yml | right |
| One step, one worktree, one PR | `contoso` | name | actions/admin-actions.test.ts | right |
| One step, one worktree, one PR | `fabrikam` | name | actions/admin-actions.test.ts | right |
| Tests and CI | `e2e/harness.ts` | file | e2e/harness.ts | right |
| Tests and CI | `test/workers.ts` | file | test/workers.ts | right |
| Tests and CI | `ERR_CONNECTION_REFUSED` | name | e2e/harness.test.ts | right |
| Tests and CI | `test/builders` | file | test/builders/assistant-world.ts | right |
| Tests and CI | `test/ports.ts` | file | test/ports.ts | right |
| Tests and CI | `.github/workflows/ci.yml` | file | .github/workflows/ci.yml | right |
| Tests and CI | `main` | name | .github/workflows/ci.yml | right |
| Adding an external write safely | `actions/registry.ts` | file | actions/registry.ts | right |
| Adding an external write safely | `actions/timebox-actions.ts` | file | actions/timebox-actions.ts | right |
| Adding an external write safely | `actions/devops-write-actions.ts` | file | actions/devops-write-actions.ts | right |
| Adding an external write safely | `server/demo.ts` | file | server/demo.ts | right |
| Adding an external write safely | `assistant/allowlist.ts` | file | assistant/allowlist.ts | right |
| Adding a Graph permission safely | `sources/oauth/oauth.ts` | file | sources/oauth/oauth.ts | right |
| Adding a Graph permission safely | `plan/permissions.ts` | file | plan/permissions.ts | right |
| Adding a Graph permission safely | `later` | name | actions/admin-actions.ts | right |
| Adding a Graph permission safely | `GRAPH_SCOPES` | name | infra/scripts/app-registration.sh | right |
| Adding a Graph permission safely | `infra/scripts/app-registration.sh` | file | infra/scripts/app-registration.sh | right |

### coop-contract.md (names)

| Heading | Name | Kind | Found in | Verdict |
|---|---|---|---|---|
| The FocusTime and Coop comment contract, v1 | `fixtures/*.json` | file | a pattern or URL template; its parts checked | right |
| The FocusTime and Coop comment contract, v1 | `fixtures/comments/` | file | docs/technical/coop-contract/fixtures/comments | right |
| The FocusTime and Coop comment contract, v1 | `fixtures/invalid/` | file | docs/technical/coop-contract/fixtures/invalid | right |
| The FocusTime and Coop comment contract, v1 | `fixtures/story-description.html` | file | docs/technical/coop-contract/fixtures/story-description.html | right |
| The FocusTime and Coop comment contract, v1 | `scripts/coop-contract.test.ts` | file | scripts/coop-contract.test.ts | right |
| How the exchange runs | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| How the exchange runs | `sent` | name | actions/account-types.ts | right |
| How the exchange runs | `received` | name | scripts/coop-contract.test.ts | right |
| How the exchange runs | `working` | name | actions/account-types.ts | right |
| How the exchange runs | `blocked` | name | .github/workflows/ci-webkit-deps.yml | right |
| How the exchange runs | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| How the exchange runs | `declined` | name | actions/collab-actions.ts | right |
| How the exchange runs | `failed` | name | .github/workflows/ci.yml | right |
| How the exchange runs | `cancelled` | name | .github/workflows/ci.yml | right |
| The comment format | `kind` | name | actions/account-types.ts | right |
| The comment format | `coop_brief` | name | scripts/coop-contract.test.ts | right |
| The comment format | `coop_update` | name | scripts/coop-contract.test.ts | right |
| The comment format | `coop_answer` | name | scripts/coop-contract.test.ts | right |
| The comment format | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| The comment format | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| The comment format | `text` | name | actions/account-types.ts | right |
| The comment format | `format` | name | actions/conversation-create.test.ts | right |
| The comment format | `html` | name | actions/admin-actions.test.ts | right |
| The comment format | `kind` | name | actions/account-types.ts | right |
| Brief | `kind` | name | actions/account-types.ts | right |
| Brief | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Brief | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Brief | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Brief | `feature_id` | name | actions/story-actions.test.ts | right |
| Brief | `requester.display_name` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `requester.devops_user_id` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `outcome` | name | actions/ask-ai.test.ts | right |
| Brief | `scope.in` | action or key | plan/find-item.ts | right |
| Brief | `scope.out` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `acceptance_expectations` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `known_decisions` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `unknowns` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `permitted_actions` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `investigate` | name | plan/patterns/inventory.ts | right |
| Brief | `propose_stories` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `ask_questions` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `granularity.max_stories` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `granularity.target_size` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `granularity.include` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Brief | `acceptance` | name | actions/capture-actions.test.ts | right |
| Brief | `dependencies` | name | actions/devops-write-actions.ts | right |
| Brief | `estimates` | name | actions/team-actions.test.ts | right |
| Brief | `test_notes` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `rollout` | name | actions/patterns-scope.test.ts | right |
| Brief | `submitted_at` | name | docs/technical/coop-contract/brief.schema.json | right |
| Brief | `permitted_actions` | name | docs/technical/coop-contract/brief.schema.json | right |
| Update | `kind` | name | actions/account-types.ts | right |
| Update | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Update | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Update | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Update | `status` | name | actions/account-types.ts | right |
| Update | `summary` | name | .github/workflows/deploy-prod.yml | right |
| Update | `proposal_ids` | name | scripts/coop-contract.test.ts | right |
| Update | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| Update | `question_ids` | name | scripts/coop-contract.test.ts | right |
| Update | `blocked` | name | .github/workflows/ci-webkit-deps.yml | right |
| Update | `occurred_at` | name | docs/technical/coop-contract/fixtures/invalid/update-blocked-without-questions.json | right |
| Update | `posted_at` | name | docs/technical/coop-contract/fixtures/invalid/update-blocked-without-questions.json | right |
| Update | `questions` | name | actions/conversation-create.test.ts | right |
| Update | `blocked` | name | .github/workflows/ci-webkit-deps.yml | right |
| Update | `text` | name | actions/account-types.ts | right |
| Update | `blocking` | name | ui/brand/Opening.tsx | right |
| Update | `suggested_answers` | name | docs/technical/coop-contract/fixtures/update-blocked.json | right |
| Update | `proposals` | name | actions/devops-write-actions.ts | right |
| Update | `done` | name | .github/workflows/ci-webkit-deps.yml | right |
| Update | `question_ids` | name | scripts/coop-contract.test.ts | right |
| Update | `questions` | name | actions/conversation-create.test.ts | right |
| Update | `proposal_ids` | name | scripts/coop-contract.test.ts | right |
| Update | `proposals` | name | actions/devops-write-actions.ts | right |
| Update | `proposals.feature_id` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Update | `feature_id` | name | actions/story-actions.test.ts | right |
| Answer | `kind` | name | actions/account-types.ts | right |
| Answer | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Answer | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Answer | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Answer | `question_id` | name | scripts/coop-contract.test.ts | right |
| Answer | `answer` | name | .github/workflows/ci-webkit-deps.yml | right |
| Proposal | `COOP_PROPOSALS_V1` | name | actions/story-actions.ts | right |
| Proposal | `plan/stories.ts` | file | plan/stories.ts | right |
| Proposal | `proposals` | name | actions/devops-write-actions.ts | right |
| Proposal | `kind` | name | actions/account-types.ts | right |
| Proposal | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Proposal | `feature_id` | name | actions/story-actions.test.ts | right |
| Proposal | `proposals` | name | actions/devops-write-actions.ts | right |
| Proposal | `rationale` | name | actions/story-actions.test.ts | right |
| Proposal | `set_aside` | name | actions/story-actions.test.ts | right |
| Proposal | `title` | name | .github/workflows/deploy-dev.yml | right |
| Proposal | `out_of_scope` | name | e2e/break-down.test.ts | right |
| Proposal | `already_covered` | name | actions/story-actions.test.ts | right |
| Proposal | `existing_item_id` | name | actions/story-actions.test.ts | right |
| Proposal | `already_covered` | name | actions/story-actions.test.ts | right |
| Proposal | `reason` | name | actions/ahead-actions.test.ts | right |
| Ids | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Ids | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Ids | `question_id` | name | scripts/coop-contract.test.ts | right |
| Versions | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Versions | `version` | name | .github/workflows/ci-webkit-deps.yml | right |
| Versions | `status` | name | actions/account-types.ts | right |
| Versions | `permitted_actions` | name | docs/technical/coop-contract/brief.schema.json | right |
| Versions | `granularity.include` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Versions | `size` | name | actions/ahead-actions.test.ts | right |
| Who can be believed | `requester.devops_user_id` | action or key | docs/technical/coop-contract/*.schema.json (a nested field) | right |
| Content rules | `replaceMentions` | name | actions/conversations-pipeline.ts | right |
| Content rules | `plan/boundary.ts` | file | plan/boundary.ts | right |
| Content rules | `records` | name | .github/workflows/ci.yml | right |
| Content rules | `exitCheck` | name | actions/boundary-actions.ts | right |
| Content rules | `SECRET_SHAPES` | name | ai/guard.ts | right |
| Content rules | `ai/guard.ts` | file | ai/guard.ts | right |
| Size limits | `failed` | name | .github/workflows/ci.yml | right |
| Edited and deleted comments | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Edited and deleted comments | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Edited and deleted comments | `blocked` | name | .github/workflows/ci-webkit-deps.yml | right |
| Edited and deleted comments | `declined` | name | actions/collab-actions.ts | right |
| Edited and deleted comments | `brief_id` | name | scripts/coop-contract.test.ts | right |
| Edited and deleted comments | `revision` | name | .github/workflows/deploy-dev.yml | right |
| Edited and deleted comments | `cancelled` | name | .github/workflows/ci.yml | right |
| Edited and deleted comments | `createdDate` | name | actions/cowork.test.ts | right |
| What this doesn't cover | `brief` | name | actions/devops-write.test.ts | right |
| What this doesn't cover | `update` | name | .github/workflows/ci.yml | right |
| What this doesn't cover | `COOP_BLOCK` | name | plan/status-report.ts | right |
| What this doesn't cover | `plan/stories.ts` | file | plan/stories.ts | right |
| What this doesn't cover | `plan/status-report.ts` | file | plan/status-report.ts | right |
| What this doesn't cover | `answer` | name | .github/workflows/ci-webkit-deps.yml | right |
| What this doesn't cover | `htmlToText` | name | actions/devops-write-actions.ts | right |
