import * as crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import type { OidcProviderConfig, ResolvedEngine, WebAdminConfig } from './config';
import { oidcForEngine } from './config';
import { engineRequest, isTrustedPeer, rewriteSetCookies, sanitizeForwardHeaders } from './proxy';

const TXN_COOKIE = 'oie-oidc-txn';
const RESULT_COOKIE = 'oie-oidc-result';
const TXN_TTL_MS = 10 * 60 * 1000;
const metadataCache = new Map<string, { expires: number; value: Metadata }>();
type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string };
type ActiveProvider = OidcProviderConfig & { discoveryUrl: string; clientId: string };
// v3 seals the engine's stable KEY (issue #53's `k:<slug>`): the identity binding
// must not move when allowedUrls is reordered mid-flow (a restart inside the
// 10-minute transaction window), and the key is what every other routing surface
// now carries. The version bump is deliberate — a v2 cookie sealed the engine
// NAME, so an in-flight sign-in across the upgrade fails closed and re-starts
// rather than resolving against a field this code no longer reads.
type Transaction = { v: 3; state: string; nonce: string; verifier: string; engineKey: string; returnPath: string; created: number };

function b64(value: Buffer | string): string { return Buffer.from(value).toString('base64url'); }
function random(size = 32): string { return crypto.randomBytes(size).toString('base64url'); }
function keyFor(secret: string): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('oie-webadmin-oidc'), Buffer.from('transaction-cookie-v1'), 32));
}

export function sealTransaction(txn: Transaction, secret: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(txn)), cipher.final()]);
    return [b64(iv), b64(encrypted), b64(cipher.getAuthTag())].join('.');
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
// Both readers — cookies() here and parseCookies in proxy.ts — decodeURIComponent.
export function txnCookieValue(engineKey: string, sealed: string): string {
    return `${encodeURIComponent(engineKey)}.${sealed}`;
}

// Takes the ALREADY percent-decoded cookie value (cookies() here and parseCookies
// in proxy.ts decode every cookie), so this is deliberately NOT the inverse of
// txnCookieValue — pairing the two directly yields a still-encoded "k%3A…" that
// matches no engine. Decoding here instead would be worse: cookies() has already
// decoded once, so a second pass would resolve a doubly-encoded key.
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

function cookies(req: Request): Record<string, string> {
    const result: Record<string, string> = {};
    for (const item of String(req.headers.cookie || '').split(';')) {
        const at = item.indexOf('=');
        if (at > 0) try { result[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1).trim()); } catch { /* ignore */ }
    }
    return result;
}

// Warned once per process, not per request: this is an operator misconfiguration,
// and repeating it per sign-in would bury the log without telling them more.
let warnedUndeclaredTerminator = false;

function secureRequest(req: Request, trusted: Set<string>): boolean {
    const encrypted = !!(req.socket as import('tls').TLSSocket).encrypted;
    const peerTrusted = isTrustedPeer(req.socket.remoteAddress, trusted);
    if (encrypted) return true;
    if (peerTrusted && req.headers['x-forwarded-proto'] === 'https') return true;
    // Plain socket, untrusted peer — yet the request says a proxy terminated TLS
    // upstream. Those headers only exist when something really is in front, so
    // this is a positive signal rather than an inference: a TLS terminator this
    // deployment has not declared. Every OIDC cookie is therefore about to be
    // minted WITHOUT Secure while the browser is on https, silently, and only on
    // this hop. Requires no configuration to detect, which is what makes it
    // catch the likeliest case — an operator who never set publicOrigin either.
    if (!warnedUndeclaredTerminator && !peerTrusted
        && (req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on'
            || /\bproto=https\b/.test(String(req.headers.forwarded || '')))) {
        warnedUndeclaredTerminator = true;
        console.warn(`[oidc] a request from ${req.socket.remoteAddress} reports TLS terminated upstream, but that peer is not in trustedProxies — `
            + 'OIDC cookies are being set without Secure. Add the terminator to trustedProxies (WEBADMIN_TRUSTED_PROXIES).');
    }
    return false;
}

