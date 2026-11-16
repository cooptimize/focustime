# CI-3: the test files each CI job runs, before and after

Listed with vitest itself at `7c92f7aa` (before) and on this branch (after): `vitest list --filesOnly` for the unit job, and each shard's files from `vitest run e2e/ --shard=N/6` with a test name that matches nothing. The browser files change shard because the set changed; what matters is the union.

## Summary

| Job | Before | After |
|---|---|---|
| Unit and store tests | 462 files | 466 files: the same, plus this step's four new tests (`scripts/ci-changes.test.ts`, `ci-tree-match.test.ts`, `ci-workflow.test.ts`, `shots-branch.test.ts`) |
| Browser tests, six shards | 155 files, `e2e/safari.test.ts` among them | 132 files: every file but `e2e/safari.test.ts` and the 22 screenshot scripts |
| Browser tests WebKit (Safari) | (none) | 1 file: `e2e/safari.test.ts` |
| All browser files | 155 | 133: the 155 less the 22 moved to `e2e/shot-scripts/` |

Left the suite (D): `e2e/ah3-shots.test.ts`, `e2e/as1-shots.test.ts`, `e2e/as2-shots.test.ts`, `e2e/bl2-shots.test.ts`, `e2e/br1-shots.test.ts`, `e2e/cf1-shots.test.ts`, `e2e/ed2-shots.test.ts`, `e2e/gu1-shots.test.ts`, `e2e/mb1-shots.test.ts`, `e2e/nm1-shots.test.ts`, `e2e/nm2-shots.test.ts`, `e2e/ps1-shots.test.ts`, `e2e/ps2-shots.test.ts`, `e2e/qt1-shots.test.ts`, `e2e/rb6-shots.test.ts`, `e2e/rs1-shots.test.ts`, `e2e/rs2-shots.test.ts`, `e2e/sg1-shots.test.ts`, `e2e/uc1-shots.test.ts`, `e2e/ui10-shots.test.ts`, `e2e/wd2-shots.test.ts`, `e2e/wk5-shots.test.ts`.

Every other file runs as before: the union of the after lists plus those 22 is exactly the before list.

## Browser shards

### Shard 1

Before (26): `e2e/addwork.test.ts`, `e2e/as1-shots.test.ts`, `e2e/bl2.test.ts`, `e2e/brand.test.ts`, `e2e/break-down.test.ts`, `e2e/close-button.test.ts`, `e2e/conversations-3.test.ts`, `e2e/dp2.test.ts`, `e2e/gu1-shots.test.ts`, `e2e/invite.test.ts`, `e2e/lp1-send-loop.test.ts`, `e2e/meetings-register.test.ts`, `e2e/notify.test.ts`, `e2e/patterns.test.ts`, `e2e/phone.test.ts`, `e2e/pk1.test.ts`, `e2e/ps2-shots.test.ts`, `e2e/pto-about.test.ts`, `e2e/qc1.test.ts`, `e2e/real-session.test.ts`, `e2e/rs1-scan.test.ts`, `e2e/rs2-loading.test.ts`, `e2e/settings-shell.test.ts`, `e2e/uc1.test.ts`, `e2e/ui10-textbox.test.ts`, `e2e/week-panel.test.ts`

After (22): `e2e/addwork.test.ts`, `e2e/bl2.test.ts`, `e2e/brand.test.ts`, `e2e/break-down.test.ts`, `e2e/close-button.test.ts`, `e2e/conversations-3.test.ts`, `e2e/dp2.test.ts`, `e2e/invite.test.ts`, `e2e/lp1-send-loop.test.ts`, `e2e/meetings-register.test.ts`, `e2e/notify.test.ts`, `e2e/patterns.test.ts`, `e2e/phone.test.ts`, `e2e/pk1.test.ts`, `e2e/pto-about.test.ts`, `e2e/real-session.test.ts`, `e2e/rs1-scan.test.ts`, `e2e/rs2-loading.test.ts`, `e2e/settings-shell.test.ts`, `e2e/uc1.test.ts`, `e2e/ui10-textbox.test.ts`, `e2e/week-panel.test.ts`

### Shard 2

