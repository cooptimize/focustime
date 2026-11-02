# U2: Today overhaul

U2 builds the Today part of the U1 plan (`docs/ux/U1/report.md`, the decisions in `docs/ux/U1/designer-prompt.md` section 5a, and the mockups in `mockups/`).

Today › Now is pruned. Check-in and Close out are now states of Today, not pages of their own. Week, Plan the day and Plan the week change only through the shared parts.

Screenshots come from demo mode only:

- `screens/before/`: U1's shots of the same code before U2.
- `screens/after/`:
  - 1920 dark and light;
  - 3840 dark;
  - Check-in and Close out again at 1:05 PM (`-1305`);
  - a failed source (`-failed`).

## What changed

### Today › Now

- **Removed:**
  - the "focus until / Next" line;
  - the VM banners. Their two prompts are now chips in the attention line; see below.
  - the big Start focus card;
  - Start focus on every row;
  - size chips on rows;
  - the musts bar;
  - "See the whole week";
  - the status bar's Business hours and Timelines switches. They now live in a ⋯ on Week's header; H and V still work.
- **Attention line:** one row, shown only when something needs it.
  - Follow-ups due: "2 follow-ups due · Jordan Lee · Dana Morales ›". It opens into rows, and a row goes to the Inbox.
  - A failed source: its name, the age of its data, and Retry (or Reconnect).
  - Expiring secrets.
  - The VM's morning prompt ("VM is off · Start · Not today").
  - A failed auto-shutdown restore ("Auto-shutdown is still changed · Restore"). The hard rule says a changed schedule must be put back or shown on Today, so this prompt could not simply be dropped.
  - Nothing shows when all is healthy.
- **Block card** (density "today"):
  - Header: client, time range, and one pill. A risk pill carries its reason ("At risk · Dentist 12:00").
  - Body: meetings and picks in time order (`plan/todayorder.ts`). Untimed picks sit where they would land if worked in turn through the free time from now.
    - Meetings are thin rows with Next, and past ones dim.
    - The next pick is highlighted. It alone has Start focus, or the countdown with Done and +15 while focus runs.
    - Other picks show "+ time" and ⋯ on hover.
    - A due badge shows on a follow-up's pick.
  - "Left off" shows on the current and next block only.
  - The all-day row and the before and after lines stay.
- **This week:** one chip per feature for today's clients, at the bottom.
  - Either "2 of 3 stories planned",
  - or "Needs stories · Draft stories · Coop brief".
  - Draft stories opens the draft story prompt under that feature. Coop brief copies the brief.
- **Pick titles** are links to DevOps. The visible cue is the underline plus the `#id`. ⋯ still has Open in Edge.
- **3840:**
  - A day timeline on the left: hours, meetings, timeboxes with the running countdown, dashed free gaps, and the now line.
  - Drag a pick onto a gap to timebox it. This uses Plan the day's rules (`timeChoices`) and the same `timebox.add`.
  - Clicking a pick opens the detail panel under the cards.
  - At 1920 Today stays one column.

### Check-in (a state of Today)

- Header: "Check-in · 1:05 PM · about 3 hours left today", with the green Done.
- Ended blocks dim. Done picks are a count in the card header ("1 done").
- Each pick that doesn't fit gets a dashed amber edge and "S · doesn't fit". So does each not-done pick in an ended block.
- Each of those picks gets one suggested move (`plan/checkinmove.ts`) plus ⋯:
  - **Tonight** when its follow-up is due today or overdue;
  - else **Move to PM** when the same client has a later block today;
  - else **Move to <next workday>**;
  - else **Tonight**.
- One amber line per block: "About 4 hours over. Move one?" in a block still running, or "3 not done. Move them, or leave them for Close out." in an ended one.
- At the bottom, once:
  - "Walked in · + Add walk-on work", where you choose a block, then an item or an intention;
  - "Musts this week: 4 clients, Northwind, Atlas tight · Review ›", which opens Plan the week.
- Done marks Check-in done and returns to Now. The ✓ and due dot rules are unchanged.

### Close out (a side panel)

- The panel sits on the right, 520 px at 1920. Today moves to its left and dims.
- **Cards behind the panel:**
  - only not-done picks, each with "→ Tue" (which moves it now);
  - "N done · N dropped" in the header;
  - dropped picks only as a count.