// The origin the IdP is told to redirect back to. Configured wins: the Host
// header is whatever the client sent, and nothing upstream is obliged to
// sanitize it, so deriving redirect_uri from it means a deployment with a lax or
// wildcard registered URI can have its callback aimed elsewhere. The charset
// check below stops header injection but says nothing about WHOSE host it is.
function publicOrigin(config: Pick<WebAdminConfig, 'publicOrigin'>, req: Request, trusted: Set<string>): string {
    if (config.publicOrigin) return config.publicOrigin;
    const host = String(req.headers.host || '');
    if (!/^[A-Za-z0-9._:[\]-]+(?::\d+)?$/.test(host)) throw new Error('invalid host header');
    return `${secureRequest(req, trusted) ? 'https' : 'http'}://${host}`;
}

// Bound the human-readable part and never cut the encoding itself: a cookie
// truncated mid-base64 decodes as garbage and the login card would show the
// generic failure instead of the engine's actual message.
//
// When clientPluginClass is set the message is NOT prose — it is the MFA
// plugin's opaque challenge, which the authenticator JSON.parses. A TOTP
// enrolment challenge (mode, challenge, secret, otpauth URI) runs past 600
// characters on nothing exotic: a long issuer plus the email-shaped username an
// IdP hands out. Clipping it yields "Unexpected authentication challenge." with
// no way forward, and an SSO account has no local password to fall back on.
//
// A challenge is therefore never truncated — half a challenge is worth exactly
// as much as none. It is sent whole or not at all, and the only bound is what
// the cookie can carry. No fixed challenge cap: any constant large enough to be
// useful is also large enough to overflow the ceiling once updatedUsername is
// long, which drops the challenge anyway — the failure it was meant to prevent.
const PROSE_MAX = 600;
const COOKIE_MAX = 3500;
// The other relayed fields are engine-controlled too, and neither has any
// business being long: clientPluginClass is a class name the client looks up in
// a registry, updatedUsername a login name. Uncapped, a broken or hostile engine
// pushes the cookie past what a browser will store (~4096 bytes) and it is
// dropped SILENTLY — which reads to the user as the generic sign-in failure the
// bounding below exists to avoid. Truncating either only breaks that one lookup.
const CLASS_MAX = 256;
const USERNAME_MAX = 256;
const STATUS_MAX = 64;          // a LoginStatus enum name; 64 is already generous
export function encodeResult(payload: { message?: unknown; [key: string]: unknown }): string {
    const message = String(payload.message ?? '');
    const challenge = !!payload.clientPluginClass;
    // Built from an ALLOWLIST, not a spread of the payload. Every value here
    // originates in the engine's LoginStatus, so a spread means the next field
    // added to setResult silently arrives unbounded — which is how `status`
    // slipped through: it alone could carry the cookie past what a browser
    // stores, and a dropped cookie shows the user nothing at all, which is worse
    // than the generic failure this bounding exists to prevent.
    const bounded: Record<string, unknown> = {
        status: String(payload.status ?? '').slice(0, STATUS_MAX),
        message: challenge ? message : message.slice(0, PROSE_MAX),
        clientPluginClass: String(payload.clientPluginClass ?? '').slice(0, CLASS_MAX),
        updatedUsername: String(payload.updatedUsername ?? '').slice(0, USERNAME_MAX)
    };
    const value = b64(JSON.stringify(bounded));
    if (value.length <= COOKIE_MAX) return value;
    // Over the ceiling. For prose, dropping the detail still leaves a usable
    // status. For a challenge there is nothing to salvage, so say so plainly
    // rather than handing the card a plugin class it cannot act on — that would
    // surface as the authenticator's confusing "unexpected challenge" instead.
    return challenge
        ? b64(JSON.stringify({ ...bounded, clientPluginClass: '', message: 'This engine requires a second authentication factor, but its challenge is too large to complete in the browser. Use the desktop Administrator.' }))
        : b64(JSON.stringify({ ...bounded, message: '' }));
}

