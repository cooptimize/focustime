# WD-1: what Plan mode did, and where it went

WD-1 removed Week › Plan (Plan the week, `ui/PlanWeek.tsx`) and Plan today (Plan the day, `ui/PlanDay.tsx`) along with the planning layout they shared (`ui/plan/PlanFrame.tsx`, `PlanHeader.tsx`, `UnitCard.tsx`). Each row below is something one of those screens did. "Where now" says where it lives after WD-1, or "Dropped" with the reason. Every write still goes through the same named actions (`weekplan.*`, `pick.*`, `draft.*`, `planday.commit`) on FocusTime's own plan store. Nothing new is written outside FocusTime.

## Plan the week (Week › Plan)

| What it did | Where now |
|---|---|
| The week grid at the top (Mon to Fri, AM over PM, a client per cell) | Week itself. The Board is the week grid; a day header opens Add work on that day |
| One client open at a time, the others one line each, J and K between clients | The panel follows the selected block's client. J and K are gone from Week (the panel has no client list). Clients with features elsewhere show under "Also this week" |
| Per-client fit and over line ("Northwind · 7h free · 9h planned", amber "about 2h over") | Client chips in Week's header ("Northwind 6h of 8h", amber when over), with the full line in the chip's popover |
| N of M clients planned | Dropped. The client chips show each client's state, and the week's tag says Draft, Confirmed or Changed since you confirmed |
| Musts and Nice to have lists | Add work › This week's features: a star makes a feature a must, no star is nice to have (`weekplan.set_tier`) |
| + Must and + Nice from DevOps | Placing a story adds its feature as nice to have (`pick.add` on the server, cached work only). "Add to this week" on a feature in More from DevOps (`weekplan.add`, nice) |
| Remove a feature from the week | The feature's ⋯ › Remove from this week, only when none of its stories is placed (else it names where they are) |
| Row ⋯: Move up and down, Make it a must or nice to have, Estimate, Pin to a block, Mark done, Ask to collaborate, Send to…, Set target date, Copy Coop brief, Create drafts in DevOps | The same menu (`weekItemMenu`) on each feature in Add work › This week's features, on the same actions |
| Drag to reorder within a list | Dropped as a drag. Move up and Move down in the feature's ⋯ do it (open question) |
| Drag a must onto one of its client's cells to pin it | + on a feature in the panel, or a drag of it onto a block, places it there as a placeholder (the same pin, `weekplan.place`, with Undo); the feature's ⋯ › Pin to a block too. Stories, promises and drafts drag the same way. Week's drop rule applies: another client's block refuses |
| Hours stepper on a feature row ("− 6h +") | The feature's ⋯ › Estimate |
| Needs stories, Break down | "Needs stories · Break down" on a placed feature with no stories (block card), in the panel's feature row, and under Not ready in the client chip's popover |
| Epic needs features (draft a feature under an epic) | The type box makes a draft story; a draft feature comes from Capture (Draft feature) or the draft editor. The panel doesn't list epics (open question) |
| A feature's detail (the detail panel) | The story card (FN-1): a feature's name in the panel opens it |
| DevOps health (a side panel of readiness flags: features with no stories, musts with no target date, Mark as being broken down, Ask the client about priorities, a draft feature under an epic) | Features with no stories: the client chip's badge and its popover's Not ready, with Break down. Missing dates, owners and sizes: Ahead › Readiness. The Coop brief: the feature's ⋯. Mark as being broken down and Ask about priorities: dropped from Week (open question) |
| Keep open for walk-ins | The client chip's popover |
| Nothing this week (marking a client quiet) | Dropped. A client with no features simply has none; its chip doesn't show |
| The type box: Enter a draft feature as a must, Shift+Enter a nice to have | The panel's type box makes a draft story on the block (Enter) or a plain to-do (Shift+Enter). Draft features: Capture |
| From last week | Add work › To place, and the "N to place" line above the grid |
| From your team (sends): Accept, Accept and schedule, Pass to…, Can't this week | Add work › To place (this week) |
| Watching and suggested to-dos | Add work › To place (Unfinished and its suggested cards) |
| Search (/) and Enter to add the first match | More from DevOps has its own search box |
| Done (Confirm week), then the Look ahead offer | Confirm week in Week's header. Confirming a future week offers Look ahead 4 weeks as before |
| Heads-up offer after a must is dropped or demoted | Dropped from the panel (open question) |
| Past weeks as a review | A past week shows no tag and no Confirm; the panel's ⋯ items say "A past week is a review" |

## Week's block card (the Board's cards)

| What it did | Where now |
|---|---|
| The status pill under the header, with its reason ("At risk · Dentist 12:00") | One status chip in the header that never wraps; the reason is in its tooltip ("At risk: Dentist 12:00") |
| The features line ("3 features · 1 needs stories"), opening the detail panel on the features | Dropped. The client chip's badge counts features that need stories; a placed feature with none says "Needs stories · Break down" on the card; Your stories opens from the card body |
| A "Plan" chip on a day header with nothing planned | Dropped (no button reads Plan). A day header opens Add work on that day |
| The hour rail with event titles (rail tier) | The slim strip (about 56 px) at every width, so to-do titles keep their width. Event titles are on hover and in the detail panel; a late promise's chip is on the card (the slim strip has no labels) |
| "+ Add to-do" | "+ Add", always the last row, opening Add work on the block |

## Plan the day (Plan today, Week focused on a day)

| What it did | Where now |
|---|---|
| Each block with its to-dos, fit said once | Week's block cards (fit in the status chip) |
| The agenda on the selected block (meetings, free gaps) | The detail panel's agenda (`ui/Agenda.tsx`), and the card's slim rail |
| Add to <client> <block>: this week's musts with their stories, promises, everything else | Add work: This week's features, Promises, More from DevOps |
| The client chooser for an Open half-day or catch-up | The same chooser at the top of Add work |
| + on a row, drag a row onto a block | The same, in Add work |
| Type a story (Enter), a plain note (Shift+Enter) | The type box at the foot of Add work |
| Size chip on a to-do | The to-do's ⋯ on its card (unchanged) |
| Timebox my day | A day header's ⋯ › Timebox my day (or Confirm and timebox), and the command menu |
| Confirm today, Confirm Tuesday | A day header's ⋯ › Confirm Tue, Nov 3, and the command menu's Confirm the day |
| Past days as a review (done and drop only) | Unchanged on the cards (done and drop). A past day's header, like a PTO day's, opens Add work on the next block that can take work |
| Trim suggestions when over | Dropped from the panel. The block's chip says Too much planned, and Check-in still offers moves |
| The day's headline ("7h of work · 6h 15m free") | The room line in the panel ("1h 45m free", "about 2h over") for the selected block |
