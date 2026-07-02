'use strict';
/*
 * Tests for the reverse proxy's pure helpers: resolveEngine (multi-engine routing
 * from the oie-engine cookie), forwardCookie (strips routing cookies), and
 * resolveForwardedFor (trusted-peer X-Forwarded-For).
 */
const assert = require('assert');
const { resolveEngine, resolveForwardedFor } = require('./proxy.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

console.log('proxy.test.js');

const ENGINES = [
    { name: 'prod', url: 'https://prod:8443', verifyTls: true },
    { name: 'stage', url: 'https://stage:8443', verifyTls: false }
];
function req(cookie) { return { headers: cookie ? { cookie } : {} }; }
function cfg(extra) { return Object.assign({ engines: ENGINES, engine: { url: 'https://fallback:8443' } }, extra); }

test('no cookie -> first engine (default)', () => {
    assert.strictEqual(resolveEngine(cfg(), req()).name, 'prod');
});

test('index cookie -> that engine', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=1')).name, 'stage');
});

test('out-of-range index -> first engine', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=9')).name, 'prod');
});

test('non-numeric index -> first engine', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=abc')).name, 'prod');
});

test('custom URL ignored when devMode off (SSRF guard)', () => {
    const e = resolveEngine(cfg({ devMode: false }), req('oie-engine=custom; oie-engine-url=https://evil:9000'));
    assert.strictEqual(e.name, 'prod');
});

test('custom URL honored when devMode on', () => {
    const e = resolveEngine(cfg({ devMode: true }), req('oie-engine=custom; oie-engine-url=https://typed:9000/'));
    assert.strictEqual(e.url, 'https://typed:9000');
    assert.strictEqual(e.verifyTls, false);
});

test('custom with non-http(s) scheme -> first engine', () => {
    const e = resolveEngine(cfg({ devMode: true }), req('oie-engine=custom; oie-engine-url=file:///etc/passwd'));
    assert.strictEqual(e.name, 'prod');
});

test('falls back to engine.url when engines list empty', () => {
    const e = resolveEngine({ engine: { url: 'https://fallback:8443', verifyTls: false } }, req());
    assert.strictEqual(e.url, 'https://fallback:8443');
});

test('resolveForwardedFor: loopback peer appends prior chain', () => {
    assert.strictEqual(resolveForwardedFor('127.0.0.1', '1.2.3.4', new Set()), '1.2.3.4, 127.0.0.1');
});

test('resolveForwardedFor: untrusted peer drops forged chain', () => {
    assert.strictEqual(resolveForwardedFor('8.8.8.8', '1.2.3.4', new Set()), '8.8.8.8');
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('  all passed');