function setResult(res: Response, payload: { message?: unknown; [key: string]: unknown }, secure: boolean): void {
    res.append('Set-Cookie', `${RESULT_COOKIE}=${encodeResult(payload)}; Path=/; Max-Age=120; SameSite=Lax${secure ? '; Secure' : ''}`);
}

async function discovery(provider: ActiveProvider): Promise<Metadata> {
    const cached = metadataCache.get(provider.discoveryUrl);
    if (cached && cached.expires > Date.now()) return cached.value;
    const response = await fetch(provider.discoveryUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`discovery returned ${response.status}`);
    const value = await response.json() as Metadata;
    if (!value.issuer || !value.authorization_endpoint || !value.token_endpoint) throw new Error('incomplete discovery document');
    for (const endpoint of [value.authorization_endpoint, value.token_endpoint]) {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('OIDC endpoints must use HTTPS');
    }
    metadataCache.set(provider.discoveryUrl, { expires: Date.now() + 5 * 60 * 1000, value });
    return value;
}

// The engine's ObjectJSONSerializer wraps every JSON payload under a single
// root key (XStream shape); the SPA's api.js normalizes identically. Reduce a
// wrapped LoginStatus to the status object itself; leave bare shapes alone.
export function unwrapEngineJson(parsed: unknown): any {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed as object);
        const inner = keys.length === 1 ? (parsed as any)[keys[0]] : null;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    }
    return parsed;
}

function jwtClaims(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid ID token');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export function validateIdTokenClaims(token: string, metadata: Metadata, provider: Pick<ActiveProvider, 'clientId'>, nonce: string, now = Date.now()): any {
    const claims = jwtClaims(token);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== metadata.issuer || !audiences.includes(provider.clientId) || claims.nonce !== nonce)
        throw new Error('ID token claim validation failed');
    if (audiences.length > 1 && claims.azp !== provider.clientId) throw new Error('ID token authorized-party validation failed');
    const seconds = Math.floor(now / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < seconds - 60 || (claims.nbf != null && claims.nbf > seconds + 60))
        throw new Error('ID token is expired or not active');
    return claims;
}

type EngineOidc = { configured: boolean; discoveryUrl?: string; clientId?: string };
const engineConfigCache = new Map<string, { expires: number; value: EngineOidc | null }>();
// Probes currently in flight, keyed like the cache. The cache entry is written
// only when a probe RESOLVES, so the TTL alone does not bound concurrency: every
// request arriving inside the timeout window would miss the cache and open its
// own socket. /webadmin/config.json is pre-auth and unthrottled, and the shell
// awaits it before the auth check, so a black-holed engine would turn N
// concurrent page loads into N simultaneous 5s connections and stall every tab
// — signed-in ones included. Callers inside the window share the one probe.
const engineConfigInFlight = new Map<string, Promise<EngineOidc | null>>();
export function engineOidcConfiguration(config: WebAdminConfig, engineKey: string): Promise<EngineOidc | null> {
    const engine = config.engines.find((candidate) => candidate.key === engineKey); if (!engine) return Promise.resolve(null);
    const cached = engineConfigCache.get(engine.url); if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    const sharing = engineConfigInFlight.get(engine.url); if (sharing) return sharing;
    // This probe sits on the pre-auth login screen's path (/webadmin/config.json),
    // so it must answer fast and remember failures: a black-holed engine gets a
    // short timeout and a negative-cache entry instead of a stall per page load.
    const probe = (async () => {
        let value: EngineOidc | null = null;
        try {
            // deadlineMs as well as timeoutMs: timeoutMs is an INACTIVITY timer, so
            // an engine that dribbles a byte every few seconds resets it forever.
            // This probe's whole contract is that it settles — the negative cache
            // and the in-flight entry above are only written when it does — so a
            // never-settling probe would pin every later request to the caller's
            // full budget permanently, with no new probe ever started.
            const response = await engineRequest(engine, { method: 'GET', path: '/api/extensions/oidcauth/public', headers: { accept: 'application/json', 'x-requested-with': 'OpenIntegrationEngine' }, timeoutMs: 5000, deadlineMs: 6000 });
            if (response.status === 200) {
                let parsed = JSON.parse(response.body.toString('utf8'));
                // Extension servlets that return String are serialized by the engine
                // as {"string": "<the json text>"} (XStream shape) — unwrap first.
                if (parsed && typeof parsed === 'object' && typeof parsed.string === 'string') parsed = JSON.parse(parsed.string);
                value = parsed && parsed.configured != null ? parsed : parsed?.publicConfiguration || parsed;
            }
        } catch { /* unreachable or malformed — treated as not configured until the negative TTL lapses */ }
        engineConfigCache.set(engine.url, { expires: Date.now() + (value ? 30000 : 15000), value });
        return value;
    })().finally(() => engineConfigInFlight.delete(engine.url));
    engineConfigInFlight.set(engine.url, probe);
    return probe;
}

