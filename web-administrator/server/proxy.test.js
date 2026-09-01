'use strict';
/*
 * Tests for the reverse proxy's pure helpers: resolveEngine (multi-engine routing
 * from the oie-engine cookie), forwardCookie (strips routing cookies), and
 * resolveForwardedFor (trusted-peer X-Forwarded-For).
 */
const assert = require('assert');
const { resolveEngine, resolveForwardedFor, isTrustedPeer, sanitizeForwardHeaders, forceNoStore } = require('./proxy.js');

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

console.log('proxy.test.js');

const ENGINES = [
    { name: 'prod', key: 'k:prod', url: 'https://prod:8443', verifyTls: true },
    { name: 'stage', key: 'k:stage', url: 'https://stage:8443', verifyTls: false }
];
function req(cookie) { return { headers: cookie ? { cookie } : {} }; }
function cfg(extra) { return Object.assign({ engines: ENGINES, engine: { url: 'https://fallback:8443' } }, extra); }

test('no cookie -> first engine (default)', () => {
    assert.strictEqual(resolveEngine(cfg(), req()).name, 'prod');
});

test('key cookie -> that engine', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=k:stage')).name, 'stage');
});

test('key cookie url-encoded by the browser -> that engine', () => {
    // The client writes the cookie with encodeURIComponent ("k:stage" -> "k%3Astage").
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=k%3Astage')).name, 'stage');
});

test('selection survives the engine list being reordered or extended (issue #53)', () => {
    // The positional cookie meant an inserted/reordered entry silently repointed
    // an existing choice; a key names the engine itself, wherever it sits.
    const edited = [
        { name: 'new', key: 'k:new', url: 'https://new:8443', verifyTls: false },
        ENGINES[1], ENGINES[0]
    ];
    assert.strictEqual(resolveEngine(cfg({ engines: edited }), req('oie-engine=k:stage')).name, 'stage');
});

test('unknown key (engine removed/renamed) -> null, NOT the first engine (issue #53)', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=k:gone')), null);
});

test('pre-key numeric index cookie -> null (stale after upgrade; user re-picks)', () => {
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=1')), null);
    assert.strictEqual(resolveEngine(cfg(), req('oie-engine=9')), null);
});

test('single-engine mode: any stale selection still resolves to the only engine', () => {
    const one = cfg({ engines: [ENGINES[0]] });
    assert.strictEqual(resolveEngine(one, req('oie-engine=k:gone')).name, 'prod');
    assert.strictEqual(resolveEngine(one, req('oie-engine=1')).name, 'prod');
    assert.strictEqual(resolveEngine(one, req()).name, 'prod');
});

test('custom URL ignored when devMode off (SSRF guard) -> unresolvable, not first engine', () => {
    const e = resolveEngine(cfg({ devMode: false }), req('oie-engine=custom; oie-engine-url=https://evil:9000'));
    assert.strictEqual(e, null);
});

test('custom URL honored when devMode on', () => {
    const e = resolveEngine(cfg({ devMode: true }), req('oie-engine=custom; oie-engine-url=https://typed:9000/'));
    assert.strictEqual(e.url, 'https://typed:9000');
    assert.strictEqual(e.verifyTls, false);
});

test('custom with non-http(s) scheme -> not honored, unresolvable', () => {
    const e = resolveEngine(cfg({ devMode: true }), req('oie-engine=custom; oie-engine-url=file:///etc/passwd'));
    assert.strictEqual(e, null);
});

test('falls back to engine.url when engines list empty', () => {
    const e = resolveEngine({ engine: { url: 'https://fallback:8443', verifyTls: false } }, req());
    assert.strictEqual(e.url, 'https://fallback:8443');
});

