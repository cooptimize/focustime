# IB-2: every date and time in the Inbox, Today and Week (Nov 8)

`ui/stamp.ts` is the one formatter for "when something happened": `stampText` (the words), `stampFull` (the tooltip), `dayHeading` (the list's headings), drawn by `ui/Stamp.tsx`. `ui/stamp.test.ts` fails if a file below goes back to another stamp formatter.

## Uses the formatter

| Where | What it shows |
|---|---|
| `ui/inbox/InboxPage.tsx` | The row's latest activity, day headings, Chats last checked |
| `ui/inbox/Detail.tsx` | The header's activity; You said; Resolved by; Where it came from; You added it / Opened; Loop closed; Captured; chatter's range and message headers |
| `ui/MessageThread.tsx` | Teams-style message headers (Inbox, phone sheet, Conversations) |
| `ui/Conversations.tsx` | A linked item's "changed …" |
| `ui/inbox/HeldBack.tsx`, `ui/inbox/MergePane.tsx` | A held message; a merge candidate's last activity |
| `ui/FollowUps.tsx` | A promise's opened and closed (Today's and Week's block panels, Close out) |
| `ui/StatusBar.tsx` | When a source was fetched, "Showing data saved" (every tab) |
| `ui/Status.tsx` | Week › Status: a comment's time, Refreshed, Kat last sent (now in the person's zone) |

## Date only in tight lists

The phone's Inbox rows show the date alone for anything older than a week (`dateOnlyIfOld`). Everywhere else keeps the time.

## Not stamps, left as they are

These say when something is planned or due, or name a day; they aren't "when it happened".

| Where | What it is |
|---|---|
| `ui/inbox/model.ts` (`dueWords`, `lateText`), `ui/inbox/Detail.tsx` (`wakeWords`) | Due badges and snooze ends, the glossary's Due badge wording |
| `ui/Today.tsx` (the attention line's promise time), `ui/WeekGrid.tsx` (rail promises) | A time on today's agenda or a rail |
| `ui/Today.tsx`, `ui/NowStrip.tsx`, `ui/WeekGrid.tsx`, `ui/labels.ts`, `ui/Carry.tsx`, `ui/Watching.tsx`, `ui/WeekStories.tsx`, `ui/Team.tsx`, `ui/TodoSheet.tsx`, `ui/PickReview.tsx` | Day names and dates of planning days; block and event ranges |
| `ui/PhoneToday.tsx`, `ui/PhoneShell.tsx` | No stamps of their own; the phone's Inbox is `InboxPage` |

## Outside this step

`whenText` in `ui/labels.ts` stays for the audit log (`ui/DevOpsWrite.tsx`, Settings). Notifications (`ui/Notices.tsx`) keep "5 min ago". Say if either should change (Q-IB2-3).
