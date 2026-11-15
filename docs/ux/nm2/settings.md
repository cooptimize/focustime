# NM-2 STEP 0.4: the settings table

Every setting in Settings (`ui/settings/registry.ts`, the rows a person can find and deep link to) and every rule and team default in Admin (`config/org.ts`), on `main` (eb6ed790): what reads it today, what a person would see change if they changed it, and a verdict.

- **live**: something reads it and a person sees the difference.
- **live, stale words**: it works, but its label or its description names something gone (a Requests list, a Closed list, Delivery chats).
- **nothing visible**: nothing a person can see changes when it changes.

How "what reads it" was found: each Settings field's stored key (`k="…"` in `ui/Settings.tsx`) was searched for outside Settings and the config code; every one has a reader in the server or in another screen. Where the reader changes nothing on screen, it is said in the row.

## Settings

| Section › setting | What reads it | What a person sees change | Verdict | Became |
|---|---|---|---|---|
| Profile › Signed in, Photos, Email, Dataverse user, Dataverse environment | the sign-in, Dataverse | read only facts | live | |
| Profile › Run setup again | Setup | Setup opens | live | |
| Working hours › Hours per day, Lunch, Time zone, One-day changes, Standing blocks | the week builder (`week/`) | blocks, half-day boundaries, Day's hours | live | |
| Notifications › What to notify me about | the notifier (`plan/notify.ts`); every kind shown has a sender in `server/ticks.ts` | that kind's notices stop or start | live | |
| Notifications › Status report times | `statusReport` tick | when Monday's report reminder comes | live | |
| Notifications › Urgent requests during focus | the notifier's focus hold (`asksThroughFocus`) | an Urgent request notice comes during focus instead of after | live | |
| Notifications › Quiet hours, Quiet on PTO days, Send a test notification, Notify this device, Show details in notifications | the notifier, push | when notices come, push on the device | live | |
| Notifications › Let FocusTime message me in Teams, What FocusTime sends in Teams | the Teams rhythm | the bot's messages | live | |
| Display › Theme, Text size, Timelines, Show personal events, Reduce motion | the app | the screens | live | |
| Day and Week › Your level | guidance defaults | Break down offered, nudges, plan share | live | |
| Day and Week › Offer Break down | `draftStories` | Break down on rows | live | |
| Day and Week › Needs attention nudges | `readinessNudges`, Backlog's Gantt | the flags on Gantt rows | live, stale words: its hint wrote the flag as a character ("The ⚑ flags in Backlog's Gantt") | Hint in words: "The readiness flags on Backlog's Gantt rows" |
| Day and Week › Count unsized work as, Shortest useful time per size, Carry-over, Suggest work for empty blocks, Add work reminder, When I tick a story, Midday check-in reminder, Close out reminder, Week nudges, Look-ahead rituals | the planning model, the tick's reminders, suggestions, Wrap it up | hours, suggestions, reminders | live | |
| Day and Week › Use timeboxing, Put timeboxes on Outlook, Ask before changing my own timebox events | timeboxes | + time, Outlook events, previews | live | |
| Day and Week › Help session length, Teams meeting for help sessions, Days to search for help, Never suggested, People I exclude, Invites go only to | Ask to collaborate | the finder's times and people | live | |
| Day and Week › At-risk blocks | the risk rules | At risk on cards | live | |
| Focus › every setting | the focus timer, Teams status, sounds, media | the timer, status, sound | live | |
| Backlog › Stale after, Stalled after, Watch within | Backlog | Stale and the Grid's states | live | |
| Clients › Keep following after focus time ends, Your clients | followed clients | which clients show | live | |
| Client chats (section) | | | live, stale words: "Your phrases for requests and promises" | "Your phrases for what clients ask and what you promise, and how each client chat is read." (old names Requests, Asks kept) |
| Client chats › My request phrases | `matchAsk` in the chat read (`actions/request-poll.ts`), then the AI's urgency check and the urgent notice (`server/ticks.ts` `asksTick`); also the grouping without AI | a client's message with one of them can bring an Urgent request notice | live, stale words: "becomes a request" (a list that is gone) | "My asking phrases", old name kept; the intro and hints say what they do now |
| Client chats › My acknowledgements | the same rules: a message that is only these is never checked | fewer messages checked | live, stale words ("is not a request") | Hint: "A message that is only these (and emoji) is never checked." |
| Client chats › My promise phrases | the chat read: my messages with one become my promises | Inbox › Promises | live | |
| Client chats › Team phrases | read only: the team's lists | | live, stale words ("Team request phrases") | "Team asking phrases" |
| Client chats › Client chats read for requests | the chats' read state | each chat's reading and polling | live, stale words ("for requests") | "Client chats FocusTime reads", old name kept |
| Accounts and calendars › every setting | sources, permissions, the VM, Teams, feedback | the sources and the VM | live | |
| Accounts and calendars › Microsoft permissions | `plan/permissions.ts` | each permission's note | live, stale words: Chat.ReadBasic's "Delivery chats"; Chat.Read's "Settings > Clients: Add a chat to allow it" (chats are added by an admin in Admin › Clients) | "Client chats: …"; "A FocusTime admin adds a client's chats in Admin › Clients" |
| DevOps › every setting | DevOps reads and writes | write access, find an item | live | |
| AI and assistant › every setting | the AI, Break down, the assistant | spend, history | live | |
| Activity, Your data, About › every row | logs, export, reset, delete, diagnostics, demo | | live | |

