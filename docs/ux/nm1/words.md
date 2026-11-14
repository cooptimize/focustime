# NM-1: the app's own words, before and after

STEP 0.3's list: every string a person can read that used a name on the retired list (`ui/guide/retired.ts`) or wrote a control as a character, with what it became. Comments in code are not on it.

How it was built. The new guard (`scripts/words-guard.ts`, `namesHits`) was written first and run on `main`: it reads every string, template part and run of JSX text in the app's code (`ui/`, `server/`, `assistant/`, `actions/`, `plan/`, `config/`, `week/`, `ai/`, `host/`, `store/`, the Teams scripts) and the public pages, and reported 121 lines. A second pass by hand added what a pattern can't see: old names in lower case ("captures and drafts", "the whole roadmap", "urgent asks"), paths written with ">" ("Settings > Data"), and pointers to a Settings section that has since moved (a write PAT is entered in Settings › DevOps, not Settings › Clients). Widening the scan to JSX text with brackets found two more lines later (the key list's footer and the iPhone note in Settings).

148 rows. "Words now" is `main` before this step; "Words proposed" is what the branch says. A row from `actions/registry.ts` shows the command's title or group (what the command menu shows) and its summary (not shown, kept in step).

| File and line (on main) | Words now | Words proposed |
|---|---|---|
| `actions/admin-actions.ts:710` | You can't remove yourself. Another admin can, or use Settings › Data › Delete my data. | You can't remove yourself. Another admin can, or use Settings › Your data › Delete my data. |
| `actions/collab-actions.ts:207` | Outlook didn't return free/busy. Try again, or reconnect Outlook in Settings > Connections | Outlook didn't return free/busy. Try again, or reconnect Outlook in Settings › Accounts and calendars |
| `actions/collab-actions.ts:254` | FocusTime can't send invites yet. Reconnect Outlook in Settings > Connections and allow calendar changes. | FocusTime can't send invites yet. Reconnect Outlook in Settings › Accounts and calendars and allow calendar changes. |
| `actions/conversation-actions.ts:1114` | #${id} was created in DevOps from this conversation. Undo it from Settings > Data > Audit log | #${id} was created in DevOps from this conversation. Undo it from Settings › Activity |
| `actions/conversation-actions.ts:1460` | #${id} was created in DevOps from this promise. Undo it from Settings > Data > Audit log | #${id} was created in DevOps from this promise. Undo it from Settings › Activity |
| `actions/conversation-actions.ts:1484` | #${k.itemId} was created in DevOps. Undo it from Settings > Data > Audit log | #${k.itemId} was created in DevOps. Undo it from Settings › Activity |
| `actions/devops-write-actions.ts:157` | may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one | may already be in DevOps. Retry it in Settings › Activity: it checks first and won't make a second one |
| `actions/devops-write-actions.ts:216` | DevOps writes aren't enabled for ${client}. Enter your own DevOps PAT in Settings > Clients > DevOps write access | DevOps writes aren't enabled for ${client}. Enter your own DevOps PAT in Settings › DevOps › Write access |
| `actions/devops-write-actions.ts:265` | ${clientName(clientKey)}'s DevOps organization changed. Enter the write PAT again in Settings > Clients | ${clientName(clientKey)}'s DevOps organization changed. Enter the write PAT again in Settings › DevOps |
| `actions/devops-write-actions.ts:625` | Feedback isn't sent again from here. Send it again from ⋯ › Send feedback | Feedback isn't sent again from here. Send it again from More › Send feedback |
| `actions/devops-write-actions.ts:654` | The request opens again in Inbox › Requests, for everyone on the chat. | The request opens again in Inbox › From chats, for everyone on the chat. |
| `actions/devops-write-actions.ts:1121` | may already be in DevOps. Retry it in Settings > Data > Audit log | may already be in DevOps. Retry it in Settings › Activity |
| `actions/devops-write-actions.ts:1159` | A create from this request may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one | A create from this request may already be in DevOps. Retry it in Settings › Activity: it checks first and won't make a second one |
| `actions/devops-write-actions.ts:1198` | A create from this conversation may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one | A create from this conversation may already be in DevOps. Retry it in Settings › Activity: it checks first and won't make a second one |
| `actions/dispatch.ts:2103` | Display (U5.1): show personal events on Week and Today. | Display (U5.1): show personal events on Week and Day. |
| `actions/dispatch.ts:2129` | Display (WK-2): the hour rail beside each card's to-dos on Week's Board. | Display (WK-2): the hour rail beside each card's to-dos on Week. |
| `actions/dispatch.ts:2138` | Display (TY-1): the Timeline switch on Today. | Display (TY-1): the Timeline switch on Day. |
| `actions/loop-actions.ts:215` | Enable DevOps writes for this client in Settings › Clients | Enable DevOps writes for this client in Settings › DevOps |
| `actions/loop-actions.ts:578` | ${res.message}. Retry it from Settings › Data › DevOps writes. | ${res.message}. Retry it from Settings › Activity. |
| `actions/meeting-actions.ts:453` | Enable DevOps writes for this client in Settings › Clients first | Enable DevOps writes for this client in Settings › DevOps first |
| `actions/meeting-actions.ts:472` | Saved as your draft: put it under a feature or epic in Inbox › Captures and drafts, then create it | Saved as your draft: put it under a feature or epic in Inbox › Captures, then create it |
| `actions/meeting-actions.ts:487` | In your Waiting on | Noted with this call |
| `actions/registry.ts:40` | Requests | From chats |
| `actions/registry.ts:87` | , title: "Plan ahead | , aka: ["Plan ahead"], title: "Backlog › Gantt: the next 12 weeks |
| `actions/registry.ts:194` | Whether a person's first Today offers the 2-minute tour; { done: true } once they open it or say Not now; kept per person in the plan store | Whether a person's first Day offers the 2-minute tour; { done: true } once they open it or say Not now; kept per person in the plan store |
| `actions/registry.ts:206` | The hours Week's rails and timelines show: business hours, 12 hours or 24 hours, for now; Settings > Display sets the default | The hours Week's rails and timelines show: business hours, 12 hours or 24 hours, for now; Settings › Display sets the default |
| `actions/registry.ts:209` | , title: "Timeline on Today", group: "Display", target: "none", shortcut: "B", summary: "Show or hide Today's hour timeline, where to-dos are timeboxed by dragging; off is the list; saved for you | , aka: ["Timeline on Today"], title: "Timeline on Day", group: "Display", target: "none", shortcut: "B", summary: "Show or hide Day's hour timeline, where to-dos are timeboxed by dragging; off is the list; saved for you |
| `actions/registry.ts:211` | Show or hide personal events on Week and Today; they still count in risk and free time; saved in config | Show or hide personal events on Week and Day; they still count in risk and free time; saved in config |
| `actions/registry.ts:221` | A plain timer, a break, or a to-do from its ⋯ menu; lengths in 5-minute steps | A plain timer, a break, or a to-do from its More menu; lengths in 5-minute steps |
| `actions/registry.ts:239` | , title: "Requests", group: "Requests", target: "none", summary: "Inbox › Requests: messages from people outside Cooptimize in your clients' registered chats, by client, newest first | , aka: ["Requests", "Asks"], title: "From chats", group: "From chats", target: "none", summary: "Inbox › From chats: messages from people outside Cooptimize in your clients' registered chats, by client, newest first |
| `actions/registry.ts:240` | Requests | From chats |
| `actions/registry.ts:241` | Requests | From chats |
| `actions/registry.ts:242` | Requests | From chats |
| `actions/registry.ts:243` | Requests | From chats |
| `actions/registry.ts:244` | Requests | From chats |
| `actions/registry.ts:246` | Requests | From chats |
| `actions/registry.ts:247` | Requests", target: "request", summary: "Show a request the AI said needs no action on the Requests tab anyway (or hide it again) | From chats", target: "request", summary: "Show a request the AI said needs no action in From chats anyway (or hide it again) |
| `actions/registry.ts:248` | Requests | Promises |
| `actions/registry.ts:249` | Requests | Promises |
| `actions/registry.ts:250` | Requests | Promises |
| `actions/registry.ts:251` | Requests | Promises |
| `actions/registry.ts:262` | Inbox › Conversations: what your clients' registered chats are talking about, one card per topic, in Needs you, Handled by teammates and Closed | Inbox › Conversations: what your clients' registered chats are talking about, one per topic, each with the list it is in |
| `actions/registry.ts:303` | Inbox items for Today and Week", group: "Inbox", target: "none", summary: "The Needs you count and the Inbox rows Today's urgent strip and Week's rail show (read only) | Inbox items for Day and Week", group: "Inbox", target: "none", summary: "The Inbox count and the Inbox rows Day's urgent strip and Week's rail show (read only) |
| `actions/registry.ts:304` | How many items need you: the Inbox badge, the same number as Needs you (read only) | How many items need you: the Inbox badge (read only) |
| `actions/registry.ts:310` | , title: "Add a promise to Today", group: "Conversations", target: "commitment", summary: "Shows the promise on Today until it's done | , aka: ["Add a promise to Today"], title: "Add a promise to Day", group: "Conversations", target: "commitment", summary: "Shows the promise on Day until it's done |
| `actions/registry.ts:339` | Every permission FocusTime asks Microsoft for, and whether it's allowed (Settings > Connections) | Every permission FocusTime asks Microsoft for, and whether it's allowed (Settings › Accounts and calendars) |
| `actions/registry.ts:343` | One of your saved Spotify or YouTube playlists (Settings > Focus) | One of your saved Spotify or YouTube playlists (Settings › Focus) |
| `actions/registry.ts:427` | Writes the previewed changes through the usual writes (read back, logged, Undo), adds the promises and Waiting on, and skips the rest | Writes the previewed changes through the usual writes (read back, logged, Undo), adds the promises, and skips the rest |
| `actions/request-actions.ts:315` | #${hit.r.itemId} was created in DevOps. Undo it from Settings > Data > Audit log; the request opens again | #${hit.r.itemId} was created in DevOps. Undo it from Settings › Activity; the request opens again |
| `actions/roadmap-actions.ts:151` | Plan ahead isn't available here | Backlog's Gantt isn't available here |
| `actions/setup-actions.ts:83` | FocusTime couldn't read your clients from Dataverse just now. You can skip this and add DevOps write access later in Settings > Clients. | FocusTime couldn't read your clients from Dataverse just now. You can skip this and add DevOps write access later in Settings › DevOps. |
| `actions/timebox-actions.ts:172` | FocusTime can't change your Outlook calendar yet. Reconnect Outlook in Settings > Connections and allow calendar changes. Your timeboxes still work locally. | FocusTime can't change your Outlook calendar yet. Reconnect Outlook in Settings › Accounts and calendars and allow calendar changes. Your timeboxes still work locally. |
| `actions/timer-actions.ts:160` | Breaks are set to 0 minutes in Settings > Planning | Breaks are set to 0 minutes in Settings › Focus |
| `assistant/answer.ts:206` | Ahead")) ? ", as far as I can tell (Ahead couldn't be read) | Backlog")) ? ", as far as I can tell (Backlog couldn't be read) |
| `assistant/answer.ts:207` | ahead | backlog |
| `assistant/reads.ts:46` | Open Today | Open Day |
| `assistant/reads.ts:73` | Follow-up: ${f.what}${f.who ? ` (${f.who})` : ""}${f.due! < d.today ? ", overdue" : ", due today"}`, link: d.link(`#/inbox/${f.id}`, "Open the follow-up | Promise: ${f.what}${f.who ? ` (${f.who})` : ""}${f.due! < d.today ? ", overdue" : ", due today"}`, link: d.link(`#/inbox/${f.id}`, "Open the promise |
| `config/org.ts:275` | Fix next looks at the top N of each backlog | Needs attention looks at the top N of each backlog |
| `config/org.ts:325` | Gaps Fix next counts | What Needs attention counts |
| `config/org.ts:345` | Readiness nudges in Plan ahead | Needs attention nudges |
| `config/settings.ts:248` | Roadmap states (step 17): Stalled after this many days without a story change; Watch when the forecast lands within this many weeks of the target date. | Backlog states (step 17): Stalled after this many days without a story change; Watch when the forecast lands within this many weeks of the target date. |
| `config/settings.ts:255` | Ahead (BH-1): an open item with no change in DevOps for this many weeks is stale in Backlog. | Backlog (BH-1): an open item with no change in DevOps for this many weeks is stale in Backlog. |
| `config/settings.ts:265` | Requests (AP-1, ADM-1): my own phrases, on top of the team's. | Client chats (AP-1, ADM-1): my own phrases, on top of the team's. |
| `plan/caltier.ts:42` | Allow calendar changes in Settings > Connections to edit Outlook events here | Allow calendar changes in Settings › Accounts and calendars to edit Outlook events here |
| `plan/caltier.ts:44` | A help invite with attendees: only cancelling is done from FocusTime (Undo in Settings > Data) | A help invite with attendees: only cancelling is done from FocusTime (Undo in Settings › Activity) |
| `plan/days.ts:24` | ${dayLabel(date)} has no working hours, so there is nothing to plan. Give it working hours (its ⋯ menu or Settings) or add a flex session | ${dayLabel(date)} has no working hours, so there is nothing to plan. Give it working hours (its Actions menu on Week, or Settings) or add a flex session |
| `plan/diagnostics.ts:30` | My promise exists but Promises and Needs you leave it out | My promise exists but the Inbox leaves it out |
| `plan/notify.ts:215` | Click to open Today. | Click to open Day. |
| `plan/notify.ts:255` | })}: look 8 to 12 weeks ahead.\nClick to open Plan ahead.`, buttons: [open("Plan ahead | })}: look 8 to 12 weeks ahead.\nClick to open Backlog's Gantt.`, buttons: [open("Open Gantt |
| `plan/permissions.ts:30` | Requests: new messages in the client chats registered in FocusTime, read for everyone on them who follows the client; read only, never posts | From chats: new messages in the client chats registered in FocusTime, read for everyone on them who follows the client; read only, never posts |
| `plan/push.ts:20` | Follow-ups due", body: "You have follow-ups due. | Promises due", body: "You have promises due. |
| `public/legal.html:34` | Settings › Data › Export my data gives you everything kept for you as a file. Delete my data signs you out and removes it: the Teams bot's records at once, everything else 30 days later. Settings › Data › Assistant history › Clear… | Settings › Your data › Export my data gives you everything kept for you as a file. Delete my data signs you out and removes it: the Teams bot's records at once, everything else 30 days later. Settings › AI and assistant › Assistan… |
| `scripts/teams-card-previews.ts:83` | Open in Ahead | Open in Backlog |
| `server/teams/rhythm-cards.ts:123` | } in Today | } on Day |
| `ui/App.tsx:153` | The week's blocks, with Add work beside them | Week: the week's blocks, with a block's panel beside them |
| `ui/App.tsx:154` | Features, epics and stories ahead: Grid, Gantt, Readiness and Backlog | Backlog: every client's DevOps on one screen: Grid, Gantt and Needs attention |
| `ui/App.tsx:155` | What needs you: promises, conversations, sends, captures and drafts | Inbox: From chats, Promises and Captures |
| `ui/App.tsx:156` | Monday's status report: this week's feature updates | Status: this week's feature updates for Monday's status report |
| `ui/App.tsx:1883` | Personal events are hidden on Week and Today. They still count in risk and free time. Click or press G to show them | Personal events are hidden on Week and Day. They still count in risk and free time. Click or press G to show them |
| `ui/App.tsx:2316` | Shows them until you leave Week; the setting is in Week's ⋯ | Shows them until you leave Week; the setting is under Week's View options |
| `ui/BlockPanel.tsx:261` | Timeboxing is off in Settings › Planning | Timeboxing is off in Settings › Day and Week |
| `ui/Checkin.tsx:114` | Requests still open after their urgency (now: 2 hours; this week: Friday) | Urgent requests still open after their urgency (now: 2 hours; this week: Friday) |
| `ui/CloseOut.tsx:259` | Back to Today (Esc)" : "Close out this day, then back to Today | Back to Day (Esc)" : "Close out this day, then back to Day |
| `ui/DevOpsWrite.tsx:432` | DevOps is read-only for this client until you add your own write PAT in Settings > Clients | DevOps is read-only for this client until you add your own write PAT in Settings › DevOps |
| `ui/DoneOffer.tsx:336` | }Undo is in Settings › Data. | }Undo is in Settings › Activity. |
| `ui/FocusScreen.tsx:49` | Back to Today | Back to Day |
| `ui/FocusScreen.tsx:104` | Back to Today (Esc); the timer keeps running | Back to Day (Esc); the timer keeps running |
| `ui/FocusScreen.tsx:105` | Back to Today, the timer keeps running | Back to Day, the timer keeps running |
| `ui/KeyLegend.tsx:43` | Every key is also a command menu entry (Ctrl K) or a ⋯ menu item. | Every key is also a command menu entry (Ctrl K) or an item in a More or Actions menu. |
| `ui/NewItem.tsx:194` | Kept on the block as a draft. Create it in DevOps from its ⋯, or drop it | Kept on the block as a draft. Create it in DevOps from its More menu, or drop it |
| `ui/PhoneShell.tsx:181` | Grid, Gantt, Gaps and Backlog need room for the whole roadmap. Open FocusTime on a computer to plan ahead. | Grid, Gantt and Needs attention need room for the whole backlog. Open FocusTime on a computer to plan ahead. |
| `ui/PhoneShell.tsx:187` | Back to Today | Back to Day |
| `ui/Settings.tsx:494` | With Show weekend on, weekend days show when something is on them (or always, with Every weekend day in Week's ⋯). A hidden day with to-dos or promises due, or today, gets a note on Week with Show. Day still steps through every da… | With Show weekend on, weekend days show when something is on them (or always, with Every weekend day under Week's View options). A hidden day with to-dos or promises due, or today, gets a note on Week with Show. Day still steps th… |
| `ui/Settings.tsx:600` | None. Set a day's own hours from its ⋯ menu in the week. | None. Set a day's own hours from its Actions menu on Week. |
| `ui/Settings.tsx:729` | Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it. Also in Week's and Day's ⋯ as Suggestions. | Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it. Also under Week's and Day's View options as Suggestions. |
| `ui/Settings.tsx:770` | Plan ahead rituals | Look-ahead rituals |
| `ui/Settings.tsx:813` | Readiness nudges | Needs attention nudges |
| `ui/Settings.tsx:835` | Readiness nudges" hint={<>The ⚑ flags in Plan ahead. Team default: {onOff(team.readinessNudges)}. {reset( | Needs attention nudges" hint={<>The ⚑ flags in Backlog's Gantt. Team default: {onOff(team.readinessNudges)}. {reset( |
| `ui/Settings.tsx:837` | Show readiness nudges | Show Needs attention nudges |
| `ui/Settings.tsx:858` | Both open Plan ahead; switch them in Notifications. | Both open Backlog › Gantt; switch them in Notifications. |
| `ui/Settings.tsx:1213` | Let urgent asks through | Let urgent requests through |
| `ui/Settings.tsx:1379` | On iPhone, add FocusTime to your home screen first (⋯ › Install app), then open it from there to turn this on. | On iPhone, add FocusTime to your home screen first (More › Install app), then open it from there to turn this on. |
| `ui/Status.tsx:1092` | Each line is its own write, logged in Settings &gt; Data with Undo. | Each line is its own write, logged in Settings › Activity with Undo. |
| `ui/StyleGuide.tsx:274` | Today and Week: four sizes and three weights. Uppercase only for section labels. | Day and Week: four sizes and three weights. Uppercase only for section labels. |
| `ui/TimeboxCheckin.tsx:287` | Undo is also in Settings › Data. | Undo is also in Settings › Activity. |
| `ui/Timeboxes.tsx:289` | Logged in Settings > Data. No undo: a first response can't be taken back." : "Logged in Settings > Data, with Undo. | Logged in Settings › Activity. No undo: a first response can't be taken back." : "Logged in Settings › Activity, with Undo. |
| `ui/WrapUp.tsx:439` | )}, in {offer.clientName}'s DevOps ({preview.previews[0]!.visibility}). Each only if the item hasn't changed since. Undo is in Settings › Data. | )}, in {offer.clientName}'s DevOps ({preview.previews[0]!.visibility}). Each only if the item hasn't changed since. Undo is in Settings › Activity. |
| `ui/keys.ts:103` | Move between blocks on Week and on Day (↓ from the afternoon reaches the evening); with the block panel open it follows | Move between blocks on Week and on Day (↓ from the afternoon reaches the evening); with the block's panel open it follows |
| `ui/keys.ts:105` | Close the block panel and go back to its block | Close the block's panel and go back to its block |
| `ui/keys.ts:110` | Actions (⋯) for what has focus | The More or Actions menu for what has focus |
| `ui/keys.ts:112` | Week: the week's blocks, with the block panel beside them | Week: the week's blocks, with a block's panel beside them |
| `ui/keys.ts:113` | Backlog: every client's DevOps on one screen, Grid and Gantt (was Ahead) | Backlog: every client's DevOps on one screen, Grid, Gantt and Needs attention |
| `ui/keys.ts:115` | Inbox: what needs you, in one list with views (Needs you, Promises, Waiting on, Captures and drafts and more) | Inbox: what needs you, in three lists: From chats, Promises and Captures |
| `ui/keys.ts:116` | Week with the block panel open (again: closed); on Backlog, Grid and Gantt (I also works) | Week with the block's panel open (again: closed); on Backlog, Grid and Gantt (I also works) |
| `ui/keys.ts:119` | Week with the block panel open; again to close it | Week with the block's panel open; again to close it |
| `ui/keys.ts:120` | Work from the block panel onto a block: it goes on. A to-do from a block onto the panel: it comes off the plan | Work from the block's panel onto a block: it goes on. A to-do from a block onto the panel: it comes off the plan |
| `ui/keys.ts:121` | In the block panel's Add box: move through the matches and take one. With no match, Enter makes a new to-do | In the block's panel, the Add box: move through the matches and take one. With no match, Enter makes a new to-do |
| `ui/keys.ts:128` | In Week: a row from Add work onto any block to place it there | In Week: a row from the block's panel onto any block to place it there |
| `ui/keys.ts:132` | Week: Timelines, the hours the rails show (business hours, 12 hours, 24 hours); H also works; also in Week's ⋯ | Week: Timelines, the hours the rails show (business hours, 12 hours, 24 hours); H also works; also under Week's View options |
| `ui/keys.ts:133` | Week: show or hide the timeline (the slim hour rail beside each card); also in the header and in ⋯ | Week: show or hide the timeline (the slim hour rail beside each card); also in the header and under View options |
| `ui/keys.ts:134` | Day: show or hide the timeline; also beside the header and in ⋯ | Day: show or hide the timeline; also beside the header and under View options |
| `ui/keys.ts:135` | Week and Day: show or hide personal events (they still count in risk and free time); also in ⋯ | Week and Day: show or hide personal events (they still count in risk and free time); also under View options |
| `ui/keys.ts:144` | Close the menu or dialog on top, or Add work; in a flow, back without saving | Close the menu or dialog on top, or the block's panel; in a flow, back without saving |
| `ui/meetings/Meetings.tsx:24` | Promises and Waiting on | Promises |
| `ui/meetings/Meetings.tsx:159` | Undo any DevOps change in Settings › Data. | Undo any DevOps change in Settings › Activity. |
| `ui/meetings/Meetings.tsx:175` | · Enable DevOps writes for this client in Settings › Clients first | · Enable DevOps writes for this client in Settings › DevOps first |
| `ui/meetings/Meetings.tsx:224` | in your Waiting on | noted with this call |
| `ui/meetings/Meetings.tsx:226` | Added to your Waiting on | Noted with this call |
| `ui/meetings/Meetings.tsx:294` | Promises and Waiting on | Promises |
| `ui/menu.ts:774` | Cancel it from Settings > Data (Undo) | Cancel it from Settings › Activity (Undo) |
| `ui/menu.ts:1165` | Breaks are set to 0 minutes in Settings > Planning | Breaks are set to 0 minutes in Settings › Focus |
| `ui/menu.ts:1422` | Shown next to Cooptimizers in Ask to collaborate, Who and Roadmap | Shown next to Cooptimizers in Ask to collaborate, Who and Backlog |
| `ui/settings/Admin.tsx:447` | ${c.key}: what Gaps counts | ${c.key}: what Needs attention counts |
| `ui/settings/Admin.tsx:450` | What Gaps counts | What Needs attention counts |
| `ui/settings/Admin.tsx:451` | ${c.key}: what Gaps counts | ${c.key}: what Needs attention counts |
| `ui/settings/Admin.tsx:1264` | Readiness top N | Needs attention top N |
| `ui/settings/Admin.tsx:1265` | Readiness top N | Needs attention top N |
| `ui/settings/Admin.tsx:1305` | Each level's defaults; a person may change any of these for themselves (Settings › Planning, Reset to team default). They never block anything. | Each level's defaults; a person may change any of these for themselves (Settings › Day and Week, Reset to team default). They never block anything. |
| `ui/settings/Admin.tsx:1311` | Readiness nudges | Needs attention nudges |
| `ui/settings/Admin.tsx:1325` | ${data.levelNames[lv]}: readiness nudges | ${data.levelNames[lv]}: Needs attention nudges |
| `ui/settings/Admin.tsx:1326` | Readiness nudges | Needs attention nudges |
| `ui/settings/Admin.tsx:1402` | Per person, in Settings › Connections (Microsoft permissions and DevOps write access). | Per person: Microsoft permissions in Settings › Accounts and calendars, DevOps write access in Settings › DevOps. |
| `ui/settings/AdminScope.tsx:61` | Ahead, Gaps and Week's lists show only these items of {name}, plus anything assigned to the person. Now: {s.words} | Backlog, Needs attention and Week's lists show only these items of {name}, plus anything assigned to the person. Now: {s.words} |
| `ui/settings/DeliveryChats.tsx:116` | FocusTime isn't allowed to read your Teams chat names and members yet. It needs the Microsoft permission Chat.ReadBasic: see Settings > Connections. | FocusTime isn't allowed to read your Teams chat names and members yet. It needs the Microsoft permission Chat.ReadBasic: see Settings › Accounts and calendars. |
| `ui/settings/registry.ts:38` | Today and Week", group: "planning", description: "How to-dos, rituals, timeboxes, help sessions and risk work when you plan.", old: [ | Day and Week", group: "planning", description: "How to-dos, rituals, timeboxes, help sessions and risk work when you plan.", old: ["Today and Week", |
| `ui/settings/registry.ts:96` | // Today and Week | // Day and Week |
| `ui/settings/registry.ts:99` | Readiness nudges", keywords: [ | Needs attention nudges", old: ["Readiness nudges"], keywords: [ |
| `ui/settings/registry.ts:109` | Plan ahead rituals", old: [ | Look-ahead rituals", old: ["Plan ahead rituals", |

Also changed with these: the Guide's sentences that quoted "Settings › Today and Week" (4, now "Settings › Day and Week"), the Guide's Backlog section address (`#/guide/backlog`; `#/guide/ahead` still opens it), and the Renamed list (`ui/guide/retired.ts`: "Settings › Planning" now points at Day and Week, and "Settings › Today and Week" has its own row).

## Where each old name can still be found

- Settings' search: `old` on the section or setting in `ui/settings/registry.ts` ("Today and Week", "Planning", "Readiness nudges", "Plan ahead rituals", "Let urgent asks through").
- The command menu: `aka` on the command ("Today", "Board", "roadmap", "ahead", "plan ahead", "fix next", "gaps", "readiness", "Plan today", "Plan the day", "Plan the week", "Timeline on Today", "Add a promise to Today", "Requests", "Asks", "Draft stories", "Needs help from").
- The Guide: one row per old name in Renamed, found by the Guide's search.

## Left as it was, and why

| Where | Words | Why |
|---|---|---|
| `ui/Day.tsx` | "Needs you", the phone's heading over Day's urgent lines | Plain words for what the lines are, not the Inbox's old view. On the allow list with that reason. |
| `plan/conversations.ts`, `actions/meeting-actions.ts` | "Waiting on <Name> · 1 day", "Waiting on <Name>" | A sentence about a person, not the old view. |
| "Loop closed", "Loop updates sent" | Results of Close the loop | Close the loop is the action's name today. |
| "Today" alone, "Today's …", "Today is …", "Today 4:07 PM" | The pill, the button, the quick date, stamps | The day that is today. |
| `ui/patterns/`, `plan/patterns/`, `actions/patterns.ts` | "Request types", "Readiness as written" | DevOps patterns' own words (a page only some people have). Not the retired work-template field or the old Backlog view. |
| `assistant/service.ts` | The assistant's glossary names old words ("called Ahead before") | It is how the assistant understands a person who still says them. Never shown. |
| `host/local/rename.ts`, `plan/timebox.ts`, `config/starter.ts` | "Coopilot" | The rename's own notice, the old marker text still recognised on Outlook events, and the names of two app registrations. |
| `actions/plan-actions.ts` | "Follow-up" as a to-do's stored type | A stored value. |
| `ui/Roadmap.tsx`, `plan/work-templates.ts` | "Roadmap", "the four lines" | Nothing draws either file any more (open question). Not scanned. |
| `scripts/demo-walkthrough.mjs`, `docs/demo/README.md`, `docs/demo/script.md` | Old tab and view names throughout | A walkthrough and a demo script written for the app on a past date; renaming words would not make their steps true (open question). Not scanned for names. |
| The command menu's groups and titles "Conversations", "Resolve a request", "Give a conversation…" | Commands from the Inbox before it was slimmed | Not on the retired list's patterns, and whether these commands should exist at all is not a wording question (open question). The group "Requests" became "From chats". |
| Admin › Clients: "Delivery chats" | The heading over a client's chats | Settings calls them Client chats. Not on the retired list; listed as an open question. |
| `server/teams/rhythm-cards.ts` | "Captured to sort later" | A sentence; "Sort later" as a kind's name is not used. |
