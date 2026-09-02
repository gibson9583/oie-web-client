import * as assert from 'assert';
import { encodeResult, openBoundTransaction, warnIfSecureCookiesUnreachable, openTransaction, routingCookies, sealTransaction, splitTxnCookie, throttleKey, txnCookieValue, unwrapEngineJson, validReturnPath, validateIdTokenClaims, withBudget } from './oidc';
import { normalizeOidc } from './config';

const secret = 'a sufficiently long test client secret';
const now = Date.now();
const txn = { v: 3 as const, state: 'state', nonce: 'nonce', verifier: 'verifier', engineKey: 'k:production', returnPath: '/dashboard?x=1', created: now };
assert.deepStrictEqual(openTransaction(sealTransaction(txn, secret), secret, now), txn);
const sealed = sealTransaction(txn, secret).split('.');
sealed[1] = (sealed[1][0] === 'A' ? 'B' : 'A') + sealed[1].slice(1);
assert.throws(() => openTransaction(sealed.join('.'), secret, now), /invalid/);
assert.throws(() => openTransaction(sealTransaction({ ...txn, created: now - 700000 }, secret), secret, now), /expired/);
// A v2 seal (engine NAME, no key prefix) must not open under v3 — an in-flight
// sign-in across the upgrade fails closed rather than resolving a stale field.
const v2 = { v: 2, state: 'state', nonce: 'nonce', verifier: 'verifier', engineName: 'Production', returnPath: '/', created: now };
assert.throws(() => openTransaction(sealTransaction(v2 as any, secret), secret, now), /expired/);

// The cookie names its engine in the clear so the callback needs one lookup;
// the prefix is a hint only — the sealed engineKey is what the router re-checks.
// roundTrip models the read side: cookies() decodeURIComponent's the whole value
// before splitTxnCookie sees it, so the write must be ASCII-safe (see below).
const roundTrip = (value: string) => splitTxnCookie(decodeURIComponent(value))!;
const split = roundTrip(txnCookieValue('k:production', sealTransaction(txn, secret)));
assert.strictEqual(split.engineKey, 'k:production');
assert.deepStrictEqual(openTransaction(split.sealed, secret, now), txn);
// A tampered prefix normally self-defeats: it selects a different engine's
// secret, so the seal does not open at all.
assert.throws(() => openTransaction(split.sealed, 'a different engine client secret', now), /invalid/);
// But two engines MAY share a client secret, and keyFor() derives from the
// secret alone — so a k:production seal opens cleanly under a k:staging prefix.
// Only the router's `txn.engineKey !== found.engine.key` re-check rejects that
// swap, which is why it is not redundant with the GCM tag.
const swapped = roundTrip(txnCookieValue('k:staging', sealTransaction(txn, secret)));
assert.strictEqual(swapped.engineKey, 'k:staging');
assert.strictEqual(openTransaction(swapped.sealed, secret, now).engineKey, 'k:production');
// So the seal alone cannot be trusted to say which engine was chosen — only the
// binding check can. Deleting it must break this, or a staging-issued code could
// be exchanged against production whenever the two share an IdP registration.
const stagingEngine = { name: 'Staging', key: 'k:staging', url: 'https://staging.test', verifyTls: true };
const prodEngine = { name: 'Production', key: 'k:production', url: 'https://engine.test', verifyTls: true };
assert.throws(() => openBoundTransaction(swapped.sealed, stagingEngine, secret, 'state', now), /invalid or expired/);
// The same transaction under its OWN engine is accepted.
assert.deepStrictEqual(openBoundTransaction(split.sealed, prodEngine, secret, 'state', now), txn);
// …and the state must still match, so a stolen cookie replayed with a different
// state parameter is refused even on the right engine.
assert.throws(() => openBoundTransaction(split.sealed, prodEngine, secret, 'not-the-state', now), /invalid or expired/);
assert.throws(() => openBoundTransaction(split.sealed, prodEngine, secret, undefined, now), /invalid or expired/);
// The router omits `now` entirely, so it reaches openTransaction as undefined and
// leans on the `now = Date.now()` default. That is the one call shape the
// assertions above do not exercise, and it is load-bearing: were the default not
// to fire, every comparison in the expiry arithmetic would be against NaN and
// therefore false, so EVERY expired transaction would be accepted.
const staleSeal = roundTrip(txnCookieValue('k:production', sealTransaction({ ...txn, created: Date.now() - 700000 }, secret))).sealed;
assert.throws(() => openBoundTransaction(staleSeal, prodEngine, secret, 'state'), /expired/);
const freshSeal = roundTrip(txnCookieValue('k:production', sealTransaction({ ...txn, created: Date.now() }, secret))).sealed;
assert.strictEqual(openBoundTransaction(freshSeal, prodEngine, secret, 'state').engineKey, 'k:production');
// engineKey() preserves \p{L}, so an accented or CJK engine name yields a
// non-ASCII key. Written raw it would be latin1-mangled back into no engine at
// all (or rejected outright as an invalid header char), so the value is
// percent-encoded on write and survives the decoding read.
for (const key of ['k:producción', 'k:北京-engine']) {
    const value = txnCookieValue(key, sealTransaction(txn, secret));
    assert.ok(/^[\x20-\x7e]+$/.test(value), `the cookie value for ${key} must be ASCII-safe`);
    assert.strictEqual(roundTrip(value).engineKey, key);
}
// A pre-upgrade v2 cookie carries no prefix; its first segment is the base64url
// IV, which matches no engine key, so the callback fails closed.
assert.strictEqual(roundTrip(sealTransaction(txn, secret)).engineKey.startsWith('k:'), false);
assert.strictEqual(splitTxnCookie(''), null);
assert.strictEqual(splitTxnCookie('no-separator'), null);
assert.strictEqual(validReturnPath('/channels?x=1'), '/channels?x=1');
for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)']) assert.strictEqual(validReturnPath(bad), '/');
// Dot segments collapse on parse, so these clear the leading-"//" guard on the
// way IN and would come back out protocol-relative — res.redirect emits that
// verbatim and the browser resolves it to another origin.
for (const bad of ['/..//evil.test', '/.//evil.test', '/foo/../..//evil.test', '/..//evil.test?x=1',
    '/a/../../..//evil.test', '/..\\/evil.test', '/../\\evil.test', '/..//']) assert.strictEqual(validReturnPath(bad), '/');
