## SA-4: Admin as its own place, a list of clients, a page for each (Nov 18)

Readings taken where the brief left room (the one that changes less), for the product owner to confirm or change:

- **What F redraws.** Admin's own rows are SA-2's parts. Components shared with Settings or owned by Calls (client chats, a client's deployments, the call registration form) sit inside the parts' groups and keep their insides, as SA-2 did for the same components. The client's DevOps scope (Backlog rules) is redrawn too, though it is shared code, since only Admin shows it.
- **Commits.** A to E were built as one piece in one worktree; split after the fact, the middle commits wouldn't build (the shell imports every part, Audit reads the settings list, the rail reads Search Admin). They landed as one commit for the screens, one for the words that point at Admin's places, and one for the tests, in that order.
- **A client's last tab and the address.** A rail click or a list row opens a client's page on the tab last used on a client this visit, and the address is `#/admin/clients/<client>` without the tab (a reload opens Overview). Writing the tab into the address on every rail click would make Back step through tabs. Should a reload keep the tab?
- **This client's DevOps check is on two pages.** The brief puts the client's row from Health on its Backlog rules tab, Check now included, so that button is on Health and on the client's page. It runs the same action (`admin.status_action`) for the same client either way.
- **The per-chat AI cap on a client's Chats tab is read-only.** It is the team's one value (`conv.chat_ai_daily_cap`), set in Team defaults › Client chats; the line links there.
- **Allow AI's count on Team defaults › AI counts Customers.** "N of M clients allow AI" uses the Customers list (the one the old per-client table showed by default); clients only under All accounts aren't counted.
- **The phone's title.** On the phone a part's page says its name ("Health") with Back to Admin; a client's page says the client's name with Back to Clients. "Admin ›" isn't repeated in the title because the rail heading already says Admin.
- **Delete stored messages** now asks with the app's own confirm under the button; what it says (every message FocusTime stored for this client that didn't become a request, for everyone on its chats) is main's text in plainer words. The action and its check are unchanged.
- **Keep people's data (years)** left the screen. Its stored value is kept and still exported; Health's Jobs row still says deleting old data isn't enforced. When deleting people's data is built, the setting comes back on Team defaults › Planning and new people.
- **From the review pass, left as they are** (each also on main, or for F's restyle):
  - Remove a person in the demo answers with "FocusTime ran into a problem" (the demo's people are pretend and its remove throws). Same on main; the real path is unchanged.
  - Settings' new Admin line is at the rail's foot, so at 1440 by 900 the rail scrolls once to show it. Should it sit at the top of the rail instead?
  - On the phone, the Saved toast sits behind the + button. (A tab row that runs past the screen now fades at its edge.)
  - Who's set up's select boxes are a labelled check part, 44 px on the phone (F).
  - A client's Calls tab says Meetings, Register a meeting and Role inside, as Calls' own screens do (not in this step).
  - Under a client the admin doesn't follow, Add a chat still opens the picker, every row saying why it can't be added; the refusal line shows above it too.
  - A newly registered chat reads "Not read yet" beside "Stop reading"; one click on a chat in the picker registers it, with no confirm. Both as on main.
  - Search Admin's client settings (Allow AI and the like) go to the Clients list unless a client's page is open, since the setting is per client.
  - People, like a client's page, opens on the tab last used this visit while the address says `#/admin/people`.
- **Taller rows.** With the parts, Team defaults › AI and Planning and new people are about one screen longer at 1440 than A to E's moved rows (`docs/ux/sa4/after.md`). Kept: the row style is SA-2's, one setting per row.