- **Panel contents:**
  - title and Done, plus ‹ › to step days;
  - the numbers line: done, carry over, dropped, focused;
  - **Where you left off:** one input per client worked, with "+ Another client" on demand;
  - **DevOps updates owed:** Mark done in DevOps for done picks still open in DevOps, and Comment for picks focused on and not done. Comment is one line, then the write framework's preview.
  - **Follow-ups due:** compact rows with badge, who, what, Close the loop and ⋯;
  - then "N more in Inbox · N captures to sort".
- **Done** closes the day exactly as before (`closeout.commit`), then plays the reverse unroll.
- `ui/CheckIn.tsx` and `ui/CloseOut.tsx` are removed. The actions and the `plan/` rules are unchanged.
- `#/today/checkin` and `#/today/closeout[/date]` still work and land on the state.

### Shared parts

- **One PickRow** with a "today" density: hover controls, a badge slot, an actions slot, and the next-pick variant.
- **One client name:** the plan's name wins over DevOps's configured name, which fixes "Northwind Foods".
- **One amber fit word set.** Every fit and "too much" style moved from `--risk` to `--watch`: Today, Plan the day, Plan the week and the card pill. `--risk` stays for At risk, overdue and errors.
- **⋯ menus hide disabled items.** The exceptions show their reason as a tooltip only:
  - Move on a done pick;
  - "Already planned here" targets;
  - a menu where every item is disabled.
- **Keys:** every key is kept. M and E now toggle the states. H and V are described as Week's, and the legend lists the timeline drag.

## Counts and clicks

See `counts.md`. Headline numbers (1920 dark demo, UI words):

| Screen | U1 | U2 |
|---|---|---|
| Now | 157 | 72 |
| Check-in | 348 | 103 |
| Close out | 330 | 105 |

Elements roughly halved. Text styles went up (Now 22 → 27), which is the one count that got worse; it is the first thing for the designer pass.

## Deviations from the mockups, with reasons

1. **Northwind's pill reads "Dentist 12:00", not "2h 30m of meetings".** The demo dentist runs 12:00 to 1:00 and crosses into the afternoon block. A personal conflict ranks above meeting load (`rankRisks`), and the pill shows the worst risk. The tooltip has both sentences.
2. **"Move to PM" doesn't appear for the morning's Cooptimize picks.** The afternoon block is Northwind's. The suggestion never moves a pick into another client's block (client data stays scoped), so they get "Move to Tue".
3. **Check-in rows have no "45m focused".** The demo day has no focus time. The badge appears once a pick has a minute or more.
4. **The VM prompts sit in the attention line, not only on the header chip.** The CLAUDE.md hard rule requires a changed auto-shutdown schedule to be shown on Today. The morning Start prompt came along with it, so step 15.5's one-click Start keeps a home.
5. **Close out has ‹ › day steps,** so any earlier day can still be closed out. When closing out a past day, the panel lists that day's not-done picks itself, because the cards behind always show today.
6. **No borrowed-time list in the Close out panel.** The Week header's borrowed chip and its menu still show and pay it. It wasn't in the panel spec.
7. **Every linked pick shows its `#id`,** not only the next one, because it is the visible cue that the title opens DevOps.
8. **The 3840 detail panel shows after you click a pick.** The mockup showed it filled; with nothing chosen it is hidden.
9. **At 3840, Check-in also shows the timeline.** It shows the same day.
10. **Check-in's "Anything shifted?" (step 11) is gone.** The musts line's Review opens Plan the week, where musts are swapped.
11. **Close out's Lumen empty state ("No open follow-ups") is gone** with the panel, so Lumen now has one empty state (Inbox).

## Not done or not checked

- Light 3840 shots were not taken. The spec asked for 1920 dark and light, and 3840 dark.
- I didn't watch the 3840 drag in the running app myself. It is covered by a browser test (`e2e/today.test.ts`) using HTML drag and drop.
- Text styles were not reduced. That needs the designer pass's type scale.
- Week, Plan the day and Plan the week changed only through the shared parts: menus, the amber fit, the client name, Week's ⋯, and size chips (still on their rows). Their own U1 findings are for later steps.
