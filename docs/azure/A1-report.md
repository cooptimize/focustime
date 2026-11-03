# A1 report: host boundary, strip, per-user time zone groundwork

Nov 2, 2026. Code only: nothing deployed, no Azure resources touched, the Entra script not run. The app still runs on
the developer machine, now through `host/local` (`FOCUSTIME_HOST=local`, the default).

Commits, in order: `f317629` (host interface and local host), `3b7600a` (core import boundary, browser profiles
removed), `e9a4559` (strip and fixtures), `4fc81ee` (time zone), and the docs commit after it.
Rollback: `git revert f317629^..HEAD` at the docs commit.

## What moved where

**The host interface.** `host/types.ts` defines one `Host` with these parts:

- `secrets`: get, set and delete by account, plus write PATs.
- `config`: load, write and the system user id.
- `paths`: config, data, cache, runtime and the plan database.
- `snapshots` and `photos`.
- `files`: plan export, store file modes and the demo flag.
- `loopback`: the desktop OAuth redirect.
- `notifications`: show (resolves with the click), close and line.
- `links.open`.
- `media`: player status, pause and resume, playlist and the end sound.
- `launch`: reopen, first window, detached programs, launcher request, launch link.
- `clock`: now and the default zone.
- `facts()`: kind, service and the config path shown in Settings.

`HostUnavailable` ("… is not available in the hosted app") is what the hosted app throws for a desktop-only operation.

| Was | Now |
|---|---|
| `secrets/keyring.ts`, `secrets/keyring-rename.ts` | `host/local/keyring.ts`, `host/local/keyring-rename.ts` (types in `host/types.ts`) |
| `cache/snapshots.ts`, `cache/photos.ts` | `host/local/snapshots.ts` (`createSnapshotStore`), `host/local/photos.ts` |
| `config/load.ts`, the file half of `config/edit.ts` | `host/local/config-file.ts` (`fileConfig`; backups, 0600, the starter file); `config/` is text and validation only |
| `server/rename.ts`, `server/media.ts`, `server/open-request.ts` | `host/local/rename.ts`, `host/local/media.ts`, `host/local/open-request.ts` |
| notify-send and gdbus in `server/notify.ts` | `host/local/notify.ts`; the reminder rules stay in `server/notify.ts` and call `host.notifications` |
| The loopback listener in `sources/oauth/oauth.ts` | `host/local/loopback.ts`; sources take a `Loopback` (none: "sign-in isn't available here") |
| XDG paths, plan store folder and file modes, exports, the demo flag in `server/main.ts` and `store/plan-store.ts` | `host/local/paths.ts`, `host/local/files.ts` (`StoreFiles`); `store/` uses only `node:sqlite` |
| xdg-open, the Chromium window, the launch file, `focustime-open` in `server/main.ts` | `host/local/launch.ts` (`localLinks`, `localLaunch`) |
| `server/host.ts`, `links/edge.ts`, `scripts/edge-profiles.ts`, `[edge]`, `[chromium]`, per-client browser and profile | removed. Links open in the person's browser (`Host.links`: local xdg-open; hosted, handed back for the page to open in a new tab). Old config files still load, the keys ignored |
| (none) | `host/azure/index.ts` stub: secrets, settings, snapshots and photos handed in, notices to an in-page inbox, links handed back, paths and desktop operations throw `HostUnavailable` |
| (none) | `host/fakes.ts` (in-memory parts and a recording fake host) and `host/host.test.ts` (one contract over the fake, azure and local hosts) |

`server/main.ts` is the only file that builds a host (`FOCUSTIME_HOST=local|azure`, default local).

**The boundary.** `host/boundary.test.ts` follows every relative import from `week/`, `plan/`, `actions/`,
`sources/` and `store/`, including what they reach in `config/`, `log/` and `links/`. It fails on any of these:

- an OS module (`fs`, `path`, `os`, `child_process`, `http`, `net` and the rest);
- `host/local`, `host/azure`, the fakes or `server/`;
- a core file that names a desktop program (secret-tool, notify-send, gdbus, playerctl, pw-play, xdg-open, chromium,
  focustime-open, systemctl).

## Inventory counts now resolved

