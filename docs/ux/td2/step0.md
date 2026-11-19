# TD-2 STEP 0

Read at `9fa4ca21` (origin/main, Nov 15, 2026). The section by section table for `docs/architecture.md` is [architecture.md](architecture.md); the product owner's open questions are [open-for-owner.md](open-for-owner.md).

## 0.1 An earlier TD-2

No branch `chore/td2-build-docs` and no TD-2 pull request existed. This step starts from `origin/main`.

## 0.2 Other open pull requests

None was open when this step started, so none touches `docs/architecture.md`, `docs/spec.md` or `CLAUDE.md`. `origin/main` is merged again before the final check.

## 0.3 CLAUDE.md's protected sections

Principles, Hard rules, Glossary, Working style and Completion report per increment were copied as they are at `9fa4ca21` (77,691 bytes together, SHA-256 starting `b799484178b84fe2`), and compared with the branch's CLAUDE.md at the end (the pull request says the result).

## 0.5 The files directly under docs/ and docs/demo/

| File | What it is for | The app it describes | Verdict |
|---|---|---|---|
| `architecture.md` | The folder guide, then a section per step | Every date from Nov 2 to Nov 15 at once | Rewritten in this step |
| `spec.md` | The first slice's spec (Oct 31) and a section per authorized step to Nov 15 | Oct 31 to Nov 15 | Moved to `docs/history/spec.md`; a note stays |
| `decisions.md` | Every decision, by step | Each row its own date | True now (a log) |
| `open-questions.md` | Every open question, by step | Each row its own date | True now (a log); its first line still says it mirrors spec section 16, left as it is (only this step's section is edited) |
| `roadmap.md` | Direction and the staged path, from a planning chat | Nov 1 | Describes an older app: a line at its top |
| `settings.md` | How Settings is put together and how to add a setting | Nov 13 | Small fixes make it true: the panel shell's example said the Guide "can sit on the same shell once ST-1 is merged"; it does |
| `settings-inventory.md` | ST-1's checkpoint: the settings before and the new layout | Nov 6, a proposal | Describes an older app: a line at its top |
| `cleanup-step-2.md` | What CL-1 stopped using and how a later step drops it | Nov 7 | True now: nothing it lists has been dropped yet |
| `demo.md` | A 5 minute walkthrough | Nov 2 (Today, Roadmap, modes) | Describes an older app: a line at its top |
| `phone.md` | FocusTime on a phone | Nov 7 (MB-1: Today, Ahead, Plan and Team) | Describes an older app: a line at its top |
| `assistant-interface.md` | The assistant service's calls and types | Nov 5 to Nov 11, with its own change list | True now (an interface reference); its example address `#/ahead?item=4417` still lands on Backlog |
| `guide.md` | How to add a Guide section, a tour or a try-it | Nov 13 | Small fixes make it true: "the five tab sections" are six since RB-6 |
| `demo/README.md` | How the demo works | Nov 8 | Already marked at its top (NM-2) |
| `demo/script.md` | The 15 minute demo script | Nov 9 | Already marked at its top (NM-2) |
| `demo/*.png`, `demo/*.gif` (63 files) | Screenshots for steps 13 to 17.6 | Nov 1 to Nov 3 | Describe an older app; `demo.md`, which shows them, carries the line |
| `demo/script-shots/` | The demo script's screenshots | Nov 9 | Covered by `demo/script.md`'s note |
| `KICKOFF_PROMPT.md` (repo root) | The prompt that started step 1 | Oct 31 | Describes the first slice: a line at its top saying so and what to read now |

## 0.6 Every place that points at docs/spec.md or docs/architecture.md

| Where | Points at | What this step does |
|---|---|---|
| `CLAUDE.md` line 5 (Read before changing code) | `docs/spec.md` | Drops the spec from the list (C) |
| `CLAUDE.md` line 10 (Current milestone, what each delivered) | `docs/spec.md` | Points at `docs/history/spec.md` (C) |
| `CLAUDE.md` line 11 (Current milestone, what is authorized) | `docs/spec.md` | Points at `docs/history/spec.md` (C) |
| `CLAUDE.md` line 56 (Folder map) | `docs/architecture.md` | Says what the file is now (C, E3) |
| `KICKOFF_PROMPT.md` | `docs/spec.md` | Marked as history (C3) |
| `docs/technical/development.md` (Tests and CI) | `docs/architecture.md#testing-hk-5` | Points at its own How tests stay apart, where the facts now are |
| `docs/technical/development.md` (Decisions and open questions) | `docs/architecture.md` | Lands; still true |
| `docs/technical/architecture.md` (its opening) | `docs/architecture.md` as "the per-file detail" | Lands on the guide; left (docs/technical/ only changes for a rescued fact) and noted in open questions |
| `docs/roadmap.md` | spec.md as "the living source" | Its new top line says what is current |
| `docs/azure/A0-plan.md`, `A0-inventory.md`, `A5-report.md`, `runbook.md` | both | Left: `docs/azure/` is out of this step; they land on the note and the guide |
| `docs/ux/br1/step0.md`, `docs/ux/nm2/step0.md` | both | Left: records of their steps; they land |
| `docs/decisions/d19-to-d666.md` (D457, an RF-1 row) | `docs/architecture.md` | Left: history |
| `docs/open-questions.md` (its first line, NM-1, TD-1 sections) | both | Left: only this step's section is edited |
| `actions/dispatch.ts`, `config/starter.ts`, `week/risks.ts`, `week/types.ts` (comments) | spec sections 4, 5 and 6 | Left: code; they land on the note, which says where the spec went |
| `store/retention.ts` (a comment) | "docs/architecture.md, Retention" | Left: code. No such section existed before either; retention is in `docs/technical/data.md` (noted in open questions) |
| `scripts/tech-docs.ts`, `docs/technical/README.md`, `security.md` | `docs/technical/architecture.md` | Not these files: the technical page of the same name |

No workflow, test or script points at either file.
