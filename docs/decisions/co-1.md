## CO-1: Ask to collaborate: pick your own time and check who is free (Nov 18)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | Scope: the dialog takes a time I set and says who is free then; Find times stays. Who can be asked, the tiers, presence, the invite (subject, body, Teams, the allowed domains, the marker), its preview, Confirm, read back, the audit log, undo and the promise it opens are main's. No new setting, dependency or migration. |
| - | Done | When sits under Who: a day, a start and an end in my own zone, named ("times in Eastern Time"), with the app's own date and time fields. The length chips set the end from the start; a typed end sets the length. Defaults: today, the next half hour, my usual help session length. |
| - | Done | A session is 15 minutes to 2 hours, to the minute. A start in the past, an end before the start and a length outside that are refused in words that say what to change, in the dialog and on the server (`sessionTime` in `actions/collab-actions.ts`). |
| - | Done | Check who is free (`collab.check`) answers for the time set, one line each, from a pure rule (`checkTime` and `checkWords` in `plan/collab.ts`). Me: free, a day off, outside my working hours with my hours, or what of mine is in the way by its own name and time (my calendar; lunch as "Lunch"). Each person: Free, Busy with the busy time (never a subject), Outside their working hours with their hours in their zone and in mine, Away that day, or Couldn't read their calendar. A summary: "Everyone is free" or "2 of 3 are free" (me counted). |
| - | Done | The check makes the reads Find times makes, for less: my calendar, hours and PTO for that day, and free/busy and working hours for the chosen people for my one day (midnight to midnight in my zone), kept nowhere. Only people on the candidate list can be asked. |
| - | Done | Nobody being busy blocks the invite. Preview invite is offered once the time has been checked; changing the day, the time or the people clears the answer until it is checked again. There is one path to the preview: the time in When. |
| - | Done | The preview checks the time again on the server and says, above its fields, who isn't free and why, in the same words as the dialog (`notFree` on the preview, never stored or sent in the invite). If the check can't run, it says "Couldn't check who is free just now" and the preview still opens. Confirm checks the time again: a start that has passed or a length outside 15 minutes to 2 hours is refused and nothing is sent. |
| - | Done | Find times keeps its range and its rules (everyone chosen free inside their own hours, me free inside mine) and moves under "Or let FocusTime find a time", using the length in When. Suggestions start on the hour or the half hour in my zone; a quarter hour only when no hour or half hour fits anywhere in the range; never before now. Picking one fills When (and Who with its people) and shows its answer at once. |
| - | Done | The demo's teammates get fictional free/busy through the app's own getSchedule reader (`sources/demo/outlook.ts`): Jordan busy 1:00 to 2:00 PM, Priya busy 10:00 to 11:00 AM, Sam working 8:00 to 4:00 Pacific, Taylor's calendar not shared. Before, the demo said Outlook isn't set up. |
| - | Done | The dialog loads when first opened (`help` in `ui/screens.ts`), so the first download stays inside its limit; Esc cancels it while it loads, as for the other dialogs that load when opened. |
| - | Done | The answer and the suggestions say AM and PM ("Busy 10:00–11:00 AM", "11:00 AM–7:00 PM your time"): a teammate's hours from another zone were ambiguous in PS-1's short form. |
| - | Done | The dialog fits at 1280 by 720 with Preview invite on screen (its footer stays at the dialog's foot) and works at 390 by 844 with every control at least 44 px. |
| - | Open | The readings taken where the brief left room are in `docs/open-questions.md` under CO-1. |

