import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent


class EnvironmentTests(unittest.TestCase):
    def run_check(self, gnome='46.0', providers=None, with_extensions=True):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            bin_dir = root / 'bin'
            bin_dir.mkdir()

            def fake(name, output):
                path = bin_dir / name
                path.write_text(f'#!/bin/sh\nprintf "%s\\n" "{output}"\n')
                path.chmod(0o755)

            fake('gnome-shell', f'GNOME Shell {gnome}')
            if with_extensions:
                fake('gnome-extensions', 'available')
            fake('install', 'available')
            for name, value in (providers or {}).items():
                fake(name, value)
            env = dict(os.environ, HOME=str(root),
                       XDG_CONFIG_HOME=str(root / 'config'),
                       PATH=str(bin_dir))
            return subprocess.run(
                ['/bin/bash', str(ROOT / 'check_environment.sh')],
                env=env, capture_output=True, text=True, timeout=30)

    def test_supported_without_clis(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('[SKIP] Codex CLI', result.stdout)
        self.assertIn('[SKIP] Claude Code CLI', result.stdout)

    def test_supported_one_cli(self):
        result = self.run_check(providers={'codex': 'codex-cli 0.165.0'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('[PASS] Codex CLI', result.stdout)
        self.assertIn('[SKIP] Claude Code CLI', result.stdout)

    def test_old_claude_warns(self):
        result = self.run_check(providers={'claude': '2.1.269 (Claude Code)'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('[WARN] Claude Code CLI', result.stdout)

    def test_old_codex_warns(self):
        result = self.run_check(providers={'codex': 'codex-cli 0.100.0'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('[WARN] Codex CLI', result.stdout)

    def test_unsupported_gnome(self):
        result = self.run_check(gnome='42.9')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[FAIL] GNOME Shell', result.stdout)

    def test_missing_gnome_extensions(self):
        result = self.run_check(with_extensions=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('[FAIL] gnome-extensions', result.stdout)


if __name__ == '__main__':
    unittest.main()
