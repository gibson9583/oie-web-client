'use strict';
/*
 * Tests for the reverse proxy's pure helpers: resolveEngine (multi-engine routing
 * from the oie-engine cookie), forwardCookie (strips routing cookies), and
 * resolveForwardedFor (trusted-peer X-Forwarded-For).
 */
const assert = require('assert');
const { resolveEngine, resolveForwardedFor, isTrustedPeer, sanitizeForwardHeaders } = require('./proxy.js');

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

test('a malformed cookie value does not break routing (no decodeURIComponent throw)', () => {
    // A bare `%`/`%ZZ` in any cookie would throw in parseCookies and 500 the proxy;
    // routing must still resolve the engine from the valid oie-engine cookie.
    const e = resolveEngine(cfg(), req('junk=%ZZ; oie-engine=1; bad=100%'));
    assert.strictEqual(e.name, 'stage');
});

test('resolveForwardedFor: loopback peer appends prior chain', () => {
    assert.strictEqual(resolveForwardedFor('127.0.0.1', '1.2.3.4', new Set()), '1.2.3.4, 127.0.0.1');
});

test('resolveForwardedFor: untrusted peer drops forged chain', () => {
    assert.strictEqual(resolveForwardedFor('8.8.8.8', '1.2.3.4', new Set()), '8.8.8.8');
});

test('isTrustedPeer: loopback (v4/v6/mapped) and configured proxies trusted; others not', () => {
    assert.strictEqual(isTrustedPeer('127.0.0.1', new Set()), true);
    assert.strictEqual(isTrustedPeer('::1', new Set()), true);
    assert.strictEqual(isTrustedPeer('::ffff:127.0.0.1', new Set()), true);
    assert.strictEqual(isTrustedPeer('10.0.0.5', new Set(['10.0.0.5'])), true);
    assert.strictEqual(isTrustedPeer('8.8.8.8', new Set()), false);
    assert.strictEqual(isTrustedPeer('', new Set()), false);
});

test('sanitizeForwardHeaders: untrusted client cannot spoof forwarding headers to the engine', () => {
    // Every X-Forwarded-* / Forwarded / X-Real-IP header the engine's Jetty honors.
    const SPOOFABLE = ['x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-forwarded-prefix',
        'x-forwarded-server', 'x-forwarded-scheme', 'x-forwarded-ssl', 'x-forwarded-https', 'x-proxied-https',
        'forwarded', 'x-real-ip'];
    const h = { cookie: 'JSESSIONID=abc' };
    for (const k of SPOOFABLE) h[k] = 'evil';
    sanitizeForwardHeaders(h, '8.8.8.8', '1.2.3.4', new Set());
    for (const k of SPOOFABLE) assert.strictEqual(h[k], undefined, `${k} should be stripped`);
    assert.strictEqual(h['x-forwarded-for'], '8.8.8.8');   // real socket IP only, forged chain dropped
    assert.strictEqual(h['cookie'], 'JSESSIONID=abc');      // non-forwarding headers untouched
});

test('sanitizeForwardHeaders: trusted fronting proxy keeps the forwarding headers it set', () => {
    const h = { 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https', 'x-real-ip': '203.0.113.7' };
    sanitizeForwardHeaders(h, '127.0.0.1', '203.0.113.7', new Set());
    assert.strictEqual(h['x-forwarded-host'], 'app.example');
    assert.strictEqual(h['x-forwarded-proto'], 'https');
    assert.strictEqual(h['x-real-ip'], '203.0.113.7');
    assert.strictEqual(h['x-forwarded-for'], '203.0.113.7, 127.0.0.1');
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('  all passed');
