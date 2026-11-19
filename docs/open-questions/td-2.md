## TD-2

- Facts found nowhere else and where they went: how tests stay apart (the old guide's Testing section), now in `docs/technical/development.md` (How tests stay apart); and the two raw-body routes beside `/api/action` (from its AS-1 and MC-1 sections), now in `docs/technical/architecture.md` (A normal request). Everything else in the old guide is in its step's decisions, a file's header comment or a `docs/technical/` page (`docs/ux/td2/architecture.md` has the table).
- Docs left as history that someone may want true again: `docs/demo.md` and `docs/demo/` (a walkthrough with screenshots of Nov 2), `docs/phone.md` (the phone on Nov 7), `docs/settings-inventory.md` (the Settings proposal of Nov 6), `docs/roadmap.md` (the direction on Nov 1) and `KICKOFF_PROMPT.md`. Rewrite any of them for the app now, or leave them as records?
- `docs/technical/architecture.md` opens by saying the per-file detail is in `docs/architecture.md`. The per-file detail is now in each file's header; the guide says where folders and entry points are. Left, since `docs/technical/` changes only for a rescued fact here; reword it with the page's next re-check?
- `docs/open-questions.md`'s first line says it mirrors spec section 16; the spec is in `docs/history/` now. Left (only this step's section is edited).
- `store/retention.ts` points to "docs/architecture.md, Retention", a section neither the old guide nor the new one has; retention is on `docs/technical/data.md`. Fix the comment with the next code step there?
- CLAUDE.md's Folder map doesn't list `docs/`, so the guide's `docs/` section is the one the check allows beyond the map. Add `docs/` to the Folder map with the next CLAUDE.md change?
- Should `docs/open-questions.md` be split into open and closed? It holds about 780 entries and table rows (914 lines), of which 484 look open and many are answered by a later step without saying so (`docs/ux/td2/open-for-owner.md` is one pass at the open ones).
- Should `docs/decisions.md` be split by month? It is over 1 MB, which some editors and the GitHub viewer open slowly.
- The runners apply timestamped migrations in name order, and some existing files carry stamps later than today (up to `20261205T0900`). A migration named for the real UTC time now would sort before them. Should the rule say "later than the newest file" (a CLAUDE.md working style change, not made here)? Found by the TD-2 review.
- `docs/technical/architecture.md` says 396 actions; the registry has about 400 now. Left for the page's next re-check.

