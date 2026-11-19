## MC-4: Calls you can scan, hide and close (Nov 18)

- **"Everyone on the call is a Cooptimizer" is read from the invite's addresses** (every one in a home domain), since the calendar has no tenant or guest flag. A guest or an automation account with a Cooptimize address counts as a Cooptimizer here, so a call with one could still say "Which client?" rather than suggest from the block. That is the reading that suggests less.
- **Hide only for a call nobody asked FocusTime to read.** A call someone else pressed Review on, or a registered client call, can't be hidden; it can be closed. Should a person be able to hide a call they only attend?
- **A hidden single meeting goes at 60 days, "every one" stays until put back.** The brief said a single meeting's row is deleted at 60 days; it said nothing of a series. Kept, since the point of "every one" is that it lasts.
- **Week's line from Thursday to Sunday, this week only.** The brief says "from Thursday"; it isn't shown on next week or last week.
- **"Nothing taken" is the whole line.** When nothing was created, kept or commented, the closed line is "Nothing taken", even with skipped ones; See what was skipped on the page has them.
- **X asks with the browser's confirm** before Skip all and close, as the brief says; the buttons don't ask, since Undo covers a mistake. Should X ask too, or neither?
- **The check's cap is per press (40).** A person with more than 40 unasked Teams calls in 14 days sees Check 40 more; the brief left the number open.
- **Old calls past 30 days.** An open call stays in its week until its transcript goes; a call older than that with nothing to read isn't listed (as before).
- **Offered, not decided:**
  - "Always review this meeting": a repeat's menu could say every one of its calls should be reviewed without asking. Not built (NOT IN THIS STEP).
  - "Don't analyze this registered call until I ask": a reviewer could turn a registered call's automatic pass off for themselves. Not built.
- **From the walkthrough, left as they are:**
  - A Needs you row counts every undecided proposal in "3 left of 11", including a comment the call's page says won't be sent (MC-1e's own count).
  - Week's call marks read "Call · Review 3 proposals" and "Weekly status call · Review 1 proposal" (MC-1's marks, not this step).
  - Week's line opens Calls on Open; on a wide screen the first call that needs me opens beside the list, as MC-3 does.
  - A call's page keeps "Update Northwind's plan" as its heading once closed; the closed block under it says so.
- **What a real tenant must still prove:** that `GET /me/onlineMeetings?$filter=JoinWebUrl eq` works inside a `$batch` for an attendee who isn't the organizer; that the transcript list answers for a recurring meeting's series id with each occurrence's `createdDateTime`; and what a tenant with Graph access to transcripts off answers inside a batch (the 403 code read from the item's body).

