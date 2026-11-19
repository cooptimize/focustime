## MB-1b: phone polish (Nov 7)

Numbered D1035 to D1036 in HK-7.

| # | Status | Decision |
|---|---|---|
| D1035 | Done | MB-1b (Q-MB1-7): on the phone, a Week card with no status pill shows UI-9's late chip at the end of its title line (after the time, before ⋯), so the card is exactly as tall as with no chip. On that line the client's name shortens with an ellipsis before the chip or the time would wrap (the full name stays in the card's label and title), and the chip keeps its 44 px tap area. Beside a status pill the chip stays on the chips line (D1021). A computer is unchanged. |
| D1036 | Done | MB-1b: the status sheet's rows wrap. They had inherited the desktop status bar's `white-space: nowrap` (`.source`), so at 360 px the DevOps line ran past the sheet and the sheet scrolled sideways. The line is wrapped, not shortened: every client and its state stay readable, on as many lines as they need. |

