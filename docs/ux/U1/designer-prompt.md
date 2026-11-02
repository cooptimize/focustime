# Design brief: Coopilot UX overhaul (U1)

You are a principal UI/UX designer with deep experience in dense productivity tools for experts (calendars, planning, issue trackers). You cut ruthlessly, design for an economy of clicks, and defend every pixel.

You can't see the code. Everything you need is in this brief and the attached files (listed at the end). Read `report.md` alongside this brief: it holds the full element inventories, counts and confusion logs.

## 1. What Coopilot is

Coopilot is a local desktop app for one consultant at Cooptimize, a consulting firm. It plans the week and protects focus time. It runs as a web page in a browser app window on Linux (Omarchy). It has no AI in the working views.

- **Coopilot vs Coop.** Coopilot is this app. Coop is a separate coding agent the firm runs inside client environments. They are unrelated, visually and in wording.
- **Clients.** The user works for several clients each week. "Internal" counts as a client. Each client has a color, used only as a thin edge and a small swatch, never a fill.
- **Focus block.** A half-day (morning or afternoon) set aside for one client. The week is Monday to Thursday, 8 blocks. Friday is a catch-up day.
- **Sources.** Read live: Dataverse (who has which block, time off), Outlook and Google calendars (meetings and personal events), Azure DevOps (work items). Each source can be live, cached (with a time) or failed (with a cause and a fix).
- **DevOps first.** If it isn't in DevOps, it isn't planned yet. Work is planned as DevOps features (worth whole blocks) broken into user stories (sized S about 1 hour, M about 2 hours, L about a block). Coopilot should make breaking a feature into stories, and keeping DevOps up to date, the easy path.
- **Pick.** One planned piece of work in a block for a day: usually a DevOps story, sometimes a follow-up or a typed intention.
- **Must / Nice to have.** A week's list per client. Musts should be done or at least started this week. Nice to haves are done if there's room.
- **Follow-up.** Something the user owes someone (an answer, an update). It has a due date and is closed with "Close the loop".
- **Timebox.** A pick placed at a time in the day. It can optionally be put on Outlook, through a preview and confirm.
- **At risk.** A block threatened by meetings or personal events, always with a stated reason.
- **Lumen.** The brand mascot, an upright green block that emits light. It never appears in working views.

### The daily and weekly rhythm

- **Plan the week** (Week › Plan the week, usually Friday or Monday): choose each client's musts from DevOps, in stack rank order, and check they fit the client's blocks.
- **Plan the day** (Today › Plan, each morning): put stories into each block, check the fit, optionally timebox.
- **Check-in** (Today › Check-in, after lunch): is the rest of the day still realistic, and what moves?
- **Close out** (Today › Close out, end of day): what got done, where I left off per client, follow-ups I owe.
- Longer range: **Roadmap › Plan ahead** shows a 12-week timeline of features, with a look-ahead every other Thursday and a monthly direction review. It's out of scope for this round, but the week should feel connected to it.

### Navigation (keep it)

- **Top bar:** the mark and "Coopilot", then four tabs: Today · Week · Roadmap · Inbox (keys 1 to 4).
- **Right of the top bar:** a VM status chip, Focus (the timer), Capture, ⋯ (Commands, Keyboard shortcuts) and the user's photo.
- **Mode switch:** each tab has one at the right of its page header. Today: Now · Plan · Check-in · Close out. Week: Week · Plan the week. A ✓ shows when a mode is done, a small dot while it's due. Planning modes have a green Done.
- **Status bar:** at the bottom, one line when all sources are live.

## 2. Who uses it and how

- **One expert user, all day,** on two screens:
  - 1920x1080, often over a Moonlight stream from a laptop;
  - a 3840x1600 ultrawide.
