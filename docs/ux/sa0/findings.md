# SA-0 findings: Settings and Admin as they are

Counted at `ee05bd15` in the demo (dark; 1440 by 900 and 390 by 844 with iPhone conditions), measured from the page and checked in the code. No redesign here: where something reads as a question, it is in part 10. Pictures are named as in [pictures.md](pictures.md) (`settings/…` and `states/…` on the `shots/sa0` branch). Every row in [inventory.md](inventory.md) is numbered; `#n` points there.

How it was measured: a script opened every section and Admin part, grew the window to the panel body's full height, and read every visible element's tag, class, font size, weight, height, hit box, colour and contrast, every `data-setting`, and every help line's rendered line count. "Kinds" below are distinct combinations of tag, class, font size and weight; two rows drawn by the same component with the same look count once.

## 1. Layout

| Thing | Kinds | Counts (1440, admin, all sections) | Example of each, with where it is drawn |
|---|---|---|---|
| Section heading | 1 | 24 pages | the panel title, `ui/PanelShell.tsx` |
| Group heading | 3 | `h3` 69, `.set-ai-h` 6, `.set-sub` 9 | `h3` from `Group` (`ui/Settings.tsx:143`); `.set-ai-h` only in AI and assistant (`ui/Settings.tsx:1701`); `.set-sub` in Notifications' groups |
| Sub heading inside a group | 7 | `h4` at 13 px and at 15 px, `legend` at 12 px and 13 px, `summary` in 3 styles | `legend` 12 px for radio groups (`ui/styles.css` `.set-choice legend`), `h4` 15 px in Notifications › In FocusTime, `summary` as "What is sent" (AI), "Not followed · 2" (Clients) and "Not Cooptimizers (2)" (People) |
| Field label | 3 | `.set-label` 12 px / 500 (most), `.set-label` 13 px / 600 (Admin's `AField`, `ui/settings/Admin.tsx:123`), `.set-notify-name` (Notifications' switch rows) | `settings/05-planning-desk-admin.png` against `settings/21-admin-organization-desk-admin.png` |
| Help line | 19 class or inline-style variants at 11, 12 and 13 px | `.set-hint` used 29 times in `ui/Settings.tsx` and 15 in `Admin.tsx`, plus `.muted`, `p.set-intro`, `.set-notify-hint`, `.cal-link-hint`, `.adm-hint`, inline `style` | `.set-hint` 12 px under a field (`ui/Settings.tsx:127`); `p.muted` 13 px as a group intro (Client chats); `.set-notify-hint` 11 px beside a switch (Notifications) |
| Row (one setting) | 19 | `tr` 128, `.adm-field` 83, `label.set-field` 64, `div.set-field` 45, `.set-notify-row` 21, `.readonly` 18, `.source` 16, and 12 more with under 10 each | `label.set-field` (`Field`, `ui/Settings.tsx:122`), `div.set-field` (`ReadOnly`, `ui/Settings.tsx:132`), `.set-notify-row` (a switch with its line beside it), `.adm-field` (Admin's `AField`) |
| Button row | 11 | | "Check and save" + "Turn off" (DevOps), "Clear it" + "Keep it" (AI), "Reset" + "Cancel" (Your data), "Check link" + "Save calendar" (calendar link form), a lone "Add" right of a list, "Undo" + "Retry" in tables, … |
| Table | 9 classes | `.wl-table` (Activity), `.adm-table`, `.adm-people`, `.adm-setup`, `.adm-levels`, `.adm-types`, `.ai-log`, `.std-articles`, `.adm-status` | Activity's write log against Admin › People's table (`settings/14-activity-desk-admin.png`, `settings/20-admin-people-desk-admin.png`) |
| Button look | 21 | heights 17, 24, 28, 29, 32 and 46 px | 17 px: link-style "Reset to team default"; 24: `.mini`; 28: `.mini quiet`; 32: primary "Check and save"; 46: the swatches' "Use" |

Spacing breaks seen in the pictures:

- A group's intro line touches the grid under it on Profile (`settings/01-you-desk-admin.png`).
- Three fields in Day and Week have no gap after the help line above them: "Suggest work for empty blocks", "When I tick a story" and "Offer DevOps updates at end of day" (`states/saved-mark-phone.png`; `ui/Settings.tsx:731`, `:746`).
- "Saved" is drawn between a switch and its help line, so the help line moves down 24 px each time something saves (`states/saved-mark-phone.png`).
- On a client's page the coloured edge of the card stops above "Data platform"; the last three rows sit outside it (`settings/09-client-Atlas-desk-admin.png`, `ui/Settings.tsx:1598`).
- In Admin › Clients each card's edge stops after "Cooptimize's work in this project"; "What Needs attention counts" to "House style" hang below it, so the next client's card seems to start early (`states/admin-client-card-desk.png`, `ui/settings/Admin.tsx:277`).

## 2. Controls

**The same kind of choice drawn with different controls.** There are 5 two-way choices drawn 4 ways:

- a checkbox switch: most on and off settings;
- a radio pair: "When I tick a story", `ui/Settings.tsx:731`;
- a select: "Quiet", which has two values, and "Plain focus sets", two values;
- a segmented row of buttons: "Data platform", and Admin › Clients' "Customers · All accounts".

Pick-one lists of 3 are radios in Display (Theme, Text size, Timelines) and a select everywhere else ("Count unsized work as", "When a break starts", "Default length").

**Switches whose words describe the off state, or the other state.**

| Where | Words | Ticked means |
|---|---|---|
| Day and Week › Timeboxes `#69` | "Don't ask again for my own timeboxes", help "Off: no question…" | don't ask. The registry calls it "Ask before changing my own timebox events", the opposite. `ui/Settings.tsx:890` |
| Admin › AI › Per client `#168` | the text beside the switch is "Allowed" or "Off", "On" or "Off" | the word changes with the state, so the label never says what the switch is (`ui/settings/Admin.tsx:663`, `:670`, `:677`) |
| Admin › AI › Processing tier `#167` | "Flex" whether ticked or not | Flex, with Standard as the unticked state, never named by the switch (`ui/settings/Admin.tsx:592`) |
| Admin › AI `#163` | "AI on" | AI on, with the label always reading "on" |
| Notifications `#30` | "Let urgent requests through", help "Off: an urgent request waits…" | through; the help explains off first |
| Notifications `#37` | "Let FocusTime message me in Teams", help "Off: FocusTime only answers…" | the same pattern |

Help that explains the off state first ("Off: …") is used 4 times; "On: …" first, once (the test site switch).

**The label repeated as the switch's own words: 6.**
- "Use timeboxing" / "Use timeboxing" (`ui/Settings.tsx:878`).
- "Start without a preview" twice.
- "Start my VM before my day" twice (`ui/Account.tsx:842`, `:903`).
- "My VM" as the group heading, then "My VM" as the label (`ui/Account.tsx:581`).
- "Personal events" / "Show personal events on Week and Day".
- "Motion" / "Reduce motion".

Most other switches pair a field label with a short verb ("Suggest", "Offer", "Play a sound").

**Button place and weight differ between sections.**
- "Check and save" is a primary outlined button in DevOps and Pocket.
- The same action in the calendar form is "Check link", then "Save calendar".
- "Turn off" (DevOps) and "Forget" (My VM) are `.mini quiet`, the same weight as "Retry".
- "Remove" sits at the right end of a row in standing blocks, playlists and calendar links, but in Admin › People it is in the last table column, while its confirm opens at the foot of the page.
- "Reset to team default" is a 17 px text link, and only shows after you change the value.

**Destructive actions and how each asks: 14 actions, 5 ways.**

| Action | Where | How it asks |
|---|---|---|
| Delete my data | Your data | type "delete" (`ui/Settings.tsx:2120`; `states/confirm-delete-desk.png`) |
| Reset my plan | Your data | type "reset" (`ui/Settings.tsx:2012`; `states/confirm-reset-desk.png`) |
| Remove a person | Admin › People | type the person's name, in a panel at the foot of the page, far from the row (`ui/settings/Admin.tsx:1145`; `states/admin-remove-person-desk.png`) |
| Clear assistant history | AI and assistant | inline "Clear it" / "Keep it" (`ui/Settings.tsx:2086`; `states/confirm-clear-assistant-desk.png`) |
| Turn AI off for everyone | Admin › AI | inline box (`ui/settings/Admin.tsx:544`; `states/admin-ai-off-confirm-desk.png`) |
| Remove a calendar link | Accounts | inline "Remove <name>? Its link and its N stored events are deleted." (`ui/settings/CalendarLinks.tsx:133`) |
| Disconnect Pocket | Accounts | inline (`states/pocket-disconnect-confirm-desk.png`) |
| Disconnect Outlook or Google | Accounts | the browser's own `confirm()` box (`ui/App.tsx:1270`) |
| Delete stored messages | client page, Admin › Clients | the browser's own `confirm()`, for everyone on the chats (`ui/settings/DeliveryChats.tsx:175`) |
| Turn off DevOps writes | DevOps | no ask, no Undo; the PAT is deleted (`ui/Settings.tsx:1935`; `states/devops-turn-off-in-demo-desk.png`) |
| Forget my VM | Accounts | no ask (`ui/Account.tsx:588`) |
| Remove a registered chat | Admin › Clients | no ask, a toast "Removed …" (`ui/settings/DeliveryChats.tsx:163`) |
| Use usual hours (clear a one-day change) | Working hours | no ask, no Undo (`ui/Settings.tsx:600`) |
| Start over | Profile › Setup (not prod) | no ask (`ui/Settings.tsx:1956`) |

## 3. Saving: 7 ways, and 4 ways to say it saved

| Way | Where | Says |
|---|---|---|
| By itself: switches, choices and selects at once; text and numbers on leaving the field or Enter | 13 Settings sections, all of Admin (`ui/settings/autosave.tsx:7`) | "Saved" by the field for 2 s, and an Undo toast "<label> saved · Undo" for 8 s |
| Applies at once with no mark | Display (`#45–50`) | nothing: the page changes. No Saved and no Undo |
| A list saved whole on each Add or Remove | standing blocks, People I exclude, playlists | "Saved" once at the foot of the list |
| One "Saved" for a group | Notifications' kinds | one mark at the group's foot, not by the switch that changed |
| A button that checks and then saves | DevOps PAT, Pocket key, calendar link, Find my VM | a line in the row ("On · as …", "Connected", "Turned off. The PAT was removed from the keyring") |
| A button that acts | Test notification, Test AI, Check again, Sync now, Refresh from Dataverse | a result line beside the button |
| Its own action, outside autosave | Data platform and Deployment items (`#105`) | the change shows; no Saved, no Undo, no Rule badge |

Where saving trips up:
- On the phone the Undo toast is drawn at `bottom: 20px` (`ui/styles.css:1329`), under the bottom tab bar and the + button, so it can't be read or pressed (`states/saved-mark-phone.png`). The Undo was offered but couldn't be reached by a script either.
- The Undo toast uses old or code-side names for some fields: "Reminder", "Check-in reminder", "Thursday nudge" (`PLANNING_LABELS`, `ui/Settings.tsx:666`), where the page says "Add work reminder (minutes after the day starts)", "Midday check-in reminder…", "Thursday".
- Admin › Status and Admin › Audit carry the line "Team settings for everyone in FocusTime. Changes save as you make them and are logged in Admin › Audit." (`ui/Settings.tsx:289`). Neither page has anything to change.

## 4. Words

Checked against the glossary in CLAUDE.md, `docs/design/wording.md` and its Renamed table.

**Old names still shown:**
- "Check-in" as a notification kind (`plan/notify.ts:22`). The glossary says "Midday check-in" since NV-1, and Teams' list beside it already says "Midday check-in" (`plan/teams-rhythm.ts:40`).
- "Check-in reminder", "Reminder" and "Thursday nudge" in Undo toasts (above).
- The glossary's Admin row still lists "Conversations"; the page is "Client chats" (`#/settings/admin-conversations` keeps the old id).

**One thing with two names: 9.**

| Settings says | Admin or elsewhere says |
|---|---|
| "Team acknowledgements" (`ui/Settings.tsx:1135`) | "Thanks and short replies" (`ui/settings/Admin.tsx:715`) |
| "Team promise phrases" | "Commitment phrases" (`ui/settings/Admin.tsx:716`) |
| "Invites go only to" (`ui/Settings.tsx:953`) | "Help invites go only to" (`ui/settings/Admin.tsx:1219`) |
| "Never suggested, for everyone" (`ui/Settings.tsx:932`) | "Never suggested as helpers or Who" (`ui/settings/Admin.tsx:1222`) |
| "Watch at (minutes of meetings)", "At risk at…", "Shortest useful focus window" | New people: "Meeting watch (minutes)", "Meeting at risk (minutes)", "Shortest focus window (minutes)" |
| "Your level": "Lead consultant" | the Dataverse position "Lead Consultant" in Positions to levels |
| Notifications "Check-in" | Teams "Midday check-in"; Day and Week "Midday check-in reminder" |
| registry "Ask before changing my own timebox events" | page "Don't ask again for my own timeboxes" (opposite sense) |
| registry labels (search results, deep links) | page labels: 41 of the 104 registry entries are named differently on the page, e.g. "Quiet hours" / "Quiet", "Show demo data" / "Demo mode", "Help session length" / "Default length" |

"Watch" names two things in two sections: a block's state from meeting minutes (Day and Week › At-risk blocks) and a feature's state near its target (Backlog › "Watch within (weeks)").

The status of a source is "live" in lower case. DevOps writes say "On" with a capital.

**Help longer than two lines:** 6 of 328 help lines at 1440, and 123 of 328 at 390. The longest at 390:
- the Client chats intro: 15 lines, 8 sentences;
- AI's "What is sent": 10 lines;
- the calendar link intro: 7 lines;
- the Admin › Standards intro: 7 lines;
- Days on Week's help: 6 lines.

**Labels that need their help to be understood:**
- "Quiet", which doesn't say quiet for what.
- "Days off", a switch row with no verb.
- "Offer" and "Suggest", which are verbs with no object.
- "Default length", which doesn't say of what; the group says "Help sessions".
- "Reading" and "Write access" in DevOps.
- "Motion".
- "Background types", "Flex", "Model". Model has no help at all (`ui/settings/Admin.tsx:626`).

**Code names shown to people:**
- Admin › Audit lists settings as `client:Atlas/allow_ai`, `person:<uuid>/automation`, `org.never_suggest` (`states/admin-audit-rows-desk.png`).
- Accounts lists Microsoft scope names: "Chat.ReadBasic", "OnlineMeetingTranscript.Read.All", "user_impersonation" (`#117`).

**A sentence that may disagree with a hard rule:** My VM's help says FocusTime "stops it only when you press Stop and confirm" (`ui/Account.tsx:585`). CLAUDE.md's hard rule says "FocusTime never stops a VM". It is unclear which is current. A later VM step may have changed it; see part 10.

## 5. Size

Screens are the page's full height divided by one screen (900 px or 844 px). Settings counts are the registry entries in that section; client page and Admin counts are inputs on the page.

| Section | 1440 | 390 | 390 at Larger | Settings |
|---|---|---|---|---|
| Profile | 1 | 1.2 | 1.5 | 6 |
| Working hours | 1 | 1.8 | 2.2 | 5 |
| Notifications | 2.9 | 5.8 | 7.4 | 11 (41 switches and fields) |
| Display | 1 | 1.2 | 1.5 | 6 |
| Day and Week | 2 | 5 | 6.4 | 24 |
| Focus | 1.1 | 2.2 | 2.7 | 11 |
| Backlog | 1 | 1 | 1 | 3 |
| Clients | 1 | 1 | 1 | 2 |
| A client's page | 1.9 | 4.5 | 5.2 | 27 inputs |
| Client chats | 1 | 2 | 2.7 | 5 |
| Accounts and calendars | 3 | 6 | 7.9 | 10 |
| DevOps | 1.2 | 2.7 | 3.5 | 3 |
| AI and assistant | 1 | 1.4 | 1.7 | 7 |
| Activity | 1 | 1.5 | 2 | 5 |
| Your data | 1 | 1.5 | 1.9 | 6 |
| About | 1 | 1 | 1 | 3 |
| Admin › Clients | 15.6 | 34.2 | 42.3 | 264 inputs, 310 buttons |
| Admin › AI | 1.6 | 2.8 | 3.5 | |
| Admin › Client chats | 1 | 1.4 | 1.7 | |
| Admin › People | 2.7 | 4.5 | 5.5 | |
| Admin › Organization | 1.4 | 3.4 | 4.2 | |
| Admin › Standards | 1.1 | 2.2 | 2.8 | |
| Admin › Status | 1.8 | 4.1 | 5.3 | |
| Admin › Audit | 1.4 | 3 | 3.7 | |

- Settings: 104 registry entries in 16 sections; 146 rows in the inventory.
- Admin: 64 rows, with the Clients card repeated per client.
- Admin › Clients is one page with every client's card open, one under the other, and no way to jump to a client. At 390 it is 34 screens long; the picture stops at the 20,000 px browser limit.

## 6. Dead and double

**Settings nothing reads**, found by grep over `actions/ plan/ week/ server/ ui/ ai/ assistant/ sources/ store/` for the key in camelCase and snake_case, leaving out tests and the Settings screens:

| Setting | Stored as | What the search found |
|---|---|---|
| "Plan up to" | `[guidance] plan_share` (`config/settings.ts:300`) | no reader and no screen; already listed for clean-up in `docs/ux/td2/open-for-owner.md` |
| keep open | `[keep_open]` (`config/settings.ts:9`) | a settingsEdit section with no screen and no reader found |
| "Keep people's data (years)" (`#183`) | `org.retention_years` | only Admin › Status's Jobs row, which says "Not enforced yet" (`actions/admin-actions.ts:114`). Its help says "Shown to everyone", but no Settings page shows it |
| "Look ahead" asks (`look_ask`, `look_reply`) | `[notify]` | kept on purpose and skipped by the reader (`plan/notify.ts:13`) |

**Read, but nowhere to change it:**
- `conv.closed_shown_days` ("Closed conversations stay shown"). It is hidden since NM-2 but still read (`config/org.ts:261`, `actions/inbox-actions.ts:40`).
- Seven notice kinds are sent with no switch anywhere in Settings: "Someone took your story", "Work sent to your week", "Answers to work you sent", "A Must someone can't take", "Someone assigned you an item", "Someone moved your dates", "Someone edited your item". They are in `KIND_LABEL` (`plan/notify.ts:34–40`) and sent through `notifier.allows(...)` (`server/ticks.ts:527`, `:549`, `:552`), but Notifications draws only 15 of the 22 kinds.

**Repeats that can disagree: 9.**
- Close out time: Day and Week's "Close out reminder (minutes before the day ends)" is 15. Teams' "Close out … minutes before my day ends" is 30. They are two numbers for one moment and they differ out of the box (`#40`, `#64`).
- Midday check-in: "minutes after lunch" (0) against Teams' 12:00 PM (`#39`, `#63`).
- Reminder and nudge times are in Day and Week (`#62–65`). Their on and off switches are in Notifications (`#14–18`). With a time left empty, the switch is on with nothing to send.
- Status report: the in-app kind (off by default), the Teams kind, and "Status report times" are three places for one report (`#27`, `#29`, `#42`).
- Timelines: Display sets the default, and V changes the screen for the session only, so the two can disagree until a reload (`#47`).
- Days on Week: Display has "Show Friday" and "Show weekend". "Every weekend day" exists only under Week's View options (`#49`).
- Send feedback is shown three ways in the demo. Accounts says "Feature #496 (FocusTime (demo feature))". Admin › Organization has organization and project empty and parent feature 0. Admin › Status says "A pretend backlog in the demo" (`#122`, `#186–188`).
- Zero-length lunches in the demo: the person's Lunch read "12:30-12:30" in the walkthrough, and New people's lunch reads "12:00-12:00" (`#189–198`). That is a zero-length lunch.
- Admin › Clients has no Allow AI. It is only in Admin › AI's per-client table (`#168`), while every other per-client Rule is on the client's card.

**Values that can't differ from the default:**
- "Plain focus sets" is disabled while Teams status is off.
- All six Teams kinds and "Also on Fridays" are disabled while "Messages in Teams" is off.
- "Pause and resume music" is disabled where players can't be reached, which is the hosted app for everyone.
- "Also Sunday evening at" (time) is disabled until its switch is on.
- "Reset to team default" appears only after a change.

**Admin, developer or test things shown to everyone:**
- Profile: "Dataverse environment" (a URL, `ui/Settings.tsx:373`), "Dataverse user: Found", and the line "Your settings save … to Demo data (in memory, not your config file)" (`ui/Settings.tsx:377`).
- Notifications: the "This test site" group (`ui/Settings.tsx:1184`), shown in the local demo.
- Accounts: Microsoft permission scope names (`ui/Settings.tsx:1846`).
- Profile › Setup: "Start over" outside prod (`ui/Settings.tsx:1956`).
- Your data: "Demo mode" and "Reset demo"; About: "Style guide (developer loop)".
- A client's page: "Data platform" and "Deployment items" (team values without a Rule badge, editable by admins and the client's leads, `ui/Settings.tsx:1598`); "Delete stored messages" (for everyone on the chats, any member can press it, `actions/request-actions.ts:256`).

