/*
 * The sealed OIDC sign-in transaction: the one piece of state that crosses the
 * browser between /oidc/start and /oidc/callback, and the only place the client
 * secret is used as a key rather than a credential.
 *
 * Split out of oidc.ts because it is the security core of the flow and nothing
 * else in that file is: this module decides what a returning browser is allowed
 * to claim it started, and every guard here has a specific attack behind it
 * (engine swapping, replay under a different state, an open redirect through
 * ?return=). Kept together, those guards read as one argument; scattered
 * through the router they read as ceremony. It also depends on nothing but
 * node:crypto, so it can be reasoned about — and tested — without an engine, a
 * provider, or an Express request.
 */

import * as crypto from 'crypto';
import type { ResolvedEngine } from './config';

export const TXN_COOKIE = 'oie-oidc-txn';
export const TXN_TTL_MS = 10 * 60 * 1000;

// v3 seals the engine's stable KEY (issue #53's `k:<slug>`): the identity binding
// must not move when allowedUrls is reordered mid-flow (a restart inside the
// 10-minute transaction window), and the key is what every other routing surface
// now carries. The version bump is deliberate — a v2 cookie sealed the engine
// NAME, so an in-flight sign-in across the upgrade fails closed and re-starts
// rather than resolving against a field this code no longer reads.
export type Transaction = { v: 3; state: string; nonce: string; verifier: string; engineKey: string; returnPath: string; created: number };

/** base64url, the encoding every value that crosses the browser here uses. */
export function b64url(value: Buffer | string): string { return Buffer.from(value).toString('base64url'); }

function random(size = 32): string { return crypto.randomBytes(size).toString('base64url'); }

function keyFor(secret: string): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('oie-webadmin-oidc'), Buffer.from('transaction-cookie-v1'), 32));
}

/**
 * A fresh transaction for one sign-in attempt. The three random values are
 * generated HERE, together, so there is one place to check that state, nonce,
 * and PKCE verifier are independent and full-entropy — reusing any of them for
 * another, or deriving one from another, defeats the guard it belongs to.
 */
export function newTransaction(engineKey: string, returnPath: string, now = Date.now()): Transaction {
    return { v: 3, state: random(), nonce: random(), verifier: random(48), engineKey, returnPath, created: now };
}

/** The PKCE challenge for a transaction's verifier (S256). */
export function codeChallenge(txn: Transaction): string {
    return crypto.createHash('sha256').update(txn.verifier).digest('base64url');
}

export function sealTransaction(txn: Transaction, secret: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(txn)), cipher.final()]);
    return [b64url(iv), b64url(encrypted), b64url(cipher.getAuthTag())].join('.');
}

export function openTransaction(value: string, secret: string, now = Date.now()): Transaction {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) throw new Error('invalid transaction');
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(parts[0], 'base64url'));
        decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
        const txn = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[1], 'base64url')), decipher.final()]).toString('utf8'));
        if (txn.v !== 3 || typeof txn.created !== 'number' || txn.created > now + 30000 || now - txn.created > TXN_TTL_MS)
            throw new Error('expired transaction');
        return txn;
    } catch (error) {
        if ((error as Error).message === 'expired transaction') throw error;
        throw new Error('invalid transaction');
    }
}

// The engineKey re-check is NOT redundant with the GCM tag. keyFor() derives the
// sealing key from the client secret alone, and two engines behind ONE IdP app
// registration — a single Entra/Keycloak client fronting Production and Staging
// — share a secret and therefore a sealing key. A transaction started against
// staging then opens cleanly under a `k:production` prefix, and without this
// comparison the staging-issued code would be exchanged against production and
// mint a production session. Only the sealed key says which engine the user
// actually chose.
export function openBoundTransaction(sealed: string, engine: ResolvedEngine, secret: string, state: unknown, now?: number): Transaction {
    const txn = openTransaction(sealed, secret, now);
    if (txn.engineKey !== engine.key || state !== txn.state) throw new Error('invalid or expired sign-in transaction');
    return txn;
}

// The transaction cookie carries its engine key in front of the sealed blob:
// `k:<slug>.<iv>.<ct>.<tag>`. The seal is authenticated with that engine's client
// secret, so the callback cannot decrypt without first knowing WHICH engine — the
// prefix answers that in one lookup instead of trying every configured secret in
// turn. The prefix is only a hint and is never trusted: it selects a candidate
// secret, and the sealed engineKey is re-checked against it after decryption, so
// editing the prefix yields a decryption failure or a mismatch, never a swap.
// engineKey() slugifies every non-alphanumeric to '-', so a key holds no '.'.
// The key is percent-encoded because engineKey() preserves \p{L}: an accented or
// CJK engine name yields a non-ASCII key, which a raw Set-Cookie either mangles
// (headers decode as latin1, so "k:producción" returns as "k:producciÃ³n" and
// resolves to no engine) or refuses outright (ERR_INVALID_CHAR above U+00FF).
// Both readers — cookies() in oidc.ts and parseCookies in proxy.ts — decode.
export function txnCookieValue(engineKey: string, sealed: string): string {
    return `${encodeURIComponent(engineKey)}.${sealed}`;
}

// Takes the ALREADY percent-decoded cookie value (cookies() in oidc.ts and
// parseCookies in proxy.ts decode every cookie), so this is deliberately NOT the
// inverse of txnCookieValue — pairing the two directly yields a still-encoded
// "k%3A…" that matches no engine. Decoding here instead would be worse: the
// caller has already decoded once, so a second pass would resolve a
// doubly-encoded key.
export function splitTxnCookie(value: unknown): { engineKey: string; sealed: string } | null {
    const at = String(value ?? '').indexOf('.');
    if (at <= 0) return null;
    return { engineKey: String(value).slice(0, at), sealed: String(value).slice(at + 1) };
}

export function validReturnPath(value: unknown): string {
    const path = typeof value === 'string' ? value : '/';
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || /[\r\n]/.test(path)) return '/';
    try {
        const parsed = new URL(path, 'https://local.invalid');
        // Re-check the NORMALIZED result, not just the input: a dot-segment
        // collapses on parse, so "/..//evil.test" arrives past the leading-"//"
        // guard and comes back out as "//evil.test" — still same-origin by the
        // check below, but a protocol-relative URL that res.redirect emits
        // verbatim and the browser resolves to https://evil.test. This value is
        // attacker-supplied via /oidc/start?return=, so an open redirect here
        // turns a genuine SSO sign-in into a phishing pivot off a trusted origin.
        // Stated as a whitelist: the two escape shapes are "//host" and "/\host",
        // and rejecting anything that is not "/" followed by a non-separator
        // covers both outright, rather than resting on the URL parser folding
        // backslashes for special schemes — true today, but nothing here asserts it.
        const out = parsed.pathname + parsed.search + parsed.hash;
        const sameOrigin = parsed.origin === 'https://local.invalid';
        return sameOrigin && (out === '/' || /^\/[^/\\]/.test(out)) ? out : '/';
    } catch { return '/'; }
}