| Inventory section | Then | Now |
|---|---|---|
| 1. Machine and OS touches | 31 rows | **Behind the host:** every row in section 1. **Removed:** Edge and Chromium detection and the browser profile scripts. **Unchanged:** the developer scripts under `scripts/` (developer tools, not product code). |
| 5. Owner and desktop content | 12 rows | **Done:** all 12 (the `system/` files kept as the developer loop). Owner, desktop, workstation and real client names are gone outside `docs/decisions.md`, `docs/azure/` and `system/README.md`. **Checked by** `fixtures/names.test.ts`. **Fixture names:** T&S and W&C became T&W (Tailspin & Wingtip), WC Project became TW Project, and `@cooptimize.org` became `@cooptimize.example`. **Removed:** the R1 desktop notification screenshot. |
| 5. Tanner-specific defaults | hours, Monday AM block, VM, Edge profiles | **Starter:** Mon to Fri 9:00 to 5:00, split at noon. **Standing blocks:** a per-person list, empty by default. **VM:** found by the Owner tag and hidden when there is none (already true). **Edge profiles:** removed. **Old four-day shape and Monday block:** only in `fixtures/four-day-week.ts`, for the tests written against them. |
| 6. Time zone reads | about 120 | **Through `userZone`:** 91 call sites. The rest take a zone already resolved from it (sources' `deps.timeZone`, the time model inside `week/`). **Fallbacks:** every New York fallback (the server, the timer, the compiled-in defaults) and every `?? "UTC"` on the person's zone replaced by the host clock's zone or `NEUTRAL_ZONE`. |

## The developer loop (`system/`)

`system/README.md` says these files are for the developer loop only. The service and desktop entries are templates that
`install.sh` fills in (repo folder, node, `~/.local/bin`).

`focustime-open` gets its window helpers from `~/.config/focustime/launcher.env`. That file is read as data, never
sourced. Without it, the script opens a plain Chromium `--app` window. On the developer machine the file names the
desktop's own helpers, so the launcher and key bindings behave as before.

## Per-user time zone

- **The setting.** `[hours] time_zone` is now optional. Left out, the host clock's zone applies: `parseConfig` takes
  `defaultZone`, and the local host passes the machine's zone. A new starter file is written with that zone.
- **The accessor.** `week/zone.ts` `userZone()` is the one read of the person's zone. `NEUTRAL_ZONE` ("UTC") applies
  only when nothing at all is known.
- **Settings.** The time zone field lists the browser's IANA zones (418 in Chromium).
- **No change for the developer.** The config file names `America/New_York`.
- **Tests.**
  - `week/zone.test.ts` covers the accessor and the default.
  - It runs the week in Eastern, Central, Mountain and Pacific, in standard and daylight time and across the Nov 1, 2026
    change, plus the "today" of 11:30 PM local.
  - It fails on a Region/City zone name in product code and on a read of the zone that skips `userZone`. Allowed: the
    Windows-to-IANA map, the demo and style guide sample data, and test fixtures.
  - `npm run test:zones` runs the whole suite under each of the four zones. All four passed: 148 files, 1,778 tests.

## Verified

- **Typecheck and tests:** both configs pass. 148 files and 1,778 tests pass, and pass again under `TZ` set to Chicago,
  Denver and Los Angeles.
- **Demo mode** (port 4819), checked in the page:
  - Week, Settings > Working hours, Clients (no browser or profile fields), Focus (music players, no program names) and
    Connections all render.
  - No page errors.
  - The VM chip shows for the demo VM.
  - Screenshots are in `docs/ux/A1/`.
- **The developer machine:** the service runs on `host/local` ("built UI, local host"), loads the config and signs in
  to Dataverse. The window, notifications, timer and launcher are left for the developer to check by hand (`focustime-open`), since nothing here sends input to the desktop.
- **Grep:** the desktop, workstation and owner names appear only in `system/README.md`, `docs/decisions.md` and
  `docs/azure/`. `fixtures/names.test.ts` enforces this.

## Deferred

- **To A2:**
  - User ids on tables and per-user settings rows (settings still come from one config file).
  - The process-wide zone the server keeps for its plan store clock and the 30-second reminder tick. It is now read
    through `userZone` from the one config.
- **Hosted sign-in:** the zone is seeded from Graph `mailboxSettings` at first sign-in. The `host/azure` stub is ready
  to take settings from the database.
- **Hosted app, Key Vault and the database:** `host/azure` secrets, snapshots, photos and notices are in memory for now
  (the stub). `secret.set` is unchanged. Whether it becomes an admin-only app setting is a hosted-app decision.
- **Hosted sessions:** the launch token page, Reopen and the `focustime-open` request file stay for the developer loop.
- **A5:** the decision log keeps the old names as history (Q3).
