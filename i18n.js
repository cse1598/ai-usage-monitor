// Pure translation helpers shared by GJS and the Node.js tests.
export const LANGUAGES = Object.freeze({ko: '한국어', en: 'English'});
export const LANGUAGE_MODES = Object.freeze(['auto', 'ko', 'en']);

const STRINGS = {
    ko: {
        fiveHour: '5시간', weekly: '주간', weeklyAll: '주간',
        remaining: '% 남음', refresh: '지금 새로고침',
        theme: '테마', auto: '시스템 설정', dark: '다크', light: '라이트',
        language: '언어', querying: '사용량 조회 중…', resetQuerying: '초기화 시간 조회 중…',
        noAi: '설치된 AI가 없습니다',
        installCli: 'Codex 또는 Claude Code CLI를 설치하고 구독 계정으로 로그인하세요.',
        noCli: '1분마다 자동 탐색',
        noReset: '초기화 시간 미제공',
        expired: '초기화 예정 시각 경과 · 재조회 필요',
        inactive: '타이머 미시작', stale: '이전 값 · ',
        noData: '한도 데이터 없음', failed: '수집기 실행 실패 · 이전 값',
        demo: '데모 · ', updated: '마지막 조회', interval: '1분 간격',
        day: '일 ', genericError: 'CLI 실행/응답 오류'
    },
    en: {
        fiveHour: '5-hour', weekly: 'Weekly', weeklyAll: 'Weekly',
        remaining: '% left', refresh: 'Refresh now',
        theme: 'Theme', auto: 'System', dark: 'Dark', light: 'Light',
        language: 'Language', querying: 'Checking usage…', resetQuerying: 'Checking reset time…',
        noAi: 'No AI CLI detected',
        installCli: 'Install Codex or Claude Code CLI and sign in to your subscription.',
        noCli: 'Automatic detection every minute',
        noReset: 'Reset time unavailable',
        expired: 'Reset time passed · refresh needed',
        inactive: 'Timer not started', stale: 'Cached · ',
        noData: 'Quota unavailable', failed: 'Collector failed · cached data',
        demo: 'Demo · ', updated: 'Last checked', interval: '1 min interval',
        day: 'd ', genericError: 'CLI execution/response error'
    }
};

const ERROR_EN = {
    'codex CLI 미설치 또는 경로 오류': 'Codex CLI not installed or invalid path',
    'claude CLI 미설치 또는 경로 오류': 'Claude Code CLI not installed or invalid path',
    'Codex 기본 한도 없음': 'Default Codex quota unavailable',
    'Codex 5시간/주간 한도 없음 (로그인 또는 응답 확인)': 'Codex quotas unavailable (check login or response)',
    'Claude 구독 한도 없음 (로그인 확인)': 'Claude subscription quota unavailable (check login)',
    'Claude 사용량 응답 없음 (로그인/CLI 버전 확인)': 'No Claude usage data (check login or CLI version)',
    'CLI 응답 시간 초과': 'CLI request timed out',
    'CLI가 응답 전에 종료됨 (로그인/버전 확인)': 'CLI exited before responding (check login or version)',
    'Codex 초기화 실패 (CLI 업데이트 확인)': 'Codex initialization failed (check CLI updates)',
    'Codex 한도 조회 실패 (구독 로그인 확인)': 'Codex quota request failed (check subscription login)',
    'Claude get_usage 실패 (2.1.270 이상 필요)': 'Claude get_usage failed (requires 2.1.270 or later)'
};

export function defaultLanguage(locale) {
    return /^ko(?:[_\.\-@]|$)/i.test(locale || '') ? 'ko' : 'en';
}

export function resolveLanguage(mode, locale) {
    return Object.hasOwn(LANGUAGES, mode) ? mode : defaultLanguage(locale);
}

export function translate(language, key) {
    return (STRINGS[language] || STRINGS.en)[key] ?? key;
}

export function translateError(language, message) {
    if (!message || language === 'ko') return message || '';
    if (Object.hasOwn(ERROR_EN, message)) return ERROR_EN[message];
    if (message.endsWith(': CLI 실행/응답 오류'))
        return message.replace('CLI 실행/응답 오류', STRINGS.en.genericError);
    // Do not expose unrecognized backend text in the English UI.
    return STRINGS.en.genericError;
}

export function countdown(t, language, now = Date.now()/1000) {
    const tr = key => translate(language, key);
    if (!Number.isFinite(t)) return tr('noReset');
    let s = Math.floor(t - now);
    if (s <= 0) return tr('expired');
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const pad = n => String(n).padStart(2, '0');
    return `${d ? d + tr('day') : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

// A successful response replaces the reset timestamp, including explicit null.
// On failure, the collector marks the previous value as stale instead.
export function resetLabel(row, language, querying = false, now = Date.now()/1000) {
    const tr = key => translate(language, key);
    if (querying) return tr('resetQuerying');
    if (!row || !Number.isFinite(row.remaining)) return tr('noData');
    const text = !Number.isFinite(row.reset_at) && row.active === false
        ? tr('inactive') : countdown(row.reset_at, language, now);
    return (row.stale ? tr('stale') : '') + text;
}
