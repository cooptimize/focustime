## CO-1: Ask to collaborate: pick your own time and check who is free (Nov 18)

Readings taken where the brief left room (the one that changes less), each open to change:

- **The summary counts me.** "2 of 3 are free" with two people chosen means me and one of them; "Everyone is free" includes me.
- **Which reason shows when several apply.** Me: a day off, then outside my hours, then what's in the way. A person: away, then a calendar that couldn't be read, then outside their hours, then busy.
- **Lunch is named in the way** ("You: Lunch 12:00–1:00") rather than called outside my hours; it is my own setting.
- **A day with no working hours** (a weekend, a day override with none) reads "You: a day off", the same as PTO.
- **Default day is today** even when the item is pinned to a later day, as decided; Find times' range still starts on the pinned day.
- **Checking needs someone chosen.** With nobody chosen, Check who is free says "Choose who to ask first". Find times with nobody chosen still lets FocusTime pick, and picking a suggestion sets Who to its person.
- **Find times uses the length in When** (to the nearest 15 minutes, 15 minutes to 2 hours); its own Length row is gone.
- **A quarter hour only when no hour or half hour fits anywhere in the range**, not per day.
- **The preview reads free/busy again** for the chosen people that day (one more getSchedule read); Confirm checks only the time (start not passed, length), not free/busy.
- **Times.** The answer and the suggestions say AM and PM ("10:00–11:00 AM", the form of `formatRange`), not PS-1's short "10:00–11:00", because a teammate's hours converted from another zone ("11:00 AM–7:00 PM your time") were ambiguous without it (the demo review). Times are in my zone; a teammate's hours show in their zone with the same hours in mine. The time field's button shows the 24 hour time it already showed ("14:00"), and the invite's preview shows its time without a zone; one format for all three is for those fields' own step.
- **The half-hour rule landed in commit A**, with the check, because the 10:06 test covers both; C's commit is the Find times words.
- **From the review passes, left as they are** (each the same on main, not this step's scope):
  - The command menu's Ask to collaborate asks "Help on which to-do?" and is a dead end on a day with no planned to-dos.
  - Not now in the invite's preview closes the whole dialog; the chosen people and time are gone.
  - After Send invite the toast has no Undo (it is in Settings › Activity); the invite shows on the day card only as a count; the promise reads "<Name>: Help session with <Name> on …".
  - Find times' range is the item's pinned day when it has one (today only, for this week's items).
  - Each suggestion's tier word reads "(Cooptimize)" for anyone else at Cooptimize, which is odd under the Cooptimize client.
  - On a phone, the invite's preview opens scrolled so its title can sit under the top edge.
  - On the night clocks go back, a session between 1:00 and 2:00 AM measures its length on the wall clock in the dialog and in real time on the server.