// Dot segments that normalize to a genuine same-origin path still work.
assert.strictEqual(validReturnPath('/foo/../channels'), '/channels');

// The engine wraps every JSON payload under a single XStream root key.
const wrapped = { 'com.mirth.connect.model.LoginStatus': { status: 'SUCCESS', message: '', updatedUsername: 'jdoe' } };
assert.strictEqual(unwrapEngineJson(wrapped).status, 'SUCCESS');
assert.deepStrictEqual(unwrapEngineJson({ status: 'FAIL', message: 'no' }), { status: 'FAIL', message: 'no' });
assert.strictEqual(unwrapEngineJson('SUCCESS'), 'SUCCESS');

const decodeResult = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
assert.strictEqual(decodeResult(encodeResult({ status: 'FAIL', message: 'x'.repeat(5000) })).message.length, 600);
assert.strictEqual(decodeResult(encodeResult({ status: 'SUCCESS' })).status, 'SUCCESS');
// An MFA challenge is opaque, not prose: the authenticator JSON.parses it, so
// the 600-character prose cap would leave it unparseable ("Unexpected
// authentication challenge.") with no local password to fall back on. A real
// TOTP enrolment challenge clears 600 on a long issuer plus an email-shaped
// username, so it must survive WHOLE.
const enrolMessage = JSON.stringify({ mode: 'enroll', challenge: 'c'.repeat(380), secret: 'S'.repeat(32), otpauthUri: `otpauth://totp/${'I'.repeat(60)}:${'u'.repeat(40)}?secret=${'S'.repeat(32)}` });
assert.ok(enrolMessage.length > 600, 'the enrolment fixture must exceed the prose cap');
const challengeResult = decodeResult(encodeResult({ status: 'FAIL', clientPluginClass: 'builtin:otp', updatedUsername: 'jane@example.test', message: enrolMessage }));
assert.strictEqual(challengeResult.message, enrolMessage);
assert.strictEqual(challengeResult.clientPluginClass, 'builtin:otp');
// Half a challenge is worth as much as none, so one that cannot fit the cookie
// is refused with something actionable rather than clipped into nonsense — and
// clientPluginClass is dropped so the card reports it instead of handing the
// authenticator a challenge it cannot parse.
const huge = decodeResult(encodeResult({ status: 'FAIL', clientPluginClass: 'builtin:otp', updatedUsername: 'u'.repeat(255), message: 'z'.repeat(4000) }));
assert.strictEqual(huge.clientPluginClass, '');
assert.match(huge.message, /too large to complete in the browser/);
// The other engine-controlled fields are bounded too. Uncapped, a broken engine
// pushes the cookie past what a browser stores (~4096 bytes) and it is dropped
// SILENTLY — the generic-failure symptom the bounding exists to avoid.
const wide = decodeResult(encodeResult({ status: 'FAIL', clientPluginClass: 'C'.repeat(9000), updatedUsername: 'u'.repeat(9000), message: 'hi' }));
assert.strictEqual(wide.clientPluginClass.length, 256);
assert.strictEqual(wide.updatedUsername.length, 256);
// status is engine-controlled too, and on its own could push the cookie past
// what a browser stores — a dropped cookie shows the user NOTHING, which is
// worse than the generic failure. Every relayed field, at once, must still fit.
assert.strictEqual(decodeResult(encodeResult({ status: 'F'.repeat(9000), message: 'hi' })).status.length, 64);
const everything = encodeResult({ status: 'F'.repeat(9000), clientPluginClass: 'C'.repeat(9000), updatedUsername: 'u'.repeat(9000), message: 'z'.repeat(9000) });
assert.ok(everything.length <= 3500, `no combination of engine-controlled fields may exceed the cookie ceiling (got ${everything.length})`);
// The payload is an allowlist, so a field nobody bounded cannot ride along.
assert.strictEqual(decodeResult(encodeResult({ status: 'FAIL', message: 'hi', sneaky: 'x'.repeat(9000) } as any)).sneaky, undefined);

