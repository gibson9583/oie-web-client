/* Unit tests for the session-expired listener registry and the request
   timeout ceiling (core/api.js). */
import api, { onSessionExpired, resetSessionExpired, isEngineReachable } from './api.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

// Drive the 401 path without a server: every api.get goes through global fetch.
globalThis.fetch = async () => new Response('', { status: 401 });

// One background 401 fires the registered handlers, once.
async function expire() {
    resetSessionExpired();
    try { await api.get('/anything'); } catch { /* the ApiError is expected */ }
}

let a = 0, b = 0;
const offA = onSessionExpired(() => { a++; });
const offB = onSessionExpired(() => { b++; });
ok(typeof offA === 'function', 'onSessionExpired returns an unsubscribe');

await expire();
ok(a === 1 && b === 1, 'both handlers fire on a background 401');

// Unsubscribing removes only that handler — the leak this guards against is a
// component that re-registers on every mount (React StrictMode remounts the
// shell), which would otherwise fire the whole expiry flow once per mount.
offA();
await expire();
ok(a === 1, 'an unsubscribed handler stops firing');
ok(b === 2, 'its sibling still fires');

// Unsubscribing twice is a no-op, and does not disturb the others.
offA();
await expire();
ok(a === 1 && b === 3, 'double-unsubscribe is harmless');

offB();
await expire();
ok(a === 1 && b === 3, 'the last unsubscribe empties the registry');

// Re-registering the SAME function twice registers twice (no dedupe) — the
// double-fire this documents is exactly why callers must unsubscribe.
const twice = () => { a++; };
const off1 = onSessionExpired(twice);
const off2 = onSessionExpired(twice);
await expire();
ok(a === 3, 'the same handler registered twice fires twice');
off1(); off2();

/* ---- the 120s ceiling: message mapping + reachability ---- */

// A TimeoutError abort is the CLIENT giving up, not an engine failure: the
// surfaced message must say so (not the DOMException's "signal timed out"),
// and it must NOT paint the engine-unreachable banner.
globalThis.fetch = async () => { throw new DOMException('signal timed out', 'TimeoutError'); };
let msg = '';
try { await api.get('/slow'); } catch (e) { msg = e.message; }
ok(/stopped waiting/.test(msg), 'a timeout abort names the client as the one that gave up');
ok(/may still be completing/.test(msg), 'a timeout abort warns the engine may still be working');
ok(!/signal timed out/.test(msg), 'the bare DOMException message is not surfaced');
ok(isEngineReachable() === true, 'a timeout abort does not flip reachability');

// A genuine network failure still does.
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try { await api.get('/down'); } catch { /* expected */ }
ok(isEngineReachable() === false, 'a rejected fetch still marks the engine unreachable');

// ...and an answer from the engine restores it.
globalThis.fetch = async () => new Response('{}', { status: 200 });
await api.get('/up');
ok(isEngineReachable() === true, 'any engine answer restores reachability');

/* ---- the long-running operations opt out of the ceiling ---- */

// Capture what send() hands to fetch: the default path must carry an abort
// signal (the ceiling), the known-long operations must not.
let lastInit = null;
globalThis.fetch = async (_url, init) => { lastInit = init; return new Response('{}', { status: 200 }); };

await api.get('/anything');
ok(lastInit.signal instanceof AbortSignal, 'a plain request carries the default ceiling');

for (const [label, call] of [
    ['engine.redeployAll', () => api.engine.redeployAll()],
    ['engine.deployMany', () => api.engine.deployMany(['a', 'b'])],
    ['messages.count', () => api.messages.count('chan')],
    ['server.setConfiguration', () => api.server.setConfiguration({}, true)],
    ['del with timeoutMs:null', () => api.del('/channels/chan/messages', {}, { timeoutMs: null })],
    ['getXml with timeoutMs:null', () => api.getXml('/channels', undefined, { timeoutMs: null })],
    ['post with timeoutMs:null', () => api.post('/channels/chan/messages/_export', null, { timeoutMs: null })]
]) {
    lastInit = null;
    await call();
    ok(lastInit && !lastInit.signal, `${label} runs without the client ceiling`);
}

/* ---- Swing-parity bulk, audit, attachment, and code-template wires ---- */

let lastUrl = '';
globalThis.fetch = async (url, init) => {
    lastUrl = String(url);
    lastInit = init;
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

await api.status.startMany(['one', 'two']);
ok(lastUrl.endsWith('/channels/_start?returnErrors=true'), 'bulk status uses the engine collection endpoint');
ok(lastInit.body === 'channelId=one&channelId=two', 'bulk status repeats channelId form fields in order');
ok(lastInit.headers['Content-Type'] === 'application/x-www-form-urlencoded', 'bulk status uses form encoding');
ok(!lastInit.signal, 'bulk status actions have no client timeout');

await api.messages.attachments('chan', 7);
ok(lastUrl.endsWith('/channels/chan/messages/7/attachments?includeContent=false'), 'attachment lists explicitly omit content by default');
await api.messages.attachments('chan', 7, true);
ok(lastUrl.endsWith('/channels/chan/messages/7/attachments?includeContent=true'), 'attachment export explicitly requests content');

await api.messages.auditAccessedPHI({ patientId: 'A&B<1>', note: 'bad\u0001value' });
ok(lastUrl.endsWith('/channels/_auditAccessedPHIMessage'), 'PHI access uses the Swing audit endpoint');
ok(lastInit.headers['Content-Type'] === 'application/xml', 'PHI audit maps are XML');
ok(lastInit.body.includes('<string>A&amp;B&lt;1&gt;</string>'), 'PHI audit values are XML escaped');
ok(!lastInit.body.includes('\u0001'), 'PHI audit values strip XML-illegal controls');

await api.codeTemplates.bulkUpdate([{ id: 'lib' }], [{ id: 'tpl' }], ['old-lib'], ['old-tpl'], false);
ok(lastUrl.endsWith('/codeTemplateLibraries/_bulkUpdate?override=false'), 'code templates use one bulk update request');
ok(lastInit.body instanceof FormData, 'code template bulk update is multipart');
const partJson = async (name) => JSON.parse(await lastInit.body.get(name).text());
ok((await partJson('libraries')).list.codeTemplateLibrary[0].id === 'lib', 'bulk libraries use the engine list envelope');
ok((await partJson('updatedCodeTemplates')).list.codeTemplate[0].id === 'tpl', 'bulk templates use the engine list envelope');
ok((await partJson('removedLibraryIds')).set.string[0] === 'old-lib', 'bulk removed libraries use the engine set envelope');
ok((await partJson('removedCodeTemplateIds')).set.string[0] === 'old-tpl', 'bulk removed templates use the engine set envelope');

console.log(`api.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
