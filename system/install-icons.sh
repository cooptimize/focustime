#!/bin/sh
# FocusTime's icons in the user's hicolor theme (step 17.5), the name the launcher entry (Icon=focustime) and every
# notification (-i focustime) use. Freedesktop Icon Theme paths:
#   $XDG_DATA_HOME/icons/hicolor/<size>x<size>/apps/focustime.png and hicolor/symbolic/apps/focustime-symbolic.svg
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
      install -D -m 644 "$src/icons/focustime-$s.png" "$theme/${s}x${s}/apps/focustime.png"
    done
    install -D -m 644 "$src/focustime-symbolic.svg" "$theme/symbolic/apps/focustime-symbolic.svg"
    refresh
    echo "FocusTime icons installed in $theme"
    ;;
  uninstall)
    for s in $sizes; do rm -f "$theme/${s}x${s}/apps/focustime.png"; done
    rm -f "$theme/symbolic/apps/focustime-symbolic.svg"
    refresh
    echo "FocusTime icons removed from $theme"
    ;;
  *) echo "usage: $0 [install|uninstall]" >&2; exit 2 ;;
esac