Before (26): `e2e/adm2-shots.test.ts`, `e2e/admin-menu.test.ts`, `e2e/ah7-readiness.test.ts`, `e2e/br1-shots.test.ts`, `e2e/capture-drafts.test.ts`, `e2e/conversations-5.test.ts`, `e2e/delivery-chats.test.ts`, `e2e/lookup.test.ts`, `e2e/mb1-shots.test.ts`, `e2e/nl1-now-mark.test.ts`, `e2e/nm2-phone-daybar.test.ts`, `e2e/nm2-settings-close.test.ts`, `e2e/nm2-shots.test.ts`, `e2e/ps1.test.ts`, `e2e/qf1.test.ts`, `e2e/rb4-code.test.ts`, `e2e/rb6-shots.test.ts`, `e2e/rowmenu.test.ts`, `e2e/settings-autosave.test.ts`, `e2e/status-report.test.ts`, `e2e/teams-bot.test.ts`, `e2e/today-meetings.test.ts`, `e2e/tx1.test.ts`, `e2e/ty1.test.ts`, `e2e/uc1-shots.test.ts`, `e2e/wd2.test.ts`

After (22): `e2e/adm2-shots.test.ts`, `e2e/admin-menu.test.ts`, `e2e/ah7-readiness.test.ts`, `e2e/capture-drafts.test.ts`, `e2e/conversations-5.test.ts`, `e2e/delivery-chats.test.ts`, `e2e/lookup.test.ts`, `e2e/nl1-now-mark.test.ts`, `e2e/nm2-phone-daybar.test.ts`, `e2e/nm2-settings-close.test.ts`, `e2e/ps1.test.ts`, `e2e/qc1.test.ts`, `e2e/qf1.test.ts`, `e2e/rb4-code.test.ts`, `e2e/rowmenu.test.ts`, `e2e/settings-autosave.test.ts`, `e2e/status-report.test.ts`, `e2e/teams-bot.test.ts`, `e2e/today-meetings.test.ts`, `e2e/tx1.test.ts`, `e2e/ty1.test.ts`, `e2e/wd2.test.ts`

### Shard 3

Before (26): `e2e/capture-address.test.ts`, `e2e/carry.test.ts`, `e2e/cf1.test.ts`, `e2e/demo-names.test.ts`, `e2e/ed2-shots.test.ts`, `e2e/estimating.test.ts`, `e2e/fn1.test.ts`, `e2e/harness.test.ts`, `e2e/identities.test.ts`, `e2e/in2-invite-send.test.ts`, `e2e/navigation.test.ts`, `e2e/nowline-label.test.ts`, `e2e/presence.test.ts`, `e2e/ps1-shots.test.ts`, `e2e/qt2.test.ts`, `e2e/rb5-code.test.ts`, `e2e/rs1-audit.test.ts`, `e2e/rs1.test.ts`, `e2e/safari.test.ts`, `e2e/sends.test.ts`, `e2e/sg1-shots.test.ts`, `e2e/status-sr3.test.ts`, `e2e/switches.test.ts`, `e2e/vm2.test.ts`, `e2e/wd2-shots.test.ts`, `e2e/week.test.ts`

After (22): `e2e/capture-address.test.ts`, `e2e/carry.test.ts`, `e2e/cf1.test.ts`, `e2e/demo-names.test.ts`, `e2e/estimating.test.ts`, `e2e/fn1.test.ts`, `e2e/harness.test.ts`, `e2e/identities.test.ts`, `e2e/in2-invite-send.test.ts`, `e2e/navigation.test.ts`, `e2e/nowline-label.test.ts`, `e2e/presence.test.ts`, `e2e/qt2.test.ts`, `e2e/rb5-code.test.ts`, `e2e/rf1.test.ts`, `e2e/rs1-audit.test.ts`, `e2e/rs1.test.ts`, `e2e/sends.test.ts`, `e2e/status-sr3.test.ts`, `e2e/switches.test.ts`, `e2e/vm2.test.ts`, `e2e/week.test.ts`

### Shard 4

