import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

// Import the GJS module as an ES module without changing Node's package type.
const source = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
const {defaultLanguage, resolveLanguage, LANGUAGE_MODES, translate, translateError, countdown, resetLabel} =
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
    for (const key of ['fiveHour','weekly','weeklyAll','remaining','refresh','theme','auto','dark','light','language','querying','resetQuerying','noAi','installCli','noCli','noReset','expired','inactive','stale','noData','failed','demo','updated','interval','day','genericError']) {
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

test('reset labels refresh even when usage is unchanged', () => {
    const old={remaining:100,reset_at:3600};
    const fresh={remaining:100,reset_at:7200};
    assert.equal(resetLabel(old,'ko',true,0),'초기화 시간 조회 중…');
    assert.equal(resetLabel(old,'en',true,0),'Checking reset time…');
    assert.equal(resetLabel(old,'en',false,0),'01:00:00');
    assert.equal(resetLabel(fresh,'en',false,0),'02:00:00');
    assert.equal(resetLabel({remaining:100,reset_at:null,active:false},'ko',false,0),'타이머 미시작');
    assert.equal(resetLabel({remaining:100,reset_at:null},'en',false,0),'Reset time unavailable');
    assert.equal(resetLabel({...old,stale:true},'en',false,0),'Cached · 01:00:00');
    assert.equal(resetLabel(null,'en',false,0),'Quota unavailable');
});
