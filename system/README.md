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

After a server change: `npm run build`, then `systemctl --user restart focustime`, then `focustime-open`.

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
server run is closed first so a fresh one opens with the current launch token.

None of this is needed for the hosted app, and no product code depends on it: the import-boundary test
(`host/boundary.test.ts`) keeps the core modules away from the machine.
