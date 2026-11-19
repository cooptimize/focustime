## TD-1

Numbered D888 to D892 by AI-F1. "Pick" reads awkwardly; the product owner renamed it (Nov 6).

| # | Status | Decision |
|---|---|---|
| D888 | Done | TD-1: a planned piece of work on a half-day block is a "to-do" (plural "to-dos") in everything people read: the app's labels, counts, empty states, tooltips, aria-labels, errors, Settings, the command menu, the Guide, notifications, the Teams cards and quick replies, the Teams app's command list, the assistant's tool descriptions and previews, the demo's scripted replies and docs, the legal page and the app manifest. Labels only: code names (`pick.*` actions, `move_pick` and the other assistant tool names, types, CSS classes, `data-pick`), tables and columns, stored values (`paid_by = 'picks'`, the close note "Done as a pick", a follow-up's close reason) and URLs stay. "Pick" meaning choose ("Pick a day after today", "the people you pick", "picks it up") stays. |
| D889 | Done | TD-1: the command menu finds every to-do command by "to-do", "todo" and the old "pick" (`filterCommands` treats pick, picks, todo and todos as to-do), so no `aka` per command. |
| D890 | Done | TD-1: the assistant's fixed instructions say "a to-do is a planned piece of work on a half-day block (code name pick)", that people may say pick or to-do and both mean the same, and that replies call it a to-do. The tool names keep pick; their descriptions say to-do. |
| D891 | Done | TD-1: a guard (`scripts/words-guard.ts`, run by `npm run guards` and CI) fails on "pick" in the to-do sense in string literals and JSX text of the app's code (not tests or fakes), the demo docs and the public pages. It skips code tokens (`pick.move`, `kind: "pick"`, class names, `Pick<>`), SQL, comments, and "pick" as choose (followed by a, the, another, from, who, up and similar, or after you, can, may, to), with a short list of one-off phrases. A noun before it ("a pick", "today's picks", "3 picks") makes it the to-do sense whatever follows. |
| D892 | Done | TD-1: the Guide answers "Where did picks go?" beside QF-1's renames. |

## TD-1: Technical docs rewritten as the current state (Nov 13)

Unnumbered until merge.

| # | Status | Decision |
|---|---|---|
| - | Done | The code on `main` is the truth. Every page in `docs/technical/` was checked whole against one commit and says so in one "Checked against" line, with no exceptions; a fact the code, the Bicep, the scripts and the workflows can't confirm is marked **Not verified**. The claims checked before the rewrite are in `docs/ux/td1/ledger.md` |
| - | Done | Pages describe the present only: no "was", "until", "used to" or step ids in the body. One short History line per page points to this file |
| - | Done | Pages use the screen names people see (Day, Week, Backlog, Status, Inbox, More). The Overview's "Names in the code" table gives the code's names beside them (`today`, `ahead`, `pick`, `followup.*`, `requests` and the rest) and is the one place outside History lines a retired name may appear |
| - | Done | Data lists the tables kept but no longer written (`chat_messages`, `asks`, `delivery_chats`, `dedupe_log`) and what would remove them; it does not drop them (migrations only add) |
| - | Done | Operations gains the app configuration (the `FOCUSTIME_*` variables, by group, names only), the reminders that exist now (and the four notification kinds still listed but never sent), and the workflows. Development gains every command and every dependency with its purpose and license |
| - | Done | The Coop comment contract stays "Proposed, not built": re-checked, re-stamped, step ids replaced by rule names, and a line saying only the comment readers exist on FocusTime's side. It stays outside the panel (`scripts/tech-docs.ts` lists seven pages; changing it is out of this step) |
| - | Done | CLAUDE.md's glossary: one row per term in use, duplicates merged (Day, Promise and Follow-up, External member, Status), retired terms moved to a short Renamed list (old, current) with a "Gone" line, history notes and step ids removed, controls named (More, Previous, Next) instead of drawn. The folder map lists every folder that exists. Principles, Hard rules, Working style and Completion report are unchanged (same sha256 of the four sections) |
| - | Done | `npm run docs:check` also fails on: a page with other than one "Checked against" commit or with exceptions in it; a retired screen name outside the names table and History lines; a repo path in backticks that doesn't exist; a table on Data the code doesn't create; a `package.json` dependency missing from Development. The checks cover the Coop contract too |
| - | Done | Where the code looked wrong, the pages say what the code does and the question goes to open questions; no code changed |

