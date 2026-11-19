# SA-5 after: Settings and Admin measured again, against SA-0's audit

The end of the overhaul (SA-0 to SA-5). Measured on `feat/sa5-search-phone`, in the demo, dark, the way SA-0 measured:

- `node scripts/settings-audit.ts` (SA-2's script, SA-0's method): kinds, help lines, screens at 1440 by 900 and on an iPhone 15 profile at 390 by 844 with a 17 px root font, folds as they open (closed).
- `node scripts/settings-phone-audit.ts` (SA-5): every Settings section, a client's page and 20 Admin pages at 390 by 844, at the Default and the largest Text size, with folds of settings opened. It counts controls under 44 px, two controls closer than 8 px, help over two lines, anything wider than the screen or clipped, and a read-only section. `e2e/settings/sa5-phone.test.ts` runs the same measure.
- The 100 searches: `ui/settings/search-cases.ts`, checked by `ui/settings/search.test.ts`.
- Labels against search: every `[data-setting]` on every page, its label read from the page and compared with the registry's.

"Before" is SA-0 (`docs/ux/sa0/findings.md`). Where SA-0 counted Settings and Admin together and a later step split them, both are given.

## The table

| Count | Before (SA-0) | Now (SA-5) |
|---|---|---|
| Kinds of row | 19 (14 in Settings) | 10 in Settings; Admin draws none of its own (SA-4's guard) |
| Kinds of help line | 17 | 17 |
| Kinds of button | 10 | 13 |
| Kinds of button row | 7 | 5 |
| Kinds of table | 1, scrolling sideways on a phone (7 tables wider than the screen) | 1, drawn as rows on a phone in Settings and Admin alike; 0 wider than the screen |
| Ways of saving | 7, with 4 ways to say it saved | 3: by itself with Saved and Undo by the field (Display and lists included); a button that checks, then saves (a token, a key, a calendar link); a button that acts and says its result on the row |
| Pairs that can disagree | 9 | 2: Timelines (Display's default against V for the session, on purpose) and the demo's zero-length lunch for new people (demo data) |
| Settings nothing reads, shown on a screen | 3 (Plan up to, Keep open, Keep people's data) | 0. One the other way round: `conv.closed_shown_days` is read with no screen |
| Labels that differ from search | 41 of 104 | 0 of 159 rows on the page; 13 team values now named as Admin names them |
| Searches that miss, of 100 | 22 find nothing, 5 lead elsewhere (main before SA-5, on SA-5's stricter 100: 19 nothing, 21 not first) | 0 nothing, 0 not first |
| Controls under 44 px at 390 | Settings 85 (SA-2's count); Admin 294 | 0 in Settings and 0 in Admin, at Default and at Larger |
| Two controls closer than 8 px at 390 | not measured | 0 in Settings and Admin |
| Help over two lines at 390 | 123 of 328 (Settings and Admin) | Settings 0 at Default and at Larger; Admin 11 at Default, 13 at Larger (listed below) |
| Read-only on the phone | Working hours (since PH-1) | none |
| Screens per section | 16 sections: 20.2 at 1440, 35.3 at 390, 44.4 at Larger | 11 sections: 16.3 at 1440, 30.7 at 390, 36.7 at Larger (below) |
| Steps per task | the walkthrough's 7 and part 9's 7 | below |

Notes on reading it:

- Kinds of help line and of button stayed where SA-2 left them. The extra kinds are the components that keep their insides (client chats, My VM, calendar links, the Pocket recorder, Diagnostics, the four shared logs).
- "Help over two lines" counts a help line, intro or note as it shows. It leaves out what sits behind More about this or another fold that explains ("Where do I find the link?"), since a press is already needed to see it. A problem line (role alert), a field's own value, a chip strip and a table cell aren't help.
- The phone's pages are about 5 percent longer than SA-3's. Rows stack under 560 px, every control is 44 px, and two controls keep 8 px apart.

## Screens per section

| Section | 1440 | 390 | 390 at Larger |
|---|---|---|---|
| Profile | 1 | 1.6 | 1.8 |
| Working hours | 1.1 | 2.1 | 2.3 |
| Display | 1 | 2.3 | 2.6 |
| Reminders and notices | 2.7 | 5.3 | 6.4 |
| Planning | 1.2 | 2.6 | 3 |
| Focus | 1.4 | 2.7 | 3.3 |
| Clients | 1.6 | 2.7 | 3.4 |
| A client's page (not in the total) | 2.2 | 4.9 | 5.7 |
| Connections | 2.6 | 4.7 | 5.6 |
| AI and assistant | 1 | 1.8 | 2.2 |
| Your data | 1.7 | 3.7 | 4.7 |
| About | 1 | 1.2 | 1.4 |
| **11 sections** | **16.3** | **30.7** | **36.7** |

On the phone the first page adds Most used (Notify this device, Let FocusTime message me in Teams, Theme, Text size, today's hours) above the search and the list: each of the five is one tap from opening Settings.

Admin's pages are as SA-4 left them, within 0.3 screens, except People: 6 screens at 390 from 4.8, because each person's row now stacks with 44 px controls.

## Steps per task

Repeated by two fresh reviewers on the demo, with no code. A step is a tap, a click or a field. SA-0's consultant numbers are places opened (`docs/ux/sa0/walkthrough.md`), its admin numbers steps (`findings.md` part 9).

A consultant on a phone (390 by 844, iPhone conditions), from Settings' first page:

| Task | SA-0 | Browsing | By search | Done |
|---|---|---|---|---|
| Friday 9:00 to 13:00 | 3 places | 2 | 3 | Yes; "9:00 to 13:00" saves as 09:00-13:00 |
| Quiet on days off | 1 place | 1, then a long scroll | 2 | Yes |
| Write to Outlook | 2 places | 2 | 3 | Yes |
| A DevOps write PAT | 1 place | 4 | 4 | As far as the demo allows |
| Connect Pocket | 1 place | 3 | 4 | Yes |
| Larger text | 1 place | 1 (Most used) | 3 | Yes |
| What FocusTime keeps | 5 places, not done | 1 | 2 | Yes |

On SA-0's phone, Working hours was read-only, so task 1 couldn't be done there at all.

An admin on a computer (1440 by 900), from Settings:

| Task | SA-0 | Browsing | By search | Done |
|---|---|---|---|---|
| Allow AI for one client | 3, scrolling | 4 | 5 | Yes |
| Who hasn't signed in | 3 | 4 | 3 | Yes |
| Who opened a client's code | 3, scrolling | 4 | 3 | Yes |
| Register a client chat | 5 or more, up to 15 screens of scrolling | 6 | 7 | Yes |
| Register a client call | 7 or more, scrolling | 7 | 8 | Yes |
| Change a client's colour | 3, scrolling | 3 | 4 | Yes |
| Remove a person | 4 | 5, no scrolling | 5 | Yes |

No task needs scrolling to find its control now. Search is a step longer for an Admin client setting, because the result opens Clients and the client is the next step (open). "not signed in" and "who opened" found nothing in the review; they now find their tabs.

## What is still open

- **Admin's long help lines.** 11 at the Default Text size, 13 at Larger, on 7 pages:
  - a client's Overview: the From Dataverse leads line; the "Match only as written" switch;
  - Chats: three switches' help; "The team's, for every client…";
  - Calls: the intro; "Organized outside Cooptimize…";
  - AI: Allow AI's help;
  - People › Who's set up: its intro;
  - Team defaults › AI and › Client chats: their intros.

  They are listed, not fixed: the brief keeps Admin's phone layout out of SA-5 beyond what the measurements demand, and these read whole, on a page only admins see. Splitting them behind More about this is one line each with `HelpLine`.
- **Kinds.** 10 kinds of row, 17 of help and 13 of button remain. Most of the extra kinds are components that keep their insides (above). Redrawing them is a follow-up of its own.
- **Timelines** can still differ from V for the session, on purpose.
- **The demo's new people get a 12:00 to 12:00 lunch** (Admin › Team defaults › Planning and new people). Demo data; SA-2's open question stands.
- **`conv.closed_shown_days`** is read but has no screen.
- **Admin's labels and keywords are in everyone's download.** Settings' search reads Admin's list to find its settings for an admin. Someone who isn't an admin never sees a result, a count or a suggestion from it (`e2e/settings/sa5-search.test.ts`), but the words are in the app's script. Moving them to load only for admins is a follow-up.
- **From the walkthroughs** (each in `docs/open-questions/sa-5.md` under SA-5): an Admin client setting found by search opens Clients, not the client; search finds places and settings, not tasks; on the phone the search sits under Most used, below the first screen; "friday" finds the Teams Friday switch before Working hours' Friday.
- **Settings' rail at 1440 by 900** scrolls once to show its Admin line (SA-4's open question).
