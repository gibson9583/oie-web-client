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

// XStream unwrapping turns a one-property { message: ... } body into the bare
// value. Non-OK handling must still surface that useful message, not raw JSON.
globalThis.fetch = async () => new Response(JSON.stringify({ message: 'library service unavailable' }), {
    status: 500, headers: { 'Content-Type': 'application/json' }
});
msg = '';
try { await api.get('/broken'); } catch (e) { msg = e.message; }
ok(msg === 'library service unavailable', 'a one-property JSON error surfaces its message');

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

/* ---- Cures Act functional audit operations ---- */

// Each posts an XStream Map<String,String> to its own endpoint. The engine's
// map converter rejects a bare JSON object, so the body must be <map> XML.
let lastUrl = null, lastBody = null, lastCt = null;
globalThis.fetch = async (url, init) => {
    lastUrl = String(url); lastBody = init.body; lastCt = (init.headers || {})['Content-Type'];
    return new Response('{}', { status: 200 });
};

for (const [label, call, path] of [
    ['auditAccessedPHI', (a) => api.messages.auditAccessedPHI(a), '/channels/_auditAccessedPHIMessage'],
    ['auditQueriedPHI', (a) => api.messages.auditQueriedPHI(a), '/channels/_auditQueriedPHIMessage'],
    ['auditExport', (a) => api.messages.auditExport(a), '/channels/_auditExportMessages'],
    ['auditExportSuccess', (a) => api.messages.auditExportSuccess(a), '/channels/_auditExportMessagesSuccess']
]) {
    await call({ patientId: 'PID-1' });
    ok(lastUrl.endsWith(path), `${label} posts to ${path}`);
    ok(lastCt === 'application/xml', `${label} sends application/xml`);
    ok(lastBody === '<map><entry><string>patientId</string><string>PID-1</string></entry></map>',
        `${label} serializes the attribute map as XStream XML`);
}

// XML metacharacters in an attribute value would otherwise break the document
// (a patient id or file pattern is user-controlled).
await api.messages.auditAccessedPHI({ 'a&b': '<x>' });
ok(lastBody === '<map><entry><string>a&amp;b</string><string>&lt;x&gt;</string></entry></map>',
    'audit attributes are XML-escaped');

// A missing metadata value must not serialize as the string "undefined".
await api.messages.auditAccessedPHI({ patientId: undefined, channel: 'c1' });
ok(lastBody === '<map><entry><string>channel</string><string>c1</string></entry></map>',
    'null/undefined audit attributes are dropped');

// XML 1.0 forbids most C0 control characters outright, and attribute values are
// user text (a patient id, a search term, an export file pattern). One stray
// byte must not make the engine reject the document — on the pre-export audit
// that would veto the export itself.
await api.messages.auditExport({ filePattern: 'msg\u0000-\u0001${MESSAGE_ID}' });
ok(lastBody === '<map><entry><string>filePattern</string><string>msg-${MESSAGE_ID}</string></entry></map>',
    'XML-illegal control characters are stripped from audit attributes');

/* ---- single-channel lifecycle reports its failures ---- */

// The engine swallows a task error into a 204 unless returnErrors is set, so a
// start that never started reads as success. The dashboard passes true for one
// channel exactly as the bulk endpoints do for many.
globalThis.fetch = async (url) => { lastUrl = String(url); return new Response('{}', { status: 200 }); };
await api.status.start('c1', true);
ok(lastUrl.includes('returnErrors=true'), 'a single-channel start can ask the engine to report failures');
await api.status.stop('c1');
ok(!lastUrl.includes('returnErrors'),
    'a caller that does not opt in sends the request unchanged (the engine already defaults to false)');

/* ---- code-template bulk-save multipart contracts ---- */

// CodeTemplateServletInterface declares the first two multipart parameters as
// List and the removal parameters as Set. The engine's JSON provider dispatches
// those types to different XStream envelope readers, so this shape is part of
// the wire contract (using `set` for a List reaches the servlet malformed).
let bulkBody = null;
globalThis.fetch = async (_url, init) => {
    bulkBody = init.body;
    return new Response('{}', { status: 200 });
};
await api.codeTemplates.bulkUpdate(
    [{ id: 'lib-1' }],
    [{ id: 'template-1' }],
    ['lib-old'],
    ['template-old'],
    false
);
const bulkParts = Object.fromEntries(await Promise.all(
    [...bulkBody.entries()].map(async ([name, blob]) => [name, JSON.parse(await blob.text())])
));
ok(bulkParts.libraries.list.codeTemplateLibrary[0].id === 'lib-1',
    'bulkUpdate sends libraries in a list envelope');
ok(bulkParts.updatedCodeTemplates.list.codeTemplate[0].id === 'template-1',
    'bulkUpdate sends updated templates in a list envelope');
ok(bulkParts.removedLibraryIds.set.string[0] === 'lib-old',
    'bulkUpdate sends removed library ids in a set envelope');
ok(bulkParts.removedCodeTemplateIds.set.string[0] === 'template-old',
    'bulkUpdate sends removed template ids in a set envelope');

console.log(`api.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
