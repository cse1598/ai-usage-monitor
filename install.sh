#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $EUID == 0 ]]; then echo 'Run as your desktop user, not sudo.'; exit 1; fi
bash ./check_environment.sh
uuid=ai-usage-monitor@local
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
conf="${XDG_CONFIG_HOME:-$HOME/.config}/ai-usage-monitor"
mkdir -p "$dest" "$conf"
if command -v gnome-extensions >/dev/null; then gnome-extensions disable "$uuid" 2>/dev/null || true; fi
install -m 644 metadata.json extension.js i18n.js stylesheet.css collector.py "$dest/"
install -d "$dest/icons"
install -m 644 icons/codex.svg icons/claude-code.svg icons/*-symbolic.svg icons/NOTICE.md icons/LICENSE "$dest/icons/"
/usr/bin/python3 - "$conf/config.json" "$(command -v codex || true)" "$(command -v claude || true)" <<'PY'
import json, pathlib,sys,os
p=pathlib.Path(sys.argv[1]); data=json.loads(p.read_text()) if p.exists() else {}
for key,path in zip(('codex','claude'),sys.argv[2:]):
    if path: data[key]=os.path.abspath(path)
data['path']=os.environ['PATH']
data.setdefault('demo',False)
p.write_text(json.dumps(data,indent=2)+'\n'); p.chmod(0o600)
print('Config:', p)
PY
echo "Installed: $dest"
echo 'Log out and back in, then run: gnome-extensions enable ai-usage-monitor@local'
