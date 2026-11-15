# NM-2 STEP 0.5: the pointers list

Every place the app's words send a person, found by scanning every string, template part and JSX text that the names check reads (and the Guide) for "Settings ›", "Admin ›", "More ›", "Inbox ›", "Backlog ›", "Week ›", "Day ›" (with › or >) and "in Team". The place's name is cut where the sentence goes on, so "Settings › Accounts" is "Settings › Accounts and calendars". The Renamed list (`ui/guide/retired.ts`) and the command menu's other names (`aka`) are old names by design and are left out.

Places that exist: Settings › Profile, Working hours, Notifications, Display, Day and Week, Focus, Backlog, Clients, Client chats, Accounts and calendars, DevOps, AI and assistant, Activity, Your data, About; Admin › Clients, AI, Conversations (Client chats after NM-2), People, Organization, Standards, Status, Audit; More › About, Admin, Code, Commands, Guide, Install app (where the browser can install), Keyboard shortcuts, Notifications, Send feedback, Settings, Status, Technical docs; Inbox › From chats, Promises, Captures; Backlog › Grid, Gantt, Needs attention, and its Filter; Day › Midday check-in and Close out.

| Where | Points at | Exists under that name? | Became |
|---|---|---|---|
| `actions/admin-actions.ts:84` | Admin › Organization | yes |  |
| `actions/admin-actions.ts:282` | Admin › Clients | yes |  |
| `actions/admin-actions.ts:609` | Admin › Status | yes |  |
| `actions/admin-actions.ts:710` | Settings › Your data | yes |  |
| `actions/collab-actions.ts:207` | Settings › Accounts | yes |  |
| `actions/collab-actions.ts:254` | Settings › Accounts | yes |  |
| `actions/conversation-actions.ts:1114` | Settings › Activity | yes |  |
| `actions/conversation-actions.ts:1460` | Settings › Activity | yes |  |
| `actions/conversation-actions.ts:1484` | Settings › Activity | yes |  |
| `actions/devops-write-actions.ts:157` | Settings › Activity | yes |  |
| `actions/devops-write-actions.ts:216` | Settings › DevOps | yes |  |
| `actions/devops-write-actions.ts:265` | Settings › DevOps | yes |  |
| `actions/devops-write-actions.ts:266` | Settings › DevOps | yes |  |
| `actions/devops-write-actions.ts:625` | More › Send feedback | yes |  |
| `actions/devops-write-actions.ts:654` | Inbox › From chats | yes |  |
| `actions/devops-write-actions.ts:656` | Inbox › Conversations | no: the Inbox has no Conversations list | It can show in Inbox › From chats again. |
| `actions/devops-write-actions.ts:1121` | Settings › Activity | yes |  |
| `actions/devops-write-actions.ts:1159` | Settings › Activity | yes |  |
| `actions/devops-write-actions.ts:1198` | Settings › Activity | yes |  |
| `actions/dispatch.ts:2703` | Admin › AI | yes |  |
| `actions/invite-send.ts:104` | Admin › Organization before sending | yes |  |
| `actions/item-card-actions.ts:92` | Settings › DevOps | yes |  |
| `actions/loop-actions.ts:215` | Settings › DevOps | yes |  |
| `actions/loop-actions.ts:578` | Settings › Activity | yes |  |
| `actions/meeting-actions.ts:152` | Admin › Status | yes |  |
| `actions/meeting-actions.ts:180` | Admin › AI | yes |  |
| `actions/meeting-actions.ts:322` | Admin › Status | yes |  |
| `actions/meeting-actions.ts:453` | Settings › DevOps first | yes |  |
| `actions/meeting-actions.ts:472` | Inbox › Captures | yes |  |
| `actions/notifier.ts:141` | Settings › Notifications | yes |  |
| `actions/patterns-run.ts:413` | Admin › AI | yes |  |
| `actions/patterns-run.ts:546` | Admin › AI | yes |  |
| `actions/patterns-run.ts:676` | Admin › AI | yes |  |
| `actions/patterns.ts:327` | Admin › Clients | yes |  |
| `actions/registry.ts:87` | Backlog › Gantt | yes |  |
| `actions/registry.ts:209` | Settings › Display | yes |  |
| `actions/registry.ts:243` | Inbox › From chats | yes |  |
| `actions/registry.ts:252` | Inbox › Promises | yes |  |
| `actions/registry.ts:266` | Inbox › Conversations | no (a summary nothing reads, but the check reads it) | Inbox › From chats |
| `actions/registry.ts:313` | Inbox › Promises | yes |  |
| `actions/registry.ts:324` | Settings › AI | yes |  |
| `actions/registry.ts:327` | Admin › Audit | yes |  |
| `actions/registry.ts:341` | Admin › Status | yes |  |
| `actions/registry.ts:343` | Settings › Accounts | yes |  |
| `actions/registry.ts:347` | Settings › Focus | yes |  |
| `actions/registry.ts:400` | Settings › DevOps | yes |  |
| `actions/registry.ts:421` | Admin › Clients | yes |  |
| `actions/registry.ts:442` | Admin › Clients | yes |  |
| `actions/request-actions.ts:315` | Settings › Activity | yes |  |
| `actions/setup-actions.ts:83` | Settings › DevOps | yes |  |
| `actions/story-actions.ts:130` | Admin › AI | yes |  |
| `actions/story-actions.ts:131` | Admin › AI | yes |  |
| `actions/story-actions.ts:399` | Admin › Clients | yes |  |
| `actions/timebox-actions.ts:172` | Settings › Accounts | yes |  |
| `actions/timer-actions.ts:160` | Settings › Focus | yes |  |
| `actions/vm-actions.ts:115` | Settings › You | no: Settings > You is Profile, and the VM is in Accounts and calendars | Settings › Accounts and calendars |
| `actions/vm-actions.ts:207` | Settings › Accounts | yes |  |
| `ai/types.ts:56` | Admin › AI | yes |  |
| `ai/types.ts:57` | Admin › AI | yes |  |
| `assistant/service.ts:77` | Inbox › Promises | yes |  |
| `assistant/service.ts:132` | Admin › AI | yes |  |
| `assistant/service.ts:133` | Admin › AI | yes |  |
| `assistant/service.ts:613` | Admin › Standards | yes |  |
| `assistant/service.ts:859` | in Team: Your teammates on this client, in Team | no: Team is hidden | Only you |
| `assistant/service.ts:893` | in Team: sees it in From your team; the client's leads see it in Team | no: From your team and Team are gone or hidden | sees it in To place, in a block's panel on Week |
| `assistant/service.ts:985` | Inbox › Captures | yes |  |
| `config/background-policy.ts:43` | Admin › Clients | yes |  |
| `config/background-policy.ts:51` | Settings › Notifications | yes |  |
| `config/background-policy.ts:52` | Settings › Notifications | yes |  |
| `config/background-policy.ts:53` | Settings › Notifications | yes |  |
| `config/starter.ts:21` | Settings › Clients | yes |  |
| `plan/caltier.ts:42` | Settings › Accounts | yes |  |
| `plan/caltier.ts:44` | Settings › Activity | yes |  |
| `plan/conversations.ts:789` | Admin › AI | yes |  |
| `plan/find-item.ts:105` | Admin › Clients | yes |  |
| `plan/find-item.ts:122` | Week › Plan | no: Week › Plan went with WD-1 | Add it to a block on Week. |
| `plan/invite.ts:71` | Settings › DevOps | yes |  |
| `plan/notify.ts:297` | in Team: nClick to open Team. | no: Team is hidden; the notice opens Week | Click to open Week. (Ask a lead to look is hidden, so this notice is no longer sent anew.) |
| `plan/patterns/scope.ts:117` | Admin › Clients | yes |  |
| `plan/patterns/scope.ts:118` | Admin › Clients | yes |  |
| `plan/patterns/scope.ts:119` | Admin › Clients | yes |  |
| `plan/permissions.ts:30` | Settings › Clients | no: chats are added by an admin in Admin › Clients, not in Settings › Clients | A FocusTime admin adds a client's chats in Admin › Clients |
| `public/legal.html:28` | Settings › Notifications | yes |  |
| `public/legal.html:34` | Settings › Your data | yes |  |
| `public/legal.html:34` | Settings › AI | yes |  |
| `server/admin-ops.ts:122` | Admin › Organization | yes |  |
| `server/teams/rhythm-cards.ts:64` | Settings › Notifications | yes |  |
| `server/teams/rhythm-cards.ts:287` | Inbox › Captures | yes |  |
| `sources/devops/write.ts:45` | Settings › DevOps | yes |  |
| `sources/devops/write.ts:54` | Settings › DevOps | yes |  |
| `sources/not-set-up.ts:8` | Settings › Accounts | yes |  |
| `sources/oauth/oauth.ts:269` | Settings › Accounts | yes |  |
| `sources/oauth/oauth.ts:276` | Settings › Accounts | yes |  |
| `ui/Account.tsx:786` | Settings › You | no: Settings > You is called Profile | Settings › Profile |
| `ui/Account.tsx:392` | Settings › Activity | yes |  |
| `ui/App.tsx:506` | Settings › Display | yes |  |
| `ui/App.tsx:1956` | Settings › Your data | yes |  |
| `ui/BlockPanel.tsx:261` | Settings › Day | yes |  |
| `ui/Conversations.tsx:227` | Settings › Clients | no: DevOps write access is in Settings › DevOps | Settings › DevOps |
| `ui/Day.tsx:652` | Inbox › Promises | yes |  |
| `ui/DayCalendar.tsx:78` | Inbox › Promises | yes |  |
| `ui/DevOpsWrite.tsx:432` | Settings › DevOps | yes |  |
| `ui/DevOpsWrite.tsx:308` | Settings › Activity | yes |  |
| `ui/DoneOffer.tsx:336` | Settings › Activity | yes |  |
| `ui/Feedback.tsx:242` | Settings › DevOps | yes |  |
| `ui/Notices.tsx:121` | Settings › Notifications | yes |  |
| `ui/Phone.tsx:149` | Settings › Notifications | yes |  |
| `ui/Settings.tsx:288` | Admin › Audit | yes |  |
| `ui/Settings.tsx:997` | Settings › Activity | yes |  |
| `ui/Settings.tsx:1144` | Inbox › Promises | yes |  |
| `ui/Settings.tsx:1620` | Admin › Clients | yes |  |
| `ui/Settings.tsx:858` | Backlog › Gantt | yes |  |
| `ui/Settings.tsx:1378` | More › Install app | yes |  |
| `ui/Setup.tsx:219` | Settings › Working hours | yes |  |
| `ui/Setup.tsx:284` | Settings › Clients | yes |  |
| `ui/Setup.tsx:507` | Settings › Setup | no: Setup is Run setup again, in Settings › Profile | Settings › Profile › Run setup again |
| `ui/Setup.tsx:507` | Settings › Setup runs this again whenever | no: Setup is Run setup again, in Settings › Profile | Settings › Profile › Run setup again |
| `ui/Status.tsx:644` | Settings › DevOps | yes |  |
| `ui/Status.tsx:771` | Settings › DevOps | yes |  |
| `ui/Status.tsx:1092` | Settings › Activity | yes |  |
| `ui/Team.tsx:383` | in Team: features in Team | no: Team is hidden | Ask a lead to look is hidden from the block panel; Team itself keeps it |
| `ui/TimeboxCheckin.tsx:287` | Settings › Activity | yes |  |
| `ui/Timeboxes.tsx:289` | Settings › Activity | yes |  |
| `ui/Timeboxes.tsx:375` | Settings › Activity | yes |  |
| `ui/Timeboxes.tsx:383` | Settings › Activity | yes |  |
| `ui/WrapUp.tsx:121` | Settings › DevOps | yes |  |
| `ui/WrapUp.tsx:439` | Settings › Activity | yes |  |
| `ui/ahead/Toolbar.tsx:82` | Admin › Clients | yes |  |
| `ui/ahead/Toolbar.tsx:83` | Admin › Clients | yes |  |
| `ui/guide/content.ts:43` | Settings › Day | yes |  |
| `ui/guide/content.ts:104` | More › Send feedback | yes |  |
| `ui/guide/content.ts:208` | Settings › Activity | yes |  |
| `ui/guide/content.ts:209` | Settings › Profile | yes |  |
| `ui/guide/content.ts:211` | Admin › AI | yes |  |
| `ui/guide/content.ts:211` | Settings › AI | yes |  |
| `ui/guide/content.ts:213` | Settings › DevOps | yes |  |
| `ui/guide/content.ts:222` | Settings › Day | yes |  |
| `ui/guide/content.ts:222` | Week › When I tick a story | yes |  |
| `ui/guide/content.ts:233` | Settings › Activity | yes |  |
| `ui/guide/content.ts:243` | Settings › Activity gives it back | yes |  |
| `ui/guide/content.ts:246` | Settings › Day | yes |  |
| `ui/guide/content.ts:251` | Settings › Display | yes |  |
| `ui/guide/content.ts:256` | Settings › Day | yes |  |
| `ui/guide/content.ts:262` | Settings › Activity | yes |  |
| `ui/guide/content.ts:277` | Settings › Backlog | yes |  |
| `ui/guide/content.ts:280` | Settings › Activity | yes |  |
| `ui/guide/content.ts:283` | Admin › Clients | yes |  |
| `ui/guide/content.ts:284` | Admin › People | yes |  |
| `ui/guide/content.ts:296` | Settings › Notifications can remind | yes |  |
| `ui/guide/content.ts:310` | Settings › Activity | yes |  |
| `ui/guide/content.ts:316` | Admin › AI | yes |  |
| `ui/guide/content.ts:318` | Admin › AI | yes |  |
| `ui/guide/content.ts:322` | Admin › Clients | yes |  |
| `ui/guide/content.ts:322` | Settings › Client chats | yes |  |
| `ui/guide/content.ts:337` | Settings › Activity | yes |  |
| `ui/guide/content.ts:339` | Admin › Clients | yes |  |
| `ui/guide/content.ts:348` | Settings › AI | yes |  |
| `ui/guide/content.ts:354` | Settings › AI | yes |  |
| `ui/guide/content.ts:361` | Settings › Notifications | yes |  |
| `ui/guide/content.ts:370` | Admin › Clients | yes |  |
| `ui/guide/content.ts:371` | Settings › Activity | yes |  |
| `ui/guide/content.ts:376` | More › Code | yes |  |
| `ui/guide/content.ts:377` | Admin › Audit | yes |  |
| `ui/guide/content.ts:390` | Settings › Display | yes |  |
| `ui/guide/content.ts:393` | More › Install app | yes |  |
| `ui/guide/content.ts:394` | More › Notifications | yes |  |
| `ui/guide/content.ts:394` | Settings › Notifications | yes |  |
| `ui/guide/content.ts:396` | Settings › DevOps | yes |  |
| `ui/guide/content.ts:397` | Settings › Accounts | yes |  |
| `ui/guide/content.ts:399` | Settings › Activity | yes |  |
| `ui/guide/content.ts:400` | Settings › Accounts | yes |  |
| `ui/guide/content.ts:401` | Settings › Your data | yes |  |
| `ui/guide/content.ts:404` | Admin › People | yes |  |
| `ui/guide/content.ts:405` | Admin › People | yes |  |
| `ui/guide/content.ts:406` | Admin › Clients under All accounts | yes |  |
| `ui/guide/content.ts:407` | Admin › People | yes |  |
| `ui/guide/content.ts:408` | More › Send feedback | yes |  |
| `ui/guide/content.ts:408` | Settings › DevOps first | yes |  |
| `ui/guide/content.ts:410` | More › About | yes |  |
| `ui/guide/content.ts:576` | More › Code | yes |  |
| `ui/guide/content.ts:589` | Admin › People | yes |  |
| `ui/guide/content.ts:590` | More › Send feedback | yes |  |
| `ui/keys.ts:140` | Day › Midday check-in | yes |  |
| `ui/keys.ts:141` | Day › Close out | yes |  |
| `ui/meetings/Meetings.tsx:57` | Admin › Clients | yes |  |
| `ui/meetings/Meetings.tsx:175` | Settings › DevOps first | yes |  |
| `ui/meetings/Meetings.tsx:159` | Settings › Activity | yes |  |
| `ui/menu.ts:778` | Settings › Activity | yes |  |
| `ui/menu.ts:1169` | Settings › Focus | yes |  |
| `ui/menu.ts:1216` | Admin › Clients | yes |  |
| `ui/menu.ts:1730` | Inbox › From chats | yes |  |
| `ui/menu.ts:1731` | Inbox › From chats | yes |  |
| `ui/menu.ts:1732` | Inbox › From chats | yes |  |
| `ui/menu.ts:1733` | Inbox › Promises | yes |  |
| `ui/menu.ts:1745` | Week › Status | yes |  |
| `ui/menu.ts:1747` | Inbox › From chats | yes |  |
| `ui/menu.ts:1752` | Week › Plan | yes |  |
| `ui/menu.ts:1753` | Backlog › Gantt | yes |  |
| `ui/menu.ts:1755` | Backlog › Needs attention | yes |  |
| `ui/menu.ts:1757` | Day › Midday check-in | yes |  |
| `ui/menu.ts:1758` | Day › Close out | yes |  |
| `ui/patterns/Patterns.tsx:47` | Admin › Clients | yes |  |
| `ui/patterns/Patterns.tsx:238` | Admin › Clients | yes |  |
| `ui/patterns/Patterns.tsx:240` | Admin › Clients | yes |  |
| `ui/patterns/Patterns.tsx:300` | Admin › Clients too | yes |  |
| `ui/patterns/Patterns.tsx:449` | Admin › Clients | yes |  |
| `ui/settings/Admin.tsx:338` | Admin › People | yes |  |
| `ui/settings/Admin.tsx:424` | Admin › Audit | yes |  |
| `ui/settings/Admin.tsx:732` | Settings › Client chats | yes |  |
| `ui/settings/Admin.tsx:742` | Inbox › Conversations | yes |  |
| `ui/settings/Admin.tsx:797` | Admin › Audit | yes |  |
| `ui/settings/Admin.tsx:890` | Admin › Audit | yes |  |
| `ui/settings/Admin.tsx:1189` | Admin › Audit | yes |  |
| `ui/settings/Admin.tsx:1305` | Settings › Day | yes |  |
| `ui/settings/Admin.tsx:290` | Admin › Status | yes |  |
| `ui/settings/Admin.tsx:291` | Admin › People | yes |  |
| `ui/settings/Admin.tsx:853` | Admin › Organization | yes |  |
| `ui/settings/Admin.tsx:1402` | Settings › Accounts | yes |  |
| `ui/settings/Admin.tsx:1402` | Settings › DevOps | yes |  |
| `ui/settings/CalendarLinks.tsx:361` | Settings › Calendar | yes: Outlook's own Settings, not FocusTime's (allowed by the check, with its reason) |  |
| `ui/settings/DeliveryChats.tsx:116` | Settings › Accounts | yes |  |
| `ui/settings/DeliveryChats.tsx:154` | Admin › Clients | yes |  |
| `plan/notify.ts:287` | Click to open Conversations. / Open Conversations (an Urgent request notice) | no: the place is Inbox › From chats | Click to open From chats. / Open From chats |
| `ui/Team.tsx:97` | Everyone on <client> sees it at the top of Plan (Make it a client priority) | no: Plan went with WD-1; priorities show under To place in a block's panel | Everyone on <client> sees it in To place, in a block's panel on Week |
| `ui/settings/Admin.tsx:742` | In Inbox › Conversations › Closed (Closed conversations stay shown) | no | The rule is hidden (settings table) |
| `ui/guide/content.ts:322` | Admin › Clients, on a client, Delivery chats, then Add a chat | the group is named Client chats after NM-2 | Client chats |
| `ui/guide/content.ts:403` | Admin … holds Clients, AI, Conversations, People … | the section is named Client chats after NM-2 | Client chats |
