#!/usr/bin/env python3
"""Read subscription quotas through local CLIs; never read credential files."""
import argparse, concurrent.futures, datetime as dt, json, math, os, pathlib, queue, shutil, subprocess, sys, threading, time

HOME = pathlib.Path.home()
CONFIG = pathlib.Path(os.environ.get('XDG_CONFIG_HOME', HOME / '.config')) / 'ai-usage-monitor' / 'config.json'
CACHE = pathlib.Path(os.environ.get('XDG_CACHE_HOME', HOME / '.cache')) / 'ai-usage-monitor' / 'usage.json'
KEYS = {'codex': ('codex_5h', 'codex_week'), 'claude': ('claude_5h', 'claude_week')}

class QueryError(Exception): pass

def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}

def find_cli(name, config):
    # Re-evaluate every poll; a saved path can disappear after uninstall.
    candidates = [config.get(name), shutil.which(name),
                  shutil.which(name, path=config.get('path') or os.defpath)]
    candidates += [str(HOME / folder / name) for folder in
                   ('.local/bin', '.npm-global/bin', '.bun/bin')]
    for candidate in candidates:
        if candidate and os.path.isabs(candidate) and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None

def cli(name, config):
    candidate = find_cli(name, config)
    if candidate is None:
        raise QueryError(f'{name} CLI 미설치 또는 경로 오류')
    return candidate

def timestamp(value):
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value) if value > 0 and math.isfinite(value) else None
        if isinstance(value, str):
            d = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
            return int(d.timestamp()) if d.tzinfo and d.year > 1970 else None
    except (ValueError, OverflowError, OSError): pass
    return None

def window(data, value_key, time_key):
    if not isinstance(data, dict): return None
    used = data.get(value_key)
    if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used): return None
    return {'remaining': round(100 - min(100, max(0, used)), 1), 'reset_at': timestamp(data.get(time_key)), 'observed_at': int(time.time())}

def parse_codex(result):
    bucket = (result.get('rateLimitsByLimitId') or {}).get('codex') or result.get('rateLimits') or {}
    if bucket.get('limitId') not in (None, 'codex'): raise QueryError('Codex 기본 한도 없음')
    rows = {}
    for field in ('primary', 'secondary'):
        w = bucket.get(field) or {}
        key = {300: 'codex_5h', 10080: 'codex_week'}.get(w.get('windowDurationMins'))
        if key: rows[key] = window(w, 'usedPercent', 'resetsAt')
    if not any(rows.values()): raise QueryError('Codex 5시간/주간 한도 없음 (로그인 또는 응답 확인)')
    return rows

def parse_claude(payload):
    if payload.get('rate_limits_available') is False: raise QueryError('Claude 구독 한도 없음 (로그인 확인)')
    limits = payload.get('rate_limits') or {}
    rows = {'claude_5h': window(limits.get('five_hour'), 'utilization', 'resets_at'),
            'claude_week': window(limits.get('seven_day'), 'utilization', 'resets_at')}
    # New Claude response schema is authoritative when supplied.
    for entry in limits.get('limits') or []:
        if not isinstance(entry, dict): continue
        key = {'session':'claude_5h', 'weekly_all':'claude_week'}.get(entry.get('kind'))
        if not key: continue
        parsed = window(entry, 'percent', 'resets_at')
        if parsed is not None:
            if isinstance(entry.get('is_active'), bool): parsed['active'] = entry['is_active']
            rows[key] = parsed
    if not any(rows.values()): raise QueryError('Claude 사용량 응답 없음 (로그인/CLI 버전 확인)')
    return rows

