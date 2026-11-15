# NM-2 STEP 0.3: the commands table

Every command the command menu can show on `main` (eb6ed790), built by `commandList` with a demo-like session that has everything on (an admin, the demo, a running timer, a client chat, Code, a client that can create a feature), and what choosing each one did. The "What choosing it does today" column is what the command's runner called, read by running it, not from its title. A command that is "not offered" is shown greyed with the reason it gives.

Verdicts:
- **true**: it does what its title says, on a screen that exists (or it opens the place where that is done, and that place offers it).
- **wrong words**: it works, but its title, its group, its reason or where it opens is out of date.
- **hollow**: its title names something that has no screen any more, or it only opens a place where what it names can't be done.

The reading taken where it was unclear (`docs/open-questions.md`, NM-2): a command that opens the place where the thing it names is done is true, as most of the menu is (Add a calendar by link opens Calendars added by link). A command that names a conversation or a request is hollow unless From chats offers the same thing on a suggestion; then its words change to say suggestion.

What each row became is in the last column. Hidden commands keep their actions, data and tests; they are listed with their reason in `HOLLOW` in `ui/menu.ts`, beside `HIDDEN_FOR_NOW` (Team's).

440 commands: 342 true, 52 wrong words, 46 hollow.

| Command | Group | Action | What choosing it does today | Verdict | Became |
|---|---|---|---|---|---|
| Day | Views | `view.today` | opens Day | true |  |
| Week | Views | `view.week` | opens Week | true |  |
| Backlog: every client's DevOps in rank order, Grid | Views | `view.roadmap` | opens Backlog (Grid) | true |  |
| Status: this week's feature updates for Monday's report | Views | `view.status` | opens Status | true |  |
| Inbox: from chats, promises, captures | Views | `view.inbox` | opens the Inbox | true |  |
| Inbox › From chats: conversations that need a DevOps item | Views | `view.requests` | opens Inbox › From chats | true |  |
| Add work beside Week (on Backlog: Grid or Gantt) | Views | `view.plan` | openRitual | true |  |
| Add work to today | Views | `view.planday` | opens Week with a block's panel on the day | true |  |
| Add work to a day… | Views | `view.planday_date` | asks: Add work to a day | true |  |
| Add work to the week | Views | `view.planweek` | opens Week with a block's panel | true |  |
| Backlog › Gantt: the timeline | Views | `view.ahead` | opens Backlog › Gantt | true |  |
| Backlog: stories in rank order | Views | `view.backlog` | opens Backlog | true |  |
| Backlog › Needs attention: missing stories, a target date, an owner or a size, or stale | Views | `view.gaps` | opens Backlog › Needs attention | true |  |
| Captures to sort (Inbox) | Views | `view.capture` | opens Inbox › Captures | true |  |
| Day › Midday check-in | Views | `view.checkin` | openCheckIn | true |  |
| Day › Close out | Views | `view.closeout` | openCloseOut | true |  |
| Inbox: next row | Inbox | `inbox.key.next` | event focustime:ask-key "next" | true |  |
| Inbox: previous row | Inbox | `inbox.key.prev` | event focustime:ask-key "prev" | true |  |
| Inbox: open or close the row | Inbox | `inbox.key.open` | event focustime:ask-key "open" | true |  |
| Inbox › From chats: create an item for the open suggestion | Inbox | `inbox.key.create` | event focustime:ask-key "create" | true |  |
| Inbox › From chats: already covered, link an item | Inbox | `inbox.key.link` | event focustime:ask-key "link" | true |  |
| Inbox › From chats: dismiss for me | Inbox | `inbox.key.dismiss` | event focustime:ask-key "dismiss" | true |  |
| Inbox › Promises: done | Inbox | `inbox.key.done` | event focustime:ask-key "done" | true |  |
| Previous week | Week | `week.prev` | changeWeek -1 | true |  |
| Next week | Week | `week.next` | changeWeek 1 | true |  |
| Back to this week | Week | `week.today` | goToday | true |  |
| Open the selected block | Week | `ui.block` | openBlock 2026-11-03 AM true | true |  |
| Settings | Week | `ui.settings` | not offered: Coming soon | wrong words | Opens Settings (it said Coming soon) |
| Next region (top bar, week, panel, status bar) | Keyboard | `ui.region_next` | moveRegion 1 | true |  |
| Previous region | Keyboard | `ui.region_prev` | moveRegion -1 | true |  |
| Open the focused work item in your browser | Keyboard | `ui.open_focused` | not offered: Focus a work item first (Tab to it) | true |  |
| Keyboard shortcuts (every key in one list) | Keyboard | `ui.keys` | showKeys | true |  |
| New feature | Work items | `ui.new_item` | openNew {"type":"Feature"} | true |  |
| New work item in DevOps | Work items | `ui.new_item` | openNew {} | true |  |
| Guide: start here, your first day and every area | Help | `ui.guide` | showGuide | true |  |
| Show me: Add work to your week | Help | `ui.guide` | startTour plan-week | true |  |
| Show me: Your week and to-dos | Help | `ui.guide` | startTour board | true |  |
| Show me: Day, focus and close out | Help | `ui.guide` | startTour today | true |  |
| Show me: The Inbox | Help | `ui.guide` | startTour inbox | true |  |
| Show me: Backlog | Help | `ui.guide` | startTour ahead | true |  |
| Show me: The assistant | Help | `ui.guide` | startTour assistant | true |  |
| Show me: Status | Help | `ui.guide` | startTour status | true |  |
| Guide: Your first day | Help | `ui.guide` | showGuide first-day | true |  |
| Guide: Day | Help | `ui.guide` | showGuide day | true |  |
| Guide: Week | Help | `ui.guide` | showGuide week | true |  |
| Guide: Backlog | Help | `ui.guide` | showGuide backlog | true |  |
| Guide: Status | Help | `ui.guide` | showGuide status | true |  |
| Guide: Inbox | Help | `ui.guide` | showGuide inbox | true |  |
| Guide: Writing work a builder can use | Help | `ui.guide` | showGuide writing | true |  |
| Guide: Capture and Break down | Help | `ui.guide` | showGuide capture | true |  |
| Guide: The assistant | Help | `ui.guide` | showGuide assistant | true |  |
| Guide: Ask | Help | `ui.guide` | showGuide ask | true |  |
| Guide: FocusTime in Teams | Help | `ui.guide` | showGuide teams | true |  |
| Guide: Client calls | Help | `ui.guide` | showGuide calls | true |  |
| Guide: Reading another client's code | Help | `ui.guide` | showGuide code | true |  |
| Guide: Settings, phone and keys | Help | `ui.guide` | showGuide settings | true |  |
| Guide: Renamed | Help | `ui.guide` | showGuide renamed | true |  |
| Technical docs: Architecture | Help | `docs.access` | showDocs architecture | true |  |
| Technical docs: Data | Help | `docs.access` | showDocs data | true |  |
| Technical docs: Integrations | Help | `docs.access` | showDocs integrations | true |  |
| Technical docs: Security | Help | `docs.access` | showDocs security | true |  |
| Technical docs: Operations | Help | `docs.access` | showDocs operations | true |  |
| Technical docs: Development | Help | `docs.access` | showDocs development | true |  |
| Code: search names | Code | `code.clients` | searchCode | true |  |
| Code: search inside files | Code | `code.clients` | searchCodeInside | true |  |
| Code: Internal | Code | `code.clients` | showCode internal | true |  |
| Refresh all sources | Week | `week.load` | refresh | true |  |
| Show source status | Sources | `source.status` | showSourceStatus | true |  |
| Connect Outlook | Sources | `auth.connect_microsoft` | connect outlook | true |  |
| Who's signed in | Settings | `auth.status` | opens Settings › you | true |  |
| Sign in with Microsoft | Settings | `auth.sign_in` | opens Settings › you | true |  |
| Send feedback | Help | `feedback.preview` | openFeedback | true |  |
| Send the feedback shown | Help | `feedback.send` | not offered: Send it from the feedback preview | true |  |
| Feedback setup | Help | `feedback.status` | opens Settings › connections | true |  |
| Sign out | Settings | `auth.sign_out` | opens Settings › you | true |  |
| My VM | My VM | `vm.status` | openVm | true |  |
| Find my VM | My VM | `vm.find` | opens Settings › you | true |  |
| Choose my VM | My VM | `vm.choose` | opens Settings › you | true |  |
| Start my VM | My VM | `vm.preview` | openVm | true |  |
| Confirm a VM change | My VM | `vm.confirm` | openVm | true |  |
| Not today (VM prompt) | My VM | `vm.dismiss_prompt` | openVm | true |  |
| Skip the next VM auto-start | My VM | `vm.autostart_skip` | openVm | true |  |
| Resume the VM auto-start | My VM | `vm.autostart_resume` | opens Settings › you | true |  |
| VM auto-start notice seen | My VM | `vm.autostart_seen` | openVm | true |  |
| Start my VM now | My VM | `vm.start_now` | openVm | true |  |
| Send a test notification | Settings | `notify.test` | opens Settings › notifications | true |  |
| Send a sample notification | Settings | `notify.sample` | opens Settings › notifications | true |  |
| FocusTime in Teams | Settings | `teams.status` | opens Settings › notifications | true |  |
| Send me a test in Teams | Settings | `teams.test` | opens Settings › notifications | true |  |
| Notifications | Settings | `notices.list` | openNotifications | true |  |
| Mark notifications read | Settings | `notices.read` | openNotifications | true |  |
| Push on this device | Settings | `push.status` | opens Settings › notifications devices | true |  |
| Notify this device | Settings | `push.subscribe` | opens Settings › notifications devices | true |  |
| Remove a device | Settings | `push.remove` | opens Settings › notifications devices | true |  |
| Calendars added by link | Sources | `calendar_link.list` | opens Settings › connections calendar-links | true |  |
| Check a calendar link | Sources | `calendar_link.preview` | opens Settings › connections calendar-links | true |  |
| Add a calendar by link | Sources | `calendar_link.add` | opens Settings › connections calendar-links | true |  |
| Change a calendar link's settings | Sources | `calendar_link.update` | opens Settings › connections calendar-links | true |  |
| Replace a calendar link | Sources | `calendar_link.replace` | opens Settings › connections calendar-links | true |  |
| Remove a calendar link | Sources | `calendar_link.remove` | opens Settings › connections calendar-links | true |  |
| Show the Azure write log | My VM | `vm.log` | opens Settings › activity azure-log | true |  |
| Connect Google Calendar | Sources | `auth.connect_google` | connect google | true |  |
| Disconnect a calendar | Sources | `auth.disconnect` | asks: Disconnect which calendar? | true |  |
| Backlog › Gantt: the next 12 weeks | Work items | `roadmap.ahead` | opens Backlog › Gantt | true |  |
| Move a bar on the timeline | Work items | `roadmap.set_dates` | opens Backlog › Gantt | true |  |
| Backlog | Work items | `roadmap.load` | opens Backlog (Grid) | true |  |
| Backlog's items | Work items | `ahead.load` | opens Backlog (Grid) | true |  |
| Who can be assigned | Work items | `ahead.people` | opens Backlog (Grid) | true |  |
| Change a date, state, size or owner | Work items | `ahead.stage` | opens Backlog (Grid) | true |  |
| Change target dates or owners of several items | Work items | `ahead.stage_bulk` | opens Backlog | true |  |
| Remove a pending change | Work items | `ahead.unstage` | opens Backlog (Grid) | true |  |
| Discard all changes | Work items | `ahead.discard` | opens Backlog (Grid) | true |  |
| Resolve a conflict | Work items | `ahead.resolve` | opens Backlog (Grid) | true |  |
| Backlog filters | Work items | `ahead.filters` | opens Backlog (Grid) | true |  |
| Remember Backlog filters | Work items | `ahead.set_filters` | opens Backlog (Grid) | true |  |
| Skip in Needs attention | Work items | `ahead.skip` | opens Backlog (Grid) | true |  |
| Unskip in Needs attention | Work items | `ahead.unskip` | opens Backlog (Grid) | true |  |
| Add work to the week | Week | `weekplan.load` | opens Week with a block's panel | true |  |
| Plan a feature for the week | Week | `weekplan.set_feature` | opens Week with a block's panel | true |  |
| Pin to a block | Week | `weekplan.place` | opens Week with a block's panel | true |  |
| Add to the week | Week | `weekplan.add` | opens Week with a block's panel | true |  |
| Set estimate | Week | `weekplan.set_estimate` | opens Week with a block's panel | true |  |
| Set story size | Week | `weekplan.set_size` | opens Week with a block's panel | true |  |
| Take off the week | Week | `weekplan.remove` | opens Week with a block's panel | wrong words | "Remove from this week" (the old title is another name) |
| Mark done for the week | Week | `weekplan.mark_done` | opens Week with a block's panel | true |  |
| Type a feature for the week | Week | `weekplan.add_draft` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): The type box for a draft feature went with WD-2; it only opens Week. |
| Draft feature on or off the week | Week | `weekplan.draft_tier` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): Draft features on the week's list went with WD-2; it only opens Week. |
| Nothing this week | Week | `weekplan.nothing` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): No screen offers Nothing this week since WD-1. |
| From last week | Week | `weekplan.proposal` | opens Week with a block's panel | true |  |
| Keep, drop or watch a row | Week | `weekplan.carry_decide` | opens Week with a block's panel | true |  |
| Accept all from last week | Week | `weekplan.carry_accept_all` | opens Week with a block's panel | true |  |
| Move or remove a check-in | Week | `weekplan.watch_checkin` | opens Week with a block's panel | true |  |
| Who can I send this to | Team | `send.people` | opens Week with a block's panel | wrong words | group Send work |
| Send to… | Team | `send.create` | opens Week with a block's panel | wrong words | group Send work |
| Cancel a send | Team | `send.cancel` | opens Week with a block's panel | wrong words | group Send work |
| Accept sent work | Team | `send.accept` | opens Week with a block's panel | wrong words | group Send work |
| Pass to… | Team | `send.pass` | opens Week with a block's panel | wrong words | group Send work |
| Can't this week | Team | `send.cant` | opens Week with a block's panel | wrong words | group Send work |
| Withdraw a Must | Team | `send.withdraw` | opens Week with a block's panel | wrong words | group Send work |
| Sent to me | Team | `send.today` | opens Week with a block's panel | wrong words | group Send work |
| From your team | Team | `team.commit` | opens Week with a block's panel | wrong words | "Sent to you and client priorities" (the old title is another name); group Send work |
| Status report | Week | `status.load` | opens Status | true |  |
| Client status report | Week | `status.report` | opens Status | true |  |
| Suggest status lines | Week | `status.suggest` | opens Status | true |  |
| Draft status updates | Week | `status.draft` | opens Status | true |  |
| Make it a client priority | Team | `priority.flag` | opens Week with a block's panel | wrong words | group Send work |
| Not a client priority | Team | `priority.unflag` | opens Week with a block's panel | wrong words | group Send work |
| Add to my week | Team | `priority.add_to_week` | opens Week with a block's panel | wrong words | group Send work |
| Ask a lead to look | Team | `look.ask` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): Can't finish while Team is hidden: the lead's notice opens Week, and a lead replies only in Team. |
| Stop watching | Week | `weekplan.watch_remove` | opens Week with a block's panel | true |  |
| Copy Coop brief | Week | `feature.brief` | opens Week with a block's panel | true |  |
| Mark as being broken down | Week | `feature.mark_breakdown` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): No screen offers Mark as being broken down since WD-1. |
| Create a promise: ask about priorities | Week | `followup.ask_priorities` | opens Week with a block's panel | hollow | Hidden (`HOLLOW`): No screen offers it since WD-1. |
| Add work to a day | Day | `planday.start` | asks: Plan which day? | true |  |
| Unfinished to-dos | Day | `planday.carry` | opens Week | true |  |
| Dismiss the suggested to-dos hint | Day | `planday.carry_hint` | opens Week | hollow | Hidden (`HOLLOW`): The suggested to-dos hint is gone; it only opens Week. |
| Suggested to-dos | Day | `suggest.load` | opens Day | true |  |
| Clear suggestions | Day | `suggest.clear` | not offered: Use Clear, or its Undo, beside the suggestions on a block or a day | true |  |
| Bring suggestions back | Day | `suggest.unclear` | not offered: Use Clear, or its Undo, beside the suggestions on a block or a day | true |  |
| Close out | Close out | `closeout.load` | openCloseOut | true |  |
| Timeboxes to check in | Close out | `checkin.sessions` | not offered: Check off a to-do with a DevOps item | wrong words | The reason it gives: at the top of the Midday check-in and Close out |
| Answer a timebox check-in | Close out | `checkin.answer` | not offered: Check off a to-do with a DevOps item | wrong words | The reason it gives: at the top of the Midday check-in and Close out |
| All went to plan | Close out | `checkin.all_to_plan` | not offered: Check off a to-do with a DevOps item | wrong words | The reason it gives: at the top of the Midday check-in and Close out |
| Undo a check-in answer | Close out | `checkin.undo` | not offered: Check off a to-do with a DevOps item | wrong words | The reason it gives: at the top of the Midday check-in and Close out |
| Finish the DevOps offer | Close out | `checkin.offer_close` | not offered: Check off a to-do with a DevOps item | wrong words | The reason it gives: at the end of Close out |
| Finish Check-in | Close out | `checkin.done` | openCheckIn | true |  |
| Finish Close out | Close out | `closeout.commit` | commitCloseOut | true |  |
| I'll make it up | To-dos | `pick.make_up` | asks: Make up which to-do? | true |  |
| Write a resume note | Close out | `note.set` | openCloseOut | true |  |
| Mark borrowed time paid | Close out | `borrow.pay` | not offered: No unpaid borrowed time | true |  |
| Add to the plan | To-dos | `pick.add` | asks: Add which work item? | true |  |
| Set size | To-dos | `pick.set_size` | asks: Set the size of which to-do? | true |  |
| Move to-do | To-dos | `pick.move` | asks: Move which to-do? | true |  |
| Mark done or not done | To-dos | `pick.mark_done` | asks: Mark which to-do done or not done? | true |  |
| Plan a deployment | To-dos | `deploy.add` | asks: Plan a deployment | true |  |
| A client's deployment items | To-dos | `deploy.items` | not offered: Set in Admin › Clients, or the client's page in Settings | true |  |
| Change a client's deployment items | To-dos | `deploy.config_save` | not offered: Set in Admin › Clients, or the client's page in Settings | true |  |
| Change the kind of a to-do | To-dos | `pick.set_kind` | asks: Change the kind of which to-do? | true |  |
| Drop to-do | To-dos | `pick.remove` | asks: Drop which to-do? | true |  |
| Take a to-do off the plan | To-dos | `pick.take_off` | asks: Take which to-do off the plan? | true |  |
| Put back a to-do taken off the plan | To-dos | `pick.put_back` | not offered: Use Undo right after Take off the plan | true |  |
| Put back an unfinished to-do | To-dos | `pick.uncarry` | not offered: Use Undo right after Keep, Move or Drop on a suggested to-do | true |  |
| Put back a dropped to-do | To-dos | `pick.undrop` | not offered: Use Undo right after Keep, Move or Drop on a suggested to-do | true |  |
| Draft a feature | Work items | `draft.add_feature` | opens Week with a block's panel | wrong words | Opens Backlog's Gantt, where a draft feature is added (it opened Week) |
| Choose a parent for a draft | Work items | `draft.set_parent` | opens Inbox › Captures | true |  |
| Delete a draft | Work items | `draft.remove` | opens Inbox › Captures | true |  |
| Edit a draft | Work items | `draft.update` | opens Inbox › Captures | true |  |
| Add a draft story | Work items | `draft.add_story` | asks: Draft a story under which epic or feature? | true |  |
| What can be created for a client | Work items | `new.options` | openNew {} | true |  |
| Save a new item as a draft | Work items | `draft.add` | openNew {} | true |  |
| Save a draft's level, parent and owner | Work items | `draft.save` | openNew {} | true |  |
| Change theme | Display | `ui.set_theme` | asks: Theme | true |  |
| Demo status | Display | `demo.status` | opens Settings › data demo-reset | true |  |
| Simulate a teammate's DevOps change | Display | `demo.devops_change` | not offered: Runs from a demo script | true |  |
| Run the VM auto-start (demo check) | Display | `demo.vm_tick` | not offered: Runs from a demo check | true |  |
| Reset demo | Display | `demo.reset` | opens Settings › data demo-reset | true |  |
| Demo mode | Display | `demo.set` | setDemo false | true |  |
| First launch | Display | `ui.first_launch` | not offered: Runs on its own the first time FocusTime opens | true |  |
| Setup status | Settings | `setup.load` | opens Settings › you setup | true |  |
| Setup: your day | Settings | `setup.prefill` | opens Settings › you setup | true |  |
| Setup: record a step | Settings | `setup.mark` | opens Settings › you setup | true |  |
| Setup: start over | Settings | `setup.reset` | opens Settings › you setup | true |  |
| Tour link | Display | `ui.tour_offer` | showGuide | true |  |
| Your first day | Help | `guide.checklist` | showGuide first-day | true |  |
| Code | Code | `code.clients` | showCode null | true |  |
| Technical docs | Help | `docs.access` | showDocs | true |  |
| Reduce motion | Display | `ui.set_reduce_motion` | asks: Reduce motion | true |  |
| Text size | Display | `ui.set_text_size` | asks: Text size | true |  |
| Timelines | Display | `ui.set_view_range` | asks: Timelines | true |  |
| Inbox view, clients and grouping | Display | `ui.set_inbox` | opens the Inbox | wrong words | "Inbox list and clients" (the old title is another name) |
| Timeline | Display | `ui.set_show_timelines` | saveShowTimelines false | true |  |
| Timeline on Day | Display | `ui.set_today_timeline` | saveDayTimeline false | true |  |
| Code: group SQL objects by schema or by type | Display | `ui.set_code_sql_group` | opens the Inbox | wrong words | Opens Code, where the Group by switch is (it opened the Inbox) |
| Days on Week | Display | `ui.set_week_days` | asks: Days on Week | true |  |
| Personal events | Display | `ui.set_show_personal` | saveShowPersonal false | true |  |
| Set working hours for a day | Time | `hours.set_day` | asks: Working hours for which day? | true |  |
| Use usual hours for a day | Time | `hours.clear_day` | not offered: No day this week has its own hours | true |  |
| Block time as unavailable | Time | `unavailable.add` | asks: Block time on which day? | true |  |
| Remove unavailable time | Time | `unavailable.remove` | not offered: No unavailable time this week | true |  |
| Add a flex session | Time | `flex.add` | asks: Flex session on which day? | true |  |
| Remove a flex session | Time | `flex.remove` | not offered: No flex session this week | true |  |
| Open Settings | Settings | `settings.load` | opens Settings | true |  |
| Change a setting | Settings | `settings.save` | opens Settings | true |  |
| Reset my plan | Settings | `plan.reset` | resetPlan | true |  |
| Start focus timer | Focus | `timer.start` | asks: Focus timer | true |  |
| Pause the timer | Focus | `timer.pause` | runTimer timer.pause | true |  |
| Resume the timer | Focus | `timer.resume` | not offered: No paused timer | true |  |
| Stop the timer | Focus | `timer.stop` | runTimer timer.stop | true |  |
| Add 15 minutes | Focus | `timer.extend` | runTimer timer.extend | true |  |
| Done with this session | Focus | `timer.done` | runTimer timer.done | true |  |
| Next to-do | Focus | `timer.next` | runTimer timer.next | true |  |
| Deep focus | Focus | `timer.deep` | runTimer timer.deep {"on":true} | true |  |
| Teams status during focus | Focus | `presence.status` | opens Settings › focus teams-status | true |  |
| Start a call | Week | `chats.calls` | asks: Start a call | wrong words | The reason it gives: client chat (was delivery chat) |
| Client chats | Settings | `chats.registered` | opens Settings › chats chats-read | true |  |
| Pick a client chat | Settings | `chats.list` | opens Settings › chats chats-read | true |  |
| Add a client chat | Settings | `chats.add` | opens Settings › chats chats-read | true |  |
| Read a client chat or not | Settings | `chats.reading` | opens Settings › chats chats-read | true |  |
| Mark a client chat as a Social chat | Settings | `chats.social` | opens Settings › chats chats-read | true |  |
| Label a client chat | Settings | `chats.kind` | opens Settings › chats chats-read | true |  |
| Remove a client chat | Settings | `chats.remove` | opens Settings › chats chats-read | true |  |
| Refresh client chat members | Settings | `chats.refresh` | opens Settings › chats chats-read | true |  |
| From chats | From chats | `requests.list` | opens Inbox › From chats | true |  |
| Refresh requests | From chats | `requests.refresh` | opens Inbox › From chats; runs requests.refresh {} | hollow | Hidden (`HOLLOW`): Refreshes a Requests list that is gone; Refresh From chats does the same read. |
| Show a request's context | From chats | `requests.context` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Requests as a list went with IB-1 and IB-4; it only opens From chats. |
| Resolve a request | From chats | `requests.resolve` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Requests as a list went; it only opens From chats. |
| Undo a request's resolution | From chats | `requests.reopen` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Requests as a list went; it only opens From chats. |
| Find an item for a request | From chats | `requests.search` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Requests as a list went; it only opens From chats. |
| Delete a client's stored chat messages | Settings | `requests.purge` | opens Settings › chats | true |  |
| Sort a request again | From chats | `requests.sort_again` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Requests as a list went; it only opens From chats. |
| Show a hidden request | From chats | `requests.show` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Hidden requests aren't listed anywhere; it only opens From chats. |
| Promises | Promises | `promises.list` | opens Inbox › Promises | true |  |
| Mark a promise done or dismiss it | Promises | `promises.resolve` | opens Inbox › Promises | true |  |
| Undo a promise's Done or Dismiss | Promises | `promises.reopen` | opens Inbox › Promises | true |  |
| Link a promise to a DevOps item | Promises | `promises.link` | opens Inbox › Promises | true |  |
| Break down: AI and write access | DevOps | `stories.status` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Break down with AI | DevOps | `stories.prepare` | asks: Break down which item? | true |  |
| Run Break down | DevOps | `stories.run` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Regenerate the proposals | DevOps | `stories.regenerate` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Save the reviewed proposals | DevOps | `stories.save` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Preview creating the items | DevOps | `stories.publish_preview` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Create all | DevOps | `stories.publish` | not offered: In the Break down panel, from a Needs stories row | true |  |
| Retry the items that weren't created | DevOps | `stories.retry` | not offered: In the Break down panel, from a Needs stories row | true |  |
| A client's house style | Settings | `stories.house_style` | opens Settings › clients | true |  |
| Edit a client's house style | Settings | `stories.house_style_save` | opens Settings › clients | true |  |
| Conversations | Conversations | `conversations.list` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Names a Conversations list; the Inbox has none since IB-4 (From chats lists suggestions and has its own command). |
| Conversations that need you (count) | Conversations | `conversations.count` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): A count of conversations that need you; Needs you went with IB-4 (the tab's number is From chats plus due promises). |
| Refresh conversations | Conversations | `conversations.refresh` | opens Inbox › From chats; runs conversations.refresh {} | wrong words | "Refresh From chats" (the old title is another name); group From chats |
| Show a conversation's messages | Conversations | `conversations.messages` | opens Inbox › From chats | wrong words | "Show a suggestion's messages" (the old title is another name); group From chats |
| Mark a conversation seen | Conversations | `conversations.seen` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Marks a conversation seen; a suggestion has no New mark. |
| Resolve a conversation | Conversations | `conversations.resolve` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Resolve went with IB-4; it only opens From chats. |
| Not work-related | Conversations | `conversations.not_work` | opens Inbox › From chats | wrong words | "This isn't work" (the old title is another name); group From chats |
| Undo Not work-related | Conversations | `conversations.not_work_undo` | opens Inbox › From chats | wrong words | "Undo This isn't work" (the old title is another name); group From chats |
| Not a request | Conversations | `conversations.not_request` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Not a request went with IB-4 (This isn't work replaces it). |
| Open a conversation again | Conversations | `conversations.reopen` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Reopen went with IB-4; it only opens From chats. |
| Hide a conversation for me | Conversations | `conversations.hide` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Hide for me went with IB-4 (Dismiss replaces it). |
| Move or split a message | Conversations | `conversations.move` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): No list of a conversation's messages to move or split them in. |
| This is work | Conversations | `conversations.this_is_work` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): The Chatter list it answered went with IB-4. |
| Link a conversation to a DevOps item | Conversations | `conversations.link` | opens Inbox › From chats | wrong words | "Already covered: link a suggestion to an item" (the old title is another name); group From chats |
| I'll take it | Conversations | `conversations.claim` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Ownership (I'll take it) went with IB-4. |
| Give to… | Conversations | `conversations.give` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Ownership (Give to…) went with IB-4. |
| Add helper | Conversations | `conversations.add_helper` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Ownership (Add helper) went with IB-4. |
| Release | Conversations | `conversations.release` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Ownership (Release) went with IB-4. |
| Close out a conversation | Conversations | `conversations.close_out` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Closing out a conversation went with IB-4. |
| Undo the last change to who has it | Conversations | `conversations.undo_ownership` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Ownership went with IB-4. |
| Take it over | Conversations | `conversations.take_over` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Take it over went with IB-4. |
| Show held-back messages | Conversations | `conversations.held` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): The held-back list is out of view since IB-4. |
| Sort or file all held messages of a client | Conversations | `conversations.held_bulk` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): The held-back list is out of view since IB-4. |
| Mark a held message not work-related | Conversations | `conversations.held_not_work` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): The held-back list is out of view since IB-4. |
| Sort unsorted messages | Conversations | `conversations.sort_unsorted` | opens Inbox › From chats; runs conversations.sort_unsorted {} | wrong words | "Sort chat messages waiting for AI" (the old title is another name); group From chats |
| Find an item to link | Conversations | `conversations.search_items` | opens Inbox › From chats | wrong words | group From chats |
| Unlink a conversation's item | Conversations | `conversations.unlink` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): A linked conversation leaves From chats, so nothing lists one to unlink. |
| Unlink a promise's item | Conversations | `my_promises.unlink` | opens Inbox › Promises | wrong words | group Promises |
| From chats | Inbox | `conversations.suggestions` | opens Inbox › From chats | true |  |
| Dismiss a suggestion | Inbox | `conversations.dismiss` | opens Inbox › From chats | true |  |
| Bring a suggestion back | Inbox | `conversations.undismiss` | opens Inbox › From chats | true |  |
| Put a cleared promise back | Inbox | `my_promises.put_back` | opens Inbox › Promises | wrong words | group Promises |
| Note older promises cleared | Inbox | `my_promises.cleared_seen` | opens Inbox › Promises | wrong words | group Promises |
| Find an item for a conversation | Conversations | `conversations.search` | opens Inbox › From chats | wrong words | "Find an item for a suggestion" (the old title is another name); group From chats |
| Create the DevOps item (a promise) | Conversations | `my_promises.start_draft` | opens Inbox › Promises | wrong words | "Create a DevOps item from a promise" (the old title is another name); group Promises |
| Merge into… | Conversations | `conversations.merge` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Merge went with IB-4. |
| Preview a merge | Conversations | `conversations.merge_preview` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Merge went with IB-4. |
| Undo a merge | Conversations | `conversations.unmerge` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Merge went with IB-4. |
| Draft the DevOps item | Conversations | `conversations.draft` | opens Inbox › From chats | wrong words | "Create an item from a suggestion" (the old title is another name); group From chats |
| Inbox items | Inbox | `inbox.list` | opens Inbox › From chats | true |  |
| Inbox items for Day and Week | Inbox | `inbox.today` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): A read for Day's lines, not a place; it only opens From chats. |
| Inbox count | Inbox | `inbox.count` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): The tab's number, not a place; it only opens From chats. |
| Hide an Inbox item for me | Inbox | `inbox.hide` | opens the Inbox | hollow | Hidden (`HOLLOW`): Hide for me went with IB-4; it only opens the Inbox. |
| Snooze an Inbox item | Inbox | `inbox.snooze` | opens the Inbox | hollow | Hidden (`HOLLOW`): Snooze went with IB-4; it only opens the Inbox. |
| Mark the Inbox timeline looked at | Inbox | `inbox.looked` | opens the Inbox | hollow | Hidden (`HOLLOW`): The Inbox timeline went; it only opens the Inbox. |
| Mark Inbox items seen | Inbox | `inbox.seen` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): New marks went with IB-4; it only opens From chats. |
| Promises | Conversations | `my_promises.list` | opens Inbox › Promises | wrong words | group Promises |
| Add a promise to Day | Conversations | `my_promises.today` | opens Inbox › Promises | wrong words | group Promises |
| Find an item for a promise | Conversations | `my_promises.search` | opens Inbox › Promises | wrong words | group Promises |
| Link a promise to a DevOps item | Conversations | `my_promises.link` | opens Inbox › Promises | wrong words | group Promises |
| Mark a promise done | Conversations | `my_promises.done` | opens Inbox › Promises | wrong words | group Promises |
| A promise isn't needed | Conversations | `my_promises.not_needed` | opens Inbox › Promises | wrong words | group Promises |
| Change a promise's due day | Conversations | `my_promises.due` | opens Inbox › Promises | wrong words | group Promises |
| Change whom a promise is to | Conversations | `my_promises.who` | opens Inbox › Promises | wrong words | group Promises |
| Close the loop on a promise without sending | Conversations | `my_promises.close` | opens Inbox › Promises | wrong words | group Promises |
| Open a promise again | Conversations | `my_promises.reopen` | opens Inbox › Promises | wrong words | group Promises |
| Skip a suggested update | Conversations | `suggestions.skip` | opens Inbox › From chats | hollow | Hidden (`HOLLOW`): Follow-through suggestions are no longer made (IB-4). |
| AI | Settings | `ai.status` | opens Settings › ai | true |  |
| Am I an admin | Admin | `admin.status` | opens Settings › admin-people | true |  |
| Open Admin | Admin | `admin.load` | opens Settings › admin-clients | true |  |
| Change a team setting | Admin | `admin.set` | opens Settings › admin-clients | true |  |
| Override a level or a client lead | Admin | `admin.override` | opens Settings › admin-people | true |  |
| Read levels and leads again | Admin | `admin.refresh_people` | opens Settings › admin-people | true |  |
| Remove a person who has left | Admin | `admin.remove_person` | opens Settings › admin-people | true |  |
| Admin audit | Admin | `admin.audit` | opens Settings › admin-audit | true |  |
| Link a client DevOps login | Admin | `admin.identity` | opens Settings › admin-people | true |  |
| Code views | Admin | `admin.code_views` | opens Settings › admin-audit code-views | true |  |
| Check a client's code access | Admin | `admin.code_check` | opens Settings › admin-clients | true |  |
| Sync the standards now | Admin | `admin.standards_sync` | opens Settings › admin-standards | true |  |
| Invite to FocusTime (Who's set up) | Admin | `admin.invited` | opens Settings › admin-people whos-set-up | true |  |
| Can I send invites from FocusTime | Admin | `admin.invite_access` | opens Settings › admin-standards | true |  |
| Preview an invite | Admin | `admin.invite_preview` | opens Settings › admin-standards | true |  |
| Send the invite shown | Admin | `admin.invite_send` | opens Settings › admin-standards | true |  |
| Retry an invite | Admin | `admin.invite_retry` | opens Settings › admin-standards | true |  |
| Status row action | Admin | `admin.status_action` | opens Settings › admin-status | true |  |
| Test AI | Settings | `ai.test` | opens Settings › ai | true |  |
| Microsoft permissions | Settings | `permissions.status` | opens Settings › connections permissions | true |  |
| Profile photos | Focus | `people.photos` | not offered: Shown wherever you and Cooptimizers appear | true |  |
| Teammates' presence | Focus | `presence.people` | not offered: Shown next to Cooptimizers in Ask to collaborate, Who and Backlog | true |  |
| Show the Teams status log | Focus | `presence.log` | opens Settings › activity teams-log | true |  |
| Open a focus playlist | Focus | `playlist.open` | opens Settings › focus playlists | true |  |
| Check media control | Focus | `media.status` | opens Settings › focus pause-media | true |  |
| Quick capture | Capture | `capture.add` | openCapture | true |  |
| Show captures | Capture | `capture.load` | opens Inbox › Captures | true |  |
| Sort a capture | Capture | `capture.route` | opens Inbox › Captures | true |  |
| Undo a capture | Capture | `capture.undo` | not offered: Undo from the Saved toast, right after a capture | true |  |
| Prepare a draft for DevOps | Capture | `draft.prepare` | opens Inbox › Captures | true |  |
| Show a draft | Capture | `draft.get` | opens Inbox › Captures | true |  |
| List a client's features and epics | Capture | `capture.features` | opens Inbox › Captures | true |  |
| Show promises | Promises | `followups.list` | opens Inbox › Promises | true |  |
| Add a promise | Promises | `followup.add` | openCapture follow_up | true |  |
| Edit a promise | Promises | `followup.edit` | opens Inbox › Promises | true |  |
| Close the loop without sending | Promises | `followup.close` | opens Inbox › Promises | true |  |
| Close the loop with someone | Promises | `loop.find` | opens Inbox › Promises | true |  |
| Draft a loop update | Promises | `loop.draft` | opens Inbox › Promises | wrong words | "Close the loop: draft the message" (the old title is another name) |
| Check text for another client's name | Promises | `boundary.check` | opens Inbox › Promises | true |  |
| Preview a loop update | Promises | `loop.preview` | opens Inbox › Promises | wrong words | "Close the loop: preview the message" (the old title is another name) |
| Send the loop update shown | Promises | `loop.send` | opens Inbox › Promises | wrong words | "Close the loop: send the message shown" (the old title is another name) |
| Check a loop update again | Promises | `loop.retry` | opens Inbox › Promises | wrong words | "Close the loop: check a sent message again" (the old title is another name) |
| Mark a loop update sent | Promises | `loop.mark_sent` | opens Inbox › Promises | wrong words | "Close the loop: mark the message sent" (the old title is another name) |
| Undo promise kept | Promises | `loop.undo_kept` | opens Inbox › Promises | true |  |
| Loop updates sent | Promises | `loop.sends` | opens Settings › data | wrong words | "Close the loop: messages sent (Settings › Activity)" (the old title is another name) |
| Not needed | Promises | `followup.not_needed` | opens Inbox › Promises | true |  |
| Snooze a promise | Promises | `followup.snooze` | opens Inbox › Promises | hollow | Hidden (`HOLLOW`): Promises has no Snooze; it only opens Promises. |
| Delete a promise | Promises | `followup.delete` | opens Inbox › Promises | true |  |
| Choose a person | Promises | `people.picker` | opens Inbox › Promises | true |  |
| Suggest who | Promises | `followup.people` | opens Inbox › Promises | true |  |
| Review heads-ups | Promises | `followups.review` | opens Inbox › Promises | hollow | Hidden (`HOLLOW`): Nothing reviews heads-ups any more; it only opens Promises. |
| Export the plan | Settings | `data.export` | exportPlan | true |  |
| Export my data | Settings | `data.export_mine` | opens Settings › data export | true |  |
| Diagnostics | Settings | `diagnostics.check` | opens Settings › data diagnostics | true |  |
| Delete my data | Settings | `data.delete_mine` | opens Settings › data delete | true |  |
| Reconnect Outlook with calendar changes | Sources | `auth.connect_outlook_write` | connectWrite | true |  |
| Timebox… | Timebox | `timebox.add` | asks: Timebox which to-do? | true |  |
| Timebox my day | Timebox | `timebox.add_many` | timeboxDay 2026-11-03 | true |  |
| Move or resize a timebox | Timebox | `timebox.update` | opens Week with a block's panel on the day | true |  |
| Remove a timebox | Timebox | `timebox.remove` | opens Week with a block's panel on the day | true |  |
| Put a timebox on Outlook | Timebox | `timebox.set_outlook` | opens Week with a block's panel on the day | true |  |
| Check Outlook write access | Settings | `write.status` | opens Settings › activity write-log | true |  |
| Preview an Outlook change | Settings | `write.preview` | opens Week with a block's panel on the day | true |  |
| Confirm an Outlook change | Settings | `write.confirm` | opens Settings › activity write-log | true |  |
| Retry an Outlook change | Settings | `write.retry` | opens Settings › activity write-log | true |  |
| Show the write log | Settings | `write.log` | opens Settings › activity write-log | true |  |
| Choose a version | Timebox | `timebox.resolve` | opens Week with a block's panel on the day | true |  |
| Open in Outlook | Calendar | `outlook.open` | openOutlook https://outlook.office.com/calendar/view/day/2026/11/3 | true |  |
| Ask to collaborate | Help | `collab.candidates` | asks: Help on which to-do? | true |  |
| Find help session times | Help | `collab.suggest` | asks: Help on which to-do? | true |  |
| Preview a help invite | Help | `collab.preview_invite` | asks: Help on which to-do? | true |  |
| Enable DevOps writes for a client | DevOps | `devops.set_write_pat` | opens Settings › devops devops-write | true |  |
| Turn off DevOps writes for a client | DevOps | `devops.clear_write_pat` | opens Settings › devops devops-write | true |  |
| How fresh DevOps is | DevOps | `devops.versions` | refresh | true |  |
| Check DevOps now | DevOps | `devops.refresh` | refresh | true |  |
| Find an item | DevOps | `devops.find` | opens Settings › devops find-item | true |  |
| Check DevOps write access | DevOps | `devops.write_status` | opens Settings › devops devops-write | true |  |
| List an item's states | DevOps | `devops.states` | opens Inbox › Captures | true |  |
| Preview a DevOps change | DevOps | `devops.preview` | opens Inbox › Captures | true |  |
| Confirm a DevOps change | DevOps | `devops.confirm` | opens Settings › activity devops-log | true |  |
| Retry a DevOps change | DevOps | `devops.retry` | opens Settings › activity devops-log | true |  |
| Show the DevOps write log | DevOps | `devops.log` | opens Settings › activity devops-log | true |  |
| Offer to update DevOps with progress | DevOps | `devops.progress_offer` | not offered: Check off a to-do with a DevOps item | true |  |
| What Edit and Move… offer for an item | DevOps | `devops.edit_offer` | not offered: Check off a to-do with a DevOps item | true |  |
| What Wrap it up offers for an item | DevOps | `devops.wrap_offer` | not offered: Check off a to-do with a DevOps item | true |  |
| Wrap it up | To-dos | `wrapup.offer` | asks: Wrap up which to-do? | true |  |
| Preview a wrap-up | To-dos | `wrapup.preview` | not offered: Check off a to-do with a DevOps item | true |  |
| Confirm a wrap-up | To-dos | `wrapup.confirm` | not offered: Check off a to-do with a DevOps item | true |  |
| Wrap up a story (from Teams) | To-dos | `wrapup.apply` | not offered: Check off a to-do with a DevOps item | true |  |
| Tick a story done or in progress | To-dos | `wrapup.tick` | not offered: Check off a to-do with a DevOps item | true |  |
| Suggest a wrap-up comment | To-dos | `wrapup.suggest` | not offered: Check off a to-do with a DevOps item | true |  |
| Open a work item's card | Work items | `item.card` | asks: Open which work item? | true |  |
| Offer to update DevOps for a to-do | DevOps | `devops.done_offer` | not offered: Check off a to-do with a DevOps item | true |  |
| Offer to undo a to-do's DevOps update | DevOps | `devops.undo_offer` | not offered: Check off a to-do with a DevOps item | true |  |
| A client's registered meetings | Meetings | `meeting.list` | opens Settings › admin-clients | true |  |
| Find a meeting to register | Meetings | `meeting.candidates` | opens Settings › admin-clients | true |  |
| Register a client meeting | Meetings | `meeting.register` | opens Settings › admin-clients | true |  |
| Change a registered meeting | Meetings | `meeting.update` | opens Settings › admin-clients | true |  |
| Stop reading a meeting | Meetings | `meeting.remove` | opens Settings › admin-clients | true |  |
| My client calls | Meetings | `meeting.mine` | opens Client calls | true |  |
| Review a call | Meetings | `meeting.review` | opens Client calls | true |  |
| Change a proposal | Meetings | `meeting.edit` | opens Client calls | true |  |
| No transcript this week | Meetings | `meeting.no_transcript` | opens Client calls | true |  |
| Preview a call's changes | Meetings | `meeting.prepare` | opens Client calls | true |  |
| Confirm a call's changes | Meetings | `meeting.confirm` | opens Client calls | true |  |
| Check a call now | Meetings | `meeting.check_now` | opens Settings › admin-clients | true |  |
| DevOps patterns | DevOps | `patterns.status` | showPatterns | true |  |
| Propose again | Meetings | `meeting.rerun` | opens Client calls | true |  |
| Open in browser | Work items | `link.open` | asks: Open which work item? | true |  |
| Ask the assistant | Assistant | `assistant.ask` | openAssistant | true |  |
| Confirm the assistant's change | Assistant | `assistant.confirm` | openAssistant | true |  |
| Undo the assistant's moves | Assistant | `assistant.undo` | openAssistant | true |  |
| Cancel the assistant's change | Assistant | `assistant.cancel` | openAssistant | true |  |
| Assistant history | Assistant | `assistant.history` | openAssistant | true |  |
| Clear assistant history | Settings | `assistant.clear` | opens Settings › ai assistant-history | true |  |
| What's next | Assistant | `assistant.today` | openAssistant | true |  |
| What I did on a day | Assistant | `lookup.day` | openAssistant | true |  |
| Look up a work item | Assistant | `items.get` | openAssistant | true |  |

## What the assistant and the Teams bot are told they can do

The assistant (the panel and the Teams bot, one service) is not given the command menu. It is given its own tools (`assistant/allowlist.ts`), each with a description and examples written for the model, and a capabilities answer for "help" (`assistant/answer.ts`). The Teams bot answers the same way, plus "capture:" and help.

| Tool | Actions it runs | Verdict | Became |
|---|---|---|---|
| today, day, item, gaps, status, sends | reads | true | |
| commitments | `conversations.list` (a read) | true: it answers who committed to what in a client's chats; it never names the Conversations list | |
| inbox | `inbox.list`, `inbox.count`, `conversations.suggestions` | true: From chats, Promises and Captures | |
| link_search, link_comment, unlink | conversation and promise links | true for a suggestion and a promise | |
| inbox_seen | `inbox.seen` | hollow: marks Inbox rows seen (no longer New); the slim Inbox has no New mark | Not offered to the model (`NOT_OFFERED`); the tool and its action stay |
| move_pick, drop_pick, keep_pick, move_picks, move_plan, close_day, add_to_week, ahead_change, comment, description, item_update, capture, close_loop, plan_deployment | writes behind Confirm | true | |
| send | `send.people`, `send.create` | true; its preview's line said the client's leads "see it in Team" | The preview says where the person sees it: To place, in a block's panel |
| add_to_week | `weekplan.add` | true; its preview's who-sees line said "Your teammates on this client, in Team" | "Only you" (nothing shows it to others while Team is hidden) |
| item_done, item_undo, write_undo, wrap_up | buttons only, never offered to the model | true | |
| capabilities ("help", "what can you do") | an answer | wrong words: "confirming a day or week" (Confirm is retired, CF-1) | The sentence lists what it can do today |

The Teams bot's own words (`assistant/quick.ts`: next, today, help, open) name no command that changed.

## Where an action's summary is read

`ActionSpec.summary` in `actions/registry.ts` is read by nothing a person or the AI sees: the command menu shows titles, the assistant is given its tools' own descriptions, and the bot answers through the assistant. So summaries were left as they are, apart from one pointer in a summary (`conversations.list`: "Inbox › Conversations"), which the pointer check reads and which now says From chats.

## Found after STEP 0, by the newcomer review

STEP 0 called these true; the review used them and found otherwise. Fixed in the same pull request:

| Command | Name | Was | Now |
|---|---|---|---|
| Send the invite shown, Preview an invite, Retry an invite, Can I send invites from FocusTime | `admin.invite_*` | opened Admin › Standards (a fall-through) | open Admin › People › Who's set up (IN-2) |
| Find my VM, Choose my VM | `vm.find`, `vm.choose` | opened Settings › Profile | open Settings › Accounts and calendars › My VM |
| Add, Label, Remove, Read or not, Refresh members, Pick a client chat | `chats.*` | opened Settings › Client chats (read only) | open Admin › Clients for an admin; the read-only list for others |
| Mark a client chat as a Social chat | `chats.social` | opened Settings › Client chats | hollow: no screen marks a Social chat (47 hollow in all) |
