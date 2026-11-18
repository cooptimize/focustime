# SA-3 after: Settings in eleven sections

Measured the way SA-0 and SA-2 measured (`node scripts/settings-audit.ts docs/ux/sa3/after.json`, which now also
counts each page's length): the demo, every Settings section and a client's own page, at 1440×900 and on an iPhone 15
profile at 390×844 (root font 17 px), dark, folds as they open (closed). Screens are the page's full height divided by
one window. SA-0's numbers are in `docs/ux/sa0/findings.md` part 5.

## Size

| Before (SA-0) | 1440 | 390 | 390 at Larger | After (SA-3) | 1440 | 390 | 390 at Larger |
|---|---|---|---|---|---|---|---|
| Profile | 1 | 1.2 | 1.5 | Profile | 1 | 1.4 | 1.7 |
| Working hours | 1 | 1.8 | 2.2 | Working hours | 1.1 | 2.1 | 2.4 |
| Display | 1 | 1.2 | 1.5 | Display | 1 | 1.9 | 2.3 |
| Notifications | 2.9 | 5.8 | 7.4 | Reminders and notices (with every reminder's time) | 2.6 | 5 | 6.3 |
| Day and Week, Backlog | 2 + 1 | 5 + 1 | 6.4 + 1 | Planning | 1.2 | 2.3 | 2.7 |
| Focus | 1.1 | 2.2 | 2.7 | Focus | 1.4 | 2.5 | 3.1 |
| Clients, Client chats | 1 + 1 | 1 + 2 | 1 + 2.7 | Clients | 1.6 | 2.4 | 3.1 |
| A client's page | 1.9 | 4.5 | 5.2 | A client's page | 2.2 | 4.7 | 5.5 |
| Accounts and calendars, DevOps | 3 + 1.2 | 6 + 2.7 | 7.9 + 3.5 | Connections | 2.5 | 4.4 | 5.2 |
| AI and assistant | 1 | 1.4 | 1.7 | AI and assistant | 1 | 1.8 | 2.1 |
| Activity, Your data | 1 + 1 | 1.5 + 1.5 | 2 + 1.9 | Your data | 1.7 | 3.3 | 4.2 |
| About | 1 | 1 | 1 | About | 1 | 1.2 | 1.4 |
| **16 sections** | **20.2** | **35.3** | **44.4** | **11 sections** | **16.1** | **28.3** | **34.5** |

Totals leave out a client's page. Some single pages grew a little on the phone (Profile, Display, Focus, AI): SA-0 had
no root font of 17 px, which SA-2's iPhone checks added, so those rows read longer for the same content.

| Count (the audit's) | SA-2 | SA-3 |
|---|---|---|
| Help lines | 216 | 214 |
| Help over one line at 1440 | 10 | 6 |
| Help over two lines at 390 | 13 | 10 |
| Help behind More about this | 35 | 42 |
| Controls under 44 px at 390 | 27 | 28 (all in the kept shared components, as in SA-2) |
| Kinds of row, help, button, table, button row | 10, 17, 13, 1, 5 | 10, 17, 13, 1, 5 |

## SA-0's nine pairs that could disagree

| # | Pair | Now |
|---|---|---|
| 1 | Close out time: the app's 15 minutes against Teams' 30 | **Gone.** One row, one time; Teams uses the app's. A person whose Teams time differed sees a one-time note. |
| 2 | Midday check-in: 0 minutes after lunch against Teams' 12:00 PM | **Gone.** One row, one time, as 1. |
| 3 | Reminder times in Day and Week, their switches in Notifications; an empty time with the switch on | **Gone.** Each reminder is one row in Reminders and notices with its switch and time; an empty stored time reads as the default. |
| 4 | Status report in three places (the in-app kind, the Teams kind, the times) | **Gone.** One Status report row with both switches and its times. |
| 5 | Timelines: Display's default against V for the session | **Still there.** Unchanged on purpose: V is for the session. |
| 6 | Days on Week: Show weekend in Display, Every weekend day only in Week's View options | **Gone.** Display's Show weekend is one choice (Never, When something's on them, Always). Always stays per browser (open questions). |
| 7 | Send feedback shown three ways in the demo | **Partly.** Settings shows it once, in About. Admin › Organization and Admin › Status are SA-4's. |
| 8 | Zero-length lunches in the demo | **Still there.** Demo data and Admin's new-people defaults; SA-2's open question stands. |
| 9 | Admin › Clients has no Allow AI | **Still there.** Admin is SA-4. |

## Read, but nowhere to change it

- The seven notice kinds sent with no switch now have one each, on by default.
- `conv.closed_shown_days` is still read with no screen (open questions).
