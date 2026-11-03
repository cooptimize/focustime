# UX review U1: audit, screen jobs and pruning plan

Nov 2, 2026. Read-only on the app: no code, config or data changed. Six screens: Today › Now, Today › Plan (Plan the day), Today › Check-in, Today › Close out, Week › Week and Week › Plan the week. Evidence first, then proposals for you to confirm.

## How this was measured

- **Demo:** a throwaway demo-mode server (fictional data, in-memory store, clock pinned to Mon Nov 2, 9:30 AM). The day was planned through the app's own actions: 4 picks in the morning (one done, one a follow-up), 4 in the afternoon (one an intention), committed. Both of Monday's blocks are at risk, and there are follow-ups that are overdue and due today. The failed source is Google, shown as cached with a network cause. I made it fail by rewriting the source status in the browser for that run only, because demo mode can't fail a source.
- **Live:** your running FocusTime, read-only, at about 12:50 PM. The browser only opened screens; no action was posted except the reads each screen makes on its own. Personal events, the PTO title and your photo are blurred. Work meeting subjects, client nicknames and item titles are not blurred, per your answer to question 5.
- **Sizes:** 1920x1080 dark for everything. 1920 light and 3840x1600 dark and light for each screen. When a screen scrolls inside its own panel, I also captured the next page (`-p2`, `-p3`).
- **Counts:** taken by a script in the page, over everything rendered on the screen, including the parts below the fold. They include the status bar but not the top bar, which is counted once in the cross-screen section.
  - *UI words:* every visible word except item, pick, meeting and follow-up titles and note text. Titles are counted separately.
  - *Elements:* buttons, links, inputs, badges, chips, tags and icons.
  - *Text styles:* distinct font size, weight, style, case and decoration.
  - *Colors:* distinct text, background and border colors in use, client colors included because the page doesn't mark them. Read every color count as an upper bound.
  - All counts are approximate (plus or minus 10%).