## 7. Finding things

Settings search (`searchSettings`, `ui/settings/registry.ts:220`) was run with 100 queries a person might type. There were 22 with no result:

> dark mode, language, password, vacation, weekend, privacy, what do you keep, pomodoro, rename client, unfollow, auto shutdown, gantt, shortcuts, keyboard, accessibility, contrast, deployment, data platform, code, who can read code, onboarding, estimate

Some of these have an answer on the page:
- "weekend" is Days on Week.
- "vacation" is Days off.
- "rename client" is Shown as.
- "unfollow" is Keep following.
- "dark mode" is Theme.
- "what do you keep" is Export or Delete my data.

Results that lead somewhere else:

| Query | Finds | Expected |
|---|---|---|
| "log out" | Outlook write log | Signed in › Sign out |
| "ai" | Profile › Email (a substring) | AI and assistant first |
| "admin" | AI for FocusTime | Admin |
| "audit" | Activity only | Admin › Audit |
| "push" | Assistant history | On your devices |

What search can't reach at all:
- Admin isn't in search (no registry entries).
- Four controls on the page have `data-setting` ids the registry doesn't list (`test-site`, `from-test-site`, `week-days`, `progress-offer`).
- A client's page has no ids.

Settings itself: the top bar's ⋯ menu lists Notifications, Calls, Commands, Guide, Technical docs, Keyboard shortcuts, Send feedback, Admin and About, but not Settings, which is only in the avatar's menu (the walkthrough's first guess, task 1). Admin › Client chats has no way to register a chat; that is on each client's card in Admin › Clients (task 8).

Settings a person would look for elsewhere first:
- Time zone: under Working hours, and Profile has a line pointing there.
- Text size: also Ctrl + and Ctrl −.
- Personal events: also G and View options.
- Suggestions: also View options.
- Teams: split across Notifications › In Teams, Focus › Teams status and Accounts › FocusTime in Teams.
- What FocusTime keeps about me: Your data (Export, Delete), AI's "What is sent", Activity, and Diagnostics, with no single page that says it.

## 8. Access

**Keyboard:** every clickable element found was focusable; none was a bare `div` with a click handler. Settings and Admin can be reached from the rail with Tab. The phone's rail is its own page.

**Hit boxes under 44 px at 390** (the style guide's phone target, `docs/design/style-guide.md`), by section:

| Section | Under 44 px |
|---|---|
| Display | 13 of 13 (radios 22 px) |
| Admin › Clients | 236 of 574 |
| Admin › AI | 23 of 28 |
| Admin › People | 19 of 45 |
| A client's page | 27 of 82 |
| Day and Week | 11 of 28 |
| Notifications | 8 of 41 |
| Focus | 7 of 12 |
| Admin › Standards | 7 of 15 |
| Accounts and calendars | 6 of 21 |
| Admin › Organization | 6 of 25 |
| Clients | 4 of 5 (rows 37 px) |
| Working hours | 3 of 15 |
| Admin › Audit | 3 of 4 |
| Profile, DevOps, AI and assistant, Your data, About | 1 each |
| Backlog, Client chats, Activity, Admin › Client chats, Admin › Status | 0 |

Selects and text inputs are 37 px, checkboxes 28 px, radios 22 px.

**Contrast below AA (4.5:1):** only the disabled "What FocusTime sends" group in Notifications, at 3.16:1 (`rgb(143,156,170)` on the panel). Disabled text is exempt, but this is the only place each Teams kind is explained, and it is disabled until "Messages in Teams" is on. Everything else passed.

**Clipping:**
- Nothing makes the whole page scroll sideways at 390 or at Larger.
- At 390, 7 tables are wider than the screen and scroll inside their box: AI's request log is 497 px, Admin › Clients' types table 624, Who's set up 602, By level 429, Standards' articles 720, Status 422, Audit 819.
- At Larger on 1440, Admin › People's table runs past the panel's right edge (26 cells; `larger/20-admin-people-desk-admin-larger.png`).
- At 390 the top bar's VM chip is cut to "VM S" (`states/saved-mark-phone.png`).

## 9. Admin

These are the steps the frequent tasks take, counted as clicks or fields from Settings' rail. The walkthrough's own count is in [walkthrough.md](walkthrough.md).

| Task | Steps | Path |
|---|---|---|
| Turn on Allow AI for one client | 3 | Admin › AI, scroll to Per client, the switch beside "Off" |
| Find who hasn't signed in | 3 | Admin › People › "Not signed in (1)" (`states/admin-not-signed-in-desk.png`) |
| See who opened a client's code | 3 | Admin › Audit, scroll past the settings audit to Code views, filter |
| Register a client chat | 5 or more | Admin › Clients, scroll to the client's card (no jump, up to 15 screens), Client chats › "Add a chat", search, pick (`states/admin-add-chat-desk.png`) |
| Register a client call | 7 or more | Admin › Clients, scroll to the card, Meetings › "Register a meeting", pick the series, then role, transcript source and reviewers (`states/admin-register-call-desk.png`) |
| Change a client's colour | 3 plus scrolling | Admin › Clients, the card, a swatch |
| Remove a person | 4 | Admin › People, Remove in the row, scroll to the foot of the page, type the name |

**Status page against settings:**
- Admin › Status (`#203–208`) and Admin › Audit (`#209–210`) set nothing, but sit in the same rail group as the settings and carry the "Changes save as you make them" line.
- Some status facts are shown again on settings pages: the poll interval in Settings › Client chats' intro, and the source states in the status bar and in Accounts.

**Admin things someone who isn't an admin needs or sees:**
- A client lead (not an admin) can edit Data platform and Deployment items on their client page (`#105`). These are team values with no Rule badge.
- Anyone who sees a client's chat can "Delete stored messages" for everyone on it (`#103`).
- People read "Set by your FocusTime admin" on 11 values (`#5`, `#73`, `#75`, `#100`, `#104`, `#108` ×3, `#126` ×3), but "Dataverse environment" (`#5`) is app config, so no admin can change it from Admin.
- An admin can reach none of Admin from Settings search.

## 10. Questions for the product owner

1. **Close out and Midday check-in times.** Each has two times, one for the in-app reminder and one for Teams. They differ out of the box (15 against 30 minutes; 0 after lunch against 12:00 PM). Should they be one time?
2. **The seven "someone did something" notices.** They are sent, but have no switch. Is that on purpose?
3. **My VM.** The help says FocusTime "stops it only when you press Stop and confirm", and CLAUDE.md says it never stops a VM. Which is current?
4. **"Keep people's data (years)".** Nothing enforces it and nobody but admins sees it, though its help says "Shown to everyone". Keep it on screen before it does anything?
5. **"Plan up to" (`plan_share`), `keep_open` and the hidden `conv.closed_shown_days`.** Remove them, or show them?
6. **Data platform and Deployment items.** These are team values, editable by a client's lead from their own Settings page with no Rule badge. Is that the intended place?
7. **Delete stored messages.** It deletes for everyone and any member of a chat can press it, behind the browser's own confirm. Is that intended?
8. **Admin › Clients.** It is one page of every client, open, at 15 screens on a computer and 34 on a phone. Is it used to jump to one client, or to compare across clients?
9. **Allow AI.** It lives only in Admin › AI, while every other per-client Rule is on the client's card. Which is the home for it?
10. **Status and Audit.** Should they stay in the Admin settings rail with the "Changes save as you make them" line?
11. **Test-site, developer and demo controls.** The test site group, Demo mode, Style guide, Start over, and the Dataverse environment URL are shown to everyone where they apply. Who are they for?