- **Mostly mouse.** Keyboard shortcuts must stay for frequent actions.
- **ADHD-friendly:** low noise, one clear next step, nothing to read that doesn't change a decision.
- **The user's own words** (answers to four questions, verbatim, typos kept):

  > **On Today, what do you look at and never read?** this is unnecessary at the top: Cooptimize focus until 12:30 PM. Next: CSC / Cooptimize • Weekly Feature Review at 1:00 PM.. under THIS WEEK i dont see a ton of value of listing these here. if the day is planned it should be focused on the calendar items and commited  planned user stories  - the feautres ear marked should be broken down. so maybe if those are listed at the bottom not top and indicated if they need decomposition

  > **Mouse or keyboard?** mostly mouse, but having quick keys for keyboards if the application is used a lot is great.

  > **The timeline rail on block cards?** i love the timeline - and especially if it can timebox and show directly in the timeline grid.  it is cluttered at laptop width but on my mega wide monitor it is a pretty epic view.

  > **What annoys you most?** the day plan is pretty solid.. the check in and close out views are too busy. too much text and too listy.  i need better organization of things to focus on or something.  plan the week could be amazinng but eeds work.  I want to talk through the process of mid-long term planning and how that rolls into weekly planning, and subsequently day planning.  also it should be easy to get owrk items on the day... but also encourage and kind of enforce the devops driven updates and decompose to user story level.

## 3. The screens in scope

