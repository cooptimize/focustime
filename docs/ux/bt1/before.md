# BT-1: CI before

From the ci runs below (`gh run view <id> --log` and the jobs API), measured on Nov 16, 2026. Medians over the runs unless said. A run's wall time is its first job's start to its last job's end (queueing before the first job is left out); runner time is every job's time added up.

## The runs

| Run | Event | Whole run, s | Runner time, s | Unit job, s | Slowest shard, s | Middle shard (median of six), s | Slowest over middle |
|---|---|---|---|---|---|---|---|
| 43775999578 | pull_request chore/td2-build-docs | 532 | 2790 | 438 | 499 | 350 | 1.42 |
| 43777256271 | push main | 527 | 2929 | 485 | 491 | 363 | 1.35 |
| 43789301008 | pull_request chore/ci3-lighter | 706 | 2347 | 298 | 407 | 289 | 1.41 |
| 43791217677 | push main | 484 | 2543 | 473 | 416 | 306 | 1.36 |
| 43804143046 | pull_request chore/rm1-remove | 1927 | 2384 | 354 | 528 | 284 | 1.86 |
| 43807916532 | push main | 458 | 2437 | 443 | 391 | 311 | 1.26 |
| 43810386204 | pull_request fix/pv1-zip | 1256 | 2297 | 277 | 417 | 314 | 1.33 |
| 43835658663 | push main | 436 | 2483 | 340 | 417 | 319 | 1.31 |
| 43851245265 | pull_request feat/pf1-split | 422 | 2508 | 356 | 405 | 340 | 1.19 |
| 43852601451 | pull_request feat/pf1-split | 410 | 2328 | 283 | 398 | 314 | 1.27 |
| **Median** | | **506** | **2460** | **355** | **416** | **314** | |

## Each job

| Job | Median, s | Fastest | Slowest | Runs |
|---|---|---|---|---|
| Unit and store tests (SQLite and SQL Server) | 355 | 277 | 485 | 10 |
| Browser tests n/6 (Chromium and WebKit) | 322 | 186 | 528 | 60 |
| Browser tests WebKit (Safari) | 74 | 68 | 91 | 8 |
| image | 60 | 47 | 72 | 10 |
| infra | 24 | 16 | 42 | 10 |
| test | 9 | 5 | 32 | 10 |
| What changed | 5 | 3 | 10 | 8 |

## Main steps (3 s or more)

| Job | Step | Median, s | Slowest, s |
|---|---|---|---|
| Browser tests WebKit (Safari) | Browser tests | 28 | 30 |
| Browser tests WebKit (Safari) | Install WebKit's system packages | 26 | 42 |
| Browser tests WebKit (Safari) | Run actions/setup-node@v4 | 5 | 7 |
| Browser tests WebKit (Safari) | Run npm ci --no-audit --no-fund | 3 | 6 |
| Browser tests n/6 (Chromium and WebKit) | Browser tests | 294 | 507 |
| Browser tests n/6 (Chromium and WebKit) | Install WebKit's system packages | 24 | 31 |
| Browser tests n/6 (Chromium and WebKit) | Run actions/setup-node@v4 | 6 | 7 |
| Browser tests n/6 (Chromium and WebKit) | Run npm ci --no-audit --no-fund | 4 | 6 |
| Browser tests n/6 (Chromium and WebKit) | Run actions/checkout@v4 | 3 | 20 |
| Unit and store tests (SQLite and SQL Server) | Unit and store tests | 312 | 433 |
| Unit and store tests (SQLite and SQL Server) | Start SQL Server | 17 | 21 |
| Unit and store tests (SQLite and SQL Server) | Run npm run typecheck | 7 | 8 |
| Unit and store tests (SQLite and SQL Server) | Run actions/setup-node@v4 | 6 | 7 |
| Unit and store tests (SQLite and SQL Server) | Run npm ci --no-audit --no-fund | 4 | 6 |
| image | Build the image and smoke test it | 45 | 67 |
| image | Run actions/checkout@v4 | 3 | 20 |
| infra | Bicep build | 14 | 20 |
| infra | Run actions/checkout@v4 | 4 | 26 |
| test | Run actions/checkout@v4 | 3 | 25 |

## The unit job: each test file

