#!/bin/sh
# Installs FocusTime for this user (R1): the systemd user service (WorkingDirectory set to this repo), the
# focustime-open launcher in ~/.local/bin, the FocusTime launcher entry, the login autostart entry and the icons.
# Run it again after moving the repo folder. With --remove-coopilot it also removes what the app installed under its
# old name (the coopilot service, launcher, entries and icons). Nothing else is touched: no Hyprland or Omarchy file.
# Usage: system/install.sh [--remove-coopilot]
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
bin="$HOME/.local/bin"

mkdir -p "$units" "$apps" "$autostart" "$bin"
sed "s|^WorkingDirectory=.*|WorkingDirectory=$repo|" "$repo/system/focustime.service" > "$units/focustime.service"
ln -sfn "$repo/system/focustime-open" "$bin/focustime-open"
install -m 644 "$repo/system/FocusTime.desktop" "$apps/FocusTime.desktop"
install -m 644 "$repo/system/focustime-autostart.desktop" "$autostart/focustime.desktop"
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
