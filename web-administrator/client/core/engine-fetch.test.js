import assert from 'node:assert/strict';

globalThis.document = { cookie: 'oie-engine=k%3Afirst; oie-login=one' };
globalThis.window = new EventTarget();
const { engineFetch, adoptEngineContext, assertEngineResponse } = await import('./engine-fetch.js');
let calls = 0, changes = 0;
window.addEventListener('oie-session-changed', () => changes++);
globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.headers.get('X-OIE-Context'), encodeURIComponent(JSON.stringify(['k:first', '', 'one'])));
    return new Response('ok');
};
assert.equal(await (await engineFetch('/api/test')).text(), 'ok');
document.cookie = 'oie-engine=k%3Asecond; oie-login=two';
await assert.rejects(engineFetch('/api/test', { method: 'PUT', body: 'secret' }), /session changed/);
assert.equal(calls, 1, 'stale mutation must not reach fetch');
assert.equal(changes, 1);

// Even a same-engine re-login must fence the old tab's work.
document.cookie = 'oie-engine=k%3Afirst; oie-login=two';
await assert.rejects(engineFetch('/api/test'), /session changed/);
assert.equal(calls, 1);

// Header-time and body-time races both discard the previous session's data.
adoptEngineContext();
let complete;
globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
const pending = engineFetch('/api/test');
document.cookie = 'oie-engine=k%3Asecond; oie-login=three';
complete(new Response('old data'));
await assert.rejects(pending, /session changed/);

adoptEngineContext();
globalThis.fetch = async () => new Response('old body');
const response = await engineFetch('/api/test');
document.cookie = 'oie-engine=k%3Asecond; oie-login=four';
adoptEngineContext();
await response.text();
assert.throws(() => assertEngineResponse(response), /previous session/);
console.log('engine-fetch: session changes block requests and stale responses');