Six screens. The first four are the core; Check-in and Close out were added because the user named them as the busiest. Screenshots are in `screens/demo/` (fictional data) and `screens/live/` (the user's real data; personal events blurred). Names are `<width>-<theme>-<screen>[-p2|-failed].png`, and `-detail-` files show menus and panels.

### Today › Now (`1920-dark-now.png`, `1920-dark-now-failed.png`, `3840-dark-now.png`)

**Today:** a centered column.
- At the top: a sentence naming the current block and the next meeting, then one row per due follow-up and a VM prompt.
- Then a full-width green "Start focus" card, and two block cards side by side. Each card has "This week:" feature links, the block's meetings, and picks, each with Start focus, a size chip, "+ time" and ⋯.
- At the bottom: a "This week" musts bar and "See the whole week".

157 UI words, 87 elements, 22 text styles. At 3840 it fills only 42% of the width and has no timeline.

**Proposed job:** "What am I doing now, and what's next?"
- **Primary action:** Start focus on the next pick.
- **Visible without interaction:**
  - the current block's meetings and committed stories in time order, with Now and Next;
  - the next pick;
  - what needs attention (an overdue follow-up, a failed source, at risk with its reason);
  - the other blocks, compact;
  - at the bottom, this week's features flagged when they still need stories.

### Today › Plan, "Plan the day" (`1920-dark-planday.png`, `live/1920-dark-planday.png`)

**Today:** two panes.
- **Left:** each block with its picks (size, + time, ⋯), a fit word ("About 3 hours over · trim") and its agenda with free gaps.
- **Right:** for the selected block, this week's priorities (features with their stories and +), then follow-ups, "Everything else" (folded), "+ Draft a story" and a free-text box for an intention.

136 UI words, 78 elements. The user calls it "pretty solid".

**Proposed job:** "What goes in each block, and does it fit?"
- **Primary action:** Done.

### Today › Check-in (`1920-dark-checkin.png`, `-p2`, `live/1920-dark-checkin.png`)

**Today:** one long list per block. Every pick is a full row with a status word, a progress bar and "0m of M (2h)". Every pick that no longer fits gets four buttons (Move to Tue, Move…, I'll make it up…, Drop). "Over" is said twice per block, both in red. Below the blocks, "Anything shifted?" lists every must per client with "Make nice to have" and "Needs help…". 348 UI words, 77 elements.

**Proposed job:** "Is the rest of today still realistic, and what moves?"
- **Primary action:** Done, with one suggested move per pick that no longer fits.

### Today › Close out (`1920-dark-closeout.png`, `-p2`, `live/1920-dark-closeout-p2.png`)

**Today:** three numbered sections.
1. Picks, each with the four buttons and a progress bar; live also lists dropped picks as full rows.
2. Where you left off: one input per client.
3. Follow-ups: a full capture box with four kind chips, then cards tagged ADDED BY ME and NEW TODAY, each with a meta line and Close the loop.

330 UI words, 86 elements.

**Proposed job:** "What got done, what carries over, and what do I owe?"
- **Primary action:** Done.

### Week › Week (`1920-dark-week.png`, `3840-dark-week.png`, `live/1920-dark-week.png`, `live/3840-dark-week.png`, details `1920-dark-detail-week-details.png`)

**Today:** five day columns, each with AM and PM cards. Every card repeats:
- "AM 9:00 AM–12:30 PM";
- a "THIS WEEK:" line per feature (19 in the demo);
- "FOLLOW-UP" lines;
- an At risk pill with no visible reason;
- picks with size, + time and ⋯;
- a meeting list, and a timeline rail showing the same meetings with free time.

Empty "ALL DAY", "BEFORE 9 AM" and "AFTER 5 PM" rows show on every day. At 3840 the rail becomes a full hour timeline and drops the meeting list. 280 UI words, 233 title words, 185 elements.

**Proposed job:** "Is the week on track, and where's the trouble?"
- **Primary action:** open the trouble (a day's Plan, a block's details).

### Week › Plan the week (`1920-dark-planweek-next.png`, `-p2`, `-p3`, `1920-dark-planweek.png`, `live/1920-dark-planweek-next.png`, menu `1920-dark-detail-planweek-row-menu.png`)

**Today:**
- **Top:** a summary strip, DevOps health (folded), "Blocks" with an instruction sentence, a per-client legend, and a 10-cell block grid.
- **Then:** filter chips and search.
- **Per client:**
  - a header with blocks, fit words and done count;
  - MUST and NICE TO HAVE with sublines;
  - feature rows with story counts, a − 1 block + stepper, a pin and ⋯;
  - nested story rows with a "Story" chip and size;
  - a small "Add from DevOps N not on the list".

Next week, unplanned, lists every DevOps item with "+ Must" and "+ Nice to have". 476 UI words, 292 title words, 140 elements, 2.7 screens of scroll.

**Proposed job:** "What are the musts for each client, and are they broken into stories?"
- **Primary action:** + Must, then Done.

## 4. The pruning plan (from report.md; critique it)

Rules applied:
- Quiet when healthy: show only what needs attention (at risk, slipped, failed source, blocked, overdue).
- One primary action per card; the rest in ⋯ or the detail panel.
- Labels only where layout doesn't already say it.
- Counts over lists ("3 musts" expands on click).
- Numbers only when they change a decision.
- One home per fact.
- No feature is lost: whatever leaves a screen is reachable elsewhere, or is proposed for deletion.

Main moves, per screen (full tables in report.md):
- **Today › Now.**
  - Remove: the top sentence and "See the whole week".
  - Merge the follow-up alerts into one expandable line.
  - Move the VM prompt into the VM chip.
  - Shrink Start focus. Per-row Start focus and + time move to hover; size chips go.
  - Give At risk its reason in words.
  - Move "This week:" features to the bottom with "needs stories" flags. The musts bar goes to Week.
  - Move the view switches out of the status bar.
- **Plan the day** (light touch).
  - Remove "Your Monday", the "From your week plan." subline, the "STORY" labels, the "Already planned here" text and empty-section lines.
  - The agenda fold becomes a chevron.
  - Promote "+ Draft a story".
  - Decide whether a typed intention becomes a draft story.
- **Check-in.**
  - One amber "over" line per block.
  - Done and fitting picks become a count.
  - One suggested move per row, the rest in ⋯.
  - Progress bars go to Close out.
  - "Anything shifted?" folds to one line.
- **Close out.**
  - Not-done picks with one carry-over button.
  - Done and dropped picks become counts.
  - Remove the capture box (Capture is global).
  - Remove ADDED BY ME and NEW TODAY; the meta line goes on demand.
  - Only follow-ups due today or overdue; the rest as "N more in Inbox".
  - Promote the DevOps update follow-ups.
- **Week.**
  - One AM / PM label per row instead of a time range on every card.
  - Empty time rows hidden.
  - "THIS WEEK:" and "FOLLOW-UP" lines become counts.
  - At risk with its reason.
  - The rail is the one home for meetings; the list goes on demand at 1920.
  - Size and + time on hover.
  - The view switches move to the Week header.
- **Plan the week.**
  - Remove the summary strip, the instruction sentence, the duplicate legend and the sublines.
  - The block grid becomes a thin strip that grows while dragging.
  - Stepper and state words on hover; no "Story" chips.
  - "needs more stories" becomes the row's flag and action.
  - "Add from DevOps" becomes the primary, larger path; Refresh DevOps goes to ⋯.

Estimated counts (UI words / elements, 1920 demo):

| Screen | Now | After |
|---|---|---|
| Today › Now | 157 / 87 | about 60 / 35 |
| Plan the day | 136 / 78 | about 95 / 60 |
| Check-in | 348 / 77 | about 110 / 30 |
| Close out | 330 / 86 | about 120 / 35 |
| Week | 280 / 185 | about 110 / 90 |
| Plan the week (next week) | 476 / 140 | about 180 / 70 |

Top jobs, clicks now and target:

| Job | Now | Target |
|---|---|---|
| Start focus on the next pick | 1 (F) | 1 |
| Mark a pick done | 1 | 1 |
| Add a DevOps item to a block | 3 to 5 | 2 |
| Move a pick to another block | 3 to 4 (1 drag in Plan the day) | 2, or 1 drag |
| See why a block is at risk | hover only, or 2 | 0 (on the card) |
| Open an item in DevOps | 1 (no visible cue) or 2 | 1, visible |
| Capture a follow-up | N + type + Enter (+0 to 1 chip) | hotkey + Enter |
| Add a must to a client's week | 5 to 6 + scroll | 3 |
| Reorder musts | 1 hidden drag, or 2 per step | 1 drag with a handle |
| Finish Plan the day | 2 + an offer | 1 |
| Finish Plan the week | 3 | 2 |
| Switch Today and Week | 1 (1 / 2) | 1 |

Cross-screen issues to solve once:
- **One block card** at three densities (Today, Week, Plan the day): header, risk with reason, meetings or rail, story rows.
- **One pick row** with hover actions, reused in Check-in and Close out.
- **One detail panel** (right side, keeps the timeline visible) for Today and Week, replacing Week's centered modal.
- **Shorter ⋯ menus.**
- **One wording set:**
  - over plan;
  - "This week:", "priorities" and "musts";
  - "Northwind" and "Northwind Foods";
  - "STORY", "Story" and "User Story".
- **Pill shapes:** today one shape is used for state, type, value and control.
- **Use of width:** Today, Check-in and Close out leave half of a 3840 screen empty.

## 5. Fixed constraints

- No new features and the same data. You may move, merge, fold or remove. Anything removed must still be reachable, or be named for deletion.
- **Truthful states.**
  - Never hide a failed source, never show success that didn't happen.
  - Cached data says so, with its time.
  - Healthy can be quiet; a problem must be visible without interaction.
- **External writes keep preview and confirm:** Outlook, DevOps, Teams status, VM.
- **Tokens:** client colors, the risk, watch, due and source-status tokens and the show-as styles (busy, tentative, free, out of office, working elsewhere) stay as they are. Never color alone: every color carries a word, icon or pattern.
- **Brand:** brand tokens, IBM Plex Sans (400, 500, 600) and Plex Mono (key hints only). Cooptimize Dark is the default, plus Cooptimize Light. See `brand.md`, `brand-brief.md` and `style-guide.md`.
- **Lumen** never appears in Week, Plan the week, Today › Now, Plan the day, Check-in, Roadmap or on a card.
- **Keyboard:** every current shortcut keeps working or gets a mapped replacement:
  - 1 to 4 tabs, T Today, P planning mode, W Plan the week, M Check-in, E Close out;
  - C commit, F focus, N capture, A add work, O open item;
  - R refresh, V timelines, H view range, Ctrl+K commands, ? shortcuts;
  - arrows between blocks, Enter details, Esc close.
- **Copy:** plain language, no em dashes in UI copy, middle dots (·) between facts, sentence case. The wording guide is `wording.md`.
- **Screens:** 1920x1080 and 3840x1600. No phone layout.

## 5a. Decisions already made (Nov 2, after the audit)

Treat these as settled. Do not reopen them; design from them.

1. **Screen jobs confirmed**, including Plan the week's "What are the musts for each client, and are they broken into stories?"
2. **Today at 3840x1600** uses the width: a day timeline (like Week's rail, with timeboxes draggable on it) with the picks beside it. At 1920 Today stays one column.
3. **Typed items in Plan the day** become a draft story under the client's feature on Enter. A plain note is still possible but shows "not in DevOps".
4. **Check-in and Close out are no longer pages.** Check-in is a state of Today's block cards: done picks collapse to a count, only picks that no longer fit show one suggested Move, one amber fit line per block, never red. Close out is a side panel over Today with three short sections (where you left off per client worked, follow-ups due, DevOps updates owed); carrying picks over happens on the cards. The mode switch keeps Check-in and Close out as entries; they change Today's state instead of navigating away.
5. **VM prompt** leaves Today; the header chip is the one place.
6. **Week at 1920:** the timeline rail replaces the meeting list. Full titles on hover; clicking a block opens the shared detail panel with the full agenda.
7. **A must** is a feature, or a single story when there is no feature. The week commits features; the day commits stories.
8. **Breaking down is a soft gate.** A feature can be a must with no stories, but shows "Needs stories" everywhere it appears, and cannot be placed on a day until it has at least one story. In its place Plan the day offers "Draft stories" and "Coop brief".
9. **Today shows only stories.** Features appear only as a "Needs stories" row at the bottom of Today, per client with a block today.
10. **Shared parts:** one detail panel (right side, Today and Week), one block card at three densities, one pick row with hover controls, one amber fit word set, menus hide disabled items, one name per client and per idea.
11. **Risk** shows its short reason on the card, in words, always.

So section 6's "ask before deciding the two open product questions" no longer applies: both are decided above (3 and 4).

## 6. What I want from you

a. **A short critique of the pruning plan.** Where would you go further? What would you keep that the plan cuts?
b. **Two distinct directions for Today › Now** at low fidelity. One should use the 3840 width with a day timeline, since the user loves the timeline. Then one chosen direction for all six screens at high fidelity, 1920x1080 dark. Add light and 3840x1600 variants for Today › Now.
c. **States for each screen:** healthy, at risk, failed source (Google cached, with Retry), empty (no blocks today, nothing planned yet) and loading (keeps the last good data, with a thin progress line).
d. **An interaction spec.** What each click, hover, drag and key does, and the click count for each top job above, next to the target.
e. **A component inventory** with rules: block card (three densities), pick row, meeting row and rail, badge and pill roles, fit word, detail panel, ⋯ menu, follow-up row, feature row with the "needs stories" flag.
f. **A list of everything removed or moved,** and where it lives now.
g. **Before and after word and element counts** per screen, measured on your designs the same way (UI words excluding titles; buttons, links, inputs, badges, chips and icons).

Challenge anything that doesn't serve the screen's one job. If the jobs are unclear, or you'd change one, ask the user before going to high fidelity. Also ask before deciding the two open product questions in report.md:
- whether a typed intention becomes a draft story;
- whether Check-in and Close out stay as pages or become a state of Today.

## 7. Attached (designer-handoff.zip)

- `designer-prompt.md`: this brief.
- `report.md`: the full audit (inventories, classifications, counts, click tables, confusion logs, cross-screen issues, the planning chain, open questions).
- `design/brand-brief.md`: the brand brief (story, voice, marks, Lumen).
- `design/brand.md`: how the brand is used in the app (marks, Lumen rules, the opening, reduced motion).
- `design/style-guide.md`: tokens (primitives, semantic, domain), client colors, type, spacing, components, interaction rules, contrast.
- `design/wording.md`: the wording guide.
- `screens/demo/`: fictional demo data, 1920 dark (with `-p2`/`-p3` scroll pages and `-failed` versions), 1920 light, 3840 dark and light, and `1920-dark-detail-*` menus and panels.
- `screens/live/`: the user's live data (personal events, PTO title and photo blurred), 1920 dark (with scroll pages), 1920 light, 3840 dark and light.

Screen keys in file names:
- `now`: Today › Now
- `planday`: Plan the day
- `checkin`: Check-in
- `closeout`: Close out
- `week`: Week
- `planweek`: Plan the week, this week
- `planweek-next`: Plan the week, next week
