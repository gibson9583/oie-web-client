import * as assert from 'assert';
import { openTransaction, sealTransaction, validReturnPath, validateIdTokenClaims } from './oidc';
import { normalizeOidc } from './config';

const secret = 'a sufficiently long test client secret';
const now = Date.now();
const txn = { v: 1 as const, state: 'state', nonce: 'nonce', verifier: 'verifier', engine: 0, returnPath: '/dashboard?x=1', created: now };
assert.deepStrictEqual(openTransaction(sealTransaction(txn, secret), secret, now), txn);
const sealed = sealTransaction(txn, secret).split('.');
sealed[1] = (sealed[1][0] === 'A' ? 'B' : 'A') + sealed[1].slice(1);
assert.throws(() => openTransaction(sealed.join('.'), secret, now), /invalid/);
assert.throws(() => openTransaction(sealTransaction({ ...txn, created: now - 700000 }, secret), secret, now), /expired/);
assert.strictEqual(validReturnPath('/channels?x=1'), '/channels?x=1');
for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)']) assert.strictEqual(validReturnPath(bad), '/');

const metadata = { issuer: 'https://issuer.test', authorization_endpoint: 'https://issuer.test/auth', token_endpoint: 'https://issuer.test/token' };
const provider: any = { clientId: 'client' };
const claims = { iss: metadata.issuer, aud: 'client', nonce: 'n', exp: Math.floor(now / 1000) + 60 };
const token = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
assert.deepStrictEqual(validateIdTokenClaims(token, metadata, provider, 'n', now), claims);
assert.throws(() => validateIdTokenClaims(token, metadata, provider, 'wrong', now), /validation/);
const engines = [{ name: 'Production', url: 'https://engine.test', verifyTls: true }];
const providerConfig = { enabled: true, discoveryUrl: 'https://issuer.test/.well-known/openid-configuration', clientId: 'client', clientSecret: secret };
assert.ok(normalizeOidc({ Production: providerConfig }, engines).Production);
const engineManaged = normalizeOidc({ Production: { enabled: true, clientSecret: secret, providerLabel: 'SSO' } }, engines).Production;
assert.strictEqual(engineManaged.discoveryUrl, undefined);
assert.strictEqual(engineManaged.clientId, undefined);
assert.throws(() => normalizeOidc({ '0': providerConfig }, engines), /does not match a configured engine name/);
console.log('oidc tests passed');
