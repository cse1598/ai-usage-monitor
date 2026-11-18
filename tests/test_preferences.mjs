import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../extension/preferences.js',import.meta.url),'utf8');
const {syncMode,toggleMode}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

for (const [name,first,second] of [['theme','light','dark'],['language','ko','en']]) {
    test(name+' follows the system initially and when linked',()=>{
        assert.deepEqual(syncMode('auto',first),{mode:'auto',value:first});
        assert.deepEqual(syncMode('auto',second),{mode:'auto',value:second});
    });
    test(name+' click detaches; matching system change relinks',()=>{
        let state=toggleMode(first,first,first,second);
        assert.deepEqual(state,{mode:second,value:second});
        assert.deepEqual(syncMode(state.mode,first),state);
        state=syncMode(state.mode,second);
        assert.deepEqual(state,{mode:'auto',value:second});
        assert.deepEqual(syncMode(state.mode,first),{mode:'auto',value:first});
    });
    test(name+' second click or matching saved override relinks',()=>{
        assert.deepEqual(toggleMode(second,first,first,second),{mode:'auto',value:first});
        assert.deepEqual(syncMode(second,second),{mode:'auto',value:second});
    });
}