Nothing in Settings was found doing nothing a person can see, so nothing in Settings is hidden.

## Admin

| Section › rule | What reads it | What a person sees change | Verdict | Became |
|---|---|---|---|---|
| Clients › a client's chats ("Delivery chats") | the shared chat read | which chats are read for that client | live, stale words: Settings calls the same thing Client chats | "Client chats", with its description; the kinds Delivery team and Customer collaboration keep their names |
| Clients › every other client rule (Team color, Allow AI, Group messages without AI, Send attachments to AI, States treated as open, Other names, Match only as written, Data platform, Source systems, Deployment items, Types that don't need breakdown, Background types, House style, Treat as a client, Hide from FocusTime, Who can read this client's code, What Needs attention counts, Cooptimize's work in this project) | the client's reads, the AI, Backlog, Code | per client | live | |
| AI › AI for FocusTime, Model, caps, Background tasks on standard, Allow AI per client | the AI | AI on or off, spend | live; its emergency-off sentence said "request sorting" | "chat sorting" |
| Conversations (section) | | | live, stale words: holds the phrase lists and how client chats are read, and no conversations | Named "Client chats" (its address `admin-conversations` is unchanged) |
| Conversations › Request phrases | the chat read for everyone (the team's list), as in Settings | Urgent request notices | live, stale words ("becomes a request") | "Asking phrases" |
| Conversations › Thanks and short replies | the same rules | | live, stale words ("never a request") | "is never checked" |
| Conversations › Commitment phrases | promises found in chats | Inbox › Promises | live | |
| Conversations › Read client chats every (minutes) | the shared poll | how fresh From chats and promises are | live | |
| Conversations › Keep messages that aren't requests (days) | `purgeChatText` after each poll | stored chat text kept that long (what is deleted, not shown) | live, stale words ("requests") | "Keep chat messages nothing was found in (days)" |
| Conversations › Closed conversations stay shown (days) | `closedShownDays`: the Inbox read keeps done promises and closed conversations that long, and the Inbox's lists filter them out (Promises shows open ones; From chats only suggestions); the assistant's commitments read keeps closed ones that long | nothing: its hint names "Inbox › Conversations › Closed", which is gone | nothing visible | Hidden. Its value is kept and still read by both reads. Admin › Status's row "Closed conversations: Shown for N days after closing" goes with it. |
| Conversations › AI requests per chat per day | the chat AI cap | sorting stops at the cap | live | |
| People, Organization, Standards, Status, Audit › every rule | people, levels, domains, feedback, retention, idle, DevOps interval, Needs attention top N, standards, new people | | live | |
| Organization › By level (Break down offered, Needs attention nudges, Plan up to, Keep open for walk-ins) | guidance | | live | |
| Status › job rows | `actions/admin-actions.ts` | | live, except the Closed conversations row (above); "Sorting requests" names the AI task that checks client messages | "Checking client messages" |

## Notification kinds a person can switch

`look_ask` and `look_reply` (Ask a lead to look and its reply) are not shown as switches in Settings › Notifications on `main`, so hiding Ask a lead to look hides no setting. Every kind shown has a sender.
