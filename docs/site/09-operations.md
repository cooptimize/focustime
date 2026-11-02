# 09. Operations

Coopilot runs as a systemd **user** service on one Linux desktop. There is no installer script in the repo; installation is a short list of files copied or linked by hand, recorded in [docs/spec.md](../../docs/spec.md) sections 19 and 20.

## Requirements

- Node 26 or newer ([package.json](../../package.json) `engines`), runs `.ts` files directly.
- Chromium (the app window, and the browser tests). Optional: Microsoft Edge for per-client profile links, `playerctl` for pausing music (open question Q57), `notify-send` for notifications, `jq`, `curl` and `hyprctl` for `coopilot-open`.
- A Secret Service keyring (`secret-tool`).
- Outside the machine, set up once by an admin: a Dataverse application user with a read-only role, the "Coopilot Desktop" public client app registration (Microsoft), a Google desktop OAuth client ([docs/spec.md](../../docs/spec.md) section 10). Profile photos need admin consent for `ProfilePhoto.Read.All`.

## Install

From [docs/spec.md](../../docs/spec.md) sections 19 and 20, and [system/](../../system/):

1. Clone the repo and run `npm ci` (dependencies install into the repo only).
2. Start once (`npm start`) so `~/.config/coopilot/config.toml` is written as a commented starter. Fill in `[dataverse]`, `[outlook]` and `[google]` identifiers.
3. Put the Dataverse and Google client secrets in the keyring from Settings > Connections (masked entry).
4. Install the service: copy [system/coopilot.service](../../system/coopilot.service) to `~/.config/systemd/user/`, then `systemctl --user daemon-reload && systemctl --user enable --now coopilot`. The unit's `WorkingDirectory` and Node path are written for the author's machine and need editing for anyone else.
5. Install the launcher: link [system/coopilot-open](../../system/coopilot-open) to `~/.local/bin/coopilot-open`, copy [system/Coopilot.desktop](../../system/Coopilot.desktop) to `~/.local/share/applications/`, the icon to `~/.local/share/icons/hicolor/256x256/apps/coopilot.png`, and [system/coopilot.desktop](../../system/coopilot.desktop) to `~/.config/autostart/`.
6. Bind keys in Hyprland: Super + Alt + C runs `coopilot-open`, Super + Alt + N runs `coopilot-open --capture` (lines in the user's `bindings.lua`; not in this repo).
7. Open Coopilot and sign in with Microsoft; connect Google; enter DevOps write PATs per client if wanted.

## Update

The service builds the UI before every start (`ExecStartPre` runs `vite build`), so an update is: pull, `npm ci` if dependencies changed, then `systemctl --user restart coopilot`. The plan store migrates itself on open, with a backup first ([store/plan-store.ts](../../store/plan-store.ts) `migrate`). An open window from the old run is out of date (its launch token changed); `coopilot-open` replaces it, and the window itself offers "Reopen Coopilot" ([ui/Reopen.tsx](../../ui/Reopen.tsx)). There is no documented update procedure beyond this (Not verified).

## Uninstall and rollback

From [docs/spec.md](../../docs/spec.md) sections 12, 19 and 20:

```bash
systemctl --user disable --now coopilot
rm ~/.config/systemd/user/coopilot.service ~/.config/autostart/coopilot.desktop
systemctl --user daemon-reload
rm ~/.local/bin/coopilot-open ~/.local/share/applications/Coopilot.desktop \
   ~/.local/share/icons/hicolor/256x256/apps/coopilot.png
# export the plan first if you want it: Settings > Data > Export
rm -r ~/.local/share/coopilot ~/.config/coopilot ~/.cache/coopilot
```

Then delete the `coopilot` keyring entries (Sign out and Disconnect remove the refresh tokens; app secrets and write PATs can be cleared in Settings or with `secret-tool clear service coopilot account <name>`), remove the two Hyprland key lines, and in Entra and Google revoke consent or delete the app registrations. Nothing else on the machine is changed.

**Rolling back a code change**: check out the earlier commit and restart. A plan store already migrated to a newer schema is refused by older code ("Plan store is from a newer Coopilot"). Restore the `plan.db.bak-v<from>-<stamp>` copy written before that migration ([store/plan-store.ts](../../store/plan-store.ts) `backupPath`).

## systemd user service

[system/coopilot.service](../../system/coopilot.service): `PartOf` and `WantedBy` `graphical-session.target`, `Type=simple`, builds the UI, runs `node server/main.ts --no-open`, `Restart=on-failure` after 5 s. The server listens on `127.0.0.1:5317`. If the port is busy it exits with "Coopilot is already running on port 5317 (perhaps as the coopilot service)" ([server/main.ts](../../server/main.ts)).

Useful commands:

```bash
systemctl --user status coopilot
systemctl --user restart coopilot
journalctl --user -u coopilot -f
```

Server flags ([server/main.ts](../../server/main.ts) header): `--dev` (Vite in the server), `--no-open`, `--no-reopen`, `--headless` (no notifications or windows; used by tests), `--port <n>`, `--clock <ISO instant>` (verification runs only). `COOPILOT_DIST` points the server at another build.

## Launcher and shortcuts

[system/coopilot-open](../../system/coopilot-open) is the one launch path for the app launcher entry, login autostart and both key bindings:

1. Start the service if it isn't active, and wait up to 60 s for the launch file and a live server.
2. With `--capture`, leave a one-shot request file (0600, holding only the word "capture") that the window picks up.
3. If a window from an earlier server run is open, close it (its token is stale).
4. Focus the Coopilot window, or open one with Omarchy's web-app launcher in its own Chromium data folder (`~/.local/share/coopilot/browser`), so it stays apart from browsing profiles.

## Logs

Structured lines on stderr, so in the journal under the service: time, source, op, and optional status, duration, count, kind ([log/logger.ts](../../log/logger.ts)). For example `2026-11-02T14:00:00.000Z outlook calendarview status=200 ms=310 count=14`. Logs never contain tokens, secrets, PATs, Authorization headers, request or response bodies, URLs with query strings, event subjects, teammates' presence or photos. See [07-security-and-privacy.md](07-security-and-privacy.md#what-is-never-logged).

## Backups

| What | When | Where |
|---|---|---|
| Plan store | Before each schema migration | `plan.db.bak-v<from>-<stamp>` next to `plan.db` |
| Plan store | Before Reset local plan | `plan.db.bak-reset-<stamp>` |
| Config | Before every Settings edit; last 30 kept | `~/.config/coopilot/backups/` |
| Plan export | On request | `~/.local/share/coopilot/exports/` |

There is no scheduled backup of `plan.db`; the person's own home-folder backup is assumed (Not verified).

## Demo mode

Settings > Display > "Show demo data", or Ctrl+K > "Demo mode". The top bar shows **Demo data**. A second action context with fictional sources (no fetch), an in-memory plan store and in-memory config replaces the live one; the real plan, config and sources are untouched. Outward actions (links, export, sign-in, every write confirm) are refused with "Demo data: nothing leaves Coopilot in demo mode". No reminders run. The VM is simulated. Turning it off throws the demo state away. The setting survives restarts through a flag file `~/.local/share/coopilot/demo-mode` ([server/demo.ts](../../server/demo.ts), [server/main.ts](../../server/main.ts), [actions/dispatch.ts](../../actions/dispatch.ts) `DEMO_REFUSED`, [docs/demo.md](../../docs/demo.md)).

For a demo on another port without touching the real service or data, the browser tests show the safe pattern: point `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_RUNTIME_DIR` at a temp folder, create `data/coopilot/demo-mode` there, and run `node server/main.ts --dev --no-open --port <n>` ([e2e/harness.ts](../../e2e/harness.ts)). A five-minute script is in [docs/demo.md](../../docs/demo.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Outlook needs reconnecting" with cached events | Microsoft refresh token expired or revoked | Settings > Connections > Sign in again ([sources/calendar/source.ts](../../sources/calendar/source.ts)) |
| "Outlook needs you to sign in again to allow this" | A scope was never consented, or MFA is needed | Sign in again from the feature that asked; for photos an admin must grant consent ([sources/oauth/oauth.ts](../../sources/oauth/oauth.ts) `needsInteraction`) |
| "Coopilot can't change your Outlook calendar yet" | Write scope not granted | Settings > Connections > Reconnect Outlook with calendar changes; if the tenant blocks user consent, an admin grants `Calendars.ReadWrite` on the registration (Q67) |
| "Enable DevOps writes" on a client | No write PAT for that client | Settings > Clients > enter a PAT with Work Items Read and write |
| "The DevOps write PAT is expired or invalid" | PAT expired, revoked, or wrong org | Enter a new one; Today warns 14 days before a known expiry (D256) |
| "DevOps PAT expired or invalid" on reads | The company PAT in Dataverse | Renew it in Dataverse (not in Coopilot) |
| "No access to DevOps project ..." | PAT scope or project name in Dataverse | Check the account's DevOps fields in Dataverse |
| "Dataverse sign-in failed: the client secret was rejected" | App secret expired | Settings > Connections: enter the new secret |
| "Secret storage unavailable" | Keyring locked | Unlock the keyring, then Retry |
| A source shows "unreachable" with an older time | Network or the service is down | Nothing to do; cached data shows until the next good read. Other sources keep working |
| "Google needs reconnecting" weekly | Google app in Testing status | Reconnect (Q12) |
| Page says "Coopilot needs a fresh launch link" | Server restarted, window has an old token | Open Coopilot again (launcher, Super + Alt + C, or `coopilot-open`) |
| "Coopilot did not start" from `coopilot-open` | Service failed | `systemctl --user status coopilot`, `journalctl --user -u coopilot` |