Before (26): `e2e/admin.test.ts`, `e2e/ah3-shots.test.ts`, `e2e/ah6-gantt.test.ts`, `e2e/board-suggest.test.ts`, `e2e/client-boundary.test.ts`, `e2e/conversations-4.test.ts`, `e2e/demo-reset.test.ts`, `e2e/guide-tour.test.ts`, `e2e/mb1.test.ts`, `e2e/meetings.test.ts`, `e2e/nm2-card-title.test.ts`, `e2e/qt1-shots.test.ts`, `e2e/qt1.test.ts`, `e2e/rb1-code.test.ts`, `e2e/rb6-code.test.ts`, `e2e/rf1.test.ts`, `e2e/rs1-shots.test.ts`, `e2e/rs2-day.test.ts`, `e2e/rs2-shots.test.ts`, `e2e/status.test.ts`, `e2e/ui10-shots.test.ts`, `e2e/uib-shots.test.ts`, `e2e/wd1.test.ts`, `e2e/wk2.test.ts`, `e2e/wk3.test.ts`, `e2e/wk5-shots.test.ts`

After (22): `e2e/admin.test.ts`, `e2e/ah6-gantt.test.ts`, `e2e/board-suggest.test.ts`, `e2e/client-boundary.test.ts`, `e2e/conversations-4.test.ts`, `e2e/demo-reset.test.ts`, `e2e/dv2.test.ts`, `e2e/fit.test.ts`, `e2e/guide-tour.test.ts`, `e2e/mb1.test.ts`, `e2e/meetings.test.ts`, `e2e/nm2-card-title.test.ts`, `e2e/qt1.test.ts`, `e2e/rb1-code.test.ts`, `e2e/rb6-code.test.ts`, `e2e/rs2-day.test.ts`, `e2e/sg1.test.ts`, `e2e/status.test.ts`, `e2e/uib-shots.test.ts`, `e2e/wd1.test.ts`, `e2e/wk2.test.ts`, `e2e/wk3.test.ts`

### Shard 5

Before (26): `e2e/ahead.test.ts`, `e2e/ai.test.ts`, `e2e/as2-shots.test.ts`, `e2e/assistant.test.ts`, `e2e/cf1-shots.test.ts`, `e2e/conversations.test.ts`, `e2e/csp-signin.test.ts`, `e2e/demo-script.test.ts`, `e2e/dv2.test.ts`, `e2e/feedback.test.ts`, `e2e/fit.test.ts`, `e2e/focus-capture.test.ts`, `e2e/hk7-assistant-close.test.ts`, `e2e/ib4-inbox.test.ts`, `e2e/nm1-shots.test.ts`, `e2e/rb2-code.test.ts`, `e2e/rs2-colors.test.ts`, `e2e/setup.test.ts`, `e2e/sg1.test.ts`, `e2e/signin-needed.test.ts`, `e2e/tech-docs.test.ts`, `e2e/today.test.ts`, `e2e/tp1.test.ts`, `e2e/ty2.test.ts`, `e2e/ui7-capture.test.ts`, `e2e/ui8.test.ts`

After (22): `e2e/ahead.test.ts`, `e2e/ai.test.ts`, `e2e/assistant.test.ts`, `e2e/conversations.test.ts`, `e2e/csp-signin.test.ts`, `e2e/demo-script.test.ts`, `e2e/ed1-edit-item.test.ts`, `e2e/feedback.test.ts`, `e2e/focus-capture.test.ts`, `e2e/hk7-assistant-close.test.ts`, `e2e/ib4-inbox.test.ts`, `e2e/rb2-code.test.ts`, `e2e/rs2-colors.test.ts`, `e2e/setup.test.ts`, `e2e/signin-needed.test.ts`, `e2e/tech-docs.test.ts`, `e2e/textsize.test.ts`, `e2e/today.test.ts`, `e2e/tp1.test.ts`, `e2e/ty2.test.ts`, `e2e/ui7-capture.test.ts`, `e2e/ui8.test.ts`

### Shard 6

