# PV-1 STEP 0: the zip, what pointed at it, and every file on main that isn't plain text

On `main` at db84596d (Nov 16). Files are named by path only. No screenshot was opened for this record, and none is described.

## 0.1 Earlier work

No branch `fix/pv1-zip` and no pull request for this step. Pull request #33 also carries the code PV-1, but it is an older step (the Week block panel, merged Nov 5) and has nothing to do with this one.

## 0.2 What pointed at the zip or at `docs/ux/U1/screens/live/`

| File | Line | Now |
|---|---|---|
| `docs/ux/U1/report.md` | 19, 488 | A line at the top says the zip and `screens/live/` were removed and why; both lines say where the demo screens are and that the live ones were removed |
| `docs/ux/U1/designer-prompt.md` | 57, 284, 293 | The same line at the top; section 7's heading says the zip was removed, and the two lines on `screens/live/` say it was removed |
| `docs/ux/U4/report.md` | 3 | Says the mockups were in the zip, removed in PV-1, and why |
| `docs/ux/ci3/step0.md` | 56 | A line under its heading says both are off main and remain in history |
| `docs/open-questions.md` (CI-3) | 1238 | The question says it was answered in PV-1 |
| `docs/decisions.md` (CI-3) | 2922, 2923 | Left as they were: a record of what CI-3 decided. PV-1's section records the removal |
| `docs/ux/README.md` | 5 | Already says the archive leaves out `U1/screens/live/`; still true |
| `scripts/guards.ts` | 92 | The zip leaves `LARGE_OK` (commit B) |

## 0.3 Every file on main that isn't plain text

169 files: 166 PNG, 2 GIF and 1 zip. No fonts, no other archives, no office files. SVG and the web manifest are text. The table goes by folder; "demo mode enforced" means the script that writes those files refuses to run outside demo mode.

