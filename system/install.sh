#!/bin/sh
# Installs the developer loop for this user (system/README.md): the systemd user service (this repo and the node on
# PATH filled in), the focustime-open launcher in ~/.local/bin, the launcher entry, the login autostart entry and the
# icons. Run it again after moving the repo folder. With --remove-coopilot it also removes what the app installed under
# its old name (the coopilot service, launcher, entries and icons). Nothing outside those is touched.
# Usage: system/install.sh [--remove-coopilot]
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
bin="$HOME/.local/bin"

node=$(command -v node) || { echo "node is not on PATH" >&2; exit 1; }
case "$repo$node$bin" in *"|"*) echo "A path holds |, which the templates can't take" >&2; exit 1 ;; esac
fill() { sed -e "s|@REPO@|$repo|g" -e "s|@NODE@|$node|g" -e "s|@BIN@|$bin|g" "$1"; }

mkdir -p "$units" "$apps" "$autostart" "$bin"
fill "$repo/system/focustime.service" > "$units/focustime.service"
ln -sfn "$repo/system/focustime-open" "$bin/focustime-open"
fill "$repo/system/FocusTime.desktop" > "$apps/FocusTime.desktop"
fill "$repo/system/focustime-autostart.desktop" > "$autostart/focustime.desktop"
chmod 644 "$apps/FocusTime.desktop" "$autostart/focustime.desktop"
"$repo/system/install-icons.sh" install

if [ "${1:-}" = "--remove-coopilot" ]; then
  systemctl --user disable --now coopilot.service 2>/dev/null || true
  rm -f "$units/coopilot.service" "$bin/coopilot-open" "$apps/Coopilot.desktop" "$autostart/coopilot.desktop"
  theme="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
  for s in 16 32 48 64 128 256 512; do rm -f "$theme/${s}x${s}/apps/coopilot.png"; done
  rm -f "$theme/symbolic/apps/coopilot-symbolic.svg"
  if command -v gtk-update-icon-cache >/dev/null; then gtk-update-icon-cache -q -f -t "$theme" || true; fi
  echo "Removed the coopilot service, launcher, entries and icons"
fi

systemctl --user daemon-reload
systemctl --user enable focustime.service >/dev/null
if command -v update-desktop-database >/dev/null; then update-desktop-database -q "$apps" || true; fi
echo "FocusTime installed from $repo (service enabled; start it with: systemctl --user start focustime)"
