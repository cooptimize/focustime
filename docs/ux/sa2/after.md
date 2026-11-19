# SA-2 after: Settings drawn with one set of parts

Measured the way SA-0 measured (`node scripts/settings-audit.ts <out.json>`): the demo, every Settings section and a client's own page, at 1440×900 and on an iPhone 15 profile at 390×844, dark. "Kinds" are distinct combinations of element, class, size, weight, margins and color. SA-0's numbers are in `docs/ux/sa0/findings.md`; the raw after numbers are `after.json` beside this file.

| Count | Before (SA-0) | After (SA-2) |
|---|---|---|
| Settings named differently in search than on their page | 41 | 0 (one name, from the registry; `e2e/settings/sa2.test.ts`) |
| Controls on the page the registry didn't list | 4, plus a client page with no ids | 0 |
| Kinds of row (SA-0 counted 19 with Admin; this audit leaves Admin out) | 14 | 10 |
| Kinds of button row | 7 | 5 |
| Kinds of table | 1 | 1 |
| Help lines | 231 | 216 |
| Help over two lines at 1440 | 3 | 1 |
| Help over one line at 1440 | 21 | 10 |
| Help over two lines at 390 | 44 | 13 |
| Help behind More about this (counted apart) | 0 | 35 |
| Controls under 44 px at 390 | 85 | 27 |
| Kinds of help line | 17 | 17 |
| Kinds of button | 10 | 13 |

## What's left, and why

- **Rows.** Four of the ten kinds are the parts' own (a row, a wide row, a header row, each wide or not) and one is a list item. The other five are components shared with Admin or Setup, which keep their insides inside the parts' cards: a client's chats (`DeliveryChatField`, Admin's too), My VM's rows (Setup's too), and the AI log's table rows. Admin is SA-4.
- **Help and buttons.** The parts draw help as one kind (`.sp-help`), More about this as one and a group's intro as one. The remaining kinds and the extra button kinds come from the same kept components (client chats, My VM, calendar links, the Pocket recorder, Diagnostics and the four shared logs) and from the segmented control's two states. Redrawing them would change shared screens outside this step's scope (docs/open-questions/sa-2.md, SA-2).
- **Help over two lines at 390 (13).** Most are inside the kept components; the rest are a row whose help depends on the data. The parts' own help keeps to two lines at Default (`e2e/settings/sa2.test.ts`).
- **Under 44 px (27).** All in the kept components (their mini buttons and links). Every part's control is at least 44 px on a phone, at Larger too.

## Walkthrough

SA-0's seven consultant tasks, repeated on the demo by a fresh reviewer with no code or docs: all seven done or as far as the demo allows. "9:00 to 13:00" saved as "09:00-13:00"; no Saved moved a row; Undo was always in reach. What it tripped on, and what changed for it, is in the pull request and in `docs/decisions/sa-2.md` and `docs/open-questions/sa-2.md` under SA-2.