// A TLS-terminating front proxy that was never declared mints OIDC cookies
// without Secure while the browser is on https — silently, and only on this hop.
const withOidc = { 'k:e': {} as any };
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: null, trustedProxies: [], publicOrigin: 'https://admin.test', oidc: withOidc }) === null, false);
// …but not when the deployment has said how TLS reaches it, or when there is no
// https to downgrade from.
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: { key: 'k', cert: 'c' }, trustedProxies: [], publicOrigin: 'https://admin.test', oidc: withOidc }), null);
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: null, trustedProxies: ['10.0.0.1'], publicOrigin: 'https://admin.test', oidc: withOidc }), null);
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: null, trustedProxies: [], publicOrigin: 'http://admin.test', oidc: withOidc }), null);
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: null, trustedProxies: [], publicOrigin: null, oidc: withOidc }), null);
// The router mounts unconditionally, so a deployment with no OIDC at all must
// not get an [oidc] warning purely for its TLS topology.
assert.strictEqual(warnIfSecureCookiesUnreachable({ tls: null, trustedProxies: [], publicOrigin: 'https://admin.test', oidc: {} }), null);

const trusted = new Set(['10.0.0.1']);
assert.strictEqual(throttleKey('10.0.0.1', '203.0.113.5, 198.51.100.7', trusted), '198.51.100.7');
assert.strictEqual(throttleKey('192.0.2.9', '203.0.113.5', trusted), '192.0.2.9');
assert.strictEqual(throttleKey('10.0.0.1', undefined, trusted), '10.0.0.1');

// The pre-auth config document races every OIDC probe against one shared budget.
// Async, so it runs last (this file compiles to CommonJS — no top-level await).
async function budgetTests() {
    const settled = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));
    // Work that beats the budget wins, and its value is passed through intact.
    assert.strictEqual(await withBudget(settled('fast', 1), 200), 'fast');
    // Work that overruns yields null rather than holding the response.
    assert.strictEqual(await withBudget(settled('slow', 200), 20), null);
    // ONE budget shared across N probes bounds the whole fan-out, not each leg:
    // three 200ms probes against a single 60ms budget must finish in about 60ms,
    // never 3×. This is what keeps N engines from stacking N timeouts.
    const budget = withBudget(new Promise<never>(() => {}), 60);
    const started = process.hrtime.bigint();
    const all = await Promise.all([1, 2, 3].map(() => Promise.race([settled('probe', 200), budget])));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.deepStrictEqual(all, [null, null, null]);
    assert.ok(elapsedMs < 150, `one shared budget must bound the whole fan-out, but it took ${elapsedMs.toFixed(0)}ms — long enough that each probe is being given its own budget`);
    // Giving up does not cancel the work — the probe still lands and still caches.
    const work = settled('late', 40);
    assert.strictEqual(await withBudget(work, 5), null);
    assert.strictEqual(await work, 'late');
}

