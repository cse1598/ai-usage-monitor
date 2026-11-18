# AI Usage Monitor

> GNOME Shell 46 · Ubuntu 24.04 LTS · v0.4

독립적인 비공식 오픈소스 프로젝트이며 OpenAI 또는 Anthropic과 제휴하지 않습니다.

Ubuntu 24.04 / GNOME Shell 46용 상단 패널 확장 프로그램. Codex 5시간·주간, Claude 5시간·주간 전체 잔여율 및 초기화 카운트다운만 표시한다.

## 설치

```bash
sudo apt update
sudo apt install -y python3 gnome-shell-extension-manager unzip
gnome-shell --version
command -v codex
command -v claude
codex --version
claude --version
```

### CLI 설치 및 구독 계정 로그인 (필요한 서비스만)

두 CLI를 모두 설치할 필요는 없다. 이미 설치되어 로그인한 CLI는 재설치하지 않는다. 위젯은 데스크톱 앱이나 웹 브라우저가 아니라 실행 가능한 CLI를 탐색한다.

**Codex CLI** (공식 npm 설치, npm이 준비되어 있어야 함):

```bash
npm --version
npm install -g @openai/codex@latest
codex --version
codex login
```

npm이 없다면 [Codex 공식 설치 안내](https://github.com/openai/codex)를 참고한다. 로그인 시 구독 중인 ChatGPT 계정을 사용한다. API 키 기반 결제와 구독 한도는 다르다.

**Claude Code CLI** (공식 Linux 설치 스크립트):

```bash
sudo apt install -y curl
curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
claude --version
claude auth login
```

[Claude Code 공식 설치 안내](https://code.claude.com/docs/en/setup). `get_usage`를 지원하는 Claude Code 2.1.270 이상이 필요하다. 구독 중인 Claude 계정으로 로그인한다.

설치 및 로그인 후 `command -v codex` 또는 `command -v claude`가 실행 경로를 반환하는지 확인한다. 사용자 지정 경로에서 설치했다면 위젯 소스 폴더에서 `bash install.sh`를 다시 실행해 PATH를 갱신한다.

| 설치 상태 | 패널 및 상세 팝업 |
| --- | --- |
| Codex만 설치 | Codex 5시간·주간만 표시 |
| Claude Code만 설치 | Claude 5시간·주간만 표시 |
| 둘 다 설치 | 네 개 모두 표시 |
| 둘 다 미설치 | AI 표시 및 팝업에서만 CLI 설치·로그인 안내 |

설치되지 않은 CLI는 실행하지 않고 오류도 표시하지 않는다. 설치된 CLI의 실제 조회 실패(로그인 만료, 네트워크 오류 등)는 해당 서비스에 한해 표시한다. 매 조회 시 설치 여부를 재확인하며, 삭제된 서비스의 이전 캐시도 제거한다.

압축을 푼 폴더에서:

```bash
python3 collector.py --demo
bash install.sh
python3 collector.py | python3 -m json.tool
```

로그아웃 후 로그인하고 다음을 실행한다(또는 Extension Manager의 Installed에서 켠다).

```bash
gnome-extensions enable ai-usage-monitor@local
gnome-extensions info ai-usage-monitor@local
```

패널의 설치된 서비스 제품 아이콘과 잔여량을 클릭하면 해당 상세 항목 및 수동 새로고침을 볼 수 있다. 자동 조회는 1분마다, 카운트다운은 1초마다. 수동 조회는 30초 최소 간격. CLI 조회는 병렬로 수행한다. 실제 토큰 수가 아니라 구독 한도의 잔여 백분율이다.

## 업데이트

Git으로 받은 경우에는 먼저 `git pull`로 소스를 업데이트한다.

```bash
gnome-extensions disable ai-usage-monitor@local
bash install.sh
```

로그아웃 및 재로그인 후 `gnome-extensions enable ai-usage-monitor@local`을 실행한다.

### ZIP으로 업데이트

기존 사용자는 패키지를 재설치할 필요 없이 새 ZIP을 기존 소스 폴더에 덮어쓰고 `bash install.sh` → 로그아웃/로그인 → `gnome-extensions enable ai-usage-monitor@local` 순서로 진행한다. 설치 폴더의 아이콘도 자동 복사된다.

## 테마

팝업 하단 `테마`에서 시스템 설정 / 다크 / 라이트를 선택할 수 있다. 기본값은 시스템 설정이며, 우분투의 색상 모드 변경을 따라간다. 선택은 `~/.config/ai-usage-monitor/theme` (XDG_CONFIG_HOME 적용)에 보존된다. 상단 패널 자체는 GNOME 기본 테마를 유지한다. 로고는 로컬 SVG로 포함되며 출처는 `icons/NOTICE.md`에 있다.

서버 조회는 60초마다 시도하며, 이전 조회가 진행 중이면 중복 실행하지 않는다. 수동 조회는 30초 최소 간격. 서버 오류/제한 발생 시 기존 캐시 및 오류 표시를 확인한다.

## UI 데모 모드

설치 후 다음 명령으로 설정을 바꾼다. 실계정 데이터를 조회하지 않는다.

```bash
python3 - <<'PY'
import os,json,pathlib
p=pathlib.Path(os.environ.get('XDG_CONFIG_HOME',pathlib.Path.home()/'.config'))/'ai-usage-monitor/config.json'
d=json.loads(p.read_text()); d['demo']=True; p.write_text(json.dumps(d,indent=2))
PY
```

새로고침(30초가 지난 뒤) 또는 확장 프로그램 껐다 켜기. 패널에서 `DEMO`가 표시된다. 실사용 전 `True`를 `False`로 바꿔 같은 명령 실행.

## 파일 구성

- `collector.py`: Python 표준 라이브러리로 CLI JSON 프로토콜 연결, 잔여량 정규화, 병렬 조회, 캐시.
- `extension.js`: GJS, 패널과 팝업, 비동기 수집, 타이머, 오류 표시.
- `stylesheet.css`: GNOME UI의 다크/라이트 스타일.
- `metadata.json`: GNOME 확장 등록 정보.
- `install.sh`, `uninstall.sh`: 사용자 단위 설치/제거.
- `test_collector.py`: 가상 응답으로 파싱·캐시·프로토콜 검증.

## 문제 해결

```bash
python3 collector.py | python3 -m json.tool
journalctl --user -b -o cat | grep -iE 'ai-usage-monitor|JS ERROR' | tail -n 50
```

- `errors.codex` / `errors.claude`: 설치된 CLI의 버전·구독 로그인 점검. 설치 시 기록한 CLI 경로 및 PATH는 `~/.config/ai-usage-monitor/config.json`에서 확인한다. CLI 이동·업데이트 후 `bash install.sh`를 다시 실행한다.
- GNOME이 확장을 찾지 못하면 로그아웃 후 재로그인한다. Wayland에서 Alt+F2의 `r`은 사용하지 않는다.
- Claude 5시간 응답이 `is_active: false`이고 초기화 시각이 없으면 `타이머 미시작`으로 표시한다.
- `~` 및 `이전 값`은 조회 실패 시의 캐시이다. 초기화 예정 시각이 경과한 수치는 숨기고 다음 조회를 기다린다.
- GNOME UI 갱신: 소스 수정 후 `bash install.sh` → 로그아웃/로그인 → 확장 활성화.

## 개인정보 및 보안

기본 설정 위치: `~/.config/ai-usage-monitor/config.json`; 사용량 캐시: `~/.cache/ai-usage-monitor/usage.json`. XDG 디렉터리가 설정된 환경에서는 이를 따른다. 인증 파일을 직접 읽거나 전송하지 않는다. CLI가 자체 인증을 처리한다. 모델 생성 요청을 보내지 않는다. API 키 환경 변수 대신 로컬 구독 로그인을 사용하도록 주요 API 키 변수를 자식 프로세스에서 제외한다. 사용자 지정 CLI 설정에 따라 인증 방식이 다를 수 있다.

## 제거

프로젝트 폴더에서 실행한다.

```bash
bash uninstall.sh
```

확장 프로그램만 제거되며 Python, CLI, 구독 로그인 및 위젯 설정과 캐시는 유지된다. 위젯 설정과 캐시까지 삭제하려면 다음을 실행한다(위젯 데이터만 삭제).

```bash
rm -rf -- "${XDG_CONFIG_HOME:-$HOME/.config}/ai-usage-monitor"
rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/ai-usage-monitor"
```

## 프로토콜 참고

- Codex: https://learn.chatgpt.com/docs/app-server — `initialize` → `initialized` → `account/rateLimits/read`. `usedPercent`, `windowDurationMins`, `resetsAt` 필드 사용. 정확히 300/10080분인 한도만 선택.
- Claude: https://ccam.dev/en/features/usage/ 및 https://github.com/jhyunwoo/ccam/blob/main/internal/usage/probe.go — 실험적 `get_usage` control request. `limits` 배열의 `session`, `weekly_all`을 우선 사용하고 `five_hour`, `seven_day`를 호환용으로 파싱. 공식적으로 안정성이 보장되지 않아 향후 수정이 필요할 수 있다.
- GNOME: https://gjs.guide/extensions/development/creating.html

## 검증 범위

`python3 -m unittest -v test_collector` 10개 통과, `bash -n install.sh uninstall.sh` 통과, JS 모듈 구문 검사 통과. 현재 패키지는 v0.4이며 사용자 제공 실제 Claude 응답 구조를 테스트에 반영했다. 실제 GNOME Shell 세션에서는 추가 검증이 필요하다.

## 라이선스 및 브랜드

아이콘은 LobeHub Icons의 MIT 라이선스에 따라 포함되며, 원본 라이선스는 `icons/LICENSE`를 참조한다. 제품명 및 로고는 각 권리자의 자산이며 공식 제휴나 승인을 의미하지 않는다. 코드의 공개 라이선스는 저장소 소유자가 선택한다.
