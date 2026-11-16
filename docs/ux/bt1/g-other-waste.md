# BT-1 G: other waste looked at

## The UI build the browser tests use

The run builds the UI once (`test/e2e-build.ts`). Inside vitest that build is a development build of React (`NODE_ENV=test`; the main script is 1.47 MB against a release's 1.07 MB). Measured on four cores (`taskset -c 8-11`, CI=1, 2 browser workers as on CI) with one shard (2/6, 105 tests), each build twice:

| Build | Wall, s | File time, s | Tests |
|---|---|---|---|
| Test build (as today) | 226, 227 | 420, 421 | 105 passed |
| Release build | 198 | 362 | 105 passed |

A release build would save about 12% of the browser time. **Not taken**, because it would check less:

- React's development build runs every effect twice under `StrictMode` (`ui/main.tsx`), which catches an effect that isn't safe to run again (the opening's own comment, `ui/brand/Opening.tsx`, guards for it). A release runs each once.
- `import.meta.env.PROD` turns the service worker on (`ui/pwa.ts`): every browser test would then run with it, changing what each page fetches and keeps, which no test was written for.
- `import.meta.env.DEV` keeps the style guide's route (`ui/main.tsx`).

The question is in the open questions: a release build for most files and the test build for a few would need someone to say which few.

## Other things looked at

- **The unit job's start** (about 30 s of finding and transforming files before tests run) doesn't shrink with more workers (`step0.md` 0.4). Nothing to change there short of fewer, larger files.
- **Making a demo session** is about 0.8 of a fresh page's 1.3 s (`start-cost.md`): app code (`buildDemo`, `seedDemo`), outside this step; B avoids it where tests can share a person.
- **The WebKit job** restores its packages and browser from caches and runs one file (a median 74 s); nothing to save.
- **The image and infra jobs** run beside the tests (medians 61 s and 24 s) and finish long before the slowest shard; they don't set the run's length.
- **npm's cache** is restored by `setup-node` in every job; each runner needs its own `npm ci`, so nothing is repeated that could be shared.