Before (25): `e2e/ah6-toolbar.test.ts`, `e2e/as3.test.ts`, `e2e/backlog.test.ts`, `e2e/bl1.test.ts`, `e2e/bl2-shots.test.ts`, `e2e/cal1.test.ts`, `e2e/capture-devops.test.ts`, `e2e/close-loop.test.ts`, `e2e/conversations-2.test.ts`, `e2e/cw1.test.ts`, `e2e/demo-check.test.ts`, `e2e/diagnostics.test.ts`, `e2e/ed1-edit-item.test.ts`, `e2e/ed2-grid.test.ts`, `e2e/guide.test.ts`, `e2e/kb1-shots.test.ts`, `e2e/mb1b.test.ts`, `e2e/nav.test.ts`, `e2e/nm1-now-mark.test.ts`, `e2e/td1.test.ts`, `e2e/textsize.test.ts`, `e2e/ui9.test.ts`, `e2e/vm.test.ts`, `e2e/wk1.test.ts`, `e2e/wk5.test.ts`

After (22): `e2e/ah6-toolbar.test.ts`, `e2e/as3.test.ts`, `e2e/backlog.test.ts`, `e2e/bl1.test.ts`, `e2e/cal1.test.ts`, `e2e/capture-devops.test.ts`, `e2e/close-loop.test.ts`, `e2e/conversations-2.test.ts`, `e2e/cw1.test.ts`, `e2e/demo-check.test.ts`, `e2e/diagnostics.test.ts`, `e2e/ed2-grid.test.ts`, `e2e/guide.test.ts`, `e2e/kb1-shots.test.ts`, `e2e/mb1b.test.ts`, `e2e/nav.test.ts`, `e2e/nm1-now-mark.test.ts`, `e2e/td1.test.ts`, `e2e/ui9.test.ts`, `e2e/vm.test.ts`, `e2e/wk1.test.ts`, `e2e/wk5.test.ts`

## Unit and store tests

Added: `scripts/ci-changes.test.ts`, `scripts/ci-tree-match.test.ts`, `scripts/ci-workflow.test.ts`, `scripts/shots-branch.test.ts`. Removed: none. The full list (after):