// What a completed SSO sign-in leaves behind for routing. This has to agree with
// login.tsx's commitEngineSelection, or shell.tsx's loadedEngineKey() disagrees
// with what the login card computes and every sign-in is followed by a reload.
const engineOf = (name: string, key: string) => ({ name, key, url: 'https://engine.test', verifyTls: true });
const prod = engineOf('Production', 'k:production');
const cookieNamed = (cookies: string[], name: string) => cookies.find((c) => c.startsWith(`${name}=`))!;
// A picker exists (multi-engine): record the choice, by key.
const multi = routingCookies({ engines: [prod, engineOf('Staging', 'k:staging')], devMode: false }, prod, false);
assert.match(cookieNamed(multi, 'oie-engine'), /^oie-engine=k%3Aproduction; Path=\/; SameSite=Lax$/);
// devMode shows a picker even with one engine, so it records too.
assert.match(cookieNamed(routingCookies({ engines: [prod], devMode: true }, prod, false), 'oie-engine'), /^oie-engine=k%3Aproduction;/);
// No picker: record nothing. A cookie here desynchronizes this tab from the
// login card's '' and forces a spurious hard reload on the next sign-in.
const single = routingCookies({ engines: [prod], devMode: false }, prod, false);
assert.match(cookieNamed(single, 'oie-engine'), /^oie-engine=; Path=\/; Max-Age=0;/);
// oie-engine-url is cleared either way — a stale typed URL would re-seed the
// login card's custom field on the next visit.
for (const cookies of [multi, single]) assert.match(cookieNamed(cookies, 'oie-engine-url'), /^oie-engine-url=; Path=\/; Max-Age=0;/);
// Secure rides on the request, not the config.
assert.ok(routingCookies({ engines: [prod], devMode: true }, prod, true).every((c) => c.endsWith('; Secure')));
assert.ok(routingCookies({ engines: [prod], devMode: true }, prod, false).every((c) => !c.includes('Secure')));
// engineKey() preserves \p{L}, so the key can be non-ASCII: written raw it comes
// back latin1-mangled (421 ENGINE_UNKNOWN) or is refused as an invalid header
// character. Every emitted cookie must be ASCII-safe.
for (const key of ['k:producción', 'k:北京-engine']) {
    const cookies = routingCookies({ engines: [prod, engineOf('Other', key)], devMode: false }, engineOf('Other', key), false);
    assert.ok(cookies.every((c) => /^[\x20-\x7e]+$/.test(c)), `routing cookies for ${key} must be ASCII-safe`);
    assert.strictEqual(decodeURIComponent(cookieNamed(cookies, 'oie-engine').split(';')[0].slice('oie-engine='.length)), key);
}

const metadata = { issuer: 'https://issuer.test', authorization_endpoint: 'https://issuer.test/auth', token_endpoint: 'https://issuer.test/token' };
const provider: any = { clientId: 'client' };
const claims = { iss: metadata.issuer, aud: 'client', nonce: 'n', exp: Math.floor(now / 1000) + 60 };
const token = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
assert.deepStrictEqual(validateIdTokenClaims(token, metadata, provider, 'n', now), claims);
assert.throws(() => validateIdTokenClaims(token, metadata, provider, 'wrong', now), /validation/);
// The config DOCUMENT stays keyed by the human engine name; the runtime map is
// keyed by the engine's stable key, which is what every lookup arrives holding.
const engines = [prod];
const providerConfig = { enabled: true, discoveryUrl: 'https://issuer.test/.well-known/openid-configuration', clientId: 'client', clientSecret: secret };
const normalized = normalizeOidc({ Production: providerConfig }, engines);
assert.ok(normalized['k:production']);
assert.strictEqual(normalized.Production, undefined);
const engineManaged = normalizeOidc({ Production: { enabled: true, clientSecret: secret, providerLabel: 'SSO' } }, engines)['k:production'];
assert.strictEqual(engineManaged.discoveryUrl, undefined);
assert.strictEqual(engineManaged.clientId, undefined);
assert.throws(() => normalizeOidc({ '0': providerConfig }, engines), /does not match a configured engine name/);
// An empty document is valid (the shipped example) and yields no providers.
assert.deepStrictEqual(normalizeOidc({}, engines), {});
budgetTests().then(() => console.log('oidc tests passed'), (error) => { console.error(error); process.exit(1); });
