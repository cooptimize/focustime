## DD-1: The dev deploy's check looks for the dev site's title (Nov 18)

- **Should the deploy's smoke test run against a local server in CI?** A change like EV-1's (what the page says on dev) passed every pull request check and only failed after the merge, in deploy-dev. `scripts/deploy-title.test.ts` now catches the title, but not the rest of the step (the sign-in redirect, the security headers). The step could move into a script that CI also runs against the image it already starts (with `FOCUSTIME_ENV=dev`), so it fails in the pull request. Not in this step: no new smoke test was in scope.
- **`docs/technical/operations.md` names the wrong smoke test.** It says deploy-dev's smoke test is `infra/scripts/smoke.sh`; the workflow runs its own inline Smoke test step (health, the commit served, the title, sign-in, headers) and smoke.sh is a by-hand check after a deploy. Not the title's cause, so not changed here.
- **The style guide's light `--risk` reads #C0311F; the stylesheet's is #B42F1D** (`--p-co-red-700`). DD-1's row gives the stylesheet's value. Which one should the table show?

