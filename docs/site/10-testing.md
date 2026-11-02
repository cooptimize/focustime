# 10. Testing

## Strategy

From [CLAUDE.md](../../CLAUDE.md#working-style): small end-to-end steps; define behavior first; write a failing test where it matters (normalization, risk rules, secret handling, failure isolation, persistence); implement; refactor. No tests for trivial styling or tests that mirror the implementation. Type-check before calling a step done, and inspect the real UI with a screenshot for UI changes.

Two kinds of tests, both run by Vitest ([vite.config.ts](../../vite.config.ts) `test.include`):

- **Unit and integration tests** next to the code (`*.test.ts`), in Node, with fake HTTP servers for every outside system.
- **Browser tests** in [e2e/](../../e2e/): Vitest drives the system Chromium through `playwright-core` against a throwaway Coopilot server in demo mode.

## What is covered

Counts are from the test files on this branch (number of `it(` or `test(` lines; approximate, and not from a test run).

| Area | Files | Cases | What the tests pin down |
|---|---|---|---|
| [week/](../../week/) | 9 | ~106 | Pattern expansion, half-day placement, risk rules (table-driven, boundaries, AM/PM spans), PTO days, free time, hours model |
| [plan/](../../plan/) | 38 | ~444 | Fit, estimating and envelopes, budgets, follow-up rules, due order, timeboxes, two-way sync decisions, calendar tiers, RSVP rules, DevOps write requests, VM rules, presence, notifications, Roadmap states, Plan ahead |
| [actions/](../../actions/) | 23 | ~317 | Dispatcher allowlist and input checks, registry matches dispatch, write framework (preview, confirm, read back, retry, undo) for Outlook, DevOps and Azure against fakes, no secret in responses |
| [sources/](../../sources/) | 14 | ~211 | Normalization from recorded and synthetic fixtures (Agile, Scrum and custom DevOps processes; Graph and Google pages), failure isolation, OAuth flow, PAT masking |
| [ui/](../../ui/) | 16 | ~144 | Navigation and addresses, keys and the legend, menus from the registry, status bar causes, contrast of token pairs, layout breakpoints |
| [server/](../../server/) | 7 | ~54 | Guard (Host, Origin, token, cookie), HTTP app, demo context, timer, notifications, media commands |
| [config/](../../config/) | 4 | ~47 | Per-field validation, comment-keeping edits and backups, notification and timeboxing settings |
| [store/](../../store/) | 1 | ~37 | Migrations, backups before migrating, refusing newer schemas, reset, export |
| [secrets/](../../secrets/) | 1 | ~12 | Keyring calls through stdin, read-only accounts, PAT wrapping |
| [links/](../../links/), [fixtures/](../../fixtures/) | 2 | ~16 | Edge launch arguments and link validation; the sample week |
| [e2e/](../../e2e/) | 10 | ~64 | Navigation, Plan the day add flow, capture and drafts, focus and capture, lookup, estimating and photos, notifications, presence, Roadmap and Plan ahead, VM and sign-in |
| Total | 125 | ~1450 | |

Key test helpers: [sources/dataverse/test-fakes.ts](../../sources/dataverse/test-fakes.ts) (fake Dataverse with `FAKE_TOKEN` and `FAKE_SECRET` used to prove they never leak), [sources/devops/write-fakes.ts](../../sources/devops/write-fakes.ts) (a fake `dev.azure.com` that keeps revisions, honors `test /rev` with 412, keeps comments, and can "lose an answer after doing the work" to test read back and retry), [sources/azure/fake-arm.ts](../../sources/azure/fake-arm.ts) (fake Resource Manager, also used by demo mode), [sources/graph/test-fakes.ts](../../sources/graph/test-fakes.ts), [sources/oauth/test-fakes.ts](../../sources/oauth/test-fakes.ts).

Test data is fake: `@example` addresses and `contoso` and `fabrikam` orgs ([CLAUDE.md](../../CLAUDE.md#working-style)). DevOps fixture files named `recorded-*` were captured from a real response shape; I did not open them to check their content is anonymized (Not verified).

## How to run

```bash
npm ci
npm test            # all unit and browser tests (vitest run)
npm run test:watch  # watch mode
npm run typecheck   # tsc for the UI and the Node side
```

Browser tests need Chromium at `/usr/bin/chromium`, `/usr/bin/chromium-browser` or `/usr/bin/google-chrome`; without one they are skipped (`describe.skipIf(!CHROMIUM)` in each e2e file). I did not run the tests for these docs: the worktree has no `node_modules` and the task was documentation only.

## How the browser tests are isolated

[e2e/harness.ts](../../e2e/harness.ts) starts one server per test file:

- In a new temp folder, with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_RUNTIME_DIR` pointed inside it, so the real config, plan store, cache and launch link are never touched.
- With demo mode on (the `demo-mode` flag file), so all sources are fictional and nothing is fetched.
- On a free port, with `--headless` (no desktop notifications, no windows), `--no-reopen`, and `--clock 2026-11-02T09:30:00-05:00` so dates are stable.
- The temp folder is deleted at the end.

## How live writes are kept out of tests

There are no automated tests that write to a real Outlook, DevOps or Azure. Every write path is tested against the fakes above. In demo mode Outlook and DevOps confirms and retries are refused ([actions/dispatch.ts](../../actions/dispatch.ts) `DEMO_REFUSED`), and Azure is simulated.

Live checks were done by hand, once per write feature, with each write approved in chat: for example the Outlook create, move and undo check on a test event (decision D216) and the DevOps create, state, comment and undo check on a test item in the Cooptimize org only ([docs/spec.md](../../docs/spec.md), "Step 14 live verification").

## What is deliberately not tested

- Trivial styling and tests that would mirror the implementation ([CLAUDE.md](../../CLAUDE.md#working-style)).
- Real outside systems in CI. There is no CI configuration in the repo (Not verified that none runs elsewhere).
- The systemd unit, `coopilot-open` and the Hyprland bindings (checked by hand; no tests for the shell script).
- Visual appearance beyond token contrast: UI changes are checked by screenshots from demo mode ([scripts/](../../scripts/) `screenshot-*.mjs`), not by pixel tests.
