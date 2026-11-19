## SA-5: Settings search that finds things, and all of Settings on the phone (Nov 18)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | Scope: search, the phone and names. No setting moves, is added or removed; no stored key, default, action or behavior changes; no migration and no new dependency. The one new prop (today's time off, for Most used) is read from the week already loaded. |
| - | Done | One search (`ui/settings/search.ts`) for Settings' box, the command menu's Settings results and Search Admin. It reads the registry's labels, old labels and `keywords` and Admin's list (`settings-list.ts`, its `words`); there is no second list. |
| - | Done | Ranking, in tiers: a section or part named by the words; a whole word in a label; a whole word among old labels and keywords; the start of a word (3 letters or more). Within a tier, the registry's order. "ai" finds AI for FocusTime and AI and assistant first. |
| - | Done | A result says where it is ("Connections › DevOps write access") and opens there: scrolled to, marked a moment, with its fold open. A setting on a client's page asks which client when more than one fits. The command menu lists the same results in the same order and opens them the same way. |
| - | Done | Admin's results show only to admins, marked Admin, under the person's own, in the box, the menu and the nearest suggestions; for anyone else they are never built (`admin === true` only, never while the check loads). |
| - | Done | Things that aren't settings (password, language, shortcuts, Gantt, code and others) answer from `NOT_SETTINGS` in the registry: where it is, or that FocusTime doesn't have it. |
| - | Done | Nothing found: "Nothing in Settings called "<words>"", up to three nearest settings, then Look in the Guide. What is typed stays in the browser: no request, no storage (`e2e/settings/sa5-search.test.ts`). |
| - | Done | The 100 searches (`ui/settings/search-cases.ts`): 100 land first, from main's 60. |
| - | Done | The phone: Settings opens on Most used (Notify this device, Let FocusTime message me in Teams, Theme, Text size, today's hours), then the search, then every section. Each of the five saves what its own page saves: the same rows for the first two, Display's setters, and Week's one-day change (`hours.set_day`, `hours.clear_day`) for today, off on a PTO day as in Week's day menu. |
| - | Done | No section is read-only on the phone (Working hours' read-only bar is gone). A table becomes rows with each cell under its column's name (shared with Admin, `row-labels.ts`); a wide row stacks; a list adds and removes with full-width buttons; a secret field is empty after save, as on a computer. |
| - | Done | Every control is at least 44 px at every Text size, with 8 px between two; a switch's or select's whole row takes the press. Help keeps to two lines at the Text size in use (`useHelpMax`), the rest behind More about this. Back goes setting, section, list, and the address follows. The desktop is unchanged. |
| - | Done | One name both sides: a row that shows a team value names it as Admin does (`team` in the registry, 13 pairs); the old name becomes an old label so search still finds it. "My acknowledgements" became "My thanks and short replies". |
| - | Done | The overhaul measured against SA-0 in `docs/ux/sa5/after.md`, with what is still open. |
| - | Done | From the review: Settings' tables drew sideways on the phone (now rows); Most used's today's hours offered Save on a PTO day (now says why); a section opened from the phone's list kept the list's scroll (now opens at its top); Admin's results now sit under all of the person's own, except an Admin part named by the words; "not signed in", "who opened" and "who changed" find their Admin tabs; the box clears when the address moves to another section; from the shake, a setting opened by search stays in view for two seconds while parts above it load their own data (My VM), unless the person moves first. |
| - | Open | The readings taken where the brief left room are in `docs/open-questions.md` under SA-5. |

