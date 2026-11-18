# SA-0 inventory: every setting and every Admin control

Read at `ee05bd15` (origin/main, Nov 18 2026), in the demo and in the code. One row per setting or control, in the order a person meets them on the page (the rail's order, top to bottom). Words in quotes are exactly as shown. Pictures: [pictures.md](pictures.md).

How to read the columns:

- **Where**: section, group, and the address (`#/settings/<section>/<id>`; an id only where the registry has one, `ui/settings/registry.ts`). "no id" means search and deep links can't reach that control.
- **Control**: switch (a checkbox; FocusTime has no other switch), choice (radio buttons or a select), number, text, time, list (text with Add and Remove), button, link, table, read-only (a value with where it comes from).
- **Kind · stored**: Personal, Rule, Default or Default by level (the glossary's Setting kinds), and where the value lives: `[plan] carry_days` is a key in the person's settings rows (`user_settings`, `config/settings.ts`); `org: <key>` is a team value in `org_settings` (`config/org.ts`), every change in `admin_audit`; "sealed" is the person's `user_secrets` (`store/user-secrets.ts`). A secret's value is never shown here.
- **Saves · says**: "by itself" is `ui/settings/autosave.tsx` (a switch, choice or select at once; text and numbers on leaving the field or Enter) with "Saved" by the field for 2 s and an Undo toast for 8 s. "applies" is Display's own path (no Saved, no Undo). A button that saves says so on its row.
- **Read by**: the file that uses the value, found with `grep` over `actions/ plan/ week/ server/ ui/ ai/ assistant/ sources/ store/` for the value's name (camelCase and snake_case), leaving out tests, the Settings screens and `config/`. "nothing found" means that search found no reader.
- **Elsewhere**: the same value set or shown in another place, and whether the two can say different things.
- **Who**: who sees it · who changes it. "Everyone" is any signed-in person.

## You › Profile (`#/settings/you`)

| # | Where | Label | Help | Control | Kind · stored | Saves · says | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Profile · `signed-in` | "Signed in" (name, email) | "One Microsoft sign-in for you, your calendar and your Azure VM." / "Your plan stays in your FocusTime account." | button "Sign out" | session | at once, no ask | `server/` sign-out | More menu shows the photo; no other Sign out found in Settings | Everyone · self |
| 2 | Profile · `photos` | "Photos" | "Photos show for you and Cooptimizers. Cached for 7 days on this device, cleared when you sign out." | none (a label and a line, no control) | none | n/a | `ui/` photo cache | none | Everyone · nobody |
| 3 | Profile · `email` | "Email" | "From your Microsoft sign-in" | read-only | sign-in | n/a | n/a | Signed in shows the same address one row above | Everyone · nobody |
| 4 | Profile · `dataverse-user` | "Dataverse user" | "Change this in Dataverse" | read-only ("Found") | Dataverse | n/a | n/a | none | Everyone · nobody |
| 5 | Profile · `environment` | "Dataverse environment" | "Set by your FocusTime admin" | read-only (a URL) | app config | n/a | n/a | Admin › Status doesn't show it; no Admin control sets it (it is app config) | Everyone · nobody (the help names an admin, but no Admin page has it) |
| 6 | Profile · no id | (a line) "Your settings save as you change them, to Demo data (in memory, not your config file). Your time zone is under Working hours." | | link "Working hours" | n/a | n/a | n/a | n/a | Everyone |
| 7 | Profile › Setup · `setup` | "Setup" | "The four first-run screens…" (not in the demo: "Setup isn't part of the demo.") | buttons "Finish setup" or "Run setup again", "Run setup from the start", "Start over" (not on prod) | `setup_state` | button | `actions/setup-actions.ts` | Day's quiet line while steps are left | Everyone · self. Not shown in the demo |

## You › Working hours (`#/settings/hours`, read-only on the phone)

| # | Where | Label | Help | Control | Kind · stored | Saves · says | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 8 | Working hours · `weekdays` | "Monday" … "Sunday" (7 fields; registry calls them "Hours per day") | group line "Like 09:00-17:00; a second span is an evening. Empty is a day off." | text ×7 | Personal · `[hours] weekdays` | by itself | `week/hours.ts`, `plan/vm-autostart.ts`, `actions/setup-actions.ts` | Setup › Your day; a day's own hours from Week (One-day changes); Admin › Organization › New people (starting value only) | Everyone · self |
| 9 | Working hours · `lunch` | "Lunch" | "Like 12:00-12:30. Empty splits the day in the middle." | text | Personal · `[hours] lunch` | by itself | `week/hours.ts`, `plan/now.ts`, `actions/time-actions.ts` | Admin › Organization › New people › Lunch (starting value) | Everyone · self |
| 10 | Working hours · `time-zone` | "Time zone" | "Where you work, as a Region/City name from the list." | text with a list | Personal · `[hours] time_zone` | by itself | `week/zone.ts` `userZone()` everywhere | Profile links here | Everyone · self |
| 11 | Working hours · `one-day-changes` | "One-day changes" (h3) | "None. Set a day's own hours from its Actions menu on Week." | list with "Use usual hours" | Personal · `[hours]` overrides | button, no ask, no Undo | `week/hours.ts` | Set on Week; cleared here | Everyone · self |
| 12 | Working hours › Standing blocks · `standing-blocks` | rows Day · Half · Client | "Shown when Dataverse has no focus block there." | selects ×3 per row, "Remove", "Add a standing block" | Personal · `[[standing_blocks]]` | by itself (the whole list) | `week/patterns.ts`, `week/build.ts`, `actions/follow.ts` | Setup › Standing blocks | Everyone · self |

## You › Notifications (`#/settings/notifications`)

| # | Where | Label | Help | Control | Kind · stored | Saves · says | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 13 | This test site · no id (`test-site`, `from-test-site` on the page, not in the registry) | "From this test site" / "Send me reminders and Teams messages from this test site" | "This is a test site. It sends nothing on its own…" / "On: you get reminders, notices, pushes and Teams messages from this test site as the real FocusTime sends them, by the switches below. Only for you." | switch | Personal · `[notify] from_test_site` | by itself | `plan/notify.ts`, `server/ticks.ts` | none | Everyone on a test site; shown in the local demo too (its site reads "Local") · self |
| 14–20 | In FocusTime › Ritual reminders · `kinds` | "Add work to today", "Check-in", "Close out", "Add work to the week", "Look ahead", "Look ahead 4 weeks", "Direction review" | one line each, e.g. "At the start of a workday when nothing is on today yet." | switch ×7 | Personal · `[notify] <kind>` | by itself (one "Saved" for the whole group, at its foot) | `plan/notify.ts`, `server/ticks.ts` | Times: Day and Week › Reminders and Week nudges (#33–38). Teams has its own Midday check-in and Close out (#53–54) | Everyone · self |
| 21–22 | In FocusTime › While you focus · `kinds` | "Focus timer", "Meeting warnings" | "When a focus session or break ends." / "5 minutes before a meeting while a focus session runs." | switch ×2 | Personal | by itself | as above | Focus › End sound (#61) plays with the timer notice | Everyone · self |
| 23–26 | In FocusTime › Other · `kinds` | "My VM", "Promises due", "Expiring secrets", "Urgent requests" | e.g. "When AI sorts a request from a client chat you are in as needing someone now." | switch ×4 | Personal | by itself | as above | Urgent requests during focus (#30) | Everyone · self |
| 27 | In FocusTime › Monday's status report · `kinds` | "Monday's status report" | "Friday afternoon (and Sunday evening if you like) when some of your features have no update yet for Monday's report. Off until you turn it on." | switch (off by default) | Personal | by itself | as above | Timing › Status report times (#29); Teams › Status report (#56) | Everyone · self |
| 28 | In FocusTime › Client calls · `kinds` | "Client calls to review" | "After a client call you review, once: its proposals are ready, or its transcript needs uploading." | switch | Personal | by itself | as above | Teams › Client calls to review (#57) | Everyone · self |
| (none) | not in Settings | "Someone took your story", "Work sent to your week", "Answers to work you sent", "A Must someone can't take", "Someone assigned you an item", "Someone moved your dates", "Someone edited your item" | | no control | Personal `[notify]`, on by default | n/a | `server/ticks.ts` sends them (`notifier.allows(...)`) | nowhere: a person can't turn these off | Everyone · nobody |
| 29 | Timing · `status-report-times` | "Status report times" (time, "Also Sunday evening at", time) | "Friday at this time, or an hour before your day ends if that comes first. Sunday only when you turn it on. These times hold in Teams too." | time, switch, time | Personal · `[notify] status_*` | by itself (times on leaving) | `plan/status-report.ts` | Teams › Status report (#56) uses these times | Everyone · self |
| 30 | Timing · `urgent-during-focus` | "Urgent requests during focus" / "Let urgent requests through" | "Off: an urgent request waits until the focus session ends, with the others." | switch | Personal · `[notify] asks_through_focus` | by itself | `plan/notify.ts` | Test group's line repeats it | Everyone · self |
| 31 | Quiet hours · `quiet` | "Quiet" | "Focus timer and meeting warnings still come." | select "Outside working hours" / "Never quiet" | Personal · `[notify] quiet` | by itself | `plan/notify.ts`, `server/teams/rhythm.ts` | Teams messages never come in quiet hours | Everyone · self |
| 32 | Quiet hours · `quiet-pto` | "Days off" / "Quiet on days off" | "PTO and company holidays from Dataverse." | switch | Personal · `[notify] quiet_pto` | by itself | `plan/notify.ts` | Teams: "never … on days off" (no switch) | Everyone · self |
| 33 | Test · `test-notification` | "Send a test notification" | "During a focus session only the timer, meeting warnings and (if you let them) urgent requests come; the rest wait and come as one after the session." | button | n/a | button; "Sent. Click it to come back here." | `notify.test` | Teams has its own "Send me a test now" per kind | Everyone · self |
| 34 | On your devices · `devices` | "Notify this device", then each device with "Remove" | "Push isn't part of the demo. In-app notifications still work." (demo) | button, list | `push_devices` table | button, no ask | `server/` push | none | Everyone · self. Not shown in the demo |
| 35 | On your devices · `push-details` | "Show details in notifications" / "Show details" | "Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen." | switch | Personal · `[notify] push_details` | by itself | `plan/notify.ts`, `server/ticks.ts` | none | Everyone · self |
| 36 | In Teams · no id | (a line) "FocusTime in Teams runs in the hosted app. Here it can't send anything." | | none | n/a | n/a | `teams.status` | Accounts and calendars › FocusTime in Teams shows the same line (#79) | Everyone |
| 37 | In Teams · `teams-messages` | "Messages in Teams" / "Let FocusTime message me in Teams" | "Off: FocusTime only answers when you message it in Teams. On: it may send the kinds you turn on below, only in your own chat with it, never in quiet hours, on days off or weekends, and held while you focus." | switch | Personal · `[notify] teams_messages` | by itself | `plan/notify.ts`, `plan/teams-rhythm.ts`, `server/teams/rhythm.ts` | Accounts and calendars links here | Everyone · self |
| 38 | In Teams › What FocusTime sends · `teams-kinds` | "Morning brief" | "Today's blocks, meetings, to-dos, promises due and work sent to you." | switch, select "At the start of my day" / "At a set time", time, button "Send me a test now" | Personal · `[notify] teams_brief*` | by itself | `plan/teams-rhythm.ts`, `server/ticks.ts` | none | Everyone · self; the whole group is disabled until #37 is on |
| 39 | same | "Midday check-in" | "This morning's to-dos with Done and Not yet, and Move the rest." | switch, time (12:00 PM), test button | Personal · `[notify] teams_checkin_at` | by itself | as above | Day and Week › "Midday check-in reminder (minutes after lunch)" (#47): a second time for the same moment. They can disagree | as above |
| 40 | same | "Close out" | "What got done today: tick to-dos or tell me, then one Confirm closes the day." | switch, number ("minutes before my day ends", 30), test button | Personal · `[notify] teams_closeout_minutes` | by itself | as above | Day and Week › "Close out reminder (minutes before the day ends)" (#48) is 15 in the demo: they disagree out of the box | as above |
| 41 | same | "Nudges" | "A promise due tonight that's still open, work sent to you waiting over half a day, and someone taking over an item assigned to you. At most one message an hour." | switch, test button | Personal | by itself | as above | Promises due (#24) in the app | as above |
| 42 | same | "Status report" | "Friday afternoon, when some of your features have no update yet for Monday's report, with the list and Open Status. Sunday evening too when you turn it on in Status report times." | switch, test button | Personal | by itself | as above | #27 and #29 | as above |
| 43 | same | "Client calls to review" | "After a client call you review, once: Update the plan when its proposals are ready, or Upload its transcript when none came through. Inside your working hours." | switch, test button | Personal | by itself | as above | #28 | as above |
| 44 | same | "Also on Fridays (catch-up)" | "Never on weekends or PTO days. A test comes now, whatever the switches say." | switch | Personal · `[notify] teams_friday` | by itself | as above | Display › Days on Week shows Friday (#66): a different "Friday" switch | as above |

## You › Display (`#/settings/display`)

All six apply at once through their own actions (`ui.set_*`), with no Saved mark and no Undo.

| # | Where | Label | Help | Control | Kind · stored | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|
| 45 | `theme` | "Theme": "Cooptimize Dark", "Cooptimize Light", "Neutral" | "Applies at once." | choice (radio) | Personal · `[ui] theme` | `ui/App.tsx` | Command menu | Everyone · self |
| 46 | `text-size` | "Text size": "Default", "Large", "Larger" | "Ctrl + and Ctrl − change it; Ctrl 0 resets." | choice | Personal · `[ui] text_size` | `ui/textsize.ts` | Keys; command menu | Everyone · self |
| 47 | `timelines` | "Timelines": "Business hours", "12 hours", "24 hours" | "The default. V on Week changes it until you close FocusTime." | choice | Personal · `[ui] view_range` | `week/hours.ts`, `ui/App.tsx` | V key, Week's More (session only): the screen can differ from this until reload | Everyone · self |
| 48 | `personal-events` (registry "Show personal events") | "Personal events" / "Show personal events on Week and Day" | "Hidden ones still count in risk and free time. G switches it." | switch | Personal · `[ui] show_personal` | `ui/App.tsx`, `ui/Day.tsx` | G key, View options on Week and Day: the same value | Everyone · self |
| 49 | no id (`week-days` on the page, not in the registry) | "Days on Week" / "Show Friday", "Show weekend" | "With Show weekend on, weekend days show when something is on them (or always, with Every weekend day under Week's View options). A hidden day with to-dos or promises due, or today, gets a note on Week with Show. Day still steps through every day." | switch ×2 | Personal · `[ui]` week days | `plan/weekdays.ts`, `ui/BlockCard.tsx` | Week's View options (and "Every weekend day" only there) | Everyone · self |
| 50 | `reduce-motion` | "Motion" / "Reduce motion" | "No opening animation; the loader's mark holds still." | switch | Personal · `[ui] reduce_motion` | `ui/brand/motion.ts` | the system's reduce motion also counts | Everyone · self |

## Planning › Day and Week (`#/settings/planning`)

| # | Where | Label | Help | Control | Kind · stored | Saves · says | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 51 | Guidance · `level` | "Your level" ("Lead consultant") | "From your position in Dataverse. It changes suggestions only, never what you can do." | read-only | Dataverse, or an admin's override | n/a | `actions/` guidance | Admin › People › Level; Admin › People › Positions to levels | Everyone · admin |
| 52 | Guidance · `break-down-offered` (registry "Offer Break down") | "Break down" / "Offer Break down on features that need stories" | "Team default: on. Reset to team default" | switch | Default by level · `[guidance] draft_stories` over `org: level guidance` | by itself | `actions/story-actions.ts` | Admin › Organization › By level | Everyone · self, over the admin's level default |
| 53 | Guidance · `readiness-nudges` | "Needs attention nudges" / "Show Needs attention nudges" | "The readiness flags on Backlog's Gantt rows. Team default: on." | switch | Default by level · `[guidance] readiness_nudges` | by itself | `ui/ahead/Gantt.tsx` | Admin › Organization › By level | as above |
| (none) | not on screen | "Plan up to" | | none | `[guidance] plan_share` | n/a | nothing found | none | stored, never shown (QT-1) |
| 54 | To-dos · `count-unsized` | "Count unsized work as" (select, then "XS 30 min · S 1h · M 2h · L 4h") | "Used wherever a to-do or story has no size yet, in every fit and budget. Nothing is written to DevOps." | choice (select) | Personal · `[plan] sizes.unsized` | by itself | `plan/estimate.ts`, `ui/ahead/Gantt.tsx` | none | Everyone · self |
| 55–57 | To-dos · `shortest-useful-time` | "Shortest useful time, S (minutes)", "…, M (minutes)", "…, L (minutes)" | "The least Timebox my day gives an S to-do (S is 1h, M 2h, L 4h)." / "The same for M." / "The same for L." | number ×3 | Personal · `[plan] min_sizes` | by itself | `plan/agenda.ts`, `plan/picktime.ts` | The line above says S 1h; this line says it again | Everyone · self |
| 58 | To-dos · `carry-over` | "Carry-over (days back)" | "Unfinished to-dos offered again. 0 turns it off." | number | Personal · `[plan] carry_days` | by itself | `actions/plan-actions.ts` | none | Everyone · self |
| 59 | To-dos · `suggest-empty-blocks` | "Suggest work for empty blocks" / "Suggest" | "Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it. Also under Week's and Day's View options as Suggestions." | switch | Personal · `[plan] suggest_empty_blocks` | by itself | `actions/plan-actions.ts` | Week's and Day's View options (same value) | Everyone · self |
| 60 | To-dos · `devops-on-done` | "When I tick a story": "Ask (Wrap it up)" / "Always skip DevOps" | "Ask opens Wrap it up: Finished or Made progress, a comment, and one preview of what goes to DevOps. Only for items you can change, on clients with DevOps writes. Nothing is written without Confirm." | choice (radio) | Personal · `[plan] devops_on_done` | by itself | `actions/wrapup-actions.ts`, `server/teams/rhythm.ts` | none; needs DevOps write access (#86) to matter | Everyone · self |
| 61 | To-dos · no id (`progress-offer` on the page, not in the registry) | "Offer DevOps updates at end of day" / "Offer" | "After Close out: Remaining Work where the process has it, else a short comment. Always previewed; nothing is written without Confirm." | switch | Personal · `[plan] devops_progress_offer` | by itself | `actions/devops-write-actions.ts`, `server/teams/rhythm.ts` | none | Everyone · self |
| 62 | Reminders · `plan-reminder` | "Add work reminder (minutes after the day starts)" | "Only while today has no to-dos." | number | Personal · `[plan] reminder_offset_minutes` | by itself | `server/ticks.ts` | Its switch is Notifications › "Add work to today" (#14) | Everyone · self |
| 63 | Reminders · `checkin-reminder` | "Midday check-in reminder (minutes after lunch)" | "On a day with to-dos. 0 is the end of lunch." | number | Personal · `[plan] checkin_reminder_minutes` | by itself | `server/ticks.ts`, `ui/App.tsx` | Switch: Notifications › "Check-in" (#15). Teams' own time (#39) | Everyone · self |
| 64 | Reminders · `closeout-reminder` | "Close out reminder (minutes before the day ends)" | "Only if Close out isn't done." | number (15) | Personal · `[plan] closeout_reminder_minutes` | by itself | `server/ticks.ts`, `ui/App.tsx` | Switch: Notifications › "Close out" (#16). Teams' own 30 (#40) | Everyone · self |
| 65 | Week nudges · `week-nudges` | "Thursday", "Friday", "Monday" | "Empty turns a nudge off." / "For next week." / "For next week, if nothing is on it yet." / "For this week, if nothing is on it yet." | time ×3 | Personal · `[plan] week_nudge_*` | by itself | `server/ticks.ts`, `actions/dispatch.ts` | Switches: Notifications › "Add work to the week" and "Look ahead" (#17, #18). Empty here and the switch on: the switch has nothing to send | Everyone · self |
| 66 | Look-ahead rituals · `rituals` | "Look ahead 4 weeks" … "Direction review" … | "Both open Backlog › Gantt; switch them in Notifications." | none (text only) | n/a | n/a | `plan/rituals.ts` | Switches in Notifications (#19, #20) | Everyone |
| 67 | Timeboxes · `timeboxing` | "Use timeboxing" / "Use timeboxing" | "Off hides the time controls; timeboxes are kept." | switch | Personal · `[timebox] enabled` | by itself | `ui/Agenda.tsx`, `ui/PickRow.tsx` | none | Everyone · self |
| 68 | Timeboxes · `outlook-default` (registry "Put timeboxes on Outlook") | "Put on Outlook" / "On by default" | "Every new event shows a preview first." | switch | Personal · `[timebox] outlook_default` | by itself | `actions/timebox-actions.ts`, `ui/Day.tsx` | Needs Accounts › Outlook calendar changes (#76) allowed; with Use timeboxing off it has no effect | Everyone · self |
| 69 | Timeboxes · `confirm-own` (registry "Ask before changing my own timebox events") | "Changes to my own timebox events" / "Don't ask again for my own timeboxes" | "Off: no question; every change is still logged and can be undone." | switch, inverted (ticked means don't ask) | Personal · `[timebox] confirm_own` | by itself | `actions/timebox-actions.ts` | none | Everyone · self |
| 70 | Help sessions · `help-length` (registry "Help session length") | "Default length" | "Where Ask to collaborate starts." / group: "For Ask to collaborate." | choice (select, "30 minutes") | Personal · `[collab] meeting_minutes` | by itself | `ui/HelpFinder.tsx` | none | Everyone · self |
| 71 | Help sessions · `help-teams` | "Teams meeting" / "On by default" | "You can turn it off per invite." | switch | Personal · `[collab] teams` | by itself | `actions/collab-actions.ts` | none | Everyone · self |
| 72 | Help sessions · `help-days` | "Days to search" | "Workdays from today, for items not pinned to a day." | number | Personal · `[collab] days_ahead` | by itself | `plan/collab.ts` | none | Everyone · self |
| 73 | Help sessions · `never-suggested` | "Never suggested, for everyone" ("Kat 🤖") | "Set by your FocusTime admin" | read-only | Rule · `org: org.never_suggest` | n/a | `config/org-apply.ts` (added to #74) | Admin › Organization › "Never suggested as helpers or Who" (different label) | Everyone · admin |
| 74 | Help sessions · `exclude` | "People I exclude" | "Never suggested as helpers or as Who. By name or email." | list ("Name or email", "Add", "Remove") | Personal · `[collab] exclude` | by itself (Add, Remove) | `plan/collab.ts`, `actions/followup-actions.ts` | #73 adds the team's | Everyone · self |
| 75 | Help sessions · `invite-domains` | "Invites go only to" ("example.com") | "Set by your FocusTime admin" | read-only | Rule · `org: org.invite_domains` | n/a | `actions/collab-actions.ts` | Admin › Organization › "Help invites go only to" (different label) | Everyone · admin |
| 76–78 | At-risk blocks · `risk-rules` | "Watch at (minutes of meetings)", "At risk at (minutes of meetings)", "Shortest useful focus window (minutes)" | "A block with this many minutes of meetings is marked Watch." / "At least the Watch value." / "With no free stretch this long, the block is at risk." / group: "When a block's meetings make it Watch or At risk." | number ×3 | Personal · `[risk] *` | by itself; "At least the Watch value" is a validation error | `week/risks.ts` | Admin › Organization › New people › "Meeting watch", "Meeting at risk", "Shortest focus window" (starting values, other words) | Everyone · self |

## Planning › Focus (`#/settings/focus`)

| # | Where | Label | Help | Control | Kind · stored | Saves · says | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 79 | Focus timer · `focus-length` | "Focus length (minutes)" | "The default for a plain timer. A to-do suggests its size instead." | number | Personal · `[plan] focus_minutes` | by itself | `actions/timer-actions.ts`, `ui/menu.ts` | The Focus menu picks a length per session | Everyone · self |
| 80 | Focus timer · `break-length` | "Break length (minutes)" | "Offered when a session ends. 0 for none." | number | Personal · `[plan] break_minutes` | by itself | `actions/timer-actions.ts` | none | Everyone · self |
| 81 | Focus timer · `end-sound` | "End sound" / "Play a sound" | "With the notification when a session ends." | switch | Personal · `[plan] end_sound` | by itself | `server/timer.ts`, hosts | Notifications › "Focus timer" (#21): with that off, the sound has no notification to go with | Everyone · self |
| 82 | Teams status · `teams-status` | "Set Teams status during focus" / "Set my status while I focus" | "Logged in Settings › Activity › Teams status log." / group: "Set while focus runs, back to automatic after. A change you make in Teams wins." | switch | Personal · `[focus] teams_status` | by itself | `actions/presence-actions.ts` | Accounts › FocusTime in Teams links here | Everyone · self |
| 83 | Teams status · `plain-focus-status` | "Plain focus sets": "Busy" / "Nothing: leave my status alone" | "Deep focus always sets Do not disturb." | choice (select), disabled while #82 is off | Personal · `[focus] plain_focus_status` | by itself | `actions/presence-actions.ts` | "Nothing" here and #82 on overlap with #82 off for plain focus | Everyone · self |
| 84 | Sound while focusing · `sound` | "Default sound" (select, "Try it") | "Brown is deep, pink brighter, rain a slow swell." | choice (select), button | Personal · `[focus] sound` | by itself | `ui/App.tsx`, `server/timer.ts` | The focus screen picks another per session | Everyone · self |
| 85 | `volume` | "Volume (50)" | "0 to 100." | slider | Personal · `[focus] volume` | by itself on release | `ui/sound.ts` | focus screen | Everyone · self |
| 86 | `fade` | "Fade in and out (seconds)" | "0 to 30." | number | Personal · `[focus] fade_seconds` | by itself | `ui/sound.ts` | none | Everyone · self |
| 87 | `on-break` | "When a break starts": "Silence" / "A soft chime" | "The sound stops either way." | choice (select) | Personal · `[focus] on_break` | by itself | `plan/focussound.ts` | none | Everyone · self |
| 88 | Music players · `pause-media` | "Pause and resume music" / "Pause music when focus ends" | "FocusTime can't pause or resume music players here. Nothing is installed for you." (hosted and demo) | switch, disabled where players can't be reached | Personal · `[focus] pause_media` | by itself | `actions/timer-actions.ts` (developer loop host only) | none | Everyone · self; works only in the developer loop |
| 89 | Playlists · `playlists` | rows "Name", link, "Remove", "Add a playlist" | "Keep up to 6 Spotify or YouTube links. Choosing one on the focus screen opens it: in your default browser (the Spotify app isn't installed)." | list | Personal · `[focus] playlists` | on leaving a row | `ui/FocusScreen.tsx` | none | Everyone · self |

## Planning › Backlog (`#/settings/ahead`)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 90 | `stale-weeks` | "Stale after (weeks)" | "Open items with no change in DevOps for this long. 1 to 26." | number | Personal · `[ahead] stale_weeks` | by itself | `plan/backlog.ts`, `plan/ahead-model.ts` | none | Everyone · self |
| 91 | `stalled-days` | "Stalled after (days)" | "Days with no story change. 3 to 60." | number | Personal · `[roadmap] stalled_days` | by itself | `plan/roadmap.ts` | none | Everyone · self |
| 92 | `watch-weeks` | "Watch within (weeks)" | "Forecast this close to the target. 0 to 4; 0 is never." | number | Personal · `[roadmap] watch_weeks` | by itself | `plan/roadmap.ts` | "Watch" also names a block state in At-risk blocks (#76): the same word for two things | Everyone · self |

## Clients › Clients (`#/settings/clients`) and a client's page (`#/settings/client/<key>`)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 93 | Clients · `follow-grace` | "Keep following after focus time ends (days)" | "Clients stay followed this long after their focus time ends." | number | Personal · `[plan] follow_grace_days` | by itself | `actions/follow.ts` | each client's "Keep following" (#98) | Everyone · self |
| 94 | Clients › Your clients · `client-list` | one row per client: swatch, name, "Followed", "DevOps writes on" | "From Dataverse (your Account Worker records and focus time). Open one to change how it shows." | links (rows), "Not followed · N" fold | n/a | n/a | n/a | n/a | Everyone |
| 95 | Client page · no id | "Dataverse nickname" | "Change this in Dataverse" | read-only | Dataverse | n/a | n/a | none | Everyone · nobody |
| 96 | Client page · no id | "Your DevOps identity" | "Change this in Dataverse" | read-only | Dataverse | n/a | n/a | Admin › People › Client DevOps identities | Everyone · nobody |
| 97 | Client page · no id | "Shown as" | "Empty shows the Dataverse nickname." | text | Personal · `[clients.<key>] name` | by itself | the client name everywhere for this person | none; Admin › Clients › aliases (#130) is a different list | Everyone · self |
| 98 | Client page · no id | "Color" (8 swatches) | "The team color, set by your FocusTime admin. Pick another to use your own." / "Reset to team color" | choice (radio swatches) | Default · `[clients.<key>] color` over `org: client color` | by itself | the client color everywhere for this person | Admin › Clients › "Team color" (#123) | Everyone · self, over the admin's |
| 99 | Client page · no id | "Followed" / "Keep following" | e.g. "Followed: focus time is ongoing." | switch (disabled for internal and standing) | Personal · `[clients.<key>] follow` | by itself | `actions/follow.ts` | #93 | Everyone · self |
| 100 | Client page · no id | "States treated as open" ("None") | "Set by your FocusTime admin" | read-only | Rule · `org: client open_states` | n/a | `plan/process.ts` | Admin › Clients › DevOps process (#126) | Everyone · admin |
| 101 | Client page · no id | "DevOps writes" ("On") | "As Alex Rivera on atlas-demo." | read-only, link "Change DevOps write access" | sealed PAT status | n/a | n/a | DevOps › Write access (#108) | Everyone · self (in DevOps) |
| 102 | Client page › Client chats · no id | "Client chats" with each chat (members, "Open in Teams", "Refresh") | "Teams group chats for Atlas, shared with everyone on them who follows Atlas. New messages are read for what they ask and promise." | read-only cards | app tables | n/a | n/a | Admin › Clients › Client chats (#124); Settings › Client chats lists them again (#106) | Members who follow · admin |
| 103 | Client page › Client chats · no id | "Delete stored messages" | browser confirm: "Delete every chat message FocusTime stored for <client> that didn't become a request? This is for everyone on these chats…" | button | app tables | browser `confirm()` | `actions/request-actions.ts` `requests.purge` (any member who sees a chat) | Admin › Clients shows the same button | Members · any member, for everyone |
| 104 | Client page · no id | "AI for this client" ("Allowed for Atlas") | "Set by your FocusTime admin" | read-only | Rule · `org: client allow_ai` | n/a | `ai/` | Admin › AI › Per client (#121) | Everyone · admin |
| 105 | Client page · no id | "Data platform": "Not set" / "Fabric" / "Azure"; "Deployment items" (per item: up, down, "Default", "Hide"; "Add an item", "Add") | "Which list a deployment for this client offers. Not set shows both, with nothing ticked." / "Add this client's own, hide ones it doesn't use, reorder, and choose what's ticked by default. Only new deployments follow." | choice (segmented), list | Rule (no badge) · `org: client data_platform`, `deploy_items` | at once (`deploy.config_save`), no Saved mark | `actions/deploy-item-actions.ts`, `plan/deploy-items.ts`, `ui/Capture.tsx` | Admin › Clients shows the same (#133). A team value on a person's page | Shown and editable only to admins and the client's leads; others see nothing |
| 106 | Client page · no id | "House style for Break down" | "The default: too few features with stories to learn from yet." | read-only | Rule · `org: client house_style`, else learned | n/a | `actions/draft-prepare.ts` | Admin › Clients (#132) | Everyone with DevOps on the client · admin |

## Clients › Client chats (`#/settings/chats`)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 107 | Phrases · no id | (intro) "Each client chat registered below is read every 5 minutes in working hours…" (8 sentences) | | none | n/a | n/a | n/a | n/a | Everyone |
| 108 | Phrases · `team-phrases` | "Team asking phrases", "Team acknowledgements", "Team promise phrases" | "Set by your FocusTime admin" | read-only ×3 | Default · `org: conv.*_phrases` | n/a | `plan/asks.ts` | Admin › Client chats › "Asking phrases", "Thanks and short replies", "Commitment phrases" (#116–118): two of the three have other names there | Everyone · admin |
| 109 | `request-phrases` | "My asking phrases" | "Added on top of the team's. Commas between them." | text | Personal · `[asks] request_phrases` | by itself | `plan/asks.ts`, `actions/conversations-pipeline.ts` | #108 | Everyone · self |
| 110 | `ack-phrases` | "My acknowledgements" | "A message that is only these (and emoji) is never checked." | text | Personal · `[asks] ack_phrases` | by itself | as above | #108 | Everyone · self |
| 111 | `promise-phrases` | "My promise phrases" | "In your own messages: commas between them. Inbox › Promises." | text | Personal · `[asks] promise_phrases` | by itself | as above, `actions/diagnostics.ts` | #108 | Everyone · self |
| 112 | `chats-read` | each client's chats, read-only | | read-only cards | app tables | n/a | n/a | the client pages (#102); Admin › Clients (#124) | Members · admin |

## Connections › Accounts and calendars (`#/settings/connections`)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 113 | Sources · `sources` | "Dataverse", "PTO", "Outlook", "Google" with state ("live") and count | | buttons "Retry", "Connect"/"Reconnect", "Disconnect" | sealed refresh tokens | buttons; Disconnect asks with the browser's `confirm()` | `sources/` | the status bar at the foot of every screen shows the same sources | Everyone · self |
| 114 | Calendars added by link · `calendar-links` | "Add a calendar by link", "Where do I find the link?" | "Any calendar with a subscription link (an .ics or webcal:// address)…" (3 lines) | button opens a form (link, "Check link", name, color, Busy only or Show titles, Personal or Work, "Save calendar"); per link "Replace link", "Remove" | `calendar_links` (link sealed) | button; Remove asks inline | `sources/` | the status bar | Everyone · self |
| 115 | Pocket recorder · `pocket` | "How to connect" (4 steps), "Pocket's guide to API keys", "Your Pocket key", "Check and save"; connected: "Check again", "Use a new key", "Disconnect" | "Connecting lets FocusTime count your Pocket recordings when you press a button here, so you know the key works…" | text (key), buttons | sealed key | button; Disconnect asks inline | `actions/pocket-actions.ts` | none | Everyone · self |
| 116 | Outlook calendar changes · `outlook-changes` | "Outlook calendar changes" | "Allowed: FocusTime can create, change and remove the Outlook events it created (timeboxes), each after a preview. It can't change any other event." / "Asks for Calendars.ReadWrite only when you reconnect here." | status line; "Reconnect Outlook with calendar changes" when not allowed | Microsoft consent | button | `actions/timebox-actions.ts` | Day and Week › "Put on Outlook" (#68) needs this | Everyone · self |
| 117 | Microsoft permissions · `permissions` | one row per permission ("User.Read", "Calendars.ReadWrite", … "user_impersonation") with "Allowed", "Missing" or "Needs admin consent" | "Every permission FocusTime asks Microsoft for, on your one sign-in. Read only unless it says so." | status rows, "Check again" | Microsoft consent | button | `sources/graph` | #116 repeats Calendars.ReadWrite | Everyone · self |
| 118 | My VM · `vm` | "My VM" (h3), then "My VM" (label): VM name, "Find my VM", "Forget", resource ID box, "Use this VM" | "FocusTime reads this VM's status, starts it, and stops it only when you press Stop and confirm. It never changes its auto-shutdown." / "Found by the VM's Owner tag." | buttons, text | Personal · `[azure] vm` | button; Forget has no ask | `actions/vm-actions.ts` | the VM chip in the top bar | Everyone · self |
| 119 | My VM · `vm-start` | "Start without a preview" / "Start without a preview" | "Pressing Start in the morning starts the VM at once." | switch (label said twice) | Personal · `[azure] start_without_asking` | by itself | `actions/vm-actions.ts` | none | Everyone · self |
| 120 | My VM · `vm-autostart` | "Start my VM before my day" / "Start my VM before my day" | (more fields appear when on) | switch (label said twice) | Personal · `[azure] auto_start*` | by itself | `plan/vm-autostart.ts`, `actions/vm-autostart.ts` | none | Everyone · self |
| 121 | FocusTime in Teams · `teams-app` | line "FocusTime in Teams runs in the hosted app. Here it can't send anything."; links "What FocusTime may send you in Teams", "Your Teams status while you focus" | | links | n/a | n/a | n/a | Notifications (#36, #37), Focus (#82) | Everyone |
| 122 | Send feedback · `feedback` | "Send feedback" | "Set up: stories go under Feature #496 (FocusTime (demo feature)) as User Story, created as you with your DevOps write PAT for Internal." / "Goes to the FocusTime backlog in Cooptimize's DevOps. 0 of 10 sent today." | "Check again"; "Turn on DevOps writes" when no PAT | `org: org.feedback` + own PAT | button | `actions/feedback-actions.ts` | Admin › Organization › Send feedback (#140); Admin › Status › Send feedback ("A pretend backlog in the demo"): in the demo the three say three things (Feature #496; empty org, project and parent 0; a pretend backlog) | Everyone · admin sets the target |

## Connections › DevOps (`#/settings/devops`, read-only on the phone)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 123 | Reading · `devops-read` (registry "DevOps per client") | one row per client, state and count | "FocusTime reads with the company PAT from Dataverse, only when fetching; it is never shown." | "Retry" per row | n/a | button | `sources/devops` | the status bar; Admin › Status › DevOps | Everyone |
| 124 | Write access · `devops-write` | "DevOps write access for <client>", "On"/"Off, read-only", PAT box ("Paste your PAT"), "Expires (optional)", "Check and save", "Turn off" | "Your own PAT per client, with Work Items (Read & write). FocusTime checks it is yours, keeps it sealed and never shows it again." / after Turn off: "Turned off. The PAT was removed from the keyring" | password, date, buttons | sealed `devops-write-pat:<client>` | button "Check and save"; "Turn off" has no ask and no Undo | `actions/devops-write-actions.ts` | each client page (#101) | Everyone · self |
| 125 | Find an item · `find-item` | client select, item number, button | "Why an item isn't showing: whether FocusTime's last check of DevOps found it, the scope, and where it shows. It answers from what FocusTime already read; Refresh checks DevOps now." | select, number, button | n/a | n/a | `actions/devops-fresh-actions.ts` | none | Everyone |

## Connections › AI and assistant (`#/settings/ai`)

| # | Where | Label | Help | Control | Kind · stored | Saves | Read by | Elsewhere | Who |
|---|---|---|---|---|---|---|---|---|---|
| 126 | `ai-team` | "AI for FocusTime" ("On"), "Allowed for" (client list), "Your monthly limit" ("$1") | "Set by your FocusTime admin" ×3 | read-only ×3 | Rule · `org: ai.on`, client `allow_ai`, `ai.person_cap_usd` | n/a | `ai/service.ts` | Admin › AI (#141–145) | Everyone · admin |
| 127 | `ai-month` | "This month" "$0 of $1" | | read-only | `ai` request log | n/a | n/a | none | Everyone |
| 128 | `draft-months` | "Break down looks back (months)" | "Examples come from the same client's features changed in this many months, 1 to 36." | number | Personal · `[ai] draft_months` | by itself | `actions/story-actions.ts` | none | Everyone · self |
| 129 | `ai-test` | "Test AI" | "Sends one fixed request with no client data." | button | n/a | button; "OK · 0.4 s · $0.0001" | `ai/` | none | Everyone |
| 130 | `ai-sent` | "What is sent" (fold) | 6 lines | fold | n/a | n/a | n/a | none | Everyone |
| 131 | `ai-log` | "Last 20 requests" table | "No AI requests yet." when empty | table | request log | n/a | n/a | none | Everyone (own) |
| 132 | Assistant · `assistant-history` | "Assistant history", "Clear" | "What you asked the assistant and its answers, kept 30 days. Only you see it; it is in Export my data." | button, then "Clear it" / "Keep it" | `assistant_turns` | button | `assistant/` | Your data › Export includes it | Everyone · self |

## Data › Activity (`#/settings/activity`, read-only on the phone)

| # | Where | Label | Help | Control | Saves | Elsewhere | Who |
|---|---|---|---|---|---|---|---|
| 133 | `write-log` (registry "Outlook write log") | "Write log" | "Every change FocusTime made in other apps." | table with "Undo", "Retry"; "Remove from Outlook" for events with no timebox | buttons | the help says "other apps" but this table is Outlook only | Everyone (own) |
| 134 | `devops-log` | "DevOps write log" | "Every change FocusTime made in DevOps, with your write PAT, and the feedback stories you sent…" | table with Undo, Retry | buttons | none | Everyone (own) |
| 135 | `azure-log` | "Azure write log" | "Every start and stop of your VM…" | table | n/a | none | Everyone (own) |
| 136 | `teams-log` | "Teams status log" | | table | n/a | Focus › Teams status (#82) names it | Everyone (own) |
| 137 | `loop-log` | "Close the loop sends" | "Each update you sent from a promise: by Teams, email, a DevOps comment…" | table with Retry | button | none | Everyone (own) |

## Data › Your data (`#/settings/data`)

| # | Where | Label | Help | Control | Asks first | Read by | Who |
|---|---|---|---|---|---|---|---|
| 138 | `export` | "Export my data" / "Download JSON" | "Your plans, promises, captures, logs and settings. Never a password or token." | button | no | `actions/` `data.export_mine` | Everyone · self |
| 139 | `reset-plan` | "Reset my plan" / "Reset…" | "Empties the plan store after a full backup. Settings and calendars stay." | button, then type "reset", "Reset", "Cancel" | typed word | `plan.reset` | Everyone · self |
| 140 | `delete` | "Delete my data" / "Delete…" | "Signs you out and deletes everything FocusTime keeps for you." Then: "Export first if you want a copy. You'll be signed out and can't sign in again…" | button, then type "delete", "Delete", "Cancel" | typed word | `data.delete_mine` | Everyone · self |
| 141 | `diagnostics` | "Diagnostics", "Run checks", "Copy as text" | counts only | button | no | `actions/diagnostics.ts` | Everyone · self |
| 142 | Demo · `demo-mode` | "Demo mode" / "Show demo data" | "Fictional data; your own plan isn't touched." | switch | no | developer loop | Developer loop only (shown in the local demo) |
| 143 | Demo · `demo-reset` | "Reset demo" | | button | no | `demo.reset` | Demo only |

## Data › About (`#/settings/about`)

| # | Where | Label | Control | Who |
|---|---|---|---|---|
| 144 | `version` | "Version 0.x", "Site: …" | read-only | Everyone |
| 145 | `guide` | "Guide" / "Open the Guide" ("How FocusTime works, the keys and the questions people ask.") | button | Everyone |
| 146 | `style-guide` | "Style guide" / "Open the style guide" ("Tokens and components in each theme (developer loop).") | link | Developer loop (shown in the local demo) |

## Admin (admins only; Settings' rail, group "Admin"; More › Admin)

Every Admin field saves by itself through `admin.set` (`ui/settings/Admin.tsx` `useAdminSave`), with "Saved" and the same Undo toast, and is logged in Admin › Audit. Each label carries its kind as a small badge ("Rule", "Default"). None of Admin is in the Settings search. Someone who isn't an admin who opens an Admin address sees one line: "Admin is only for FocusTime admins (the "FocusTime Admins" group in Entra). Settings shows the team's values as "Set by your FocusTime admin"." Every Admin page, the status ones too, carries the line "Team settings for everyone in FocusTime. Changes save as you make them and are logged in Admin › Audit."

### Admin › Clients (`#/settings/admin-clients`): one card per client, all open, one under the other

| # | Label | Help | Control | Kind · stored (`org: client:<key>/…`) | Read by | Elsewhere |
|---|---|---|---|---|---|---|
| 147 | "Customers 6" / "All accounts 8" | "Clients are active Dataverse accounts of type Customer, plus Cooptimize Internal and any account treated as a client below. Nothing is deleted." | segmented choice | view only | n/a | Admin › AI has the same filter |
| 148 | "Team color" | "Suggested by FocusTime: distinct from the others, readable in both themes. Pick another to set it." | 8 swatches, "#rrggbb" and "Use" | Default · `color` | everywhere a client shows | each person's client page (#98) |
| 149 | "Leads" | "From Dataverse: the account's owner and Lead Consultants on the account. Add or remove one in Admin › People." | read-only | Dataverse plus overrides | `actions/` lead checks | Admin › People (#160) |
| 150 | "Client chats" (each chat: kind select "Delivery team"/"With the client", "Open in Teams", "Remove", "Stop reading"; "Delete stored messages"; "Add a chat") | "Teams group chats for <client>, shared with everyone on them who follows <client>…" | cards, select, buttons, picker | app tables (registration) | polling | person's client page (#102), Settings › Client chats (#112), Admin › Status › Client chats |
| 151 | "Meetings" ("Register a meeting": a series from my calendar or "Paste a Teams link"; per call: role, transcript source, reviewers) | "<client>'s weekly calls. After each one, its reviewers get proposals from the transcript to confirm. FocusTime reads no other meeting." | buttons, picker, selects | app tables (registry) | `sources/graph` meetings | More › Client calls (`#/meetings`) |
| 152 | "DevOps process" › "States treated as open" | "Done states this client still works in, like Resolved. Commas between them." | text | Rule · `open_states` | `plan/process.ts` | person's client page (#100) |
| 153 | "DevOps process" › types table: "Needs breakdown", "Background" per type | "Needs breakdown and Background are Rules: they apply to everyone's plans for <client>." | switch per type | Rule · `no_breakdown`, `background` | `plan/process.ts` | none |
| 154 | "Cooptimize's work in this project": "Automatic", "Whole project", "By team", "By area path" | "Backlog, Needs attention and Week's lists show only these items of <project>, plus anything assigned to the person…" | choice (radio), lists | Rule · `scope` | `plan/devops-scope.ts` | DevOps › Find an item explains it |
| 155 | "What Needs attention counts": "Needs stories", "No target date", "Unassigned", "Unsized" | "Backlog's Needs attention counts only these for this client. Turn off Unsized for a client that doesn't size in DevOps." | switch ×4 | Rule · `fix_gaps` | `plan/fixnext.ts` | none |
| 156 | "Who can read this client's code": "Whole company" / "Its team only" | "Code shows every client's repos, read only, to every Cooptimizer by default…" | choice (select) | Rule · `code_access` | `actions/code-actions.ts` | none |
| 157 | "Can FocusTime read it?" "Check" | "Read with the company DevOps token for this client. It needs Code (read), added to the token in DevOps." | button | n/a | `admin.code_check` | none |
| 158 | "Data platform", "Deployment items" | as #105 | segmented, list | Rule (no badge) · `data_platform`, `deploy_items` | as #105 | the same control on the client page for admins and leads |
| 159 | "Source systems" | "Which source-system standards go with this client's AI drafts." | choice (select) | Rule · `source_systems` | `actions/standards.ts` | none |
| 160 | "Other names (aliases)" | "Other names people use for this client, like a short name or an old company name…" (3 lines) | text | Rule · `aliases` | `plan/boundary.ts`, `ai/guard.ts` | none |
| 161 | "Match only as written" | "Matches the name and other names only with the capitals as written…" | switch | Rule · `exact_case` | `plan/boundary.ts` | none |
| 162 | "House style for Break down" | "Sent with every Break down request for this client. Empty goes back to the style learned from its own features." | text area | Rule · `house_style` | `actions/draft-prepare.ts` | person's client page (#106) |

### Admin › AI (`#/settings/admin-ai`)

| # | Label | Help | Control | Kind · stored | Read by | Elsewhere |
|---|---|---|---|---|---|---|
| 163 | "AI for FocusTime" / "AI on" | "The one switch for everyone, and the emergency off: off stops every AI request at once. Everything else works without AI." | switch; off asks first (inline box) | Rule · `org: ai.on` | `ai/service.ts` | Settings › AI (#126) |
| 164 | "Model" | none | text (shows "stub") | Rule · `org: ai.model` | `server/main.ts` | none |
| 165 | "Monthly cap per person (US dollars)" | "AI stops for a person at this, until next month." | number | Rule · `org: ai.person_cap_usd` | `ai/service.ts` | Settings › AI "Your monthly limit" |
| 166 | "Monthly cap for everyone (US dollars)" | "This month so far: $0.00." | number | Rule · `org: ai.app_cap_usd` | `ai/service.ts` | none |
| 167 | "Processing tier": one row per task, "Flex" switch on four, "Standard" on the rest | "Background work nobody waits on uses Flex: half the price, slower…" | switch ×4 (label "Flex" whether on or off) | Rule · `org: ai.tier.*` | `server/appconfig.ts` | none |
| 168 | "Per client": "Allow AI" ("Allowed"/"Off"), "Group messages without AI" ("On"/"Off"), "Send attachments to AI" ("On"/"Off") | intro speaks only of attachments | switch ×3 per client; the words beside each change with it | Rule · client `allow_ai`, `group_without_ai`, `send_attachments` | `ai/`, `actions/conversations-pipeline.ts` | client page shows Allow AI read-only (#104); Admin › Clients has no Allow AI |

### Admin › Client chats (`#/settings/admin-conversations`)

| # | Label | Help | Control | Kind · stored | Read by | Elsewhere |
|---|---|---|---|---|---|---|
| 169 | "Asking phrases" | "A client's message with one of these is checked for what it asks. Commas between them." | text | Default · `org: conv.request_phrases` | `plan/asks.ts` | Settings › Client chats "Team asking phrases" |
| 170 | "Thanks and short replies" | "A message that is only these (and emoji) is never checked." | text | Default · `org: conv.ack_phrases` | as above | Settings calls them "Team acknowledgements" |
| 171 | "Commitment phrases" | "In a person's own messages: a promise to keep." | text | Default · `org: conv.promise_phrases` | as above | Settings calls them "Team promise phrases" |
| 172 | "Read client chats every (minutes)" | "1 to 30, in followers' working hours only. Applies from the next poll." | number | Rule · `org: conv.poll_minutes` | `actions/request-poll.ts` | Settings › Client chats' intro states it ("every 5 minutes") |
| 173 | "Keep chat messages nothing was found in (days)" | "Then they're deleted, after each poll." | number | Rule · `org: conv.retention_days` | `server/retention-job.ts` | Admin › Status › Jobs states it |
| 174 | "AI requests per chat per day" | "At most, for each chat." | number | Rule · `org: conv.chat_ai_daily_cap` | `actions/request-poll.ts` | none |
| (none) | "Closed conversations stay shown (days)" | | hidden since NM-2 | Rule · `org: conv.closed_shown_days` | `actions/inbox-actions.ts` still reads it | nowhere to change it |

### Admin › People (`#/settings/admin-people`)

| # | Label | Help | Control | Kind · stored | Elsewhere |
|---|---|---|---|---|---|
| 175 | "Admins" | "Admins are the members of the Entra group "FocusTime Admins". FocusTime never makes anyone an admin…" ("Nobody seen yet.") | read-only list | Entra | none |
| 176 | "Who's set up": "All (5)", "Not signed in (1)", "Set up partly (2)", "Invite several"; table Name, Signed in, DevOps connected, Calendar connected, "Invite" | "Cooptimizers only. Yes or no for each…" | filter, table, checkboxes, buttons; Invite opens a sheet | app tables | the People table's "Last sign-in" (#177) answers who hasn't signed in a second way |
| 177 | "People": "Refresh from Dataverse"; table Name, Level (select), Client lead ("Remove", "Add as lead of…", "Add", "Undo"), Last sign-in, Setup, Dataverse, Clients, Sources, Automation (switch, "Rule"), "Remove" | "Cooptimizers only. Levels change suggestions and emphasis only, never what anyone can see or do." | table with selects, switches, buttons | overrides in `org_settings`; Remove: type the name | Settings › Day and Week › Your level (#51) |
| 178 | "Not Cooptimizers (2)" | | fold with the same table | as above | none |
| 179 | "Client DevOps identities" (per client: "Remove", "Confirm", "Not them") | "When someone signs in to a client's DevOps with a client login, FocusTime counts that login as them…" | buttons | identity links | person's client page "Your DevOps identity" (#96) |
| 180 | "Positions to levels" (Position in Dataverse, Level select, People) | "Each Cooptimizer's level comes from their Dataverse position…" | select per position | Rule · `org: positions` | #177's Level column |

### Admin › Organization (`#/settings/admin-organization`)

| # | Label | Help | Control | Kind · stored | Read by | Elsewhere |
|---|---|---|---|---|---|---|
| 181 | "Help invites go only to" | "From the app's settings until an admin sets them here. Commas between domains." | text | Rule · `org.invite_domains` | `actions/collab-actions.ts` | Settings › Day and Week "Invites go only to" |
| 182 | "Never suggested as helpers or Who" | "Names or emails, commas between them. People may exclude more for themselves." | text | Rule · `org.never_suggest` | `config/org-apply.ts` | Settings › Day and Week "Never suggested, for everyone" |
| 183 | "Keep people's data (years)" | "Shown to everyone. Deleting older data automatically comes in a later step." | number | Rule · `org.retention_years` | nothing found (only Admin › Status's Jobs row, "Not enforced yet") | not shown to anyone else, despite "Shown to everyone" |
| 184 | "Counts as in use (minutes)" | "5 to 60. An open page counts as someone using FocusTime only this long after their last key, click or scroll. Background work waits otherwise." | number | Rule · `org.idle_minutes` | `server/use.ts`, `ui/activity.ts` | none |
| 185 | "Needs attention looks at the top N of each backlog" | "10 to 100, for epics, features and stories each…" | number | Rule · `ahead.fix_top_n` | `plan/fixnext.ts` | none |
| 186–188 | Send feedback: "DevOps organization", "Project", "Parent feature" | "From the app's settings until an admin sets it here. Stories are created under the parent feature by the person sending them…" | text, text, number (empty, empty, 0 in the demo) | Rule · `org.feedback` | `actions/feedback-actions.ts` | Settings › Accounts › Send feedback (#122), Admin › Status |
| 189–198 | New people: "Monday" … "Sunday", "Lunch", "Meeting watch (minutes)", "Meeting at risk (minutes)", "Shortest focus window (minutes)" | "Prefilled into Setup for someone signing in for the first time; theirs to change after." / "Spans like 09:00-17:00; empty for a day off." / "A span like 12:00-12:30." (the demo's lunch reads "12:00-12:00") | text ×8, number ×3 | Default · `org.new_person` | `server/people.ts` (first sign-in) | the person's Working hours (#8–9) and At-risk blocks (#76–78), in other words |
| 199 | By level: "Break down offered", "Needs attention nudges" per level | "Each level's defaults; a person may change any of these for themselves (Settings › Day and Week, Reset to team default). They never block anything." | switch grid | Default by level · `org: level guidance` | `actions/story-actions.ts`, `ui/ahead/Gantt.tsx` | Settings › Day and Week › Guidance (#52–53) |

### Admin › Standards (`#/settings/admin-standards`)

| # | Label | Help | Control | Kind · stored | Read by |
|---|---|---|---|---|---|
| 200 | "Repo" | "A public https://github.com/<owner>/<repo> address." | text | Rule · `standards.repo_url` | `actions/standards.ts` |
| 201 | "Branch" | "Empty means the repo's default branch." | text | Rule · `standards.branch` | as above |
| 202 | "Last synced", "Last checked", "Budget"; "Sync now"; "Active articles (12)" table | | read-only, button, table | standards cache | as above |

### Admin › Status (`#/settings/admin-status`): a status page, nothing to set

| # | Part | Control |
|---|---|---|
| 203 | "This environment", "OpenAI key", "Send feedback", "Dataverse people and leads", "Teams and DevOps permissions" | read-only |
| 204 | "Jobs" (Read client chats, Delete chat messages nothing was found in, People levels and leads from Dataverse, Sign-in sweep and removals, Delete people's data) | table |
| 205 | "Background passes" | table |
| 206 | "DevOps" per client with "Check now" | table, buttons |
| 207 | "Client chats" per chat (Reading, Last poll, State, AI calls today) | table |
| 208 | "Conversations" ("Not available here." in the demo) | table |

### Admin › Audit (`#/settings/admin-audit`)

| # | Part | Control | Notes |
|---|---|---|---|
| 209 | Audit: "Everything" (area), "Filter by who, setting or client"; table When, Who, For, Setting, Was, Now, Note | select, text, table | settings shown by their code names ("client:Atlas/allow_ai", "person:<id>/automation"); "The last 200" |
| 210 | "Code views": "Every client", "Everyone"; table | selects, table | "Nothing yet." in a fresh demo |

## Counts

- Settings: 16 sections, 104 registry entries; on the pages, 146 numbered rows above (a row can hold several controls). 4 controls carry a `data-setting` that the registry doesn't list (`test-site`/`from-test-site`, `week-days`, `progress-offer`), so search can't find them; the client page's 12 rows have no ids at all.
- Admin: 8 parts, 64 rows above; Admin › Clients repeats its 16 rows for each client (6 in the demo's Customers view, 8 in All accounts), 264 inputs on one page.
- Saving: Settings saves by itself in 13 sections; Display applies without Saved or Undo; secrets, PATs, links and keys save with a button; Admin saves by itself.
