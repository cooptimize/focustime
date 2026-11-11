# FocusTime demo (about 5 minutes)

A scripted walkthrough in demo mode, in the step 16.2 navigation: four tabs (Today · Week · Roadmap · Inbox, keys 1–4), one mode switch at the right of each page header, and planning as a mode with a green Done. Verified end to end at 1920x1080 on Nov 2, 2026 with `scripts/demo-walkthrough.mjs` (demo clock Monday Nov 2, 9:30 AM). Screenshots are in `docs/demo/`.

The demo is signed in as a fictional person (Alex Rivera) with a fictional VM: the VM chip in the top bar and on Today, "Your VM is off. Start it?", and Start (about 20 seconds to Running) work on a simulated Azure, with no Azure calls. The auto-shutdown time is shown, never changed (D475).

## Before you start
1. Turn on demo mode: my initials (top right) > Settings > Display > "Show demo data", or Ctrl+K > "Demo mode". The top bar shows **Demo data**.
2. Everything you see is fictional: Northwind Foods, Harbor Health, Atlas Freight and Cooptimize (internal), with made-up people, DevOps items, meetings and a Thursday day off (Friday when today is Thursday), generated for the current week. Nothing is fetched and nothing leaves FocusTime: links, export, sign-ins and every external write are refused with "Demo data: nothing leaves FocusTime in demo mode".
3. Changes you make during the demo (picks, timeboxes, closed follow-ups) go to an in-memory store. Turning demo mode off throws them away and brings back your real data untouched. Turning it off and on again starts a fresh demo.

To run the script yourself against a running FocusTime: `node scripts/demo-walkthrough.mjs docs/demo dark --now 2026-11-02T09:30:00-05:00` (it turns demo mode on first and stops if the "Demo data" tag is missing; `--runtime <dir>` points it at a throwaway server's launch link).

## Where things are
- **Today** (1): Now · Plan · Check-in · Close out. A ✓ on a mode means it's done for the day; a small dot means it's due now (Plan in the morning, Check-in after lunch, Close out near the end of the day). Nothing switches by itself.
- **Week** (2): Week · Plan the week (next week by default, ‹ › for others). The header has the week, the client chips and any borrowed time (CF-1: no musts, nothing to confirm).
- **Roadmap** (3): Roadmap · Plan ahead (coming next).
- **Inbox** (5 since RF-1; 4 before): follow-ups and captures.
- **P** toggles the current tab's planning mode. Every place has its own address, so browser back and reopening land where you were.
- Top right: the VM chip, Focus (the countdown while it runs), Capture, ⋯ (Commands, keyboard shortcuts) and my initials (Settings, Sign out).

## The walkthrough

| # | Do | Say | Screenshot |
|---|---|---|---|
| 1 | Open FocusTime (Today › Now, `1`) | "This is Today: what's now and next, what's due, and one big button. The switch on the right says Plan is due this morning." | `01-today.png` |
| 2 | Press `2` | "The week: each half-day is a focus block for a client, from Dataverse, with meetings and personal events on it. The header shows this week's clients and their hours." | `02-week.png` |
| 3 | Click **Plan the week** on the switch, then ‹ to this week | "Plan the week opens on next week. Each client's features on the week, from DevOps in backlog order, with the fit in plain words." | `03-plan-week.png` |
| 4 | Click ⋯ on a row | "Everything else about an item lives here: reorder, blocks, pin, mark done, get help, target date, Coop brief." | `04-plan-week-menu.png` |
| 5 | Esc, click **Week** on the switch, then Monday's **Plan** chip | "A day's Plan chip opens Today in Plan mode for that day: my Monday on the left, what I can add on the right." | `05-plan-day.png` |
| 6 | Click the Northwind block | "Select a block and the right pane follows: this week's priorities first, then follow-ups, then everything else." | `06-plan-day-northwind.png` |
| 7 | Click "+" on two stories | "One click each. Each row turns into a check. The block's fit updates in plain words." | `07-plan-day-added.png` |
| 8 | Click the green **Done** | "Done saves the plan: Plan gets its ✓. It offers to timebox the day." | `08-plan-day-done.png` |
| 9 | Click "Timebox my day" | "Each pick goes into a free gap. Outlook is optional, and off in demo mode." | `09-timebox-my-day.png` |
| 10 | Click "Timebox 2 picks" | "Now the picks have times on their own rows." | `10-plan-day-timed.png` |
| 11 | Click **Done** again | "Back to Now: the next pick is one big Start focus." | `11-today-planned.png` |
| 12 | Click Start focus | "The focus screen: a countdown, the one pick, the next meeting, and focus sounds. The Focus button in the top bar carries the timer." | `12-focus.png` |
| 13 | Stop, Esc, then press `E` | "At the end of the day, Today › Close out: what got done, where I left off, and the follow-ups I owe." | `13-close-out.png` |
| 14 | On Jordan Lee's follow-up: Close the loop, Teams | "I answered Jordan on Teams, so I close the loop." | `14-close-the-loop.png` |
| 15 | Confirm | "Closed." | `15-closed.png` |
| 16 | Click **Done** | "Close out is saved and I'm back on Now: Plan, Check-in and Close out all show ✓. That's the day." | `16-today-closed.png` |
| 17 | Press `3` | "Roadmap: the features and epics I own, and whether they're on track for their target date. Plan ahead comes next." | `17-roadmap.png` |

Every tab and mode, at 1920 and 3840 in dark and light, is in the step 16.2 screenshots (`scripts/screenshot-step162.mjs`); a few are kept here as `162-*.png`.

## Afterwards
Turn demo mode off in Settings > Display. Your real plan, config and sources come back as they were.
