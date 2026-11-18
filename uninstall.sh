#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID == 0 ]]; then exit 1; fi
uuid=ai-usage-monitor@local
gnome-extensions disable "$uuid" 2>/dev/null || true
rm -rf -- "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
echo 'Extension removed. Config and quota cache retained.'