- `actions/admin-actions.test.ts`
- `actions/admin.test.ts`
- `actions/ahead-actions.test.ts`
- `actions/ai-tier.test.ts`
- `actions/ask-ai.test.ts`
- `actions/calendar-actions.test.ts`
- `actions/capture-actions.test.ts`
- `actions/carry-actions.test.ts`
- `actions/chat-actions.test.ts`
- `actions/chat-images.test.ts`
- `actions/client-accounts-status.test.ts`
- `actions/client-accounts.test.ts`
- `actions/client-lead.test.ts`
- `actions/closeout-actions.test.ts`
- `actions/code-actions.test.ts`
- `actions/code-git.test.ts`
- `actions/code-inside.test.ts`
- `actions/code-names.test.ts`
- `actions/conversation-actions.test.ts`
- `actions/conversation-backfill.test.ts`
- `actions/conversation-create.test.ts`
- `actions/conversation-held.test.ts`
- `actions/conversation-images.test.ts`
- `actions/conversation-merge-preview.test.ts`
- `actions/conversation-merge.test.ts`
- `actions/conversation-messages.test.ts`
- `actions/conversation-ownership.test.ts`
- `actions/conversations-pipeline.test.ts`
- `actions/conversations-rules-only.test.ts`
- `actions/cowork.test.ts`
- `actions/deploy-actions.test.ts`
- `actions/devops-actions.test.ts`
- `actions/devops-fresh.test.ts`
- `actions/devops-poll.test.ts`
- `actions/devops-write.test.ts`
- `actions/diagnostics.test.ts`
- `actions/dispatch.test.ts`
- `actions/done-offer.test.ts`
- `actions/draft-prepare.test.ts`
- `actions/ed2-change-set.test.ts`
- `actions/feedback-actions.test.ts`
- `actions/find-presence.test.ts`
- `actions/focus-sound-actions.test.ts`
- `actions/followup-who.test.ts`
- `actions/guide-actions.test.ts`
- `actions/held-recheck.test.ts`
- `actions/identities.test.ts`
- `actions/inbox-actions.test.ts`
- `actions/inbox-today.test.ts`
- `actions/invite.test.ts`
- `actions/item-card-actions.test.ts`
- `actions/item-edit.test.ts`
- `actions/link-actions.test.ts`
- `actions/loop-actions.test.ts`
- `actions/match-me.test.ts`
- `actions/meeting-actions.test.ts`
- `actions/meeting-capture.test.ts`
- `actions/new-item-actions.test.ts`
- `actions/notifier.test.ts`
- `actions/not-work.test.ts`
- `actions/patterns-reader.test.ts`
- `actions/patterns-run.test.ts`
- `actions/patterns-scope.test.ts`
- `actions/patterns.test.ts`
- `actions/patterns-wp3.test.ts`
- `actions/people-match.test.ts`
- `actions/people-picker.test.ts`
- `actions/photo-actions.test.ts`
- `actions/plan-actions.test.ts`
- `actions/presence-actions.test.ts`
- `actions/progress-actions.test.ts`
- `actions/promise-fixes.test.ts`
- `actions/promise-reply.test.ts`
- `actions/readback.test.ts`
- `actions/registry.test.ts`
- `actions/request-actions.test.ts`
- `actions/request-poll-boundary.test.ts`
- `actions/request-poll.test.ts`
- `actions/roadmap-actions.test.ts`
- `actions/rsvp-actions.test.ts`
- `actions/settings-actions.test.ts`
- `actions/setup-actions.test.ts`
- `actions/slim-inbox.test.ts`
- `actions/slow-source.test.ts`
- `actions/status-report.test.ts`
- `actions/step13.test.ts`
- `actions/story-actions.test.ts`
- `actions/team-actions.test.ts`
- `actions/team-clients-only.test.ts`
- `actions/time-actions.test.ts`
- `actions/timebox-actions.test.ts`
- `actions/transcript-file.test.ts`
- `actions/ui-actions.test.ts`
- `actions/vm-actions.test.ts`
- `actions/vm-autostart.test.ts`
- `actions/weekplan-actions.test.ts`
- `actions/weeks-touched.test.ts`
- `actions/work-item-types.test.ts`
- `actions/wrapup-actions.test.ts`
- `ai/guard.test.ts`
- `ai/openai.test.ts`
- `ai/schema.test.ts`
- `ai/service.test.ts`
- `ai/tiers.test.ts`
- `assistant/answers.test.ts`
- `assistant/asks-to-confirm.test.ts`
- `assistant/context.test.ts`
- `assistant/over-words.test.ts`
- `assistant/parity.test.ts`
- `assistant/quick.test.ts`
- `assistant/resolve.test.ts`
- `assistant/service.test.ts`
- `config/background-policy.test.ts`
- `config/cl1-rollback.test.ts`
- `config/config.test.ts`
- `config/edit.test.ts`
- `config/notify.test.ts`
- `config/org-rules.test.ts`
- `config/org.test.ts`
- `config/timeboxing.test.ts`
- `fixtures/names.test.ts`
- `fixtures/sample-week.test.ts`
- `host/azure/azure-host.test.ts`
- `host/boundary.test.ts`
- `host/host.test.ts`
- `host/local/keyring.test.ts`
- `host/local/media.test.ts`
- `host/local/open-request.test.ts`
- `host/local/rename.test.ts`
- `host/no-demo-leak.test.ts`
- `host/no-ui-import.test.ts`
- `log/appinsights.test.ts`
- `plan/addpane.test.ts`
- `plan/addtargets.test.ts`
- `plan/addwork.test.ts`
- `plan/agenda.test.ts`
- `plan/ahead-edit.test.ts`
- `plan/ahead-people.test.ts`
- `plan/ahead.test.ts`
- `plan/ahead-view.test.ts`
- `plan/asks-ai.test.ts`
- `plan/asks.test.ts`
- `plan/backlog-list.test.ts`
- `plan/backlog-status.test.ts`
- `plan/backlog.test.ts`
- `plan/blockpanel.test.ts`
- `plan/blockstatus.test.ts`
- `plan/blockstories.test.ts`
- `plan/boardsuggest.test.ts`
- `plan/borrow.test.ts`
- `plan/boundary.test.ts`
- `plan/breakdown.test.ts`
- `plan/caltier.test.ts`
- `plan/capture-prepare.test.ts`
- `plan/capture.test.ts`
- `plan/cardfold.test.ts`
- `plan/carry-budget.test.ts`
- `plan/carry.test.ts`
- `plan/chats.test.ts`
- `plan/checkinmove.test.ts`
- `plan/checkin.test.ts`
- `plan/client-accounts.test.ts`
- `plan/code-kinds-inside.test.ts`
- `plan/code-kinds.test.ts`
- `plan/code-sql-tree.test.ts`
- `plan/code.test.ts`
- `plan/collab.test.ts`
- `plan/common-words.test.ts`
- `plan/cowork.test.ts`
- `plan/dayblocks.test.ts`
- `plan/days.test.ts`
- `plan/dayview.test.ts`
- `plan/deploy-items.test.ts`
- `plan/deploy.test.ts`
- `plan/devops-pace.test.ts`
- `plan/devops-scope.test.ts`
- `plan/diagnostics.test.ts`
- `plan/due.test.ts`
- `plan/ed2-grid.test.ts`
- `plan/estimate.test.ts`
- `plan/evening.test.ts`
- `plan/expiry.test.ts`
- `plan/feedback.test.ts`
- `plan/find-item.test.ts`
- `plan/fit.test.ts`
- `plan/fixnext.test.ts`
- `plan/focussound.test.ts`
- `plan/focus.test.ts`
- `plan/followups.test.ts`
- `plan/gantt.test.ts`
- `plan/gantt-tree.test.ts`
- `plan/identities.test.ts`
- `plan/image-strip.test.ts`
- `plan/inbox-items.test.ts`
- `plan/invite.test.ts`
- `plan/levels.test.ts`
- `plan/light-format.test.ts`
- `plan/lookup.test.ts`
- `plan/meetings.test.ts`
- `plan/modes.test.ts`
- `plan/notify.test.ts`
- `plan/nowline.test.ts`
- `plan/now.test.ts`
- `plan/outlooksync.test.ts`
- `plan/pastrows.test.ts`
- `plan/patterns/patterns.test.ts`
- `plan/patterns/wp2.test.ts`
- `plan/patterns/wp3.test.ts`
- `plan/people.test.ts`
- `plan/permissions.test.ts`
- `plan/person-match.test.ts`
- `plan/phonenow.test.ts`
- `plan/picktime.test.ts`
- `plan/presence.test.ts`
- `plan/process-names.test.ts`
- `plan/process.test.ts`
- `plan/progress.test.ts`
- `plan/promise-items.test.ts`
- `plan/quick-create.test.ts`
- `plan/rail-promises.test.ts`
- `plan/reach.test.ts`
- `plan/readiness.test.ts`
- `plan/requests.test.ts`
- `plan/rituals.test.ts`
- `plan/roadmap.test.ts`
- `plan/rowdates.test.ts`
- `plan/rsvp.test.ts`
- `plan/rules.test.ts`
- `plan/sanitize.test.ts`
- `plan/sends.test.ts`
- `plan/setup.test.ts`
- `plan/slim-inbox.test.ts`
- `plan/standards.test.ts`
- `plan/status-dot.test.ts`
- `plan/status-report-client.test.ts`
- `plan/status-report.test.ts`
- `plan/status-sr3.test.ts`
- `plan/step151.test.ts`
- `plan/stories.test.ts`
- `plan/suggestlines.test.ts`
- `plan/suggest.test.ts`
- `plan/target.test.ts`
- `plan/teams-rhythm.test.ts`
- `plan/three-questions.test.ts`
- `plan/timebox.test.ts`
- `plan/timeline.test.ts`
- `plan/timer.test.ts`
- `plan/todaycal.test.ts`
- `plan/todayday.test.ts`
- `plan/todayorder.test.ts`
- `plan/today.test.ts`
- `plan/transcript.test.ts`
- `plan/unsized.test.ts`
- `plan/urgent.test.ts`
- `plan/vm-autostart.test.ts`
- `plan/vm.test.ts`
- `plan/wake.test.ts`
- `plan/weekclients.test.ts`
- `plan/weekdays.test.ts`
- `plan/weekdrop.test.ts`
- `plan/weeklist.test.ts`
- `plan/weekplan.test.ts`
- `plan/work-templates.test.ts`
- `plan/wrapup.test.ts`
- `scripts/ai-eval.test.ts`
- `scripts/app-registration.test.ts`
- `scripts/ci-changes.test.ts`
- `scripts/ci-tree-match.test.ts`
- `scripts/ci-workflow.test.ts`
- `scripts/coop-contract.test.ts`
- `scripts/costs-workbook.test.ts`
- `scripts/db-guard.test.ts`
- `scripts/decisions.test.ts`
- `scripts/env-separation.test.ts`
- `scripts/guards.test.ts`
- `scripts/parity.test.ts`
- `scripts/shots-branch.test.ts`
- `scripts/teams-package.test.ts`
- `scripts/tech-docs.test.ts`
- `scripts/words-guard.test.ts`
- `server/appconfig.test.ts`
- `server/app.test.ts`
- `server/app-use.test.ts`
- `server/assistant-voice.test.ts`
- `server/auth/google-connect.test.ts`
- `server/auth/mailbox.test.ts`
- `server/auth/signin.test.ts`
- `server/buildinfo.test.ts`
- `server/chat-images.test.ts`
- `server/code-inside-words.test.ts`
- `server/demo-admin.test.ts`
- `server/demo-inbox.test.ts`
- `server/demo-meetings.test.ts`
- `server/demo-status-report.test.ts`
- `server/demo-status-rf1.test.ts`
- `server/demo-status-sr3.test.ts`
- `server/demo-status.test.ts`
- `server/demo.test.ts`
- `server/demo-writes.test.ts`
- `server/env1-store.test.ts`
- `server/guard.test.ts`
- `server/guest-signin.test.ts`
- `server/ics-fetch.test.ts`
- `server/meeting-job.test.ts`
- `server/notices.test.ts`
- `server/notify.test.ts`
- `server/org-bootstrap.test.ts`
- `server/owner-secrets.test.ts`
- `server/people.test.ts`
- `server/pwa.test.ts`
- `server/teams/assistant.test.ts`
- `server/teams/bot.test.ts`
- `server/teams/endorsements.test.ts`
- `server/teams/rhythm-cards.test.ts`
- `server/teams/rhythm.test.ts`
- `server/teams/sdk.test.ts`
- `server/telemetry.test.ts`
- `server/test-app.test.ts`
- `server/ticks-env1.test.ts`
- `server/ticks-requests.test.ts`
- `server/ticks.test.ts`
- `server/ticks-vm-autostart.test.ts`
- `server/timer.test.ts`
- `server/use.test.ts`
- `server/webpush.test.ts`
- `sources/azure/client.test.ts`
- `sources/calendar/source.test.ts`
- `sources/dataverse/devops-targets.test.ts`
- `sources/dataverse/directory.test.ts`
- `sources/dataverse/holidays.test.ts`
- `sources/dataverse/normalize.test.ts`
- `sources/dataverse/pto.test.ts`
- `sources/dataverse/source.test.ts`
- `sources/demo/ai.test.ts`
- `sources/demo/code.test.ts`
- `sources/demo/demo-days.test.ts`
- `sources/devops/card.test.ts`
- `sources/devops/git.test.ts`
- `sources/devops/normalize.test.ts`
- `sources/devops/signals.test.ts`
- `sources/devops/source.test.ts`
- `sources/google/normalize.test.ts`
- `sources/graph/chats.test.ts`
- `sources/graph/meetings.test.ts`
- `sources/graph/normalize.test.ts`
- `sources/graph/people.test.ts`
- `sources/graph/presence.test.ts`
- `sources/graph/write.test.ts`
- `sources/ics/fetch.test.ts`
- `sources/ics/link.test.ts`
- `sources/ics/parse.test.ts`
- `sources/ics/source.test.ts`
- `sources/oauth/oauth.test.ts`
- `store/accounts.test.ts`
- `store/admin-store.test.ts`
- `store/ai.test.ts`
- `store/app-keys.test.ts`
- `store/capture-undo.test.ts`
- `store/claim.test.ts`
- `store/code-views-store.test.ts`
- `store/conversation-store.test.ts`
- `store/devops-store.test.ts`
- `store/images-bytes.test.ts`
- `store/import.test.ts`
- `store/isolation.test.ts`
- `store/legacy-chat-rows.test.ts`
- `store/meeting-store.test.ts`
- `store/migrations/additive.test.ts`
- `store/migrations/named.test.ts`
- `store/migrations/pick-item-index.test.ts`
- `store/plan-store.test.ts`
- `store/retention.test.ts`
- `store/scope.test.ts`
- `store/sql/migrate.test.ts`
- `store/sql/sqlserver.test.ts`
- `store/sql/tsql.test.ts`
- `store/standards-sync.test.ts`
- `store/teams-store.test.ts`
- `store/user-data.test.ts`
- `store/user-secrets.test.ts`
- `store/user-settings.test.ts`
- `store/vm-restores.test.ts`
- `store/work-templates-store.test.ts`
- `test/builders/builders.test.ts`
- `test/no-outbound.test.ts`
- `test/workers.test.ts`
- `ui/about.test.ts`
- `ui/activity.test.ts`
- `ui/ahead/bulk-parts.test.ts`
- `ui/ahead/layout.test.ts`
- `ui/ahead/model.test.ts`
- `ui/api.test.ts`
- `ui/appname.test.ts`
- `ui/brand/assets.test.ts`
- `ui/brand/boot.test.ts`
- `ui/brand/opening.test.ts`
- `ui/break-down-label.test.ts`
- `ui/capturebox.test.ts`
- `ui/code/address.test.ts`
- `ui/code/sql-tree.test.ts`
- `ui/code/viewer.test.ts`
- `ui/collaborate-label.test.ts`
- `ui/contrast.test.ts`
- `ui/dateinput.test.ts`
- `ui/daypanel.test.ts`
- `ui/devops-fresh.test.ts`
- `ui/docs/docs-nav.test.ts`
- `ui/guide/app-names.test.ts`
- `ui/guide/guide.test.ts`
- `ui/guide/sections.test.ts`
- `ui/guide/tours.test.ts`
- `ui/icons.test.ts`
- `ui/inbox/model.test.ts`
- `ui/keys.test.ts`
- `ui/mb1.test.ts`
- `ui/menuhead.test.ts`
- `ui/menu-icons.test.ts`
- `ui/menu.test.ts`
- `ui/MessageThread.test.ts`
- `ui/nav-deeplinks.test.ts`
- `ui/nav.test.ts`
- `ui/PersonPicker.test.ts`
- `ui/places.test.ts`
- `ui/planday.test.ts`
- `ui/plan/plan.test.ts`
- `ui/planview.test.ts`
- `ui/plan-words.test.ts`
- `ui/qf1-names.test.ts`
- `ui/railnow.test.ts`
- `ui/refresh.test.ts`
- `ui/roadmapmenu.test.ts`
- `ui/rs1-contrast.test.ts`
- `ui/scroll.test.ts`
- `ui/settings/autosave.test.ts`
- `ui/settings/registry.test.ts`
- `ui/stamp.test.ts`
- `ui/status.test.ts`
- `ui/step151.test.ts`
- `ui/step15.test.ts`
- `ui/td1-names.test.ts`
- `ui/textbox.test.ts`
- `ui/textsize.test.ts`
- `ui/timeinput.test.ts`
- `ui/today-nav.test.ts`
- `ui/tokens.test.ts`
- `ui/ty1.test.ts`
- `ui/ty2.test.ts`
- `ui/TypeIcon.test.ts`
- `ui/viewport.test.ts`
- `ui/weekfit.test.ts`
- `ui/weekmenu.test.ts`
- `ui/weekread.test.ts`
- `ui/work.test.ts`
- `week/build.test.ts`
- `week/dates.test.ts`
- `week/follow.test.ts`
- `week/free.test.ts`
- `week/holidays.test.ts`
- `week/hours.test.ts`
- `week/patterns.test.ts`
- `week/personal.test.ts`
- `week/pto-half.test.ts`
- `week/pto.test.ts`
- `week/rank.test.ts`
- `week/risks.test.ts`
- `week/zone.test.ts`