class Session:
    def __init__(self, args, env=None):
        self.p = subprocess.Popen(args, cwd=HOME, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace', bufsize=1)
        self.q = queue.Queue()
        def reader():
            try:
                for line in self.p.stdout:
                    try: self.q.put(json.loads(line))
                    except ValueError: pass
            finally: self.q.put(None)
        threading.Thread(target=reader, daemon=True).start()
    def send(self, obj):
        self.p.stdin.write(json.dumps(obj) + '\n'); self.p.stdin.flush()
    def wait(self, predicate, seconds):
        end = time.monotonic() + seconds
        while True:
            try: msg = self.q.get(timeout=max(0, end-time.monotonic()))
            except queue.Empty: raise QueryError('CLI 응답 시간 초과') from None
            if msg is None: raise QueryError('CLI가 응답 전에 종료됨 (로그인/버전 확인)')
            if isinstance(msg, dict) and predicate(msg): return msg
    def close(self):
        if self.p.stdin:
            try: self.p.stdin.close()
            except BrokenPipeError: pass
        try: self.p.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.p.terminate()
            try: self.p.wait(timeout=10)
            except subprocess.TimeoutExpired: self.p.kill(); self.p.wait()
        self.p.stdout.close()
    def __enter__(self): return self
    def __exit__(self, *args): self.close()

def query_codex(config):
    env = os.environ.copy(); env.pop('OPENAI_API_KEY', None)
    if config.get('path'): env['PATH'] = config['path']
    with Session([cli('codex', config), 'app-server'], env) as s:
        s.send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name':'ai_usage_monitor','title':'AI Usage Monitor','version':'0.5.0'}}})
        m = s.wait(lambda m: m.get('id') == 1 and ('result' in m or 'error' in m), 20)
        if 'error' in m: raise QueryError('Codex 초기화 실패 (CLI 업데이트 확인)')
        s.send({'method':'initialized'})
        s.send({'id':2,'method':'account/rateLimits/read'})
        m = s.wait(lambda m: m.get('id') == 2 and ('result' in m or 'error' in m), 30)
        if 'error' in m: raise QueryError('Codex 한도 조회 실패 (구독 로그인 확인)')
        return parse_codex(m.get('result') or {})

def query_claude(config):
    env = os.environ.copy()
    if config.get('path'): env['PATH'] = config['path']
    for key in ('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'):
        env.pop(key, None)
    args = [cli('claude', config), '-p','--input-format','stream-json','--output-format','stream-json','--verbose','--safe-mode','--no-session-persistence']
    with Session(args, env) as s:
        s.send({'type':'control_request','request_id':'ai-usage','request':{'subtype':'get_usage','skip_behaviors':True}})
        m = s.wait(lambda m: m.get('type')=='control_response' and (m.get('response') or {}).get('request_id')=='ai-usage', 60)
        response = m.get('response') or {}
        if response.get('subtype') != 'success': raise QueryError('Claude get_usage 실패 (2.1.270 이상 필요)')
        return parse_claude(response.get('response') or {})

def collect(config):
    old = read_json(CACHE); result = {'rows': {}, 'errors': {}, 'demo': False, 'providers': {}}
    detected = {name: find_cli(name, config) for name in KEYS}
    result['providers'] = {name: bool(path) for name, path in detected.items()}
    config = dict(config, **{name: path for name, path in detected.items() if path})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(fn, config): provider for provider, fn in [('codex',query_codex),('claude',query_claude)] if detected[provider]}
        for future in concurrent.futures.as_completed(futures):
            provider = futures[future]
            try:
                fresh = future.result()
                for key in KEYS[provider]: result['rows'][key] = fresh.get(key)
            except Exception as e:
                result['errors'][provider] = str(e) if isinstance(e, QueryError) else f'{type(e).__name__}: CLI 실행/응답 오류'
                for key in KEYS[provider]:
                    prev = (old.get('rows') or {}).get(key)
                    result['rows'][key] = dict(prev, stale=True) if isinstance(prev, dict) else None
    result['checked_at'] = int(time.time())
    CACHE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = CACHE.with_name(f'.usage-{os.getpid()}.tmp')
    fd = os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as f: json.dump(result,f,ensure_ascii=False)
    temp.replace(CACHE)
    return result

def demo():
    now = int(time.time())
    return {'demo': True, 'checked_at':now, 'errors':{}, 'providers':{'codex':True,'claude':True}, 'rows':{k:{'remaining':v,'reset_at':now+t,'observed_at':now} for k,v,t in zip(KEYS['codex']+KEYS['claude'], [78,32,65,41],[9060,302400,6480,370800])}}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--demo',action='store_true'); args=parser.parse_args()
    config=read_json(CONFIG)
    print(json.dumps(demo() if args.demo or config.get('demo') else collect(config),ensure_ascii=False))
