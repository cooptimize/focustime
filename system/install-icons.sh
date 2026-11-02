#!/bin/sh
# Coopilot's icons in the user's hicolor theme (step 17.5), the name the launcher entry (Icon=coopilot) and every
# notification (-i coopilot) use. Freedesktop Icon Theme paths:
#   $XDG_DATA_HOME/icons/hicolor/<size>x<size>/apps/coopilot.png and hicolor/symbolic/apps/coopilot-symbolic.svg
# Usage: system/install-icons.sh [install|uninstall]   (install is the default)
# Touches only those files and the user folder's icon cache; nothing system-wide, no other .desktop file.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
src="$here/../assets/brand"
theme="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
sizes="16 32 48 64 128 256 512"

refresh() {
  # -t: the user folder has no index.theme of its own (the system hicolor one applies); -f: rebuild even if fresh.
  if command -v gtk-update-icon-cache >/dev/null; then gtk-update-icon-cache -q -f -t "$theme" || true; fi
}

case "${1:-install}" in
  install)
    for s in $sizes; do
      install -D -m 644 "$src/icons/coopilot-$s.png" "$theme/${s}x${s}/apps/coopilot.png"
    done
    install -D -m 644 "$src/coopilot-symbolic.svg" "$theme/symbolic/apps/coopilot-symbolic.svg"
    refresh
    echo "Coopilot icons installed in $theme"
    ;;
  uninstall)
    for s in $sizes; do rm -f "$theme/${s}x${s}/apps/coopilot.png"; done
    rm -f "$theme/symbolic/apps/coopilot-symbolic.svg"
    refresh
    echo "Coopilot icons removed from $theme"
    ;;
  *) echo "usage: $0 [install|uninstall]" >&2; exit 2 ;;
esac