469 files; their times add up to 571 s (vitest's per-file time, the sum of its tests and hooks). The 40 slowest:

| File | Median, s |
|---|---|
| `store/isolation.test.ts` | 55.5 |
| `assistant/parity.test.ts` | 30.1 |
| `actions/devops-write.test.ts` | 28.5 |
| `actions/patterns-run.test.ts` | 24.7 |
| `store/plan-store.test.ts` | 24.3 |
| `server/teams/rhythm.test.ts` | 24.1 |
| `store/import.test.ts` | 17.8 |
| `actions/patterns-scope.test.ts` | 14.2 |
| `actions/plan-actions.test.ts` | 12.2 |
| `store/teams-store.test.ts` | 12.1 |
| `actions/team-actions.test.ts` | 10.7 |
| `server/teams/bot.test.ts` | 10.4 |
| `assistant/service.test.ts` | 9.2 |
| `store/sql/migrate.test.ts` | 7.6 |
| `store/standards-sync.test.ts` | 7.4 |
| `sources/ics/source.test.ts` | 7.1 |
| `actions/slow-source.test.ts` | 7.0 |
| `store/user-data.test.ts` | 6.8 |
| `actions/item-edit.test.ts` | 6.7 |
| `store/user-settings.test.ts` | 6.1 |
| `server/ticks.test.ts` | 5.7 |
| `store/accounts.test.ts` | 5.5 |
| `actions/progress-actions.test.ts` | 5.2 |
| `store/work-templates-store.test.ts` | 5.0 |
| `actions/patterns-wp3.test.ts` | 4.9 |
| `store/meeting-store.test.ts` | 4.7 |
| `actions/vm-actions.test.ts` | 4.7 |
| `store/ai.test.ts` | 4.6 |
| `actions/ahead-actions.test.ts` | 4.3 |
| `actions/weekplan-actions.test.ts` | 4.3 |
| `actions/status-report.test.ts` | 4.2 |
| `store/retention.test.ts` | 4.1 |
| `store/migrations/named.test.ts` | 3.9 |
| `store/admin-store.test.ts` | 3.9 |
| `store/conversation-store.test.ts` | 3.9 |
| `actions/timebox-actions.test.ts` | 3.8 |
| `store/code-views-store.test.ts` | 3.8 |
| `store/user-secrets.test.ts` | 3.8 |
| `actions/followup-who.test.ts` | 3.6 |
| `server/demo.test.ts` | 3.4 |

## The browser shards: each file

130 files; their times add up to 3496 s. Each file's time and how much of it the tests vitest printed (those over 300 ms) account for; the rest is its start (the demo server and Chromium in beforeAll), its quick tests and its teardown.

| File | Median, s | Printed tests, s | The rest, s |
|---|---|---|---|
| `e2e/ps1.test.ts` | 224.3 | 216.1 | 8.2 |
| `e2e/guide-tour.test.ts` | 222.0 | 217.9 | 4.1 |
| `e2e/rs1.test.ts` | 145.7 | 126.3 | 19.4 |
| `e2e/ahead.test.ts` | 131.8 | 115.0 | 16.8 |
| `e2e/vm2.test.ts` | 97.6 | 94.2 | 3.4 |
| `e2e/wd2.test.ts` | 92.6 | 73.8 | 18.8 |
| `e2e/textsize.test.ts` | 84.0 | 80.3 | 3.7 |
| `e2e/pf1.test.ts` | 83.5 | 71.7 | 11.8 |
| `e2e/wd1.test.ts` | 80.1 | 57.3 | 22.8 |
| `e2e/rb6-code.test.ts` | 79.9 | 71.0 | 8.8 |
| `e2e/settings-shell.test.ts` | 78.1 | 76.0 | 2.1 |
| `e2e/brand.test.ts` | 77.2 | 58.9 | 18.3 |
| `e2e/ed2-grid.test.ts` | 71.7 | 60.1 | 11.5 |
| `e2e/wk5.test.ts` | 70.0 | 67.2 | 2.8 |
| `e2e/wk1.test.ts` | 59.5 | 55.6 | 3.9 |
| `e2e/ty1.test.ts` | 56.8 | 41.2 | 15.6 |
| `e2e/patterns.test.ts` | 56.8 | 47.8 | 9.0 |
| `e2e/vm.test.ts` | 52.7 | 51.2 | 1.6 |
| `e2e/ah6-gantt.test.ts` | 48.0 | 43.5 | 4.5 |
| `e2e/nl1-now-mark.test.ts` | 47.6 | 46.6 | 1.0 |
| `e2e/settings-autosave.test.ts` | 45.2 | 42.7 | 2.5 |
| `e2e/tp1.test.ts` | 41.5 | 29.9 | 11.6 |
| `e2e/wk2.test.ts` | 40.3 | 38.4 | 1.9 |
| `e2e/ty2.test.ts` | 40.1 | 35.9 | 4.2 |
| `e2e/guide.test.ts` | 36.8 | 35.5 | 1.3 |
| `e2e/demo-names.test.ts` | 36.1 | 34.0 | 2.1 |
| `e2e/uc1.test.ts` | 34.3 | 32.7 | 1.6 |
| `e2e/wk3.test.ts` | 31.4 | 29.3 | 2.2 |
| `e2e/ah6-toolbar.test.ts` | 30.1 | 28.6 | 1.5 |
| `e2e/close-loop.test.ts` | 29.4 | 27.8 | 1.6 |
| `e2e/capture-drafts.test.ts` | 28.8 | 25.8 | 3.0 |
| `e2e/ah7-readiness.test.ts` | 28.4 | 25.5 | 2.9 |
| `e2e/rs2-day.test.ts` | 28.2 | 26.4 | 1.8 |
| `e2e/ui10-textbox.test.ts` | 28.1 | 26.6 | 1.5 |
| `e2e/sg1.test.ts` | 27.9 | 23.6 | 4.3 |
| `e2e/mb1.test.ts` | 26.1 | 24.4 | 1.8 |
| `e2e/ed1-edit-item.test.ts` | 25.6 | 21.7 | 3.9 |
| `e2e/bl1.test.ts` | 25.0 | 23.2 | 1.8 |
| `e2e/addwork.test.ts` | 24.9 | 23.4 | 1.4 |
| `e2e/safari.test.ts` | 24.7 | 12.8 | 11.9 |
| `e2e/rb2-code.test.ts` | 24.2 | 19.8 | 4.4 |
| `e2e/tech-docs.test.ts` | 24.2 | 22.4 | 1.7 |
| `e2e/demo-script.test.ts` | 23.6 | 21.2 | 2.4 |
| `e2e/week.test.ts` | 23.2 | 21.7 | 1.5 |
| `e2e/tx1.test.ts` | 23.1 | 20.0 | 3.1 |
| `e2e/rb1-code.test.ts` | 23.0 | 21.8 | 1.2 |
| `e2e/rf1.test.ts` | 22.0 | 17.0 | 5.0 |
| `e2e/ui8.test.ts` | 21.9 | 19.2 | 2.7 |
| `e2e/estimating.test.ts` | 21.3 | 19.8 | 1.5 |
| `e2e/cf1.test.ts` | 21.0 | 19.3 | 1.8 |
| `e2e/rb4-code.test.ts` | 20.5 | 17.4 | 3.1 |
| `e2e/bl2.test.ts` | 20.5 | 18.8 | 1.7 |
| `e2e/qc1.test.ts` | 20.2 | 17.7 | 2.4 |
| `e2e/nav.test.ts` | 19.1 | 17.4 | 1.7 |
| `e2e/rb5-code.test.ts` | 18.8 | 16.3 | 2.5 |
| `e2e/ib4-inbox.test.ts` | 18.6 | 16.1 | 2.5 |
| `e2e/fit.test.ts` | 18.5 | 16.4 | 2.1 |
| `e2e/conversations-3.test.ts` | 18.5 | 8.7 | 9.8 |
| `e2e/real-session.test.ts` | 18.5 | 18.5 | 0.0 |
| `e2e/lp1-send-loop.test.ts` | 18.2 | 16.7 | 1.5 |
| `e2e/dp2.test.ts` | 17.3 | 15.8 | 1.5 |
| `e2e/switches.test.ts` | 17.0 | 15.5 | 1.5 |
| `e2e/conversations-2.test.ts` | 16.5 | 7.9 | 8.6 |
| `e2e/rs2-colors.test.ts` | 16.4 | 13.7 | 2.7 |
| `e2e/today.test.ts` | 16.1 | 14.0 | 2.1 |
| `e2e/focus-capture.test.ts` | 16.0 | 13.1 | 2.9 |
| `e2e/backlog.test.ts` | 15.2 | 13.5 | 1.7 |
| `e2e/fn1.test.ts` | 14.6 | 13.1 | 1.6 |
| `e2e/feedback.test.ts` | 14.3 | 10.6 | 3.7 |
| `e2e/ui9.test.ts` | 13.7 | 12.0 | 1.7 |
| `e2e/rowmenu.test.ts` | 13.3 | 11.4 | 1.9 |
| `e2e/dv2.test.ts` | 12.5 | 8.8 | 3.8 |
| `e2e/qf1.test.ts` | 12.1 | 9.9 | 2.1 |
| `e2e/phone.test.ts` | 11.9 | 10.2 | 1.7 |
| `e2e/nm1-now-mark.test.ts` | 11.6 | 11.3 | 0.3 |
| `e2e/presence.test.ts` | 11.4 | 9.5 | 1.9 |
| `e2e/teams-bot.test.ts` | 11.1 | 8.9 | 2.2 |
| `e2e/rs2-loading.test.ts` | 11.0 | 9.0 | 2.0 |
| `e2e/assistant.test.ts` | 10.7 | 7.9 | 2.8 |
| `e2e/status-sr3.test.ts` | 10.5 | 8.6 | 1.9 |
| `e2e/delivery-chats.test.ts` | 10.2 | 8.3 | 1.9 |
| `e2e/notify.test.ts` | 10.1 | 8.2 | 1.8 |
| `e2e/admin-menu.test.ts` | 9.8 | 7.8 | 2.1 |
| `e2e/navigation.test.ts` | 9.8 | 8.1 | 1.6 |
| `e2e/lookup.test.ts` | 9.5 | 7.8 | 1.7 |
| `e2e/in2-invite-send.test.ts` | 9.4 | 7.6 | 1.8 |
| `e2e/close-button.test.ts` | 9.0 | 7.2 | 1.8 |
| `e2e/ui7-capture.test.ts` | 8.8 | 6.6 | 2.2 |
| `e2e/admin.test.ts` | 8.5 | 8.3 | 0.2 |
| `e2e/signin-needed.test.ts` | 8.4 | 6.0 | 2.3 |
| `e2e/pk1.test.ts` | 8.2 | 6.4 | 1.9 |
| `e2e/status-report.test.ts` | 8.1 | 6.0 | 2.1 |
| `e2e/identities.test.ts` | 7.8 | 5.9 | 1.9 |
| `e2e/nm2-settings-close.test.ts` | 7.7 | 5.1 | 2.6 |
| `e2e/qt2.test.ts` | 7.5 | 5.7 | 1.9 |
| `e2e/cw1.test.ts` | 7.3 | 5.8 | 1.5 |
| `e2e/demo-reset.test.ts` | 7.2 | 5.4 | 1.8 |
| `e2e/today-meetings.test.ts` | 7.1 | 4.8 | 2.3 |
| `e2e/cal1.test.ts` | 7.0 | 4.3 | 2.7 |
| `e2e/conversations.test.ts` | 6.7 | 6.3 | 0.3 |
| `e2e/break-down.test.ts` | 6.6 | 6.1 | 0.6 |
| `e2e/setup.test.ts` | 6.3 | 6.0 | 0.3 |
| `e2e/hk7-assistant-close.test.ts` | 6.3 | 4.3 | 2.0 |
| `e2e/carry.test.ts` | 6.1 | 4.1 | 2.0 |
| `e2e/board-suggest.test.ts` | 6.0 | 4.2 | 1.8 |
| `e2e/sends.test.ts` | 5.9 | 4.3 | 1.6 |
| `e2e/qt1.test.ts` | 5.9 | 4.1 | 1.8 |
| `e2e/mb1b.test.ts` | 5.8 | 4.4 | 1.4 |
| `e2e/capture-devops.test.ts` | 5.6 | 5.3 | 0.3 |
| `e2e/week-panel.test.ts` | 5.2 | 5.0 | 0.2 |
| `e2e/invite.test.ts` | 5.1 | 3.3 | 1.8 |
| `e2e/conversations-4.test.ts` | 5.1 | 4.9 | 0.2 |
| `e2e/meetings-register.test.ts` | 5.0 | 3.2 | 1.8 |
| `e2e/csp-signin.test.ts` | 5.0 | 2.7 | 2.3 |
| `e2e/conversations-5.test.ts` | 4.9 | 4.6 | 0.3 |
| `e2e/capture-address.test.ts` | 4.6 | 3.0 | 1.7 |
| `e2e/td1.test.ts` | 4.5 | 3.1 | 1.4 |
| `e2e/client-boundary.test.ts` | 4.4 | 2.7 | 1.7 |
| `e2e/status.test.ts` | 4.4 | 2.6 | 1.9 |
| `e2e/nm2-phone-daybar.test.ts` | 4.4 | 2.1 | 2.2 |
| `e2e/nm2-card-title.test.ts` | 4.2 | 2.5 | 1.7 |
| `e2e/nowline-label.test.ts` | 4.1 | 2.4 | 1.8 |
| `e2e/meetings.test.ts` | 4.1 | 2.4 | 1.7 |
| `e2e/ai.test.ts` | 4.0 | 3.7 | 0.3 |
| `e2e/kb1-shots.test.ts` | 4.0 | 2.6 | 1.4 |
| `e2e/pto-about.test.ts` | 3.5 | 2.0 | 1.5 |
| `e2e/diagnostics.test.ts` | 3.5 | 2.1 | 1.5 |
| `e2e/demo-check.test.ts` | 3.5 | 1.9 | 1.6 |
| `e2e/as3.test.ts` | 3.2 | 1.8 | 1.4 |
| `e2e/harness.test.ts` | 1.8 | 0.0 | 1.8 |
