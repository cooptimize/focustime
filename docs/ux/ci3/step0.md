# CI-3 STEP 0

Read at `7c92f7aa` (origin/main, Nov 15, 2026, TD-2 merged). The CI timings, a clone's and a worktree's are in [before.md](before.md).

## 0.1 An earlier CI-3

No branch `chore/ci3-lighter` and no CI-3 pull request existed. This step starts from `origin/main`.

## 0.2 Other open pull requests

None was open when this step started, so none touches `.github/workflows/`, `scripts/guards.ts` or `docs/ux/`. `origin/main` is merged again before pushing.

## 0.3 and 0.4 Measurements

In [before.md](before.md).

## 0.5 What depends on a job's or a check's name

- **Branch rules.** None can be seen: `gh api repos/cooptimize/focustime/branches/main/protection` answers "Branch not protected", and the repository's rulesets and the rules for `main` are empty lists. Organization rules, if any, can't be read with this access. So every job keeps its name (a rule that can't be seen may still name it).
- **deploy-dev's reuse of CI** (`scripts/ci-tree-match.sh`, D456) depends on: the workflow file `ci.yml`; a run of it with event `pull_request` and status `success` on the pull request's last commit; the artifact `tested-tree` holding `git rev-parse HEAD^{tree}`, written by the job `test` after `unit` and `browser` passed; and `ci.yml` being callable (`workflow_call`), which deploy-dev does when the tree doesn't match.
- **The recorded tested tree**: the `test` job's "Record the tested tree" step and its artifact, kept 30 days.
- These names stay: `Unit and store tests (SQLite and SQL Server)`, `Browser tests N/6 (Chromium and WebKit)` (N from 1 to 6), `test`, `infra`, `image`, the artifact `tested-tree` and the workflow name `ci`. `ci-webkit-deps.yml` is separate: nothing depends on its jobs.

## 0.6 What reads or writes docs/ux

### Tests whose only job is screenshots

24 files in `e2e/` with no assertion, each skipped unless an environment variable names an output folder, so in CI each only loads and skips:

| File | Writes when | Kind |
|---|---|---|
| `e2e/ah3-shots.test.ts`, `as1-shots`, `as2-shots`, `mb1-shots`, `rb6-shots`, `ui10-shots` | `FOCUSTIME_SHOTS` names a folder | Screenshots |
| `e2e/bl2-shots.test.ts`, `br1-shots`, `cf1-shots`, `ed2-shots`, `gu1-shots`, `nm1-shots`, `nm2-shots`, `ps1-shots`, `ps2-shots`, `qt1-shots`, `rs1-shots`, `rs2-shots`, `sg1-shots`, `uc1-shots`, `wd2-shots`, `wk5-shots` | `<STEP>_SHOTS` names a folder | Screenshots |
| `e2e/rs1-audit.test.ts`, `e2e/rs1-scan.test.ts` | `RS1_AUDIT` or `RS1_SCAN` names a file | A layout audit as JSON, not screenshots: left in the suite (open question) |

`e2e/adm2-shots.test.ts` and `e2e/kb1-shots.test.ts` have assertions despite their names and stay. So does `e2e/uib-shots.test.ts`, whose assertions sit inside a block skipped unless `FOCUSTIME_SHOTS` is set (found by the review; an open question).

### Tests that check behavior and can also take screenshots

These stay in the suite: the screenshots are a side path that runs only when `FOCUSTIME_SHOTS` (or `VM2_SHOTS`) names a folder, which CI never sets. Their comments name `docs/ux/<step>` as where a step's pictures went: `e2e/ah6-gantt`, `cw1`, `ed1-edit-item`, `fn1`, `in2-invite-send`, `nl1-now-mark`, `qc1`, `rb1-code`, `rb2-code`, `rb4-code`, `rb5-code`, `setup` (VM-2's), `status-sr3`, `tp1`, `tx1`, `ty1`, `ty2`, `vm2`. `e2e/addwork` and `e2e/today` only cite a note in `docs/ux`.

### Scripts

- Default to a folder under `docs/ux`: `scripts/screenshot-ah5.ts`, `screenshot-bl1.ts`, `screenshot-gd2.ts`, `screenshot-gd3.ts`, `screenshot-ib4.ts`, `screenshot-rf1.ts`. Every other screenshot script already defaults to `screenshots/` (ignored by git).
- `scripts/teams-card-previews.ts` writes to `screenshots/teams` by default; its comment names `docs/ux/tb3` and `docs/ux/fn1`.
- `scripts/demo-walkthrough.mjs` writes to `docs/demo` (not `docs/ux`).

### Docs and the app

- Notes inside `docs/ux` name their own images as text (file names in code spans, no Markdown image links): 42 Markdown files, the most in `U1/report.md`, `U2/mockups/README.md`, `U1/designer-prompt.md`, `U5/u5.1.md`.
- Outside `docs/ux`, only text mentions of `docs/ux/...` paths, never an image shown: `docs/guide.md`, `docs/decisions.md`, `docs/open-questions.md`, `docs/analysis/wp1-plan.md`, `docs/azure/A0-inventory.md`, `A0-plan.md`, `A1-report.md`, `A2-report.md`.
- The app: `ui/guide/content.ts` and `ui/stamp.test.ts` cite a note in `docs/ux` in a comment. Nothing in the app reads `docs/ux`.

### Real data among the images

> PV-1 (Nov 16): both are off main now; `screens/live/` went in CI-3 and the zip in PV-1. They remain in history.

`docs/ux/U1/screens/live/` (32 PNG files) holds U1's screenshots of the owner's real FocusTime, taken on request (`docs/ux/U1/report.md`, answer 5), with real client names, a real person's name and real meeting titles. `docs/ux/U1/designer-handoff.zip` (16 MB) holds the same 32 among its 87 screenshots. Both are on main today, in a public repository. The repo's own rule is that screenshots in the repo come from demo mode only.

## 0.7 Files under docs/ that something running needs

| Path | Needed by |
|---|---|
| `docs/technical/**` | The app (the Technical docs panel, built in by `scripts/tech-docs.ts`), the image (`.dockerignore` keeps it), `scripts/tech-docs.test.ts`, `scripts/coop-contract.test.ts`, `ui/brand/assets.test.ts`, the guards |
| `docs/decisions.md` | `scripts/decisions.test.ts`, `scripts/tech-docs.test.ts`, the guards (as history) |
| `docs/architecture.md` | `scripts/tech-docs.test.ts` (the build guide's checks) |
| `docs/demo/` | `scripts/demo-walkthrough.mjs` writes its screenshots there on purpose; `docs/demo.md` shows them; the words guard reads `docs/demo/script.md` |
| Every other text file under `docs/` | Only the guards, which read every tracked text file |

Everything else under `docs/` is a record: nothing that runs reads it. No browser test and nothing in the image reads any file under `docs/` outside `docs/technical/` (the image leaves out `docs/` except `docs/technical/`, and the unit job runs every test that reads one).

### Large files (over 300 KB) outside docs/ux

| File | Size | Why it is large |
|---|---|---|
| `docs/decisions.md` | 1.0 MB | The decision log; it grows with every step |
| `ui/styles.css` | 593 KB | The app's one stylesheet |
| `docs/demo/175-brand-assets.png`, `175-open-vs-reference.gif`, `175-close-out-dark.gif` | 337 to 546 KB | The demo walkthrough's pictures, kept on purpose (`.gitignore` says so) |