// Resolves to `work`'s value, or null once `ms` lapses — whichever lands first.
// The work is NOT cancelled: engineOidcConfiguration's probe keeps running behind
// its shared in-flight entry and still populates the cache, so giving up here
// costs the current response its answer, not the answer itself. That guarantee
// depends on the probe actually settling — see its deadlineMs.
export function withBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout>;
    const lapsed = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
        // Never hold the process open for a deadline nobody is waiting on.
        if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([work, lapsed]).finally(() => clearTimeout(timer));
}

// Opens a sealed transaction and confirms it belongs to the engine the cookie's
// cleartext prefix selected, and to this callback.
//
// The engineKey re-check is NOT redundant with the GCM tag. keyFor() derives the
// sealing key from the client secret alone, so two engines configured against one
// IdP app registration — a single Entra/Keycloak client fronting Production and
// Staging — share a secret and therefore a sealing key. A transaction started
// against staging then opens cleanly under a `k:production` prefix, and without
// this comparison the staging-issued code would be exchanged against production
// and mint a production session. Only the sealed key says which engine the user
// actually chose.
export function openBoundTransaction(sealed: string, engine: ResolvedEngine, secret: string, state: unknown, now?: number): Transaction {
    const txn = openTransaction(sealed, secret, now);
    if (txn.engineKey !== engine.key || state !== txn.state) throw new Error('invalid or expired sign-in transaction');
    return txn;
}

