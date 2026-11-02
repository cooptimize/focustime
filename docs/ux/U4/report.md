# U4: Plan the week and Plan the day

U4 builds the planning half of the U1 plan (`docs/ux/U1/report.md`, the mockups in `docs/ux/U1/designer-handoff.zip`), on top of U3's type scale and its shared detail panel. Where the step prompt and the mockups differ, the prompt wins.

Screenshots come from demo mode only:

- `screens/before/` shows the code at 249c7fa.
- `screens/after/` has 1920 dark and light, plus 3840 dark, for these screens:
  - Plan the day;
  - Plan the week, this week (`planweek`);
  - Plan the week, next week (`planweek-next`);
  - this week with a feature's panel open (`planweek-panel`);
  - next week with the health list open (`planweek-next-health`).

## What changed

### Plan the week

- **Header:**
  - ‹ ›, then "Plan the week of Nov 9" with a muted "next week · not planned yet". The muted part can also read "changed since planned" (amber), "planned" or "a review".
  - "DevOps health · N to look at" is a link that opens the health list in the detail panel.
  - ⋯ holds Refresh DevOps (R still works), when the week was planned, and "<client>: back to DevOps order".
  - Done and the mode switch.
  - The summary strip and the Blocks sentence are gone.
- **Blocks strip:**
  - The grid and its legend are replaced by one chip per half-day ("Mon AM · Cooptimize"). A half-day that doesn't count says why, muted ("mostly meetings").
  - PTO, Catch-up and half-days with no block are dashed.
  - "· 1 pinned" shows when something is pinned there.
  - Drag a must onto a chip to pin it (the same `weekplan.place`). The chips grow while a row is dragged.
  - A chip click filters the cards to its client.
- **Client cards:**
  - Two columns at 1920, one below 1400 px, three from 3000 px.
  - **Header:** swatch, name (it opens the client panel), "N blocks" with what isn't counted on hover, and the fit once.
  - **Must rows:**
    - a visible handle, then the title;
    - "N stories" muted, or an amber "Needs stories · Draft stories · Coop brief";
    - a bordered "1 block" with − + on hover, and ⋯ on hover.
    - Stories under a listed feature sit nested under it, with open stories not on the list as one muted line.
    - No sublines, no Story chip, no state word. The state is in the title's tooltip.
  - **Over budget:** one amber line, "3 blocks of musts, 2 blocks free. Move one to nice to have, or borrow Friday." (`overLine`)
  - "▸ Nice to have · N" is folded.
  - **Add from DevOps · N more of yours** is open:
    - the first three rows, each with a bordered "+ Must" and a plain "Nice";
    - then "Show N more", which also brings the epics and stories whose feature isn't listed.
    - Listed items never appear there.
- **Detail panel:** a shell (`PanelShell` in `ui/DetailPanel.tsx`) for subjects other than a block.
  - A feature: dates with Set target date, its stories, drafts, Draft stories, Coop brief, Open in DevOps.
  - A client: every half-day and whether it counts, borrowed time, musts done.
  - DevOps health: the readiness list.
  - Esc closes it, as on Week.

### Plan the day

- **Header:**
  - ‹ ›, then "Plan today".
  - "about 5 hours free · about 2 hours over" (`dayHeadline`). Amber appears only when over.
  - Timebox my day is a secondary button.
  - Done and the mode switch.
  - "Your Monday" is gone.
- **Blocks:**
  - **Header:** swatch, client, a muted range, and the fit once (`blockFitWords`). It reads "About 2h over · Trim" in amber, or "Fits · 30m spare" muted, never red.
  - **Rows** (PickRow density "plan"):
    - a handle, the title, and a due badge on a follow-up's pick;
    - the size chip always, with + time and ⋯ on hover;
    - no checkbox. A done pick shows ✓ and is struck.
  - The "Left off" line stays.
  - **Agenda:** open on the selected block, folded on the others ("▸ Agenda · 2 meetings · 2h 30m free"). Free gaps stay green.
- **Right pane:**
  - **"Add to <client> <morning>"** is the heading.
  - **This week's musts:**
    - each feature with "2 of 3 stories planned" and its stories, ✓ when planned here or + to add;
    - or one amber "Needs stories · Draft stories · Coop brief" row.
    - Clicking a feature's name chooses it as the parent for typed stories.
  - **Follow-ups** shows only when there are any.
  - **"▸ Everything else · N in DevOps order"** is folded.
  - **Type box:** "Type a story for <client>, then Enter".
    - Enter saves a draft story under the chosen feature and plans it in the selected block.
    - Shift+Enter keeps it a plain note, marked "not in DevOps" on its row.
    - A one-line hint sits under the box.
  - Features aren't picks: they can't be added or dragged onto a block.

### Shared

- Both screens use the U3 type scale (11, 12, 13 and 15 px at 400, 500 and 600).
- Fit words are amber only, and ⋯ menus hide disabled items.
- **Keys:** every key still works.
  - The legend adds Enter / Shift Enter in the type box.
  - It also adds dragging in Plan the week: reorder by the handle, or pin onto a block chip.

## Counts and clicks

See `counts.md`. Headline numbers (1920 dark, UI words):

| Screen | U1 | U4 |
|---|---|---|
| Plan the week, next week | 476 | 144 |
| Plan the day | 136 | 93 |

| Screen | Elements U1 → U4 | Text styles before → U4 |
|---|---|---|
| Plan the week, next week | 140 → 78 | 16 → 7 |
| Plan the day | 78 → 53 | 21 → 9 |

Click counts:

- Add a must: 3.
- Reorder: 1 drag.
- Finish Plan the week: 2.
- Add a story to a block: 2.
- Finish Plan the day: 1.
- Type a story: type + Enter.

## Deviations, with reasons

1. **Four commits became two plus this one.** The header and strip share `ui/PlanWeek.tsx` with the cards. Plan the day's cards share `ui/PlanDay.tsx` and the CSS block with the right pane. Splitting them would have left commits that don't build.
2. **Story sizes aren't shown in the right pane.** A story gets its size when it is added, and the size chip is on the block's row. Fewer words.
3. **A feature's title opens the detail panel, not DevOps.** Open in DevOps is the panel's first link. The panel is where its stories, dates and the Coop brief live.
4. **The drag hint is a tooltip on the handle**, not a line of text. The keyboard legend lists it too.
5. **A block chip click filters the cards to its client.** This is an addition. It costs nothing and helps on a busy week.
6. **The "Break it down" pick is removed** (an intention named after a feature). Draft stories and the type box replace it, because features aren't picks.
7. **Timebox my day appears only after commit**, as before step U4. Placing picks into gaps needs the committed plan.
8. **The right pane's first label is "This week"** when nice to haves are listed too. "This week's musts" would mislabel them.
9. **Plan the week (this week) still scrolls about 85 px** on the demo at 1920. Four clients with open Add sections don't fit in 985 px. Next week, the main Plan the week moment, doesn't scroll.
10. **An open panel adds text styles** (12 with a feature, 11 with health). Its section labels and rows are on the scale, but they add sizes and colors to the count.
11. **"Back to DevOps order" moved to ⋯** and to the client panel. It was a link in each card, shown only after a reorder.
12. **Plan ahead is unchanged.** It still shares the week cells and their data.

## Not done or not checked

- The pin drag onto a chip, and the handle reorder, are covered by browser tests using HTML drag and drop. I didn't do them by hand in the running app.
- Light 3840 shots were not taken, as in U2 and U3.
- The type box's Enter flow writes only to the local store (a draft and a pick). Create in DevOps is still the draft editor's job, through the write framework.
