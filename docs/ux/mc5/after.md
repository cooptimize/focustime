# MC-5: Calls, before and after

Measured on the demo (a fictional person and fictional calls, Thursday Nov 5, 2026 4:30 PM ET, Pocket connected with the demo key) by `e2e/shot-scripts/mc5-shots.ts`, before on main at `589e3225` and after on this branch. Words are what is on screen in the list or the call's page (the top bar left out); rows visible are list rows whose whole height shows without scrolling; "fits" is how many one-line rows the list's height holds, since the demo has only seven calls.

## Counts

| | 1440 by 900, before | 1440 by 900, after | 390 by 844, before | 390 by 844, after |
|---|---|---|---|---|
| Words in the list | 133 | 95 | 100 | 88 |
| Calls visible in the list without scrolling | 4 of 7 | 6 of 6, room for 15 | 2 of 7 | 5 of 6, room for 6 |
| Lines per Needs you row | 4 | 2 | 4 | 2 |
| Lines per week row | 3 to 4 | 1 | 4 to 5 | 2 (when and name over the client and mark) |
| Words on the call's page | 235 | 277 | 145 | 148 |
| Proposals visible without scrolling | 1 | 4 | 0 | 0 (the summary fills the first screen; the first proposal starts just under it) |
| Times the call's count is on screen | 6 | 1 on the call's page ("0 of 11 decided"); the list's row says "11 left" | 3 | 1 |
| Stuck header (and a group's head) | 72 px (and 50) | 86 px (and 33) | 255 px | 218 (and 49) px |

The list has 6 rows after against 7 before because last week's closed call is now "1 closed" beside its group's head instead of a row. The call's page has more words at 1440 than before because more proposals show: per proposal it is three lines where it was nine to twelve, and the help sentences are gone.

## Help and explanation, where it went

| Sentence (before) | Where | After |
|---|---|---|
| "The calls you were on, newest first" | the list's subtitle | the heading's hover |
| "Only you see the calls from your calendar, and FocusTime keeps nothing about one until you review it." | under the filters | the heading's hover |
| "4 of your recordings in the last 14 days. … Pocket checked at 10:00 AM." | Pocket's line | counts in Settings; when it was checked is Check Pocket's hint in the menu |
| "Record calls on a Pocket? Connect it in Settings." | Pocket's line, not connected | "Connect Pocket", a link |
| "Teams has no transcript for these, or FocusTime can't ask …" | under the fold's title | the fold's hover |
| "Only you see what you hid. Hiding never changes the meeting." | Hidden | the filter's hover |
| "You and the Cooptimizers on the invite can see this call. Only you can act on it." | the call's page | "The invite sees it" in the line under the title, the sentence on hover |
| "Skipping writes nothing to DevOps and keeps no promise." | beside Skip all and close | gone; the Undo message says what happened |
| The paragraph above the proposals (what the AI read, who spoke) | the call's page | gone; the Transcript view has the lines and the people |
| "From your Pocket recording. Speakers aren't named, and Pocket can mix them up." | the call's page | "Pocket" in the line under the title, the sentence on hover |
| MC-2's upload box and its two sentences | a call with no transcript | the transcript choices: From Teams, Pocket recording, A file; the kinds in small type under the drop area |
| "Optional" and the sentences beside a proposal's fields | an open proposal | the fields' titles; a field DevOps needs says "needed" |

## Every control and state, and where it went

| What | When it shows | After |
|---|---|---|
| Add a call | always | the header, beside the menu |
| Refresh | always | the header's menu |
| Check Pocket again, with when Pocket was checked | Pocket connected | Check Pocket in the menu, its hint "Checked 4:30 PM" |
| Set my Pocket address | recordings left out | the Pocket line, unchanged |
| Pocket couldn't be checked, Check Pocket again | the list failed | "Pocket didn't answer." with Check again, the reason on hover |
| Hide the list / Show the list | wide screens | Hide the list in the menu; Show the list unchanged |
| Open, Closed, Hidden with counts | always | unchanged; a zero isn't drawn |
| Client chips (All clients, each client, No client yet) | always | the Client row: All, each client with its square, No client only when a call has none |
| The check's lines (couldn't check, not checked yet with Check 40 more, the organization's setting) | when they happen | unchanged |
| Needs you: "3 left of 11" with a bar | proposals left | "3 left" on line 1; the bar on line 2 once something is decided |
| Needs you: Review, Upload, Open | by state | a click on the row (Review, Open); "Add transcript" (Upload); "Use Pocket recording"; "Try again" |
| Needs you: Skip all and close | proposals left | "Skip all" / "Skip last N" on the selected, hovered or focused row; on the phone in the call's header |
| Needs you: a past week's "still open" | a call from an earlier week | "Transcript goes Nov 26" in amber on line 2 |
| A row's tick box | always | only after Select calls |
| Ticked rows' bar (N chosen, Hide N, Skip all and close N, Clear) | rows ticked | unchanged, with Done selecting |
| A week row's "About Northwind" or "Which client?" | a calendar call | the picker: "Northwind", or "Which client?" in amber |
| The marks "Transcript in Teams", "Pocket recording", "Teams and Pocket", "Checking…", "Not checked" | after the check | "Teams", "Pocket", "Teams · Pocket" with the full words as label and hover; Checking… and Not checked unchanged |
| A week row's Review | a calendar call | a click on the row |
| A week row's Hide | a call nobody asked to read | on hover or focus; always on touch |
| A repeat's row and its menu (Hide every one, only this week's, Show each one) | a series | unchanged |
| A recording with no call (its row, Review, Hide) | Pocket connected | unchanged, as a week row |
| A row's busy and error lines, with Upload a file | Review from a row | unchanged |
| The fold "N calls with no transcript" | calls with none | unchanged, last |
| Client calls fold | registered calls | unchanged |
| Hidden: Put back, Put back all | hidden meetings | unchanged |
| Closed rows: what came of each | Closed | unchanged, with the mark |
| Keys J, K, Enter, X | the list | unchanged; X skips with the app's Undo, no browser question |
| The call's heading "Update Northwind's plan" | a call | the call's name |
| The call's sub line and the who-sees sentence | a call | one line: client, type, when, people, origin, who sees it |
| Proposals (11) and Transcript (12) | a call with a transcript | Proposals and Transcript, no counts |
| "11 to review · 1 done" | a call | "1 of 11 decided" with a bar in the Show row, the one count |
| All, New in DevOps, Promises, Comments with counts | a call | the Show row's chips, All without a number; a kind with none isn't offered |
| Skip all and close, Skip the last N and close | proposals left | unchanged, the header's right |
| Propose again | a reviewer | the call's menu |
| Upload a transcript (the file button) | a reviewer | the call's menu; a drop on the page still asks before replacing |
| Get it from Teams | a Teams call FocusTime may ask | the transcript choices, and the call's menu |
| No transcript this week | a reviewer | the call's menu |
| What was said | a summary | unchanged |
| The AI step failed, Try again | a failed pass | unchanged |
| Waiting on the transcript | waiting | one line, its explanation on hover |
| The closed block, See what was skipped | a closed call | unchanged |
| A group's head, its count, Select all | each kind | unchanged; Select all when the group has more than one |
| A proposal's tick | undecided | line 1 |
| Its title box | undecided | the title on line 1; a box once open |
| Level, Parent, Assigned to, Target date | a new item | line 2 in words; the grid once open |
| More: description, size and details (and the three questions) | a new item | "Description and size", open |
| Create in DevOps, Add to Promises, Add comment | undecided | "Create", "Keep", "Add comment" on line 1; the preview unchanged |
| Skip, Bring back | undecided, skipped | unchanged |
| Show in transcript | a quote | a click on the quote line |
| The other quotes | more than one | open |
| What DevOps needs, what can't be sent, a refusal | a check or a write | the row opens by itself; "needed" on the field; the sentence for screen readers; can't and refusal lines unchanged |
| Enable DevOps writes | no write PAT | unchanged, line 1 |
| Create and break down, Break down | a feature | open; Break down on a created row unchanged |
| Another client's name was removed | a draft | unchanged |
| The bar for ticked proposals | ticked | unchanged |
| "1 done", "1 skipped" folds | decided rows | unchanged |
| The upload box (no transcript) | no transcript | the transcript choices |
| Use my Pocket recording on the call's page | a recording fits | Pocket recording in the choices, "Use this recording" |
| The recording's date question | a Pocket export from another day | unchanged |
| An attendee's view (who reviews) | not a reviewer | unchanged |
| Add a call's form (Name, Day, Starts, Length, About, Add and upload) | Add a call | one panel: Pocket recording, A file, Later; "Add and review" or "Add" |