test('a malformed cookie value does not break routing (no decodeURIComponent throw)', () => {
    // A bare `%`/`%ZZ` in any cookie would throw in parseCookies and 500 the proxy;
    // routing must still resolve the engine from the valid oie-engine cookie.
    const e = resolveEngine(cfg(), req('junk=%ZZ; oie-engine=k:stage; bad=100%'));
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

test('forceNoStore: engine responses without cache directives get no-store (browser would disk-cache them)', () => {
    const h = { 'content-type': 'application/json' };
    forceNoStore(h);
    assert.strictEqual(h['cache-control'], 'no-store');
    assert.strictEqual(h['content-type'], 'application/json');   // other headers untouched
});

test('forceNoStore: overrides upstream cache headers rather than only filling in missing ones', () => {
    const h = {
        'cache-control': 'public, max-age=3600',
        'expires': 'Thu, 01 Jan 2026 00:00:00 GMT',
        'pragma': 'cache'
    };
    forceNoStore(h);
    assert.strictEqual(h['cache-control'], 'no-store');
    assert.strictEqual(h['expires'], undefined);
    assert.strictEqual(h['pragma'], undefined);
});

/* A round trip through the real proxy, against a stub standing in for the engine.
   forceNoStore is unit-tested above, but only this pins that the proxy actually
   RUNS it on the way back — and message content is the response where getting it
   wrong writes PHI into the browser's on-disk cache. */
async function testAsync(name, fn) {
    try { await fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

(async () => {
    const http = require('http');
    const { createApiProxy } = require('./proxy.js');
    const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    // The proxy takes plain node request/response objects; express only adds
    // originalUrl, which the mount would have set.
    const frontFor = (proxy) => http.createServer((req, res) => { req.originalUrl = req.url; proxy(req, res); });

    await testAsync('proxy round trip: a message-content response is marked no-store', async () => {
        // The "engine": answers with the cache headers a stock Jetty would.
        const engine = http.createServer((req, res) => {
            res.writeHead(200, {
                'content-type': 'application/json',
                'cache-control': 'public, max-age=600',
                'expires': 'Thu, 01 Jan 2026 00:00:00 GMT'
            });
            res.end(JSON.stringify({ message: { messageId: 1 } }));
        });
        const enginePort = await listen(engine);

        const front = frontFor(createApiProxy(cfg({
            engines: [{ name: 'stub', key: 'k:stub', url: `http://127.0.0.1:${enginePort}`, verifyTls: false }]
        })));
        const frontPort = await listen(front);

        try {
            const response = await fetch(`http://127.0.0.1:${frontPort}/api/channels/c1/messages/1`);
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.headers.get('cache-control'), 'no-store');
            assert.strictEqual(response.headers.get('expires'), null);
        } finally {
            front.close();
            engine.close();
        }
    });

    await testAsync('proxy answers 421 ENGINE_UNKNOWN for a stale selection instead of forwarding to the first engine', async () => {
        const front = frontFor(createApiProxy(cfg()));   // two engines; nothing listens — a forward would fail differently
        const frontPort = await listen(front);
        try {
            const response = await fetch(`http://127.0.0.1:${frontPort}/api/users/current`, {
                headers: { cookie: 'oie-engine=k:gone' }
            });
            assert.strictEqual(response.status, 421);
            const body = await response.json();
            assert.strictEqual(body.error, 'ENGINE_UNKNOWN');
        } finally {
            front.close();
        }
    });

    await testAsync('the 421 refusal still delivers its JSON when the request body is mid-upload', async () => {
        // Answering before the body is read used to tear the socket down and the
        // client saw a reset instead of the ENGINE_UNKNOWN body — the refusal
        // must drain the request (respondEngineUnknown req.resume()).
        const front = frontFor(createApiProxy(cfg()));
        const frontPort = await listen(front);
        try {
            const response = await fetch(`http://127.0.0.1:${frontPort}/api/channels/c1`, {
                method: 'PUT',
                headers: { cookie: 'oie-engine=k:gone', 'content-type': 'application/json' },
                body: JSON.stringify({ channel: { description: 'x'.repeat(512 * 1024) } })
            });
            assert.strictEqual(response.status, 421);
            const body = await response.json();
            assert.strictEqual(body.error, 'ENGINE_UNKNOWN');
        } finally {
            front.close();
        }
    });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('  all passed');
})();
