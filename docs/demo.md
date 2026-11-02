# Coopilot demo (about 5 minutes)

A scripted walkthrough in demo mode, verified end to end at 1920x1080 on Nov 1, 2026 (step 15) and again on Nov 2 (steps 15.2 and 15.3) with `scripts/demo-walkthrough.mjs`. Since step 15.3, Close out (step 13) shows the capture box with Follow-up chosen for anything new I owe. Since step 15.4 the demo is signed in as a fictional person (Alex Rivera) with a fictional VM: the VM chip in the top bar and on Today, "Your VM is off. Start it?", Start (about 20 seconds to Running), Delay shutdown and Restore all work on a simulated Azure, with no Azure calls. Screenshots are in `docs/demo/`.

## Before you start
1. Turn on demo mode: Settings (`,`) > Display > "Show demo data", or Ctrl+K > "Demo mode". The top bar shows **Demo data**.
2. Everything you see is fictional: Northwind Foods, Harbor Health, Atlas Freight and Cooptimize (internal), with made-up people, DevOps items, meetings and a Thursday day off, generated for the current week. Nothing is fetched and nothing leaves Coopilot: links, export, sign-ins and every external write are refused with "Demo data: nothing leaves Coopilot in demo mode".
3. Changes you make during the demo (picks, timeboxes, closed follow-ups) go to an in-memory store. Turning demo mode off throws them away and brings back your real data untouched. Turning it off and on again starts a fresh demo.

To run the script yourself against a running Coopilot: `node scripts/demo-walkthrough.mjs docs/demo dark --now 2026-11-02T09:30:00-05:00` (it turns demo mode on first and stops if the "Demo data" tag is missing).

## The walkthrough

| # | Do | Say | Screenshot |
|---|---|---|---|
| 1 | Open Coopilot (Today, `1`) | "This is Today: what's now and next, what's due, and one big button." | `01-today.png` |
| 2 | Press `2` | "The week: each half-day is a focus block for a client, from Dataverse, with meetings and personal events on it. Cards say At risk only when meetings really eat the block." | `02-week.png` |
| 3 | Press `3`, then the "Plan the week" chip (‹ to this week) | "Each client's musts and nice to haves for the week, from DevOps in stack rank order. The fit is in plain words: Fits, Room for…, About half a block over." | `03-plan-week.png` |
| 4 | Click ⋯ on a row | "Everything else about an item lives here: reorder, blocks, pin, mark done, get help, target date, Coop brief." | `04-plan-week-menu.png` |
| 5 | Click the "Plan the day" chip | "Plan the day: my Monday on the left, what I can add on the right." | `05-plan-day.png` |
| 6 | Click the Northwind block | "Select a block and the right pane follows: this week's priorities first, then follow-ups, then everything else." | `06-plan-day-northwind.png` |
| 7 | Click "+" on two stories | "One click each. Each row turns into a check, Already planned here. The block's fit updates: About 1h 30m over, in amber, with a trim link. Nothing is red unless it's a real problem." | `07-plan-day-added.png` |
| 8 | Click **Done** | "Done saves the plan. It offers to timebox the day." | `08-plan-day-done.png` |
| 9 | Click "Timebox my day" | "Each pick goes into a free gap. Outlook is optional, and off in demo mode." | `09-timebox-my-day.png` |
| 10 | Click "Timebox 2 picks" | "Now the picks have times on their own rows." | `10-plan-day-timed.png` |
| 11 | Press `1` | "Back on Today, the next pick is one big Start focus. Focus is also always in the top bar (F)." | `11-today-planned.png` |
| 12 | Click Start focus | "The focus screen: a countdown, the one pick, the next meeting, and focus sounds." | `12-focus.png` |
| 13 | Stop, Esc, then press `E` | "At the end of the day, Close out: what got done, where I left off, and the follow-ups I owe." | `13-close-out.png` |
| 14 | On Jordan Lee's follow-up: Close the loop, Teams | "I answered Jordan on Teams, so I close the loop." | `14-close-the-loop.png` |
| 15 | Confirm | "Closed. That's the day." | `15-closed.png` |

## Afterwards
Turn demo mode off in Settings > Display. Your real plan, config and sources come back as they were.
