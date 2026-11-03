# R1 report: Coopilot is now FocusTime

Renamed on Nov 2, 2026 (D416). The screenshots here come from demo mode (fictional data), except `notification.png`, which is a sample notification on the desktop.

- `signin-dark.png`, `signin-light.png`: the sign-in screen, "FocusTime" under the bent mark.
- `topbar-dark.png`, `topbar-light.png`: the top bar, WeekMark and "FocusTime".
- `about-dark.png`, `about-light.png`: Settings > About, with the lockup "FocusTime" and "by Cooptimize" muted.
- `notification.png`: a desktop notification from app FocusTime with the FocusTime icon.

## Migration on this computer (first start, Nov 2, 2026)

| What | Result |
|---|---|
| `~/.config/coopilot` | copied to `~/.config/focustime` (config.toml, backups); the old folder kept with MIGRATED.txt |
| `~/.local/share/coopilot` | copied to `~/.local/share/focustime` (plan.db and its backups; all 31 tables have the same row counts); the browser profile not copied; the old folder kept with MIGRATED.txt |
| `~/.cache/coopilot` | copied to `~/.cache/focustime`; the old folder kept with MIGRATED.txt |
| Keyring | moved from service coopilot to focustime and read back: dataverse-client-secret, google-client-secret, outlook-refresh-token, google-refresh-token, one DevOps write PAT (account `devops-write-pat:<client key>`); no failures; no old entries left |
| Service and launcher | the coopilot service disabled and removed; `focustime` installed and enabled (`system/install.sh`); `focustime-open`, `FocusTime.desktop`, autostart entry and icons installed; the coopilot ones removed (icons through the old install-icons.sh uninstall) |
| Hyprland | the two binding lines in `~/.config/hypr/bindings.lua` now run focustime-open (backup `bindings.lua.bak-r1`) |

The live checks after the first start:
- Signed in, with no re-consent.
- Dataverse, PTO, Outlook and Google are live.
- The VM chip reads the VM's power state.
- One timebox event on Outlook created before the rename, plus a help invite, are found by their markers. The timebox is still in the FocusTime tier (move, resize, retitle, show as, delete).
