# U6 report: Plan the week, one client at a time

Plan the week and Plan the day now share one planning layout, `ui/plan/`. Plan the week shows one client at a time, and the week grid at the top acts as the client filter.

## The shared layout (`ui/plan/`)

- **PlanFrame.** Two panes.
  - The left pane is fluid. The right pane is 420 px at 1920 and 520 px at 3840, with a 20 px gap and 24 px gutters.
  - The right pane is sticky and scrolls on its own.
  - Below 1200 px, the panes stack in one column.
- **PlanHeader.** In order: ‹ ›, the title, a muted summary, a spacer, the secondary action, ⋯, the green Done and the mode switch.
- **UnitCard.**
  - A 4 px client-colored edge, a 12 px radius and 12/14 padding.
  - The fit words are amber when over, muted when the plan fits and green when everything is planned.
  - Section labels are uppercase at 11 px.
  - A collapsed card (UnitLine) is one line on the same columns.
- **PlanRow.** The one row used by both screens. PickRow's "plan" density is built on it.
- **AddPane.** "Add to <client>" with a muted count, an optional search, labeled sections, and the type box pinned at the foot with a one-line hint.
- **FoldLine.** "▸ Label · N", the same on both screens.

## Plan the week

- **The week grid.**
  - Mon to Fri, AM over PM. Each cell shows its client name on a colored edge.
  - "Mostly meetings" cells are dimmed. A pinned must shows its title in its cell.
  - PTO is one hatched cell, and Friday's catch-up is one dashed cell.
  - The open client's cells read "Planning".
  - Click a cell to open its client. Drag a must onto its client's cells to pin it; other clients' cells and PTO refuse the drop.
- **Client lines.** One line per client with blocks, in first-block order. When only one card is open, the other clients are lines showing their musts summary and fit.
- **The open card.** MUST rows, with "Needs stories" when a feature has none, then the amber over line, "▸ Nice to have · N", and at the foot "‹ Previous" and "Next client: X ›", or Done on the last client. An empty card offers "Nothing this week".
- **Where it opens.** On the first client with trouble (over budget, or a must that needs stories), otherwise on the first client.
- **The right pane** follows the open client.
  - It shows "N of yours not on the list", a search, FROM DEVOPS rows with "+ Must" and "Nice", and "▸ Everything else · N in DevOps order".
  - Stories under a listed feature are not offered.
  - The type box reads "Type a feature for <client>, then Enter". Enter makes a local draft feature as a must; Shift+Enter makes it a nice to have.
- **Keys.** J and K (or ↓ and ↑ when nothing is focused) move between clients. / goes to the search, Enter adds the first result as a must, and Esc clears it.
- **Removed.** The two-column cards, the client filter chips (the blocks strip), the inline Add lists on each card, and the loose draft stories section.

## Plan the day

The behavior is unchanged. It now uses PlanFrame, PlanHeader, UnitCard for blocks, the shared AddPane and FoldLine for the agenda. New keys: J and K move between blocks, and / opens Everything else and focuses its search.

## Store and actions

- **Migration 22** adds `week_drafts` (a draft feature on a week list, as must or nice) and `week_quiet` ("Nothing this week" for a client). Both are covered by Reset local plan and the export.
- **New actions:** `weekplan.add_draft`, `weekplan.draft_tier` and `weekplan.nothing`.
- When "Create in DevOps" turns a draft into a real item, `weekplan.load` puts that item on the list in the draft's place.
- There are no new external writes.

## Verification

- **Typecheck:** both projects are clean.
- **Unit tests:**
  - `ui/plan/plan.test.ts`: six tests of the shared components.
  - `plan/weekclients.test.ts`: four tests (lines, first-block order, Friday pins, first trouble).
  - `actions/weekplan-actions.test.ts`: three new tests (draft feature, tier, Nothing this week).
- **Browser tests:**
  - `e2e/planweek.test.ts`: ten tests. They cover the grid, the drag refusals, opening on trouble, Next and Previous, the pane following the client, search with Enter, the type box, the keys, the type scale and overflow at 1920 and 3840, and the right pane's width and stickiness.
  - `e2e/planning.test.ts` and `e2e/estimating.test.ts` were moved to the new layout; their Plan the day tests changed only selectors.
- **Screenshots** in `screens/before/` and `screens/after/` (1920 dark and light, 3840 dark) and `screens/side-by-side-1920-dark.png`, all from demo mode.
- **Counts:** see `counts.md`.

## Deviations

- PickRow stays in `ui/PickRow.tsx` and is built on `ui/plan/PlanRow.tsx`, so Today's and Week's imports don't change.
- Loose draft stories no longer appear on Plan the week's card. They stay in Plan the day, the Inbox and the draft editor.
- PTO and whole catch-up days are one cell spanning AM and PM, as on Week (U3). This also keeps the word guard under 120.

## Limitations

- Drag to pin still needs a mouse. The keyboard path is the row's ⋯ → Pin to a block.
- A draft feature counts as 1 block until it is created in DevOps and sized there.
