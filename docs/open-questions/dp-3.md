## DP-3

- **Only the client's people, or everyone?** The picker offers the client's people first and then everyone at Cooptimize, as the brief says. Whether a deployment should be limited to the client's people is open.
- **The first hold: a press, or the timebox setting?** Only a person's own press puts it on Outlook; `outlook_default` doesn't apply. A person who always wants holds might want the setting to apply.
- **A change reaching Outlook without FocusTime open.** A hold that fell behind waits for the person's next visit. Updating it in the background would be a background Outlook write, which this step rules out.
- **Seeing each other's Outlook state.** Nobody sees whether a deployment is on anyone else's Outlook. A team might want "on 2 of 3 calendars".
- **The assistant and the Teams bot** don't add people, show who is on a deployment, or offer Take me off. Their deployment proposals make a deployment for the person alone, as before.
- **People who don't use FocusTime** can't be added (refused by name). They could be added once they sign in, or be told some other way.
- **A to-do or a block with people?** Only a deployment takes people.
- **Whom to add when someone hasn't signed in yet.** The picker lists them; the server refuses with their name. The picker doesn't mark them beforehand, because the picker's data doesn't say who uses FocusTime; Send to… marks it from its own list.
- **Undo after someone else's change.** An Undo of a details save puts back what it was without checking the version, so it can undo someone else's later change too; a move's Undo checks (it is refused if anyone changed it since).
- **A person removed while their form is open** gets "That deployment isn't on your plan any more" on Save.
- **An import into a database where the deployment still exists** makes the person's own copy rather than putting them back on the shared one (an export holds no ids of shared rows).
- **The demo's second person.** `demo.be` switches the whole demo session to the teammate (their own plan), not a second window. It is the smallest way to see both sides; a side-by-side view would need two demo sessions on one database.
- **Being added, seen in the demo.** The notice comes from each person's ticks, which the demo doesn't run, so a teammate trying it in the demo learns who added them only from "Added by" where it opens (now on the computer's details too). In the hosted app it is a notice by the person's switch.
- **Move, Done and the phone's Move to <day> don't say who else they change.** Only Deployment details has the line; the undo line after each counts everyone ("for all 2 on it"). A line on the Move step would be one more place for the same words.
- **A deployment's narrow weekend card shows no title** (the client and the window, the title on hover, UC-2), and clicking the column's empty space opens the catch-up day's panel. Both before DP-3.
- **The window's times read three ways** (19:00 on cards, 7:00 PM in the form, 7:00 on the phone's sheet with no AM or PM) and none names a zone. Before DP-3; with people in other zones a zone name might help.
- **Saves to the hold timebox after someone else's change reach my Outlook without a question when I turned off previews for my own events** (my confirm_own rule, as the brief asks). Whether a shared deployment's hold should always ask is open.
- **A removed person's notice names the deployment as it is when the notice is sent**, not when they were removed (a rename in between shows the new title). Keeping the title on the note needs a column.