| File | Bytes | What it is |
|---|---|---|
| `assets/brand/icons/focustime-128.png` | 3,239 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-16.png` | 427 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-256.png` | 6,354 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-32.png` | 922 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-48.png` | 1,460 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-512.png` | 13,356 | App icon, made from the WeekMark |
| `assets/brand/icons/focustime-64.png` | 1,969 | App icon, made from the WeekMark |
| `assets/teams/color.png` | 2,146 | Teams app icon (scripts/teams-icons.ts) |
| `assets/teams/outline.png` | 484 | Teams app icon (scripts/teams-icons.ts) |
| `docs/demo/01-today.png` | 113,532 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/02-week.png` | 241,673 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/03-plan-week.png` | 148,991 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/04-plan-week-menu.png` | 165,226 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/05-plan-day.png` | 97,196 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/06-plan-day-northwind.png` | 116,057 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/07-plan-day-added.png` | 128,800 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/08-plan-day-done.png` | 137,642 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/09-timebox-my-day.png` | 160,112 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/10-plan-day-timed.png` | 126,624 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/11-today-planned.png` | 126,074 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/12-focus.png` | 78,916 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/13-close-out.png` | 158,741 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/14-close-the-loop.png` | 163,817 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/154-inbox-sort-chips.png` | 140,088 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-settings-you.png` | 131,993 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-today-vm-prompt-light.png` | 111,397 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-today-vm-prompt.png` | 111,442 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-vm-delay-preview.png` | 126,670 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-vm-menu.png` | 129,565 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/154-vm-stop-preview.png` | 132,518 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/155-settings-notifications-light.png` | 160,474 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/155-settings-notifications.png` | 160,656 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/155-settings-you.png` | 137,660 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/15-closed.png` | 148,171 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/162-menu-person-light.png` | 122,271 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-roadmap-ahead.png` | 43,600 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-today-checkin-light.png` | 131,959 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-today-now.png` | 113,678 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-today-plan.png` | 97,221 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-week-plan.png` | 153,989 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/162-week.png` | 241,867 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-focus-deep.png` | 68,761 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-help-presence-light.png` | 189,903 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-help-presence-word.png` | 176,811 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-roadmap-presence.png` | 152,578 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-settings-focus.png` | 142,097 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-today-vm-prompt.png` | 107,855 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-vm-menu.png` | 125,719 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/163-week-vm-running.png` | 241,241 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/164-help-avatars.png` | 188,440 | Step 16.4 screenshot, demo per the spec |
| `docs/demo/164-planweek.png` | 156,743 | Step 16.4 screenshot, demo per the spec |
| `docs/demo/164-raise.png` | 34,675 | Step 16.4 screenshot, demo per the spec |
| `docs/demo/164-roadmap-people.png` | 156,941 | Step 16.4 screenshot, demo per the spec |
| `docs/demo/164-settings-photos.png` | 130,173 | Step 16.4 screenshot, demo per the spec |
| `docs/demo/16-today-closed.png` | 121,044 | Demo walkthrough, demo mode enforced (scripts/demo-walkthrough.mjs) |
| `docs/demo/175-about-light.png` | 65,409 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/175-brand-assets.png` | 558,755 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/175-close-out-dark.gif` | 344,746 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/175-open-vs-reference.gif` | 556,574 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/175-today-dark.png` | 112,429 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/175-week-light.png` | 259,215 | Step 17.5 screenshot or animation, demo mode per its commit |
| `docs/demo/176-1920-dark-planday.png` | 126,083 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/176-1920-dark-today.png` | 130,121 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/176-1920-light-planday.png` | 126,068 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/176-1920-light-today.png` | 129,587 | Step screenshot; no record says it was taken in demo mode (listed in open questions) |
| `docs/demo/17-plan-ahead-3840.png` | 265,188 | Step 17 screenshot, demo mode enforced (scripts/screenshot-step17.mjs) |
| `docs/demo/17-plan-ahead-dark.png` | 173,016 | Step 17 screenshot, demo mode enforced (scripts/screenshot-step17.mjs) |
| `docs/demo/17-plan-ahead-light.png` | 172,941 | Step 17 screenshot, demo mode enforced (scripts/screenshot-step17.mjs) |
| `docs/demo/17-roadmap-light.png` | 189,587 | Step 17 screenshot, demo mode enforced (scripts/screenshot-step17.mjs) |
| `docs/demo/17-roadmap.png` | 152,215 | Step 17 screenshot, demo mode enforced (scripts/screenshot-step17.mjs) |
| `docs/demo/script-shots/01-today-dark.png` | 106,724 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/01-today-light.png` | 105,304 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/02-plan-today-dark.png` | 120,379 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/02-plan-today-light.png` | 119,391 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/03-week-dark.png` | 164,357 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/03-week-light.png` | 165,799 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/04-ahead-grid-dark.png` | 191,451 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/04-ahead-grid-light.png` | 188,394 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/05-ahead-gantt-dark.png` | 177,955 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/05-ahead-gantt-light.png` | 176,544 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/06-ahead-fix-next-dark.png` | 125,531 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/06-ahead-fix-next-light.png` | 124,145 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/07-break-down-review-dark.png` | 199,697 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/07-break-down-review-light.png` | 204,547 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/08-break-down-created-dark.png` | 141,420 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/08-break-down-created-light.png` | 146,114 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/09-inbox-needs-you-dark.png` | 150,508 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/09-inbox-needs-you-light.png` | 149,630 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/10-inbox-create-form-dark.png` | 158,777 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/10-inbox-create-form-light.png` | 157,391 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/11-inbox-create-preview-dark.png` | 278,771 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/11-inbox-create-preview-light.png` | 289,014 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/12-inbox-tracked-dark.png` | 159,874 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/12-inbox-tracked-light.png` | 158,876 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/13-inbox-promises-dark.png` | 63,904 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/13-inbox-promises-light.png` | 63,341 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/14-capture-dark.png` | 133,312 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/14-capture-light.png` | 143,981 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/15-capture-ai-version-dark.png` | 146,779 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/15-capture-ai-version-light.png` | 157,223 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/16-assistant-move-dark.png` | 185,873 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/16-assistant-move-light.png` | 185,049 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/17-assistant-comment-dark.png` | 196,820 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/17-assistant-comment-light.png` | 196,054 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/18-send-to-dark.png` | 175,137 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/18-send-to-light.png` | 189,266 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/19-close-out-dark.png` | 81,002 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/demo/script-shots/19-close-out-light.png` | 81,220 | Demo script step, demo mode (DEMO_SHOTS) |
| `docs/teams/screens/card-brief-dark.png` | 98,546 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-done-dark.png` | 107,534 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-done-light.png` | 107,463 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-light.png` | 98,321 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-proposal-dark.png` | 124,069 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-proposal-light.png` | 124,420 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-test-dark.png` | 99,646 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-brief-test-light.png` | 99,382 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-cancelled-dark.png` | 12,102 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-cancelled-light.png` | 12,456 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-capture-dark.png` | 27,394 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-capture-light.png` | 27,692 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-capture-undone-dark.png` | 10,218 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-capture-undone-light.png` | 10,554 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-changed-dark.png` | 50,625 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-changed-light.png` | 51,166 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-dark.png` | 65,605 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-light.png` | 65,516 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-moved-dark.png` | 67,141 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-moved-light.png` | 68,052 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-proposal-dark.png` | 100,350 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-proposal-light.png` | 100,928 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-ticked-dark.png` | 62,805 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-checkin-ticked-light.png` | 62,955 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-dark.png` | 72,243 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-done-dark.png` | 67,063 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-done-light.png` | 67,847 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-light.png` | 71,870 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-proposal-dark.png` | 112,449 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-closeout-proposal-light.png` | 112,493 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-done-dark.png` | 21,448 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-done-light.png` | 21,628 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-expired-dark.png` | 15,335 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-expired-light.png` | 15,764 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-failed-dark.png` | 19,854 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-failed-light.png` | 19,810 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-help-dark.png` | 56,571 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-help-light.png` | 56,541 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-next-dark.png` | 28,035 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-next-light.png` | 27,812 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-nudges-dark.png` | 57,465 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-nudges-light.png` | 57,455 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-proposal-dark.png` | 44,609 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-proposal-light.png` | 45,268 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-today-dark.png` | 34,795 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-today-light.png` | 34,639 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-working-dark.png` | 10,207 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/card-working-light.png` | 10,264 | Teams card preview drawn from test data (scripts/teams-card-previews.ts) |
| `docs/teams/screens/tb1b-legal-1920.png` | 220,521 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb1b-legal-phone.png` | 183,701 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb1-settings-teams-off-larger.png` | 154,663 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb1-settings-teams-off.png` | 130,347 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb1-settings-teams-on-larger.png` | 154,554 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb1-settings-teams-on.png` | 130,477 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb2-settings-in-teams-larger.png` | 186,340 | Teams settings or legal page, demo mode (e2e) |
| `docs/teams/screens/tb2-settings-in-teams.png` | 134,169 | Teams settings or legal page, demo mode (e2e) |
| `docs/ux/U1/designer-handoff.zip` | 16,336,384 | U1 designer hand-off archive (removed in PV-1) |
| `public/icons/apple-touch-icon.png` | 2,034 | Web app icon |
| `public/icons/focustime-192.png` | 3,996 | Web app icon |
| `public/icons/focustime-512.png` | 11,439 | Web app icon |
| `public/icons/focustime-maskable-512.png` | 5,357 | Web app icon |

The one archive, `docs/ux/U1/designer-handoff.zip` (87 files), by name only:

- `designer-prompt.md`, `report.md`
- `design/brand-brief.md`, `design/brand.md`, `design/style-guide.md`, `design/wording.md`
- `screens/demo/`: 49 PNG files
- `screens/live/`: 32 PNG files, named `<width>-<theme>-<screen>[-p2|-p3].png` (widths 1920 and 3840; screens checkin, closeout, now, planday, planweek, planweek-next, week). The CI-3 notes call these real.

Files that may hold real screens: the 29 `docs/demo/` files of steps 15.4, 15.5, 16.2, 16.3 and 17.6 (`154-*`, `155-*`, `162-*`, `163-*`, `176-*`). The scripts for 15.4 to 16.3 (`scripts/screenshot-step154.mjs` and the others) use demo mode only when given `--demo`, and nothing records that they were given it. Step 17.6's four have no script on main, and nothing records that they came from the demo. Step 16.4's say so (the spec: "Demo screenshots"), and so do the others in the table. They are not removed here; `docs/open-questions.md` (PV-1) lists them by path.

## 0.4 The shots/ branches

One: `shots/archive` (3,027 files, CI-3's images in their old `docs/ux/<step>/` folders). No folder is named `live` and no file name says real or prod. The only step notes that call screenshots real are U1's (`screens/live/`), and the archive has no `docs/ux/U1/screens/live/` file (it has the 49 `screens/demo/` ones).
