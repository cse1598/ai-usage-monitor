#!/usr/bin/env bash
# Read-only diagnostics: no credential reads, login, network requests or installation.
set -euo pipefail
cd "$(/usr/bin/dirname "$0")"
if [[ ! -x /usr/bin/python3 ]]; then
    echo '[FAIL] /usr/bin/python3 not found. Install python3 first.'
    exit 1
fi
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 - <<'PY'
import json
import pathlib
import re
import shutil
import subprocess
import sys

print('=== AI Usage Monitor | Compatibility Check ===')
failed = False

def report(status, name, detail):
    global failed
    print(f'[{status}] {name}: {detail}', flush=True)
    if status == 'FAIL':
        failed = True

def version(command, config_path=None):
    try:
        import os
        env = os.environ.copy()
        if config_path:
            env['PATH'] = config_path
        output = subprocess.run(command, capture_output=True, text=True,
                                timeout=10, env=env, check=True)
        return (output.stdout.strip() or output.stderr.strip()).splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError):
        return None

try:
    os_info = {}
    for line in pathlib.Path('/etc/os-release').read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep:
            os_info[key] = value.strip('"')
except OSError:
    os_info = {}
is_ubuntu = os_info.get('ID') == 'ubuntu' and os_info.get('VERSION_ID') == '24.04'
report('PASS' if is_ubuntu else 'WARN', 'OS',
       os_info.get('PRETTY_NAME', 'Unknown') +
       ('' if is_ubuntu else ' (Ubuntu 24.04 is the tested target)'))

py_ok = sys.version_info >= (3, 10)
report('PASS' if py_ok else 'FAIL', 'Python (/usr/bin/python3)',
       f'{sys.version.split()[0]} (minimum 3.10; tested on 3.12.3)')

supported = json.loads(pathlib.Path('extension/metadata.json').read_text())['shell-version']
gnome = version(['gnome-shell', '--version'])
match = re.search(r'GNOME Shell (\d+)(?:\D|$)', gnome or '')
gnome_ok = bool(match and match.group(1) in supported)
report('PASS' if gnome_ok else 'FAIL', 'GNOME Shell',
       f'{gnome or "not found"} (supported: {", ".join(supported)})')
for cmd in ('gnome-extensions', 'install'):
    report('PASS' if shutil.which(cmd) else 'FAIL', cmd,
           'available' if shutil.which(cmd) else 'not found')

if py_ok:
    sys.path.insert(0, str(pathlib.Path('extension').resolve()))
    from collector import CONFIG, read_json, find_cli
    config = read_json(CONFIG)
    # Match the collector's executable discovery. The installer captures
    # the current PATH; saved absolute paths remain valid when executable.
    import os
    config['path'] = os.environ.get('PATH', '')
    for name, title in (('codex', 'Codex CLI'), ('claude', 'Claude Code CLI')):
        path = find_cli(name, config)
        if not path:
            report('SKIP', title, 'not installed (optional)')
            continue
        output = version([path, '--version'], config['path'])
        match = re.search(r'(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)', output or '')
        if not match:
            report('WARN', title, 'version unavailable; check CLI installation')
            continue
        current = tuple(map(int, match.groups()))
        if name == 'claude' and current < (2, 1, 270):
            report('WARN', title, f'{output} (get_usage requires >= 2.1.270)')
        elif name == 'codex' and current < (0, 165, 0):
            report('WARN', title, f'{output} (older than tested 0.165.0; compatibility unknown)')
        else:
            report('PASS', title, f'{output} (version check only; login/protocol not tested)')
print('Compatibility check failed.' if failed else 'Compatibility check passed (warnings are non-blocking).')
sys.exit(1 if failed else 0)
PY
