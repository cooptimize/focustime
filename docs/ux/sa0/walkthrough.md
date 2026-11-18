# SA-0 walkthrough: a first-week consultant, then an admin

A fresh agent did these tasks with nothing but the running demo. It was told not to read the code or the docs. It drove a browser at 1440 by 900 in dark mode, the way a person would: it looked at each screen, opened menus and clicked by visible words. The demo person is also an admin, so the admin tasks ran in the same session. Its pictures are on `shots/sa0` under `walkthrough/` (listed in [pictures.md](pictures.md)).

"Places" counts each screen it opened looking for the control, including the one where it found it.

## As a consultant

| # | Task | Looked first | Places | Done | Where it wasn't sure |
|---|---|---|---|---|---|
| 1 | Change working hours (Friday 9:00 to 13:00) | the top bar's ⋯ menu, which has no Settings entry | 3: ⋯, then the avatar menu, then Settings › Working hours | Yes. "9:00 to 13:00" was refused with "Use "HH:MM-HH:MM", e.g. "09:00-17:00""; "09:00-13:00" saved ("Friday hours saved. Undo") and stayed after a reload | The days have no heading, only "Like 09:00-17:00; a second span is an evening. Empty is a day off." Lunch showed "12:30-12:30". |
| 2 | Make notices quiet on days off | Settings › Notifications | 1, after scrolling | It was already on ("Quiet on days off") | The page opens with "This test site … It sends nothing on its own" and an unticked "Send me reminders and Teams messages from this test site". After that, the agent wasn't sure whether the switches below do anything. |
| 3 | Turn on writing to Outlook | Settings › Accounts and calendars: "Outlook calendar changes: Allowed…", with no control | 2: then Day and Week › Timeboxes › "Put on Outlook" / "On by default" | Yes, ticked and saved. Searching "outlook" lists both, plus the write log | Is "On by default" the switch, or only the starting value per timebox? "Asks for Calendars.ReadWrite only when you reconnect here" has no Reconnect button beside it. |
| 4 | Give DevOps write access for one client | Settings › DevOps | 1 | Partly. Every client was already "On"; a made-up token gave "Demo data: nothing leaves FocusTime in demo mode" | The page asks for a "PAT … with Work Items (Read & write)" but doesn't say where to make one. Client names differ on one page: "Atlas Freight" under Reading, "Atlas" under Write access. "Turn off" doesn't say whether it deletes the token or pauses writes (it deletes it). |
| 5 | Connect Pocket | Settings › Accounts and calendars, by guessing; search "pocket" also finds it | 1 | Yes: "Connected, checked Nov 2 · 6 recordings in the last 7 days" | Nothing; the steps were clear. |
| 6 | Make the text larger | Settings › Display › Text size | 1 | Yes. Search finds "text size" but not "bigger font" | At Larger, the top bar's Focus, Capture and Ask shrink to icons with no words (`walkthrough/63-day-larger.png`). |
| 7 | Find what FocusTime keeps about them | Settings › Your data | 5: Your data, then search ("privacy", "what FocusTime keeps": "Nothing called …"), then Activity, the Guide, the Technical docs | No | The only description is "Your plans, promises, captures, logs and settings. Never a password or token." "Download JSON" answered "Export isn't available here" in the demo (`walkthrough/72-export.png`). |

## As an admin

| # | Task | Looked first | Places | Done | Where it wasn't sure |
|---|---|---|---|---|---|
| 8 | Register a client chat | ⋯ › Admin, which opens Admin › Clients; then Admin › Client chats, which holds only phrase lists and polling rules (`walkthrough/81-admin-chats.png`) | 3, and 2 tries | Yes, on the second client | It scrolled the one long page to Fabrikam's "Add a chat". Picking a chat the picker itself offered gave "That isn't one of your clients" (`walkthrough/84-addchat-picked.png`). The picker offers the same chats, "Friday lunch crew" too, under every client. Under Harbor it worked: "Added … Read from now on". A chat named "Delivery Team" was labelled "Customer collaboration" by itself. Not sure what "Stop reading" next to "Not read yet" and "Delete stored messages" would do. |
| 9 | Register a client call | Admin › Clients › Harbor › Meetings (learned in task 8) | 1 | Yes: "Register a meeting", picked the weekly series from the calendar, Register | ⋯ › Calls lists registered calls but has only "Add a call", and the agent couldn't tell whether that is the same thing. |
| 10 | Turn on Allow AI for one client | Admin › AI | 1 | Yes: "Fabrikam: Allow AI saved. Undo" | The per-client table sits at the foot of the page, below the long Processing tier list. |
| 11 | Find who hasn't signed in | Admin › People › Who's set up | 1 | Yes: "4 of 5 signed in", "Not signed in (1)" | Just above it, Admins says "Nobody seen yet." while the agent was signed in as an admin. |
| 12 | See who opened a client's code | Admin › Audit | 1, and 2 trips | Yes, after opening a file in Code itself: two rows, "Opened the repo" and "Opened a file" | "Code views" sits under the 23-row settings table with no menu entry of its own (`walkthrough/120-admin-audit.png`, `walkthrough/125-codeviews.png`). The audit lists settings as "client:Fabrikam/allow_ai" and "person:a4d0…/automation". The chat and the call registered in tasks 8 and 9 don't appear in "Everything". |

## The worst five moments

1. **Task 8.** "That isn't one of your clients" came right after picking a chat FocusTime offered under that client. In the demo, Fabrikam isn't one of the demo person's DevOps clients ("The process couldn't be read: Not a demo client"), but nothing before the pick said so.
2. **Task 8.** Admin › Client chats opens with "The team's phrase lists." and has no way to register a chat; registering lives on each client's card in Admin › Clients.
3. **Task 7.** "Export isn't available here" after Download JSON, and no other screen says what is kept.
4. **Task 3.** "Outlook calendar changes: Allowed" has no switch. The control a person wants is "Put on Outlook" / "On by default" on another page.
5. **Task 12.** The audit shows "client:Fabrikam/allow_ai" as a setting's name. It leaves out the chat and the call just registered, and puts "Code views" under it.

## Counts

- Consultant: 7 tasks, 14 places in all, 5 finished, 1 partly (DevOps, because demo tokens can't be checked), 1 not finished (what FocusTime keeps).
- Admin: 5 tasks, 7 places in all, all finished. 2 needed a second try: a chat under another client, and opening Code first.
- First guesses: the ⋯ menu for Settings (task 1); Accounts for Outlook writing (task 3); Admin › Client chats for registering a chat (task 8). All three were wrong.

## What the run left in its demo session

Friday hours, Put on Outlook, the Pocket connection, Allow AI for Fabrikam, the Harbor chat and weekly call registrations, and two code-view rows. The text size was set back to Default. The demo's store is in memory, and the server was stopped afterwards (by its own process id).