// The routing cookies a completed SSO sign-in must leave behind, matching what
// login.tsx's commitEngineSelection writes for a password sign-in — the two have
// to agree or shell.tsx's loadedEngineKey() disagrees with what the login card
// computes and every sign-in is followed by a spurious hard reload.
//
// The key is percent-encoded because engineKey() preserves \p{L}: a raw non-ASCII
// key is read back latin1-mangled (and 421s), or is rejected outright as an
// invalid header character. Both readers — cookies() here and parseCookies in
// proxy.ts — decode. oie-engine-url is cleared in BOTH branches, as the picker
// does: a stale typed URL beside a named-engine choice re-seeds the login card's
// custom field on the next visit.
export function routingCookies(config: Pick<WebAdminConfig, 'engines' | 'devMode'>, engine: ResolvedEngine, secure: boolean): string[] {
    const attributes = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
    const cleared = (name: string) => `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
    // No picker means no remembered choice to record — the proxy already ignores
    // the cookie outright in single-engine mode, so writing one only desynchronizes
    // this tab from what the login card computes ('').
    const routable = config.engines.length > 1 || !!config.devMode;
    return [
        cleared('oie-engine-url'),
        routable ? `oie-engine=${encodeURIComponent(engine.key)}; ${attributes}` : cleared('oie-engine')
    ];
}

// Resolves an engine by its stable key (issue #53). A pre-key numeric index is
// not accepted and not translated: it would be a guess at which entry the caller
// meant, which is exactly what the key migration removed.
async function providerFor(config: WebAdminConfig, raw: unknown): Promise<{ engine: ResolvedEngine; provider: ActiveProvider } | null> {
    const engine = config.engines.find((candidate) => candidate.key === String(raw ?? '')); if (!engine) return null;
    const web = oidcForEngine(config, engine.key); if (!web) return null;
    const reported = await engineOidcConfiguration(config, engine.key);
    const discoveryUrl = reported?.configured ? reported.discoveryUrl : web.discoveryUrl;
    const clientId = reported?.configured ? reported.clientId : web.clientId;
    return discoveryUrl && clientId ? { engine, provider: { ...web, discoveryUrl, clientId } as ActiveProvider } : null;
}

// The address the throttle should count: behind the deployment's trusted front
// proxy every browser shares one socket address, so use the client the proxy
// reports (the RIGHTMOST X-Forwarded-For hop — appended by the trusted proxy,
// unforgeable by the client, unlike the client-suppliable leftmost entries).
export function throttleKey(remoteAddress: string | undefined, forwardedFor: unknown, trusted: Set<string>): string {
    if (isTrustedPeer(remoteAddress, trusted)) {
        const hops = String(forwardedFor || '').split(',').map((hop) => hop.trim()).filter(Boolean);
        if (hops.length) return hops[hops.length - 1];
    }
    return String(remoteAddress || 'unknown');
}

function limiter(trusted: Set<string>) {
    const hits = new Map<string, number[]>();
    return (req: Request, res: Response, next: () => void) => {
        const key = throttleKey(req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
        const now = Date.now();
        // Drop buckets whose window has fully passed so one-off addresses
        // don't accumulate forever.
        if (hits.size > 1000) for (const [stale, times] of hits) { if (now - (times[times.length - 1] || 0) >= 60000) hits.delete(stale); }
        const recent = (hits.get(key) || []).filter((time) => now - time < 60000);
        if (recent.length >= 30) {
            // Say WHEN, not just no. The throttle keys on client IP, so the two
            // populations that hit it are an attacker and a shared egress —
            // an office NAT, or a CI run driving many sign-ins — and for the
            // latter a bare 429 reads as a functional failure. Retry-After lets a
            // caller distinguish "throttled" from "broken" without guessing.
            const oldest = recent[0] || now;
            res.set('Retry-After', String(Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000))));
            const text = 'Too many OIDC requests. Try again shortly.';
            // Content-negotiated rather than always JSON. Both routes here are
            // reached ONLY by top-level browser navigation — location.assign to
            // /oidc/start, and the IdP's 302 to /oidc/callback — so an
            // unconditional JSON body would put a raw object in the user's
            // window. JSON is right for the app's fetch endpoints; these two are
            // not that, so answer whatever the caller actually asked for.
            // text/plain is listed FIRST and explicitly. Offering only `json` plus
            // a default does not work: a browser's Accept ends with `*/*;q=0.8`,
            // which matches application/json, so res.format picks JSON and the
            // user reads a raw object. Naming both lets the browser's q=1
            // text/html preference beat the wildcard while an XHR still gets JSON.
            res.status(429).format({
                'text/plain': () => { res.type('text/plain').send(text); },
                'application/json': () => { res.json({ error: 'TOO_MANY_REQUESTS', message: text }); },
                default: () => { res.type('text/plain').send(text); }
            });
            return;
        }
        recent.push(now); hits.set(key, recent); next();
    };
}

// Every cookie this router sets — the sealed transaction, the result — takes its
// Secure flag from how the request arrived. That is correct, but it means a
// deployment that terminates TLS in front and forgets to declare the terminator
// mints them WITHOUT Secure while the browser is on https: silently, and only
// for the OIDC hop, so nothing else in the app looks wrong. Say it once at
// startup, where an operator can act on it, rather than per request.
export function warnIfSecureCookiesUnreachable(config: Pick<WebAdminConfig, 'tls' | 'trustedProxies' | 'publicOrigin' | 'oidc'>): string | null {
    // The router mounts unconditionally, so without this a deployment using no
    // OIDC at all gets an [oidc] warning purely for its TLS topology.
    if (!Object.keys(config.oidc || {}).length) return null;
    if (config.tls) return null;                                   // TLS terminated here — sockets are encrypted
    if ((config.trustedProxies || []).length) return null;         // a declared terminator can assert x-forwarded-proto
    // Loopback is always trusted, so a same-host proxy still works. The gap is a
    // terminator on another host, which this deployment has not named.
    const https = String(config.publicOrigin || '').startsWith('https://');
    if (!https) return null;                                       // plain http end to end — nothing to downgrade
    return '[oidc] publicOrigin is https but this server terminates no TLS and trusts no proxy, '
        + 'so OIDC cookies will be set without Secure unless the terminator is on this host. '
        + 'Add the terminator to trustedProxies (WEBADMIN_TRUSTED_PROXIES).';
}

export function createOidcRouter(config: WebAdminConfig) {
    const router = express.Router();
    const trusted = new Set(config.trustedProxies || []);
    const warning = warnIfSecureCookiesUnreachable(config);
    if (warning) console.warn(warning);
    router.use(limiter(trusted));
    router.get('/start', async (req, res) => {
        const found = await providerFor(config, req.query.engine);
        if (!found) { setResult(res, { status: 'FAIL', message: 'SSO is not configured for this engine.' }, secureRequest(req, trusted)); return res.redirect('/'); }
        try {
            const metadata = await discovery(found.provider);
            const origin = publicOrigin(config, req, trusted);
            const verifier = random(48);
            const txn: Transaction = { v: 3, state: random(), nonce: random(), verifier, engineKey: found.engine.key,
                returnPath: validReturnPath(req.query.return), created: Date.now() };
            const secure = secureRequest(req, trusted);
            res.append('Set-Cookie', `${TXN_COOKIE}=${txnCookieValue(found.engine.key, sealTransaction(txn, found.provider.clientSecret))}; Path=/oidc; HttpOnly; Max-Age=600; SameSite=Lax${secure ? '; Secure' : ''}`);
            const target = new URL(metadata.authorization_endpoint);
            target.searchParams.set('client_id', found.provider.clientId);
            target.searchParams.set('redirect_uri', `${origin}/oidc/callback`);
            target.searchParams.set('response_type', 'code'); target.searchParams.set('response_mode', 'query');
            target.searchParams.set('scope', found.provider.scopes.join(' ')); target.searchParams.set('state', txn.state);
            target.searchParams.set('nonce', txn.nonce); target.searchParams.set('code_challenge_method', 'S256');
            target.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
            // Allowlisted literal only. The login card sends this on a retry
            // after a rejected attempt: the IdP's own SSO session would
            // otherwise silently re-authenticate the same rejected account,
            // making it impossible to switch users.
            if (req.query.prompt === 'login') target.searchParams.set('prompt', 'login');
            return res.redirect(target.toString());
        } catch (error) {
            console.error(`[oidc] start failed: ${(error as Error).message}`);
            setResult(res, { status: 'FAIL', message: 'SSO is unavailable. Use local sign-in.' }, secureRequest(req, trusted));
            return res.redirect('/');
        }
    });
    router.get('/callback', async (req, res) => {
        const secure = secureRequest(req, trusted);
        res.append('Set-Cookie', `${TXN_COOKIE}=; Path=/oidc; HttpOnly; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`);
        let returnPath = '/';
        try {
            // One lookup: the cookie names its engine key in the clear, and the
            // seal — which only that engine's client secret opens — carries the
            // same key for confirmation. A pre-upgrade v2 cookie has no key
            // prefix, so it lands on an unknown engine here and fails closed.
            const parts = splitTxnCookie(cookies(req)[TXN_COOKIE]);
            const found = parts && await providerFor(config, parts.engineKey);
            if (!found || !parts) throw new Error('invalid or expired sign-in transaction');
            const txn = openBoundTransaction(parts.sealed, found.engine, found.provider.clientSecret, req.query.state);
            returnPath = txn.returnPath;
            if (typeof req.query.error === 'string') throw new Error('The identity provider declined sign-in.');
            if (typeof req.query.code !== 'string' || !req.query.code) throw new Error('The identity provider returned no authorization code.');
            const metadata = await discovery(found.provider);
            const form = new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code,
                redirect_uri: `${publicOrigin(config, req, trusted)}/oidc/callback`, client_id: found.provider.clientId,
                client_secret: found.provider.clientSecret, code_verifier: txn.verifier });
            const tokenResponse = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form, signal: AbortSignal.timeout(15000) });
            const tokens = await tokenResponse.json() as any;
            if (!tokenResponse.ok || typeof tokens.id_token !== 'string') throw new Error('OIDC token exchange failed');
            const claims = validateIdTokenClaims(tokens.id_token, metadata, found.provider, txn.nonce);
            const body = Buffer.from(new URLSearchParams({ username: String(claims.preferred_username || claims.email || claims.sub || 'oidc'), password: `oidc:${tokens.id_token}` }).toString());
            const headers: import('http').OutgoingHttpHeaders = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-requested-with': 'OpenIntegrationEngine', 'content-length': body.length };
            sanitizeForwardHeaders(headers, req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
            const login = await engineRequest(found.engine, { method: 'POST', path: '/api/users/_login', headers, body });
            let result: any;
            try { result = unwrapEngineJson(JSON.parse(login.body.toString('utf8'))); } catch { result = { status: login.status === 200 ? 'SUCCESS' : 'FAIL' }; }
            const status = result?.status || result;
            if (!status) throw new Error('engine rejected SSO');
            const upstreamCookies = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'] : login.headers['set-cookie'] ? [login.headers['set-cookie']] : [];
            for (const cookie of rewriteSetCookies(upstreamCookies, secure)) res.append('Set-Cookie', cookie);
            // Route this session the same way a password sign-in would (see
            // login.tsx commitEngineSelection): the stable key when a picker is in
            // play, and NO cookie in single-engine mode. Writing a cookie there
            // would desynchronize shell.tsx's loadedEngineKey() from what the
            // login card computes ('') and force a spurious hard reload on the
            // next sign-in in this tab.
            for (const cookie of routingCookies(config, found.engine, secure)) res.append('Set-Cookie', cookie);
            // Local auth answers "Incorrect username or password." — an oidc:-prefixed
            // password can only reach local auth when no OIDC plugin intercepted it.
            const pluginMissing = status === 'FAIL' && /incorrect username or password|invalid (username|user name).*password/i.test(String(result.message || ''));
            const message = result.clientPluginClass ? String(result.message || '')
                : pluginMissing ? 'The engine does not accept SSO. Verify that the OIDC Authentication extension is installed and configured.'
                : status === 'FAIL' ? 'SSO sign-in was rejected.' : String(result.message || '');
            setResult(res, { status, message, clientPluginClass: result.clientPluginClass || '', updatedUsername: result.updatedUsername || '' }, secure);
            return res.redirect(returnPath);
        } catch (error) {
            console.error(`[oidc] callback failed: ${(error as Error).message}`);
            setResult(res, { status: 'FAIL', message: (error as Error).message.startsWith('The identity provider') ? (error as Error).message : 'SSO sign-in failed. Use local sign-in or contact an administrator.' }, secure);
            return res.redirect(returnPath);
        }
    });
    return router;
}
