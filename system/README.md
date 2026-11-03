# system/: the developer loop only

FocusTime is a hosted web app for Cooptimizers. Nothing in this folder is part of the product or ships with it. These
files run the app on one Linux developer machine through the local host (`host/local`, `FOCUSTIME_HOST=local`, the
default when the server starts here), so a change can be tried end to end before it goes to Azure.

| File | What it does |
|---|---|
| `install.sh` | Installs the files below for the current user, filling in the repo folder, the `node` on `PATH` and `~/.local/bin`. Run it again after moving the repo. `--remove-coopilot` removes what the app installed under its old name. |
| `focustime.service` | A systemd user service (template) that builds the UI and runs `server/main.ts --no-open` on 127.0.0.1:5317. |
| `focustime-open` | Starts the service if needed, waits for it, then focuses the app window or opens one. `--capture` opens Quick capture. |
| `FocusTime.desktop`, `focustime-autostart.desktop` | A launcher entry and a login autostart entry (templates) that run `focustime-open`. |
| `install-icons.sh` | Installs the app icons into the user's hicolor theme, so desktop notifications show them. |
| `sqlserver/compose.yaml` | A3: the local SQL Server 2025 container (rootless Podman) on 127.0.0.1:14330, for the service, `npm run dev` and the tests. Run through `npm run db:up` (below), never directly. |

After a server change: `npm run build`, then `systemctl --user restart focustime`, then `focustime-open`.

## Retired for daily use (A5, D469)

Since A5 the daily app is prod (`https://ft-prod-app.grayforest-92f64bef.centralus.azurecontainerapps.io`), and the
service here is off: `systemctl --user disable --now focustime` (the service and its login autostart through
`focustime-open`; the autostart entry in `~/.config/autostart/` is moved aside to `focustime.desktop.retired`). Nothing
was deleted: the repo, `~/.config/focustime/`, the keyring entries, `~/.local/share/focustime/` and the `focustime`
database in the container are as they were. Super+Alt+C and Super+Alt+N in `~/.config/hypr/bindings.lua` open prod
(and prod's `#/capture`) in an app window instead.

Turn it back on:

```sh
systemctl --user enable --now focustime
mv ~/.config/autostart/focustime.desktop.retired ~/.config/autostart/focustime.desktop
focustime-open
```

and put the two bindings back to `~/.local/bin/focustime-open` and `... --capture`. The SQL Server container
(`npm run db:up`) and the developer loop (`npm run dev`) don't need the service and keep working either way.

## The database (A3)

The plan store is SQL Server: Azure SQL in the hosted app, the local container here. Needs `podman` and
`podman-compose`.

| Command | What it does |
|---|---|
| `npm run db:up` | Starts the container. The first time it makes the sa password (keyring: `focustime` / `sql-password`, passed to Podman in the environment, never on a command line), the volume, and `focustime_dev`. |
| `npm run db:migrate [-- --database focustime]` | Creates the database if missing (read committed snapshot on) and brings it to this build's schema. |
| `npm run db:reset` | Drops and recreates `focustime_dev`. Refuses `focustime`, the service's database. |
| `npm run db:down` | Stops the container. The data stays in the `focustime-sqlserver` volume. |

Databases: `focustime` is the service's (your plan), `focustime_dev` is for `FOCUSTIME_DB_NAME=focustime_dev npm run dev`,
and the tests make and drop their own `focustime_test_*`.

The service reads the database from `~/.config/focustime/app.toml`:

```toml
[database]
driver = "sqlserver"
server = "localhost"
port = 14330
database = "focustime"
auth = "sql"
user = "sa"
```

**Back to SQLite** (the fallback): set `driver = "sqlite"` (or remove `[database]`), then
`systemctl --user restart focustime`. The service then opens `~/.local/share/focustime/plan.db`, which the switch left
untouched, as it was at the moment of the export. Anything done on SQL Server after the switch is not in it;
`focustime export-local` and `focustime import` move data in the other direction only.

`focustime` (linked into `~/.local/bin` by `install.sh`): `export-local` writes the SQLite store as one person's export
JSON (opened read-only, never migrated); `import --file <export.json> --user <oid> [--dry-run]` loads an export into the
SQL Server database the app config names (or `FOCUSTIME_DB_*`); `counts --user <oid> [--sqlite]` prints rows per table.

## Window helpers

`focustime-open` opens a Chromium `--app` window by default, and a new one each time. A desktop can do better with two
optional helpers, one `KEY=program` line each in `~/.config/focustime/launcher.env` (mode 0600, owned by you; read as
data, never sourced):

```
FOCUSTIME_WEBAPP=<program that opens a web app window: <program> <url> <browser flags...>>
FOCUSTIME_FOCUS=<program that focuses a matching window or runs a command: <program> <pattern> <command>>
```

On Omarchy (Hyprland) these are `omarchy-launch-webapp` and `omarchy-launch-or-focus`, and a key binding in
`~/.config/hypr/bindings.lua` can run `focustime-open`. Where `hyprctl` is available, a window left from an earlier
server run is closed first so a fresh one opens on the current server.

None of this is needed for the hosted app, and no product code depends on it: the import-boundary test
(`host/boundary.test.ts`) keeps the core modules away from the machine.
