## SA-5: Settings search that finds things, and all of Settings on the phone (Nov 18)

Readings taken where the brief left room (the one that changes less), for the product owner to confirm or change:

- **Admin results and the person's own.** Admin's results come under all of the person's own. The one exception is an Admin part named by the words ("admin", "audit", "health"): it leads, since that is what was typed and what SA-0 expected. Is that the right exception?
- **Section names match on old names too** ("notifications" finds Reminders and notices as a section).
- **A word's start matches only from 3 letters**, so "ai" doesn't match "aim" or "air" by its start.
- **Answers with nowhere to open** (something FocusTime doesn't have) show in the command menu as rows that can't be chosen, with the answer as their hint.
- **What counts as two controls too close.** The sides of one choice, the rows of one list, one tab list or one table may touch; their lines part them. Two separate controls keep 8 px.
- **Keywords removed** from Clients' list and the Guide line where they repeated the label, so a whole word in a label ranks above them.
- **Commits.** C landed as four commits (the parts, the sections, Most used and Back, the tests) plus one from the review, not one per section: each section's change is a line or two once the parts changed, and a commit per section wouldn't build alone.
- **Status lines split on the phone** like help, so a long status keeps to two lines with the rest behind More about this.
- **Not counted as help or clipping**: a problem or alert line, what sits behind a fold that explains ("Where do I find the link?"), a field's own value and a strip of chips.
- **Left with two names**: "Your level" against Admin's "Level" (a person's resolved level, not the mapping Admin sets), "Send feedback" against Admin's "Send feedback goes to" (a status line, not the value), and a client's "Color" against Admin's "Team color" (the person's own, with Reset to the team's).
- **Two status lines shortened** to fit two lines on the phone (Teams connected, the VM hint); their meaning is unchanged.
- **Admin's long help lines** (11 at Default, 13 at Larger) are listed in `docs/ux/sa5/after.md`, not fixed: Admin's phone layout is out of scope beyond what the measurements demand, and the brief's two-line rule names Settings. Fix them in a follow-up?
- **Admin's labels and keywords are in everyone's script**, though never shown to someone who isn't an admin. Load them only for admins in a follow-up?
- **Today's hours on a PTO day** says why and offers nothing, as Week's day menu does; the server's `hours.set_day` itself doesn't refuse a PTO day (unchanged).
- **The calendar link's last line** ("The link works like a password…") is inside "Where do I find the link?", so it isn't measured as help; it runs to four lines on the phone when that fold is open.
- **From the admin walkthrough, left for the product owner** (fixed in SA-5: "who opened", "not signed in" and "invite" now find their Admin tabs; the search box clears when the address moves to another section):
  - An Admin client setting found by search (Allow AI, Team color, Chats, Calls) opens Clients rather than asking which client, unless a client's page is open. The person's own client results do ask. Asking would need Admin's list of every client in Settings' search; a follow-up?
  - Search finds places and settings, not tasks ("remove a person", "register a meeting"): those are in the command menu, whose other results are outside SA-5.
  - "Allow AI" shows three times for an admin: the person's read-only row on a client's page, the one on AI and assistant, and Admin's. Each is a real place; only Admin's changes it.
  - The person's "which client?" lists only followed clients, so a client the person doesn't follow can't be reached that way (as on main's Clients list).
  - Admin's own words: the Calls tab holds "Meetings" and "Register a meeting"; Fabrikam's Chats says a chat can't be registered yet shows Add a chat; Atlas's Add a chat and Register a meeting offer other clients' chats and series; "Not a demo client." on Backlog rules. Admin's content, outside SA-5.
  - Data platform and Deployment items stay changeable on a client's Settings page (SA-0's #105, unchanged: no behavior change in SA-5).
  - Opening a result scrolls to it and marks it but doesn't move keyboard focus to its control.
- **From the consultant's phone walkthrough** (fixed in SA-5: a section opened from the phone's list now starts at its top, where the list's scroll used to carry over):
  - The search sits under Most used, as the brief orders it, so on a 390 by 844 screen it is below the first screen. Should it move above Most used?
  - Back from a result goes to the section, then the list, as the brief says; the words typed are gone by then.
  - "friday" finds "Also on Fridays" (Teams) before Working hours' Friday, since a setting's own row ranks under whole settings; making an exact part lead moved another of the 100 searches.
  - On the phone a switch sits under its label and help, a line or two below its name; the whole row takes the press.
  - The Teams messages switch's help is its off meaning ("Off: FocusTime only answers…") in either state, SA-2's pattern for switches (the label says what on means).
  - Outside SA-5: the top bar's VM chip cut to "VM S" (and overlapping at Larger); DevOps write access not saying where to make a PAT, "Atlas Freight" and "Atlas" on one page, what Turn off does to the token; Reminders and notices' length; Undo toasts following onto the next page; Most used's time picker's Save over the bottom bar; Export in the demo.

