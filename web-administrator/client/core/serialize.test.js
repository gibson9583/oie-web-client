import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { discardEngineResponses } from './engine-fetch.js';

// The browser import map supplies the formatter's ESM build. This test only
// exercises validation; refuse accidental formatter use in the Node harness.
const hook = registerHooks({
    resolve(specifier, context, next) {
        if (specifier === 'js-beautify') return {
            url: 'data:text/javascript,export const js = () => { throw new Error("Unexpected formatter call"); };',
            shortCircuit: true,
        };
        return next(specifier, context);
    },
});
const { validateScript } = await import('./serialize.js');
hook.deregister();

let reply = () => Response.json({ error: null });
const submitted = [];
let releaseProbe;
const probe = new Promise(resolve => { releaseProbe = resolve; });
globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/webplugins')) { await probe; return Response.json([]); }
    assert.ok(String(url).endsWith('/javascript/_validate'));
    assert.equal(init.method, 'POST');
    submitted.push(init.body);
    return reply();
};

const oldProbe = validateScript('return;');
discardEngineResponses();
releaseProbe();
assert.equal((await oldProbe).ok, null);
assert.equal(submitted.length, 0, 'a capability probe cannot start validation after logout');

for (const body of [{ error: null }, { error: '' }, { error: '  ' }]) {
    reply = () => Response.json(body);
    assert.deepEqual(await validateScript('return <message/>;'), { ok: true });
}
reply = () => Response.json({ error: 'Error on line 1: invalid syntax.' });
assert.deepEqual(await validateScript('function {'), { ok: false, message: 'Error on line 1: invalid syntax.' });
for (const body of [{}, null, [], { error: false }, { error: 0 }, { error: {} }]) {
    reply = () => Response.json(body);
    assert.equal((await validateScript('return;')).ok, null, 'malformed replies cannot authorize saving');
}
reply = () => new Response('not JSON');
assert.equal((await validateScript('')).ok, null);
reply = () => new Response('unavailable', { status: 503 });
assert.equal((await validateScript('')).ok, null);
reply = () => { throw new TypeError('network unavailable'); };
assert.equal((await validateScript('')).ok, null);
assert.equal(submitted[0], 'return <message/>;', 'Rhino source reaches the existing validator unchanged');
assert.equal(submitted[3], 'function {');
let releaseValidation;
reply = () => new Promise(resolve => { releaseValidation = resolve; });
const oldValidation = validateScript('return;');
await new Promise(resolve => setImmediate(resolve));
discardEngineResponses();
releaseValidation(Response.json({ error: null }));
assert.equal((await oldValidation).ok, null, 'late validation cannot authorize a later session');
console.log('serialize: valid, invalid and unavailable validation results remain distinct');
