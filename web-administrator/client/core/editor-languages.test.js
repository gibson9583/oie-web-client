import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureEditorLanguage, registerEditorLanguage } from './editor-languages.js';

let sequence = 0;
const definition = () => ({ configuration: { comments: { lineComment: '#' } }, tokensProvider: { tokenizer: { root: [[/#.*/, 'comment']] } } });
function fixture() {
    const ids = new Map([['javascript', { id: 'javascript' }]]);
    const configurations = new Map();
    const tokens = new Map();
    const set = (map, key, value) => { map.set(key, value); return { dispose: () => map.delete(key) }; };
    return { ids, configurations, tokens, languages: {
        getLanguages: () => [...ids.values()],
        register: language => { ids.set(language.id, language); },
        setLanguageConfiguration: (id, value) => set(configurations, id, value),
        setMonarchTokensProvider: (id, value) => set(tokens, id, value)
    } };
}
const nextId = () => `plugin-language-${sequence++}`;

test('registration is lazy, concurrent editors share a load, and success is reused', async () => {
    const id = nextId(), monaco = fixture();
    let calls = 0, release;
    const ready = new Promise(resolve => { release = resolve; });
    const aliases = ['Plugin language'];
    registerEditorLanguage(id, { aliases, load: () => { calls++; return ready; } });
    aliases.push('later mutation');
    assert.equal(calls, 0);
    assert.equal(await ensureEditorLanguage(monaco, 'javascript'), true);
    assert.equal(calls, 0);
    const first = ensureEditorLanguage(monaco, id);
    assert.equal(ensureEditorLanguage(monaco, id), first);
    await Promise.resolve();
    assert.equal(calls, 1);
    release(definition());
    assert.equal(await first, true);
    assert.deepEqual(monaco.ids.get(id).aliases, ['Plugin language']);
    assert.ok(monaco.tokens.has(id));
    assert.ok(monaco.configurations.has(id));
    assert.equal(await ensureEditorLanguage(monaco, id), true);
    assert.equal(calls, 1);
});

test('invalid and duplicate registrations cannot replace an existing provider', async () => {
    const id = nextId(), monaco = fixture();
    assert.throws(() => registerEditorLanguage('', { load: definition }), /Invalid/);
    assert.throws(() => registerEditorLanguage(id, {}), /loader/);
    registerEditorLanguage(id, { load: definition });
    assert.throws(() => registerEditorLanguage(id, { load: () => { throw Error('replacement'); } }), /already registered/);
    assert.equal(await ensureEditorLanguage(monaco, id), true);
});

test('host languages and aliases remain available without invoking a colliding plugin', async () => {
    const monaco = fixture();
    for (const id of ['javascript', 'rhino', 'js', 'text']) {
        registerEditorLanguage(id, { load: () => { throw Error('must not run'); } });
        assert.equal(await ensureEditorLanguage(monaco, id), true);
    }
    assert.equal(monaco.ids.size, 1);
});

for (const failure of ['throw', 'reject', 'missing tokens']) {
    test(`${failure} keeps the fallback and a later editor retries`, async () => {
        const id = nextId(), monaco = fixture();
        let calls = 0;
        registerEditorLanguage(id, { load() {
            if (calls++ > 0) return definition();
            if (failure === 'throw') throw Error('unavailable');
            if (failure === 'reject') return Promise.reject(Error('unavailable'));
            return {};
        } });
        assert.equal(await ensureEditorLanguage(monaco, id), false);
        assert.equal(monaco.ids.has(id), false);
        assert.equal(await ensureEditorLanguage(monaco, id), true);
        assert.equal(calls, 2);
    });
}

test('failed Monaco installation disposes configuration and retries its existing language id', async () => {
    const id = nextId(), monaco = fixture();
    registerEditorLanguage(id, { load: definition });
    const install = monaco.languages.setMonarchTokensProvider;
    monaco.languages.setMonarchTokensProvider = () => { throw Error('invalid tokenizer'); };
    assert.equal(await ensureEditorLanguage(monaco, id), false);
    assert.equal(monaco.ids.has(id), true); // Monaco cannot unregister language metadata.
    assert.equal(monaco.configurations.has(id), false);
    monaco.languages.setMonarchTokensProvider = install;
    assert.equal(await ensureEditorLanguage(monaco, id), true);
});

test('a timed-out load cannot register over a subsequent successful retry', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const id = nextId(), monaco = fixture();
    let release, calls = 0;
    const late = new Promise(resolve => { release = resolve; });
    const current = definition();
    registerEditorLanguage(id, { load: () => calls++ ? current : late });
    const first = ensureEditorLanguage(monaco, id);
    await Promise.resolve();
    t.mock.timers.tick(10001);
    assert.equal(await first, false);
    assert.equal(monaco.ids.has(id), false);
    assert.equal(await ensureEditorLanguage(monaco, id), true);
    release({ tokensProvider: { tokenizer: { root: [] } } });
    await late;
    assert.equal(monaco.tokens.get(id), current.tokensProvider);
    assert.equal(calls, 2);
});