- **Click counts:** from opening the screen, in the demo, checked against the code (ui/*.tsx).
- **"How often it matters":** marked *(j)* where it is my judgment.

Screenshots are in `screens/demo/` and `screens/live/`, named `<width>-<theme>-<screen>[-p2|-failed].png`. Menus and panels are in `screens/demo/1920-dark-detail-*.png`.

## Your answers (verbatim)

0.1 On Today, during the day, what do you actually look at, and what do you never read?
> this is unnecessary at the top: Cooptimize focus until 12:30 PM. Next: CSC / Cooptimize • Weekly Feature Review at 1:00 PM.. under THIS WEEK i dont see a ton of value of listing these here. if the day is planned it should be focused on the calendar items and commited  planned user stories  - the feautres ear marked should be broken down. so maybe if those are listed at the bottom not top and indicated if they need decomposition

0.2 Mouse, keyboard, or both equally?
> mostly mouse, but having quick keys for keyboards if the application is used a lot is great.

0.3 Do you use the timeline rail on the block cards, or would a plain meeting list do?
> i love the timeline - and especially if it can timebox and show directly in the timeline grid.  it is cluttered at laptop width but on my mega wide monitor it is a pretty epic view.

0.4 The 2 or 3 moments where the app annoys you most.
> the day plan is pretty solid.. the check in and close out views are too busy. too much text and too listy.  i need better organization of things to focus on or something.  plan the week could be amazinng but eeds work.  I want to talk through the process of mid-long term planning and how that rolls into weekly planning, and subsequently day planning.  also it should be easy to get owrk items on the day... but also encourage and kind of enforce the devops driven updates and decompose to user story level.

Scope answers: 5 "live." (live screenshots committed, see the note at the end), 6 "include them all." (Check-in and Close out added), 7 "b" (the planning process is a section here, and we talk after).

## Summary: the top 5 problems

1. **Check-in and Close out repeat the whole plan as a list of forms.** Every pick that doesn't fit gets four buttons (Move to Tue, Move…, I'll make it up…, Drop), a progress bar and a size line.
   - Check-in: 348 UI words and 56 buttons for 8 picks. Close out: 330 words and 69 buttons. That is 2 to 2.5 times the words of Today or Plan the day for the same picks.
   - Check-in says "over" twice per block: a red line on the right ("about an hour more than the time left") and a red sentence below it (25 words). Fit in red breaks the wording guide ("Fit is never red").
   - In live Close out, dropped picks are full rows, and #7047 and #7056 each appear twice, once planned and once dropped.
   - *Evidence:* `demo/1920-dark-checkin.png`, `demo/1920-dark-closeout-p2.png`, `live/1920-dark-closeout-p2.png`.
2. **The same fact appears two to four times on a screen.**
   - Today: the next meeting is in the top line, the NEXT tag and the block's meeting list. The next pick is in the big Start focus card and in 8 per-row Start focus buttons.
   - Week: each meeting is in the card's list and again on the rail. "This week:" repeats 19 times, and Order history export is listed on 3 Northwind cards.
   - Musts progress appears in the Week header, Today's "This week" bar and Check-in's "Anything shifted?".
   - *Evidence:* `demo/1920-dark-now.png`, `demo/1920-dark-week.png`.
3. **Committed features take the top of each Today card; stories and the calendar sit lower.** You said the day should lead with calendar items and committed stories, with features at the bottom and flagged when they need breaking down.
   - Today puts "This week:" feature links above the meetings and picks.
   - The links look like DevOps links, but they open Plan the day for that feature.
   - Whether a feature needs stories ("needs more stories", "No stories yet") shows only deep in Plan the week, never where the day is planned or lived.
   - Plan the day's right pane accepts a free-typed intention ("Or type what you'll do…") with no nudge toward a story. Live has two such picks without a DevOps number.
4. **Plan the week is long, and its plan is spread over three places.**
   - The fit for each client is shown twice: in the Blocks legend ("Northwind 2 musts left · 3 planned, 2 available") and in each client header.
   - The block grid is 10 large cells that mostly say only the client name.
   - Next week shows 476 UI words and 292 title words; the list scrolls to 2,664 px.
   - Adding a must takes 5 to 6 clicks, plus a scroll, and the "+ Must" buttons are tiny.
   - Every must shows a "Finish this week, or at least start" subline.
   - *Evidence:* `demo/1920-dark-planweek-next.png` and `-p2`, `-p3`.
5. **Reasons and status hide behind hover, and controls that mean the same thing are worded differently.**
   - Hover-only:
     - "At risk" never says why, except in a tooltip or the Details dialog (`demo/1920-dark-detail-week-risk-hover.png`, `-week-details.png`).
     - Pick titles on Today open DevOps but don't look like links.
     - The Plan the week rows can be dragged to reorder, but nothing shows it.
   - Over plan is worded four ways: "About 3 hours over", "trim", "No longer fits" and "about an hour more than the time left".
   - The same client is "Northwind" on four screens and "Northwind Foods" on Check-in and Close out.
   - Week cards show "9:00 AM–12:30 PM" 5 times per row.
   - "Business hours" and "Timelines on" sit in the status bar on every screen, but only change Week.

## Counts, all six screens (1920x1080 dark)

| Screen | UI words (demo / live) | Title words (demo / live) | Elements (demo / live) | Text styles | Colors (upper bound) | Scroll |
|---|---|---|---|---|---|---|
| Today › Now | 157 / 119 | 78 / 87 | 87 / 74 | 22 | 29 | none |
| Plan the day | 136 / 145 | 93 / 109 | 78 / 98 | 25 to 27 | 24 to 27 | none |
| Check-in | 348 / 261 | 71 / 61 | 77 / 60 | 19 | 19 to 21 | panel, 1 page more (demo) |
| Close out | 330 / 230 | 69 / 87 | 86 / 62 | 22 to 23 | 17 to 27 | panel, 1.5 pages more |
| Week | 280 / 312 | 233 / 235 | 185 / 183 | 23 to 24 | 52 to 56 | grid scrolls 60 px |
| Plan the week (this week) | 401 / 478 | 114 / 253 | 115 / 128 | 21 to 22 | 20 to 24 | panel, 1.7 to 2.7 pages more |
| Plan the week (next week) | 476 / 373 | 292 / 97 | 140 / 111 | 21 | 20 | panel, 2.7 pages more |

- **Top bar on every screen:** 13 to 14 words and 8 elements.
- **A failed source** adds about 55 UI words on every screen: a source line on Today, plus a status bar that grows from one line to two, with five source chips and a cause line.
- **At 3840x1600:** Today and the rituals use the same words, but Today fills only the middle 42% of the screen (about 1,610 of 3,840 px). Week drops about 40 title words because the rail replaces the meeting list, but adds UI words for hour labels.

## Top jobs: clicks now and target

Counted from opening Today › Now (or the named screen), mouse first. *Key* is the keyboard path.

| Job | Now: clicks (key) | Path today, and what's in the way | Target |
|---|---|---|---|
| Start focus on the next pick | 1 (F) | Big Start focus card. Also 8 smaller Start focus buttons | 1 |
| Mark a pick done | 1 | Checkbox | 1 |
| Add a DevOps item to a block | 3 to 5 (P, then mouse) | Plan (mode switch) → choose the block → + on the item; +1 to open "Everything else" when the item isn't a priority; Done (+1) to finish. From Week: ⋯ → Add work… → type → choose (3 plus typing) | 2 |
| Move a pick to another block | 3 to 4 | ⋯ → Move → target, with a submenu for another day. 1 drag in Plan the day only. Check-in: 1 click "Move to Tue" | 2, or 1 drag on Today too |
| See why a block is at risk | 0 clicks but hover only (tooltip); Week: 2 (⋯ → Details, or select + Enter) | The reason is never written on the card | 0: a short reason on the card |
| Open an item in DevOps | 1 (title, no link look) or 2 (⋯ → Open in Edge); Week "This week:" links don't open DevOps | Hidden affordance; the links that do look like links do something else | 1, with a visible cue |
| Capture a follow-up | N + type + 0 to 1 (Follow-up chip) + Enter; Super+Alt+N anywhere | Fine | hotkey + Enter |
| Add a must to a client's week | 5 to 6 + a scroll | Week → Plan the week → (‹ to this week) → scroll to the client → "Add from DevOps" → + Must → Done | 3 |
| Reorder musts | 1 drag (no visible handle) or 2 clicks per step (⋯ → Move up) | Drag isn't discoverable | 1 drag with a handle |
| Finish Plan the day | 2 + one offer | Plan → (picks) → Done → "Timebox my day?" offer | 1 Done |
| Finish Plan the week | 3 | Week → Plan the week → Done | 2 |
| Switch between Today and Week | 1 (1 / 2) | Tabs | 1 |

On the path:
- Hover-only controls: risk reasons, rail labels (truncated "Team s…"), and the reasons on disabled menu items.
- Menus: every pick and every Plan the week row has a ⋯ with 8 to 10 entries. On a done pick, three of them are disabled with long reasons.
- Modals: Details, Timebox…, the write preview, Capture.

## Today › Now

Screens: `demo/1920-dark-now.png`, `demo/1920-dark-now-failed.png`, `demo/3840-dark-now.png`, `live/1920-dark-now.png`, `live/3840-dark-now.png`. Pick menu: `demo/1920-dark-detail-now-pick-menu.png`.

**Proposed job:** "What am I doing now, and what's next?" (unchanged from your draft).
- **Primary action:** Start focus on the next pick (or Stop and Done while focus runs).
- **Must be visible without interaction:**
  1. The current block, with its meetings and committed stories in time order, Now and Next marked.
  2. The next pick, as the one big action.
  3. Anything that needs attention today: an overdue or due-today follow-up, a failed source, an at-risk block, with the reason in words.
  4. The rest of today's blocks, compact.
  5. At the bottom, this week's features for today's clients, each flagged when it still needs stories.
- **Elsewhere:** sizes, timeboxing controls, the VM prompt (the VM chip), musts progress (Week), view switches (Week).

| # | Element | Data behind it | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | Title "Today" and the date | clock | orientation | rarely | yes, the tab | KEEP | Short; the date matters when planning ahead |
| 2 | Now line "Cooptimize focus until 12:30 PM. Next: … at 11:00 AM" | slots, events | what's now and next | sometimes | yes, the NEXT tag and the block's meetings | REMOVE | You never read it; Now and Next are on the rows |
| 3 | Follow-up alerts (Overdue 1 day, Due today), one row each | follow-ups | reply now | sometimes | yes: Week cards, Inbox, the pick list | KEEP, compressed | Needs attention. One line, "2 follow-ups due · Jordan Lee, Dana Morales", expands on click |
| 4 | Source line (when a source fails) | source status | trust the data, retry | rarely | yes, the status bar | KEEP | Truthful state. One line with Retry; the status bar line goes |
| 5 | VM prompt "Your VM is off. Start it?" with Start, Not today | VM state | start the VM | sometimes (mornings) | yes, the VM chip | MOVE | To the VM chip: it shows "Start" as its own action when the morning prompt applies |
| 6 | Start focus card (100 px tall, full width) | next pick | start | always | yes, 8 row buttons | KEEP, smaller | One primary; half the height; it can sit in the current block's header |
| 7 | Block header "Morning · 9:00 AM–12:30 PM" and the client name | slots | orientation | always | no | KEEP | One line: "Cooptimize · 9:00–12:30" |
| 8 | At risk pill | risk rules | is this block in trouble | sometimes | yes, Week | KEEP, with a reason | The reason in words after the pill ("Dentist overlaps 12:00") |
| 9 | "This week:" feature links (3 to 5 per card, above the meetings) | week plan features | plan from a feature | rarely | yes: Week cards, Plan the week | MOVE | To the bottom of Today, one row per feature, with "needs stories" flags (your answer 0.1) |
| 10 | Meetings in the block, with Now, Next and past dimmed | calendar | where the day goes | always | no (Now line removed) | KEEP | Your answer 0.1 |
| 11 | Pick rows: checkbox and title | picks | do and tick | always | no | KEEP | |
| 12 | Per-row "Start focus" button (8) | picks | start a pick other than the next | rarely | yes, the big card | ON DEMAND | Shows on hover and on the current row only |
| 13 | Size chip S/M/L per pick | pick size | none during the day | rarely | yes, Plan the day | REMOVE here | Sizes are for planning; stay in Plan the day |
| 14 | "+ time" per pick (7) | timeboxes | timebox now | rarely | yes, Plan the day | ON DEMAND | On hover; a timed pick still shows its time |
| 15 | ⋯ per pick | menu | move, drop, open, help | sometimes | no | KEEP | The one place for the rest |
| 16 | "Left off: …" resume note | notes | where to restart | sometimes | yes, Plan the day | KEEP for the current or next block only | |
| 17 | All day row, Before and After your blocks lines | calendar | the day outside the blocks | sometimes | no | KEEP | Step 17.6 |
| 18 | "This week" musts bar (per client "0 of 1 must done") | week plan | on track this week | rarely during the day | yes: Week header, Check-in | MOVE | To Week; Today's bottom row lists features instead (row 9) |
| 19 | "See the whole week" link | | go to Week | rarely | yes, the Week tab | REMOVE | The tab does it |
| 20 | Status bar: "All sources live · updated…", Business hours, Timelines on, Refresh | sources, view prefs | trust, refresh | rarely | yes, row 4 | KEEP the state dot and Refresh; MOVE the two view switches to Week | Quiet when healthy |

| Counts | Now (demo) | After pruning (estimate) |
|---|---|---|
| UI words | 157 | about 60 |
| Elements | 87 | about 35 |
| Text styles | 22 | about 10 |

**Confusion log**
- The top line repeats the NEXT tag. You don't read it (0.1).
- "This week:" links look like DevOps links but open Plan the day for that feature (title "Plan this block from that feature" on hover only).
- Pick titles open DevOps but look like plain text.
- "At risk" with no reason on the card, in demo or live.
- 9 Start focus targets on one screen (1 card, 8 rows).
- "NEXT" on a meeting row is uppercase, while the pill style elsewhere is sentence case ("At risk").
- At 3840, Today uses the middle 1,610 px of 3,840 and has no timeline, though you call the wide timeline the best view (0.3).
- Demo only: the status bar said "updated 3 h ago" because the demo clock was pinned while the real clock wasn't. It doesn't happen live.

## Today › Plan (Plan the day)

Screens: `demo/1920-dark-planday.png`, `live/1920-dark-planday.png`, `live/1920-light-planday.png`, `demo/3840-dark-planday.png`. Menu and fold: `demo/1920-dark-detail-planday-pick-menu.png`, `-planday-agenda-folded.png`.

**Proposed job:** "What goes in each block, and does it fit?" (unchanged).
- **Primary action:** Done.
- **Must be visible without interaction:**
  1. Each block's picks with sizes and fit in words.
  2. Each block's agenda with free gaps.
  3. For the selected block, this week's stories under their features, with Add.
  4. Features that still need stories, with Draft a story.
  5. Follow-ups owed to that client.
- **Elsewhere:** ticking done (Today), Start focus (Today), Check-in's actions.

You said "the day plan is pretty solid" (0.4). The pruning here is light.

| # | Element | Data | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | ‹ › and "Plan today" | dates | plan another day | sometimes | no | KEEP | |
| 2 | "About 11 hours of work · about 5 hours free" | fit | is the day overbooked | always | partly, the block fit words | KEEP | The day total; the one number that matters |
| 3 | Timebox my day button | timeboxes | place picks in gaps | sometimes | yes, the offer after Done | KEEP, secondary | |
| 4 | Done (green) | | commit | always | no | KEEP | One primary |
| 5 | "Your Monday" label | | | never | yes, the header | REMOVE | The layout says it |
| 6 | Block header: swatch, client, "Morning · 9:00 AM–12:30 PM" | slots | which block | always | no | KEEP | |
| 7 | Fit word "About 3 hours over" and "trim" | fit | trim | always | no | KEEP | Calm amber, the right tone |
| 8 | Pick rows: checkbox, title, size chip, + time, ⋯ | picks | size, time, move | always | no | KEEP; checkbox ON DEMAND | Ticking done belongs to Today |
| 9 | Agenda fold link "2 meetings · 1 personal · about 2 hours free" | calendar | fold | rarely | yes, the agenda below it | ON DEMAND | A small chevron instead of a sentence |
| 10 | Agenda rows with free gaps, Now and Next | calendar, timeboxes | where picks fit | always | no | KEEP | NEXT can go in planning (j) |
| 11 | "Left off: …" | notes | where to restart | sometimes | yes, Today | KEEP | Its home in planning |
| 12 | Right pane header "Add to Cooptimize Morning" | selection | target | always | no | KEEP | |
| 13 | "THIS WEEK'S PRIORITIES" and the subline "From your week plan." | | | rarely | | KEEP the label, REMOVE the subline | |
| 14 | Feature row: title, Must chip, "all on the plan" or "8 to add" | week plan | which stories remain | always | no | KEEP | Add "needs stories" when it has none |
| 15 | Story rows: "STORY" label, title, "Already planned here", ⋯ | stories | add | always | | KEEP the title and +; REMOVE "STORY" and the "Already planned here" text (a check says it) | |
| 16 | "+ Draft a story" | drafts | break a feature down | sometimes | no | KEEP, promoted | DevOps first (0.4) |
| 17 | FOLLOW-UPS section; "Nothing owed to W&C." when empty | follow-ups | pick a follow-up | sometimes | yes, Today | KEEP when not empty; REMOVE the empty line | |
| 18 | "EVERYTHING ELSE 3 more, in DevOps order" (folded) | items | other work | sometimes | no | KEEP | Counts over lists |
| 19 | "Or type what you'll do for X, then Enter" | intentions | free-text pick | sometimes | no | KEEP, changed | Offer "Make it a draft story" on Enter (open question 3) |
| 20 | Status bar | | | | as Today | as Today | |

| Counts | Now (demo) | After (estimate) |
|---|---|---|
| UI words | 136 | about 95 |
| Elements | 78 | about 60 |

**Confusion log**
- The fold link is a sentence of numbers that reads as a summary, not a control.
- "STORY" is shown on every row of a list that only holds stories.
- "Must" chip next to "all on the plan" and "8 to add": two different kinds of count on one row.
- "trim" is a link with no verb ("Trim to fit"?).
- Live: the help session's title is repeated in full on its pick row and its agenda row.

## Today › Check-in

Screens: `demo/1920-dark-checkin.png`, `demo/1920-dark-checkin-p2.png` (in the demo it scrolls), `live/1920-dark-checkin.png`.

**Proposed job:** "Is the rest of today still realistic, and what moves?"
- **Primary action:** Done. The second action is one Move per pick that no longer fits.
- **Must be visible without interaction:**
  1. Time left per remaining block after meetings.
  2. Only the picks that no longer fit, each with one suggested move.
  3. A one-line musts question for the week ("Still realistic?"), expandable.
- **Elsewhere:** done and fitting picks (a count), focused time (Close out), walk-on work (Capture and Today), the musts list (Week).

| # | Element | Data | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | Title "Check-in Mon, Nov 2, 9:30 AM" | clock | | rarely | | KEEP, without the time | |
| 2 | Done | | finish | always | | KEEP | |
| 3 | Block header "Morning Cooptimize 9:00 AM to 12:30 PM · about 2 hours left after meetings" | slots, calendar | time left | always | | KEEP, shorter | "Morning · Cooptimize · 2h left" |
| 4 | Right-hand red "about an hour more than the time left" | fit | | always | yes, row 5 | REMOVE | Duplicate; fit in red breaks the wording guide |
| 5 | Red sentence "About an hour more planned than the time left. What should move? Carry over, move, drop or make up one of the picks marked 'No longer fits'." | fit | | always | yes, row 4 | KEEP one short amber line | "About 1h over. Move one?" |
| 6 | Done and "Fits" pick rows, full size | picks | none | rarely | yes, Today | ON DEMAND | "2 done · 1 fits" as a count, expand to see |
| 7 | "No longer fits" pick rows | picks, fit | move it | always | no | KEEP | The point of Check-in |
| 8 | Four buttons per row: Move to Tue, Move…, I'll make it up…, Drop | actions | move | always | yes, ⋯ | KEEP "Move to Tue" (the suggestion); ON DEMAND the rest (⋯) | One primary per row |
| 9 | "#4412" ids before titles | DevOps id | | rarely | | ON DEMAND | Hover or ⋯ |
| 10 | Progress bar and "0m of S (1h)" per row | focused time, size | how much was done | rarely mid-day | yes, Close out | MOVE | To Close out |
| 11 | "Add walk-on work…" per block | | log unplanned work | sometimes | yes, Capture | ON DEMAND | One link at the bottom, not per block |
| 12 | "Anything shifted?" and its subline | week plan | swap musts | sometimes | yes: Week header, Today bar | ON DEMAND | One line: "Musts: 3 clients, 1 tight. Review" expands |
| 13 | Per client line "0 of 2 musts done · 2 musts left, 2 blocks left. Still realistic?" | week plan | | sometimes | | inside 12 | |
| 14 | Per must: MUST label, #id link, "Make nice to have", "Needs help…" | week plan | demote, get help | rarely | yes, Plan the week ⋯ | inside 12; "Needs help…" ON DEMAND | |
| 15 | Empty right third of the screen at 1920 | | | | | layout | Use it, or center |

| Counts | Now (demo) | After (estimate) |
|---|---|---|
| UI words | 348 | about 110 |
| Elements | 77 | about 30 |

**Confusion log**
- Over plan is said twice per block, both in red.
- Done picks show "Done" and a progress bar reading "0m of M (2h)" that looks broken. You ticked it without timing it.
- "Northwind Foods" here vs "Northwind" on Today and Week.
- "Make nice to have" and "Make a must" buttons look like states, not actions.
- "Needs help…" is faint grey text that is a button.
- With the clock past the morning, live shows "· ended" on the morning block, yet four of its picks still offer Move.

## Today › Close out

Screens: `demo/1920-dark-closeout.png`, `demo/1920-dark-closeout-p2.png`, `live/1920-dark-closeout.png`, `live/1920-dark-closeout-p2.png`.

**Proposed job:** "What got done, what carries over, and what do I owe?"
- **Primary action:** Done.
- **Must be visible without interaction:**
  1. Picks not done, each with one carry-over suggestion. Done picks as a count.
  2. A where-you-left-off line per client worked today.
  3. Follow-ups due today or overdue, with Close the loop.
  4. DevOps updates owed (Mark done in DevOps).
- **Elsewhere:** the capture box (N), other follow-ups (Inbox), dropped picks (a count).

| # | Element | Data | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | Title, ‹ ›, Done | | finish | always | | KEEP | |
| 2 | "1. Picks 0m focused of 11h planned" | focus time | how the day went | sometimes | | KEEP | The one summary number |
| 3 | MORNING / AFTERNOON labels | | | sometimes | | KEEP | |
| 4 | Pick rows not done: #id, title, client name, progress bar, "0m of M (2h)", four buttons | picks | carry over | always | yes, Check-in | KEEP the title and one carry-over button; ON DEMAND the rest; REMOVE the client name (the section says it) | |
| 5 | Done pick row with "Done" text and a centered "Enable DevOps writes" | picks, DevOps access | update DevOps | sometimes | yes, row 10 | REMOVE the text; MOVE the DevOps update to row 10 | |
| 6 | Dropped picks as full rows (live: 6) | picks | none | rarely | yes, the same item planned and dropped | ON DEMAND | "3 dropped" |
| 7 | "2. Where you left off", the subline and the "+ Another client" select | notes | write a note | always | | KEEP the inputs; REMOVE the subline; ON DEMAND the select | |
| 8 | "1 capture to sort into follow-ups or drafts. Sort captures" | captures | sort | sometimes | yes, Inbox count | KEEP as a count | |
| 9 | "3. Follow-ups 5 open, 2 due by today still open" | follow-ups | | always | | KEEP | |
| 10 | Capture box, 4 kind chips, "Enter saves", Tip line | capture | add a follow-up | rarely | yes, Capture (N) | REMOVE | Capture is global; one "+ Follow-up" link at most |
| 11 | Follow-up cards: ADDED BY ME, NEW TODAY, due badge, who, what, meta line (client · opened … · on Teams), Close the loop, ⋯ | follow-ups | close | always | yes, Inbox | KEEP the badge, who, what and Close the loop; REMOVE ADDED BY ME and NEW TODAY; ON DEMAND the meta line | |
| 12 | DevOps update follow-up with "Enable DevOps writes" or "Mark done in DevOps" | follow-ups, DevOps | update DevOps | always when present | | KEEP, promoted | DevOps first (0.4) |
| 13 | Follow-ups not due yet ("OTHER OPEN FOLLOW-UPS") | follow-ups | | rarely | yes, Inbox | ON DEMAND | "3 more in Inbox" |

| Counts | Now (demo) | After (estimate) |
|---|---|---|
| UI words | 330 | about 120 |
| Elements | 86 | about 35 |

**Confusion log**
- Live: #7047 and #7056 appear twice, once as planned and once as "Dropped".
- "Enable DevOps writes" floats centered under a done pick with no context.
- "NEW TODAY" on every follow-up (all were added today in the demo) says nothing.
- The section numbers 1, 2 and 3 suggest a sequence that Done doesn't enforce.
- The client name repeats on every row of a block that is already one client.

## Week › Week

Screens: `demo/1920-dark-week.png`, `demo/1920-dark-week-p2.png`, `demo/3840-dark-week.png`, `live/1920-dark-week.png`, `live/3840-dark-week.png`. Panels: `demo/1920-dark-detail-week-details.png`, `-week-block-menu.png`, `-week-risk-hover.png`.

**Proposed job:** "Is the week on track, and where's the trouble?" (unchanged).
- **Primary action:** open the trouble: a day's Plan, or a block's details.
- **Must be visible without interaction:**
  1. Per day: planned or not.
  2. Per block: client, at risk with the reason, and committed stories.
  3. The timeline of meetings and timeboxes on each block.
  4. Musts progress per client, once, in the header.
  5. PTO and Friday.
- **Elsewhere:** the full feature list for each block (Plan the week), follow-up text (Inbox), sizes and + time (Plan the day).

| # | Element | Data | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | ‹ ›, "Week of Nov 2–6, 2026" | dates | other weeks | sometimes | | KEEP | |
| 2 | "Musts Cooptimize 0/1 · Northwind 0/2 · …" | week plan | on track | always | yes: Today bar, Check-in | KEEP | Its one home |
| 3 | Day header: day, date, Today, Planned ✓ / Plan chip, ⋯, PTO pill | day plans, PTO | plan a day | always | | KEEP | |
| 4 | "ALL DAY" row ×5 (empty in demo) | calendar | | rarely | | ON DEMAND | Only when a day has one |
| 5 | "BEFORE 9 AM" and "AFTER 5 PM" rows ×5, mostly empty | calendar | | rarely | | ON DEMAND | Only when something is there |
| 6 | Card label "AM 9:00 AM–12:30 PM" ×10 | slots | | rarely | yes, every card in the row | REMOVE the time range | One AM / PM label per row, like Plan the week |
| 7 | Client name and swatch | focus time | | always | | KEEP | |
| 8 | "THIS WEEK:" lines (19 in demo; the same feature on several cards) | week plan | | rarely | yes, Plan the week | ON DEMAND | "3 features" expands, or only features pinned to this block |
| 9 | "FOLLOW-UP" lines with badge and text (8) | follow-ups | | sometimes | yes: Today, Inbox | ON DEMAND | Keep the due badge only ("Overdue 1 day") |
| 10 | At risk pill | risk | trouble | sometimes | | KEEP, with a reason | "At risk · Dentist 12:00" |
| 11 | Pick rows: checkbox, title, size, + time, ⋯ | picks | | sometimes | yes, Today | KEEP checkbox and title; ON DEMAND size, + time | |
| 12 | Meeting list in the card | calendar | | sometimes | yes, the rail | ON DEMAND at 1920; REMOVE at 3840 | Your answer 0.3: keep the timeline |
| 13 | Timeline rail with labels and free durations | calendar, timeboxes | timebox by drag | always | yes, row 12 | KEEP | Your answer 0.3 |
| 14 | "+ Add work" on the selected card | | add | sometimes | yes, ⋯ → Add work | KEEP on hover and selection | |
| 15 | Friday "Not a working day" ×2 | hours | | rarely | | REMOVE one | One line for the day |
| 16 | Evening strip "5:30 Run club" | calendar | | sometimes | | KEEP | |
| 17 | Status bar view switches (Business hours, Timelines on) | prefs | | rarely | | MOVE | Into the Week header's ⋯ |

| Counts | Now (demo) | After (estimate) |
|---|---|---|
| UI words | 280 | about 110 |
| Title words | 233 | about 120 |
| Elements | 185 | about 90 |
| Colors (upper bound) | 56 | about 30 |

**Confusion log**
- Live: "THIS WEEK: …" lines on Mon AM and Tue AM show only an ellipsis.
  - Cause, measured in the page: the label plus a long title is wider than the card's line, so the title wraps to a second line that's clipped, leaving the line's "…".
  - On Mon AM it is "FocusTime - Cooptimize Work Management App".
- Live: the same feature is listed twice on one card (Wed AM "Create Alert Framework in DWM", Tue PM "Resource Data Model"). It's likely listed once as pinned here and once as unpinned for the client.
- "At risk" never says why on the card. The reason is in a tooltip and in Details ("At risk: Personal").
- In the demo, the Dentist (12:00 to 1:00) shows in the PM card's list as "12:00 Dentist", at the bottom, after 3:00.
- The truncated rail labels ("Team s…", "Propos…") are the only place some meetings show at 1920 when the list is folded.
- The Details dialog (Enter) holds things found nowhere else: the DevOps "assigned to you" list and the free gaps. It covers the whole week.
- At 3840 the cards use the space well, but text stays 11 to 13 px on a screen 3,840 px wide.

## Week › Plan the week

Screens:
- This week: `demo/1920-dark-planweek.png`, `-p2`, `live/1920-dark-planweek.png`.
- Next week: `demo/1920-dark-planweek-next.png`, `-p2`, `-p3`, `live/1920-dark-planweek-next.png`.
- Row menu: `demo/1920-dark-detail-planweek-row-menu.png`.

**Proposed job:** "What are the musts for each client, and are they broken into stories?" I added "broken into stories" to your draft because of your answer 0.4.
- **Primary action:** + Must on a DevOps item, then Done.
- **Must be visible without interaction:**
  1. Per client: blocks this week and the fit in words.
  2. The musts, in order, each with its story count, flagged when it needs stories.
  3. One "Add from DevOps" list per client, folded to a count.
  4. Nice to haves, folded to a count.
  5. DevOps health as a count.
- **Elsewhere:** follow-ups and days off (Week), the full block grid (on demand), done counts (Week).

| # | Element | Data | Decision or action | How often *(j)* | Duplicate? | Class | Reason |
|---|---|---|---|---|---|---|---|
| 1 | "Plan the week of Nov 9 · next week", ‹ › | | which week | always | | KEEP | |
| 2 | "Planned Mon, Nov 2, 9:31 AM" or "Changed since planned (…)" | commit | re-commit? | sometimes | | KEEP "Changed since planned"; ON DEMAND the time | |
| 3 | Refresh DevOps button | | refresh | rarely | yes, R and Refresh | MOVE | To ⋯ (R still works) |
| 4 | Done, mode switch | | commit | always | | KEEP | |
| 5 | Strip "5 open follow-ups · 1 day off" | follow-ups, PTO | | rarely | yes: Week, Inbox | REMOVE | Not about musts; PTO already removes blocks |
| 6 | "DevOps health 6 to look at" (folded) | DevOps | fix the backlog | sometimes | | KEEP | DevOps first |
| 7 | "Blocks" heading and the sentence "Click a block to see its client's list. Drag an item onto a block to pin it there (optional)" | | | rarely | | REMOVE the sentence | A one-time hint at most |
| 8 | Blocks legend per client: "2 musts left · 3 planned, 2 available" | budget, fit | | always | yes, every client header | REMOVE | Keep it on the client header only |
| 9 | Block grid, 10 cells with client names and pins (180 px tall) | slots, pins | pin, filter | sometimes | yes, Week | ON DEMAND | A thin strip; tall cells only while dragging a pin |
| 10 | Client filter chips and Search | | filter | sometimes | | KEEP | |
| 11 | Client header: name, "· 1 block", fit words, "0 of 1 must done", "Not counted: Wed AM: mostly meetings" | budget | is the client over | always | yes, row 8 | KEEP name, blocks and fit; ON DEMAND done and "Not counted" | |
| 12 | MUST and NICE TO HAVE labels with sublines ("Finish this week, or at least start", "If there's room") | | | rarely | | KEEP the labels; REMOVE the sublines | |
| 13 | Feature row: title link, state word, "2 of 2 stories open", − 1 block +, pin, ⋯ | week plan | size, pin | always | | KEEP title, stories and blocks; ON DEMAND the state word and stepper (hover) | |
| 14 | "needs more stories", "No stories yet", "Raise to 2?" | estimate | break it down | always when present | | KEEP, promoted | Make it the row's flag and action: "Needs stories · Draft one" (0.4) |
| 15 | Story rows: title, state, "Story" chip, size, ⋯ | stories | size | sometimes | | KEEP title and size; REMOVE the "Story" chip | |
| 16 | "Done (picked and ticked)" | picks | | rarely | | KEEP as a check | |
| 17 | "Add from DevOps N not on the list" (folded, small) | DevOps | add | always | | KEEP, larger | It is the primary path |
| 18 | Next week's list: every DevOps item with "Feature · Active · target Nov 20", "+ Must", "+ Nice to have" | DevOps | add | always | | KEEP the title and + Must; ON DEMAND the meta and Nice to have | |
| 19 | "STORIES UNDER #4430 …" group headers | DevOps | | sometimes | | KEEP | |
| 20 | Status bar | | | | | as Today | |

| Counts | Now (demo, next week) | After (estimate) |
|---|---|---|
| UI words | 476 | about 180 |
| Title words | 292 | about 150 (folded lists) |
| Elements | 140 | about 70 |
| Scroll | 2.7 pages | about 1.5 pages |

**Confusion log**
- The fit is shown twice per client (legend and header).
- The "1 block" stepper looks like a chip with − and + floating beside it.
- "Story" pill chips look like buttons and aren't.
- A row can be dragged to reorder, but there is no handle.
- In the demo, Thursday is "Day off" on both rows but shows a client color edge.
- The blocks grid shows "No block" on Friday twice.
- The ⋯ menu on a feature has 10 entries. Three are disabled with reasons ("Already first", "Already last", "Enable DevOps writes first").
- Live: "Changed since planned" in amber with the time, but no hint about what changed.

## Cross-screen issues

- **Navigation and modes.** The tabs and mode switch are clear and consistent. Today has four modes, and three of them list the same picks again with their own controls: Now (checkbox, Start focus, + time, ⋯), Check-in (four buttons) and Close out (four buttons). The pick row component (PickRow) isn't reused in Check-in and Close out.
- **One primary action per screen.**
  - Today: 1 big button plus 8 copies.
  - Check-in and Close out: Done plus a primary-looking button on every row.
  - Plan the week: Done plus "+ Must" on every row.
- **The detail panel.** Week's Details is a centered modal that covers the week. It is the only place that shows the DevOps "assigned to you" list and the free gaps in words, and Today has no Details at all. Proposal: one right-side panel shared by Week and Today, opened by clicking a block, so the timeline stays visible.
- **Menus.** The ⋯ menus are complete but long, and they show disabled items with their reasons inline. Proposal: hide disabled items unless the item is the one you would expect ("Move" on a done pick), and put the reason in a tooltip.
- **Terminology.**
  - Over plan: "About 3 hours over", "trim", "No longer fits" and "about an hour more than the time left".
  - Week features: "This week:", "THIS WEEK'S PRIORITIES", "Musts" and "Anything shifted?".
  - Notes: "Left off:" and "Where you left off".
  - Client names: "Northwind" and "Northwind Foods".
  - DevOps links: "Open in Edge", the DevOps id links and the "This week:" links, each acting differently.
  - Item types: "STORY", "Story" and "User Story".
  - The next meeting: "NEXT" and "Next:".
- **Badges and status.**
  - Risk is a pill without a reason.
  - Due badges are consistent and good.
  - Fit is red in Check-in but amber in Plan the day.
  - The "Must" chip, the "Story" chip, the size chips and the stepper all use the same pill shape for different roles: state, type, value and control.
- **Status bar.** One line when healthy, which is good. The view switches (Business hours, Timelines on) appear on every screen, but they're Week's.
- **Top bar.** 8 elements. The VM chip and Today's VM prompt say the same thing.
- **Width.**
  - Today is a centered 1,116 px column at 1920 and about 1,610 px at 3840.
  - Check-in and Close out are 1,400 px, left-aligned, with an empty right third.
  - Week and Plan the week use the full width.
- **Text styles and colors.**
  - 19 to 27 text styles per screen; the style guide has 7 type steps.
  - Up to 56 colors on Week, client colors included.
  - Most of the extra styles come from one-off small labels: uppercase 11 px, 12.5 px muted, 12 px bold and similar.
- **Shared by all four core screens.**
  - One block card (header, risk with reason, meetings or rail, story rows) in Today, Week and Plan the day, at three densities.
  - One pick row with hover actions.
  - One "needs stories" flag on features.
  - One fit word set in amber.
  - One detail panel.

## Planning process: my reading of the chain today (for our talk)

This is a starting point for the conversation you asked for (7b), not a proposal.

1. **Roadmap › Plan ahead (12 weeks).**
   - Features and epics I own, with Start and Target dates from DevOps or estimated.
   - Whole blocks per feature, in week cells.
   - "Look ahead 4 weeks" every other Thursday, and a direction review monthly.
2. **Week › Plan the week (next week).**
   - Per client: musts and nice to haves from DevOps in stack rank order.
   - Features count in whole blocks; their stories nest under them as the envelope.
   - Optional pins to a block.
   - Done commits the week.
3. **Today › Plan (each morning).**
   - Per block: the week's priorities for that client first, then follow-ups, then everything else.
   - Stories become picks sized S, M or L.
   - Done commits the day; Timebox my day places the picks into gaps.
4. **Check-in (after lunch)** and **Close out (end of day)**. These re-fit the day, carry picks over, write the note and close follow-ups.

Where it seems to break, from the evidence:
- **Features flow down, but stories are created too late.** A feature can be a must with "No stories yet" (live: 2 of Cooptimize's musts next week). The first place you can add one of its stories to a block is Plan the day, and the only nudge is "needs more stories" in Plan the week. Nothing on Today or Week says a committed feature has no stories.
- **Free text gets around DevOps.** Plan the day takes a typed intention, and Close out's capture box takes a draft story, without asking for it to reach DevOps. Live Today has 2 of 7 picks without a DevOps number.
- **Two places set blocks per feature.** Plan ahead's week cells and Plan the week both set them. Plan ahead's 12-week view and the week's musts are linked only through those numbers.
- **Three rhythms, no line between them.** Look ahead every other Thursday, the direction review monthly and Plan the week weekly each sit in a different place. None of them shows the next level down ("this month's features → this week's musts → today's stories") in one view.

Questions to start with:
- **What is a "must" for you?** A feature, a story, or either? Today it can be both, which is why blocks and sizes mix.
- **Should breaking a feature down be a gate?** For example, a must can't be committed without at least one story, with a "Draft stories" step and a Coop brief inside Plan the week.
- **Should the day show only stories?** Features would appear only as the "needs stories" row at the bottom.

## Open questions for you

1. Do you confirm the six screen jobs above? I changed Plan the week's to "What are the musts for each client, and are they broken into stories?"
2. Today at 3840: should Today use the width for a day timeline (like Week's rail) with the picks beside it, rather than a centered column? Your answer 0.3 suggests yes.
3. In Plan the day, should typing an intention offer "Make it a draft story" by default (DevOps first), or stay free text?
4. Should Check-in and Close out keep their own pages, or become a panel over Today › Now (a "re-fit" state of the same cards)?
5. Is the VM prompt worth a row on Today, or is the chip enough?
6. On Week at 1920, should the rail replace the meeting list (one home per fact), with full titles on hover?

## Screenshots in the repo

- At your request (answer 5, "live"), live screenshots are committed under `screens/live/`.
- This is an exception to the CLAUDE.md rule that repo screenshots come from demo mode only. It's recorded here; `docs/decisions.md` wasn't changed because this step writes only under `docs/ux/`.
- Personal events (titles and rail labels), the PTO title and the profile photo are blurred. No email addresses, tenant or app IDs, tokens or DevOps URLs are visible in any screenshot. The browser shows no URL bar, and no menu that shows the account was opened.
