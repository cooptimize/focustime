# RS-1: what was there before, and what each became

Taken on `origin/main` at 0c93e940, before any change. "Places" is how many times the class is written in `ui/` (code, not tests); "seen" is how many controls of that kind the browser drew across every screen of the demo (46 screens, `e2e/rs1-scan.test.ts`).

## Control styles

| Before | Places | Seen | Shape before | Became |
|---|---|---|---|---|
| `button` with no class | many | about 60 | 8 radius, `--border-strong`, surface fill, 30 high | the outlined pill: 32 high, the quiet line, no fill |
| `.mini` | 452 | 180 | 6 radius, 21 high (28 on Day and Week), 12 px text | small pill, 28 high |
| `.mini.primary` | part of 184 | 24 | accent line and text, weight 600 | small pill, accent line and text, weight 500 |
| `.quiet`, `.mini.quiet` | 211 | 110 | no line, faint text | quiet: no line, muted text, the wash on hover |
| `.link-btn` | 106 | 60 | underlined text | unchanged: a link stays a link |
| `.top-btn` (Focus, Capture, Ask, Refresh, New, Filter) | 26 | 180 | 8 radius, surface fill, 30 high | outlined pill with an icon and its word |
| `.top-more`, `.more-btn` (⋯) | 3 + many | 172 | a "⋯" character in a 28 px box, 6 radius | round icon button, the More icon (32 in headers, 28 in rows) |
| `.done-btn`, `.add-work-head`, `.start-focus`, `.commit` in a foot, `.ib-act.primary`, `.focus-btn.primary` | 12 | 30 | filled, 6 to 10 radius, 28 to 47 high | the filled pill (the one main action) |
| `.ib-act` | 30 | 20 | 8 radius, 36 high | outlined pill, 32 high |
| `.x-close` | 1 (shared) | 25 | an X in a 44 px square, 8 radius | the Close icon; a 44 px target, a round 32 wash |
| `.pd-step button`, `.day-step` (‹ ›) | 4 | 28 | characters in 28 px boxes with a line | round icon buttons, Back and Next |
| `.aw-plus`, `.sug-plus`, `.sug-x`, `.chip-x` | 8 | 36 | "+" and "×" characters, 4 to 6 radius, some lined | round icon buttons, Add and Close |
| `.ah-chev` | 2 | 44 | a drawn chevron, 6 radius | round icon button, the family's chevron |
| `.sc-tool` (B, I, •, 1., Link) | 1 | 5 | letters in small boxes | round icon buttons: bold, italic, bullets, numbers, link |
| `.views` / `.view-tab` (tabs) | 1 | 215 | a boxed group, the active tab a raised tile | no box; an icon and a word in a pill; the active one the accent wash |
| `.mode-switch` / `.ms-btn` (Grid, Gantt; Edit, Preview) | 7 | 14 | a bordered sunken group, the active side a lined tile | a switch: one track, the chosen side lifted |
| `.day-switch` (Cards, Timeline) | 1 | 24 | a bordered pair with a divider | a switch |
| `.rm-seg` (Mine, Contributing, Everyone; levels) | 4 | 15 | a bordered group, the active side inverted | a switch |
| `.ib4-switch` / `.ib4-tab` (the Inbox's lists) | 1 | 12 | a bordered sunken group | a switch, an icon on each side |
| `.seg` / `.seg-btn` (the New form's Level, AM and PM, sizes) | 10 | few | a bordered sunken group | a switch |
| `.st-scope` (My features, Client report) | 1 | 2 | a bordered group | a switch |
| `.adm-filter` (Customers, All accounts) | 1 | 2 | two joined buttons, the active one inverted | a switch |
| `.cv-switch` Wrap | 1 | 1 | a checkbox and the word Wrap | a switch with two sides, No wrap and Wrap (the same checkbox underneath) |
| `.status-pill` | 3 | 40 | a lined pill | a status: a wash, no line |
| `.due-badge`, `.late-chip` | 5 | 60 | lined, tinted; late with a left stripe | a status: the state's wash, no line |
| `.today-pill` | 3 | 46 | filled accent | a status: the accent wash |
| `.holiday-pill`, `.overflow-pill`, `.status-chip`, `.bd-chip`, `.mtg-chip`, `.checkin-chip`, `.st-badge`, `.cal-tag`, `.adm-mark`, `.adm-kind` (Rule, Default), `.cv-ro` (Read only), `.sc-state`, `.state` | 30 | 80 | lined or dashed pills | a status: a wash, no line |
| `.chip-btn` (Capture's kinds, a client), `.rm-chip` (client filters, Needs attention), `.ib4-chip`, `.ah-chip-btn`, `.dp-chip`, `.as-chip`, `.att-chip`, `.carry-chip` | 40 | 90 | pills with `--border-strong`, some filled, some 4 to 8 radius | a chip to press: the quiet line when off, its wash when on |
| `.size-chip` | 3 | 26 | a lined pill | a line when it can be pressed, a wash when it only tells |
| `.vm-chip` | 2 | 43 | a lined pill, surface fill | a quiet pill with its dot |
| `input`, `select`, `textarea` (`.field`, `.set-field`, `.date-field`, `.select-field`, 40 more) | 498 | 110 | 6 to 8 radius, `--border-strong`, 23 to 34 high | 32 high, 8 radius, the quiet line, the accent line and the ring on focus |
| `.popup-menu`, `.cell-pop`, `.command-menu` | 12 | 8 | 10 to 12 radius, `--border-strong` | 12 radius, the quiet line |
| `.menu-item` | 5 | 449 | 32 high, no icon, a "✓" for a chosen one | 32 high, an icon before every item, the accent wash on the active row |
| `.menu-group` | 2 | 20 | small capitals | plain muted text |
| `.cap-dialog`, `.write-dialog` and other dialogs | 20 | 6 | 12 radius | 16 radius |
| `.ib4-row` | 3 | 22 | a bordered box per row with a client stripe | a row: no box, a client swatch, the wash on hover; a quiet card while open |
| `.us-line` (Day's promise lines) | 1 | 30 | a bordered box with a colored left edge | a row with the kind's icon |
| `.aw-row`, `.pick-row` in the panel | 8 | 80 | 6 radius, `--raised` on hover | a row: 32 high, 8 radius, the wash on hover |
| `.ah-cell` (Backlog grid) | 1 | 900 | a line under every row | no lines between rows; the column heads keep theirs |
| `.ps-item` (Settings' side list) | 1 | 20 | 8 radius, the active one with an accent edge | a row; the active one the accent wash |
| `.set-client-row`, `.adm-table` rows | 3 | 30 | a box or a rule per row | rows with no box |
| `.cv-tree-row` | 1 | 20 | 6 radius, the selected one with an accent edge | a row with folder and file icons |
| Block cards (`.half.card`) | 1 | 40 | client edge, border, the selected ring | unchanged |

## Text characters used as a control or a mark

| Character | Places | Where | Became |
|---|---|---|---|
| ‹ and › (back, next) | 15 + 13 | Day, Week (App), Close out, Team, DatePicker, Feedback, ImageViewer, Meetings, Menus (back and the next-step arrow), PanelShell, Settings, Day's lines and chips, the Inbox's rows | Back and Next icons |
| ⋯ (more) | 14 | App (the top bar, twice), Menus, PickRow, FollowUps, Roadmap, StoryCardEdit, ahead/Toolbar, ahead/Levels, inbox/ItemActions, inbox/Suggestion | the More icon, with the name it had |
| + (add) | 22 | "+ Add" (App, BlockCard, Day, DayTimeline, PhoneDay), "+ New", "+ New under", "+ time", "+ date", "+ owner", "+ size", "+ Add a line", "+ Add a feature", "+ Add a type", "+ Add a criterion", "+ Add walk-on work", the panel's and a suggestion's "+", the stepper's "+" and "−" | the Add icon and the word (the Minus icon on the stepper) |
| × and ✕ (close, remove) | 16 | DoneOffer, ItemLookup, Notices, PhoneShell, Suggest, WeekStories, WrapUp, ahead/Bulk, ahead/Toolbar, AdminMeetings, DayTimeline, the Guide's try-it | the Close icon |
| ▸ and ▾ (folds, a list to open) | 20 | plan/FoldLine, DayTimeline, NewItem, Roadmap, Patterns, Admin, BlockPanel, SelectField, TimeField, DatePicker, Code, ahead/Toolbar | Closed and Open chevrons |
| ⌃ (an open row) | 3 | Day, the Inbox | the Up chevron |
| ✓ and ✗ (done, failed) | 22 | Menus (a chosen item), ModeSwitch, BlockPanel, CellPopover, Day, DayTimeline, PickRow, Team, StoryCard, Assistant, SendLoop, DoneOffer, WrapUp, TimeboxCheckin, WhoSetUp, the Guide | Done and Close icons |
| ⋮⋮ (a drag handle) | 5 | PickRow, plan/PlanRow, Carry, the Guide's try-it | the Grip icon |
| ⚑ and ◷ (a Gantt marker) | 1 | ahead/Gantt | Flag and Time icons |
| + and – (the Guide's folds) | 1 | guide.css | a chevron |
| the browser's ▶ (details) | 16 | Status, Settings, Admin | the family's chevron |
| → ("→ Thu"), "+15", "+N" | | in sentences and counts | unchanged: words, not controls |
| "⋯" in sentences | 40 | the Guide's answers, Settings hints, tooltips | unchanged (docs/open-questions.md) |

Hand-drawn icons that were already there moved to the family too: the close X, the Backlog's and Code's chevrons, the eye on a Watching row, the calendar on a to-do's time, the Deployment mark, the assistant's microphone and the phone's bottom bar.
