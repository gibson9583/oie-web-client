'use strict';
/*
 * Tests for the web-admin plugin install/uninstall forward. Install is now a thin
 * pass-through to the engine (no local extraction), so the only unit-testable piece
 * is the CSRF header guard; the forward + relay behaviour is covered by e2e.
 */
const assert = require('assert');
const { csrfOk, hasSession, preUploadGate } = require('./plugin-install.js');

// Minimal res double: records the status and whether a body was sent.
function resDouble() {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
}

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

console.log('plugin-install.test.js');

test('csrfOk requires X-Requested-With', () => {
    assert.strictEqual(csrfOk({ headers: { 'x-requested-with': 'OpenIntegrationEngine-WebAdmin' } }), true);
    assert.strictEqual(csrfOk({ headers: {} }), false);
});

test('hasSession detects the JSESSIONID cookie only', () => {
    assert.strictEqual(hasSession({ headers: { cookie: 'a=1; JSESSIONID=abc; b=2' } }), true);
    assert.strictEqual(hasSession({ headers: { cookie: 'JSESSIONID=abc' } }), true);
    assert.strictEqual(hasSession({ headers: { cookie: 'NOTJSESSIONID=abc' } }), false);
    assert.strictEqual(hasSession({ headers: {} }), false);
});

// The gate must reject BEFORE express.raw buffers the body: next() is only
// reached for an authenticated, CSRF-headed request.
const XRW = 'OpenIntegrationEngine-WebAdmin';
test('preUploadGate blocks a missing CSRF header (403), no next', () => {
    const res = resDouble(); let nexted = false;
    preUploadGate({ headers: { cookie: 'JSESSIONID=abc' } }, res, () => { nexted = true; });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(nexted, false);
});
test('preUploadGate blocks a request with no session cookie (401), no next', () => {
    const res = resDouble(); let nexted = false;
    preUploadGate({ headers: { 'x-requested-with': XRW } }, res, () => { nexted = true; });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nexted, false);
});
test('preUploadGate passes an authenticated, CSRF-headed request', () => {
    const res = resDouble(); let nexted = false;
    preUploadGate({ headers: { 'x-requested-with': XRW, cookie: 'JSESSIONID=abc' } }, res, () => { nexted = true; });
    assert.strictEqual(res.statusCode, null);
    assert.strictEqual(nexted, true);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('  all passed');
