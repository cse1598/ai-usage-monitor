import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

// Import the GJS module as an ES module without changing Node's package type.
const source = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
const {defaultLanguage, resolveLanguage, LANGUAGE_MODES, translate, translateError, countdown} =
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('locale default', () => {
    assert.equal(defaultLanguage('ko_KR.UTF-8'), 'ko');
    assert.equal(defaultLanguage('en_US'), 'en');
    assert.equal(defaultLanguage('fr_FR'), 'en');
    assert.equal(defaultLanguage('ja_JP.UTF-8'), 'en');
    assert.equal(defaultLanguage('zh_CN'), 'en');
    assert.equal(defaultLanguage('en_GB.UTF-8'), 'en');
    assert.equal(defaultLanguage('ko-KR'), 'ko');
    assert.equal(defaultLanguage('ko@variant'), 'ko');
    assert.equal(defaultLanguage('C'), 'en');
    assert.equal(defaultLanguage(undefined), 'en');
});
test('system mode and saved manual preferences', () => {
    assert.deepEqual([...LANGUAGE_MODES], ['auto','ko','en']);
    assert.equal(resolveLanguage('auto','ko_KR'),'ko');
    assert.equal(resolveLanguage('auto','en_US'),'en');
    assert.equal(resolveLanguage('auto','de_DE'),'en');
    assert.equal(resolveLanguage('en','ko_KR'),'en');
    assert.equal(resolveLanguage('ko','en_US'),'ko');
    assert.equal(resolveLanguage('invalid','ja_JP'),'en');
});
test('all interface keys have both translations', () => {
    for (const key of ['fiveHour','weekly','weeklyAll','remaining','refresh','theme','auto','dark','light','language','querying','noAi','installCli','noCli','noReset','expired','inactive','stale','noData','failed','demo','updated','interval','day','genericError']) {
        assert.notEqual(translate('en',key),key);
        assert.notEqual(translate('ko',key),key);
    }
});
test('countdowns in both languages', () => {
    assert.equal(countdown(90061,'en',0),'1d 01:01:01');
    assert.equal(countdown(90061,'ko',0),'1일 01:01:01');
    assert.equal(countdown(null,'en',0),'Reset time unavailable');
    assert.equal(countdown(0,'ko',1),'초기화 예정 시각 경과 · 재조회 필요');
});
test('backend error messages', () => {
    const msg='CLI 응답 시간 초과';
    assert.equal(translateError('ko',msg),msg);
    assert.equal(translateError('en',msg),'CLI request timed out');
    assert.equal(translateError('en','OSError: CLI 실행/응답 오류'),'OSError: CLI execution/response error');
    assert.equal(translateError('en','새 오류'),'CLI execution/response error');
    assert.equal(translateError('en',null),'');
    // Every currently emitted QueryError message must have an English mapping.
    const collector=readFileSync(new URL('./collector.py', import.meta.url),'utf8');
    for(const match of collector.matchAll(/raise QueryError\('([^']+)'\)/g))
        assert.notEqual(translateError('en',match[1]),'CLI execution/response error',match[1]);
});
