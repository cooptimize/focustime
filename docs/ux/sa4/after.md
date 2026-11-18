# SA-4: Admin after

Measured on `feat/sa4-admin` after F (Admin's rows drawn with SA-2's parts), in the demo, dark. "Before" is SA-0's `docs/ux/sa0/findings.md` part 5 and part 9.

## Size: screens long

At 1440 by 900 it is the panel's body against its own height; at 390 by 844 the page against the screen. A client's tabs are measured on Northwind, the demo's fullest client.

Before:

| Page | 1440 | 390 | 390 at Larger |
|---|---|---|---|
| Admin › Clients (every client's card, open) | 15.6 | 34.2 | 42.3 |
| Admin › AI | 1.6 | 2.8 | 3.5 |
| Admin › Client chats | 1 | 1.4 | 1.7 |
| Admin › People | 2.7 | 4.5 | 5.5 |
| Admin › Organization | 1.4 | 3.4 | 4.2 |
| Admin › Standards | 1.1 | 2.2 | 2.8 |
| Admin › Status | 1.8 | 4.1 | 5.3 |
| Admin › Audit | 1.4 | 3 | 3.7 |

After:

| Page | 1440 | 390 | 390 at Larger |
|---|---|---|---|
| clients | 1 | 1.3 (0 of 9 under 44) | 1.9 |
| clients/Northwind/overview | 1 | 1.5 (0 of 21 under 44) | 1.8 |
| clients/Northwind/chats | 1.1 | 2.1 (0 of 22 under 44) | 2.5 |
| clients/Northwind/calls | 1 | 1.3 (0 of 15 under 44) | 1.6 |
| clients/Northwind/ai | 1 | 1.1 (0 of 11 under 44) | 1.3 |
| clients/Northwind/code | 1 | 1.1 (0 of 11 under 44) | 1.3 |
| clients/Northwind/deployments | 1 | 1.9 (0 of 49 under 44) | 2.2 |
| clients/Northwind/backlog | 1.6 | 3.5 (0 of 26 under 44) | 4.2 |
| people/people | 1.2 | 3.9 (0 of 38 under 44) | 4.7 |
| people/setup | 1 | 2 (0 of 11 under 44) | 2.5 |
| people/logins | 1 | 1 (0 of 8 under 44) | 1 |
| people/levels | 1 | 1.2 (0 of 8 under 44) | 1.4 |
| people/admins | 1 | 1 (0 of 5 under 44) | 1 |
| defaults/ai | 2.2 | 3.5 (0 of 13 under 44) | 4.3 |
| defaults/chats | 1.1 | 1.7 (0 of 11 under 44) | 1.9 |
| defaults/planning | 2.5 | 4 (0 of 28 under 44) | 4.5 |
| defaults/standards | 1.2 | 5.5 (0 of 19 under 44) | 6.8 |
| health | 2 | 5.4 (0 of 4 under 44) | 6.8 |
| audit/changes | 1.2 | 8.7 (0 of 4 under 44) | 10.8 |
| audit/code | 1 | 1 (0 of 4 under 44) | 1 |

The longest Admin page was every client's card on one page (15.6 screens at 1440); a client's longest tab is now 1.6. The parts' rows (label and help on the left, one row per setting) make Team defaults › AI and Planning and new people longer than A to E's moved rows (2.2 and 2.5 screens at 1440, from 1.4 and 1.5). Audit's changes table is long on a phone because each change is drawn as rows, one line per column.

Hit boxes under 44 px at 390: before, Admin › Clients 236 of 574, AI 23 of 28, People 19 of 45, Standards 7 of 15, Organization 6 of 25, Audit 3 of 4. After: 0 on every page above (`e2e/admin/sa4-place.test.ts` checks it at the largest Text size and a 17 px root font).

## Steps from Settings' rail

| Task | Before | After | Path |
|---|---|---|---|
| Turn on Allow AI for one client | 3, scrolling to Per client | 4 | Admin, the client in the rail, AI, the switch |
| Find who hasn't signed in | 3 | 3 | Admin, People, Who's set up (its Not signed in count shows at once) |
| See who opened a client's code | 3, scrolling past the settings audit | 3, the client filter a 4th | Admin, Audit, Code views (a client's Code tab links there too) |
| Register a client chat | 5 or more, scrolling up to 15 screens | 5 | Admin, the client, Chats, Add a chat, pick |
| Register a client call | 7 or more, scrolling to the card | 6 | Admin, the client, Calls, Register a meeting, the series, Register |
| Change a client's colour | 3 plus scrolling | 3 | Admin, the client (Overview), a swatch |
| Remove a person | 4, the name box at the foot of the page | 5 | Admin, People, Remove in the row, the name in the box at that row, Remove |

On the phone: Allow AI 4 taps, Who's set up 3. At 1440 by 900 Settings' rail scrolls once to show its Admin line (an open question).
