import * as crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import type { OidcProviderConfig, WebAdminConfig } from './config';
import { oidcForEngine } from './config';
import { engineRequest, isTrustedPeer, rewriteSetCookies, sanitizeForwardHeaders } from './proxy';

const TXN_COOKIE = 'oie-oidc-txn';
const RESULT_COOKIE = 'oie-oidc-result';
const TXN_TTL_MS = 10 * 60 * 1000;
const metadataCache = new Map<string, { expires: number; value: Metadata }>();
type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string };
type Transaction = { v: 1; state: string; nonce: string; verifier: string; engine: number; returnPath: string; created: number };

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
        if (txn.v !== 1 || typeof txn.created !== 'number' || txn.created > now + 30000 || now - txn.created > TXN_TTL_MS)
            throw new Error('expired transaction');
        return txn;
    } catch (error) {
        if ((error as Error).message === 'expired transaction') throw error;
        throw new Error('invalid transaction');
    }
}

export function validReturnPath(value: unknown): string {
    const path = typeof value === 'string' ? value : '/';
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || /[\r\n]/.test(path)) return '/';
    try {
        const parsed = new URL(path, 'https://local.invalid');
        return parsed.origin === 'https://local.invalid' ? parsed.pathname + parsed.search + parsed.hash : '/';
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

function secureRequest(req: Request, trusted: Set<string>): boolean {
    return !!(req.socket as import('tls').TLSSocket).encrypted
        || (isTrustedPeer(req.socket.remoteAddress, trusted) && req.headers['x-forwarded-proto'] === 'https');
}

function publicOrigin(req: Request, trusted: Set<string>): string {
    const host = String(req.headers.host || '');
    if (!/^[A-Za-z0-9._:[\]-]+(?::\d+)?$/.test(host)) throw new Error('invalid host header');
    return `${secureRequest(req, trusted) ? 'https' : 'http'}://${host}`;
}

function setResult(res: Response, payload: object, secure: boolean): void {
    const value = b64(JSON.stringify(payload)).slice(0, 3500);
    res.append('Set-Cookie', `${RESULT_COOKIE}=${value}; Path=/; Max-Age=120; SameSite=Lax${secure ? '; Secure' : ''}`);
}

async function discovery(provider: OidcProviderConfig): Promise<Metadata> {
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

function jwtClaims(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid ID token');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export function validateIdTokenClaims(token: string, metadata: Metadata, provider: OidcProviderConfig, nonce: string, now = Date.now()): any {
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

function providerAt(config: WebAdminConfig, raw: unknown): { index: number; provider: OidcProviderConfig } | null {
    const index = /^\d+$/.test(String(raw)) ? Number(raw) : -1;
    if (index < 0 || index >= config.engines.length) return null;
    const provider = oidcForEngine(config, index);
    return provider ? { index, provider } : null;
}

function limiter() {
    const hits = new Map<string, number[]>();
    return (req: Request, res: Response, next: () => void) => {
        const key = String(req.socket.remoteAddress || 'unknown');
        const now = Date.now();
        const recent = (hits.get(key) || []).filter((time) => now - time < 60000);
        if (recent.length >= 30) { res.status(429).send('Too many OIDC requests. Try again shortly.'); return; }
        recent.push(now); hits.set(key, recent); next();
    };
}

export function createOidcRouter(config: WebAdminConfig) {
    const router = express.Router();
    const trusted = new Set(config.trustedProxies || []);
    router.use(limiter());
    router.get('/start', async (req, res) => {
        const found = providerAt(config, req.query.engine);
        if (!found) { setResult(res, { status: 'FAIL', message: 'SSO is not configured for this engine.' }, secureRequest(req, trusted)); return res.redirect('/'); }
        try {
            const metadata = await discovery(found.provider);
            const origin = publicOrigin(req, trusted);
            const verifier = random(48);
            const txn: Transaction = { v: 1, state: random(), nonce: random(), verifier, engine: found.index,
                returnPath: validReturnPath(req.query.return), created: Date.now() };
            const secure = secureRequest(req, trusted);
            res.append('Set-Cookie', `${TXN_COOKIE}=${sealTransaction(txn, found.provider.clientSecret)}; Path=/oidc; HttpOnly; Max-Age=600; SameSite=Lax${secure ? '; Secure' : ''}`);
            const target = new URL(metadata.authorization_endpoint);
            target.searchParams.set('client_id', found.provider.clientId);
            target.searchParams.set('redirect_uri', `${origin}/oidc/callback`);
            target.searchParams.set('response_type', 'code'); target.searchParams.set('response_mode', 'query');
            target.searchParams.set('scope', found.provider.scopes.join(' ')); target.searchParams.set('state', txn.state);
            target.searchParams.set('nonce', txn.nonce); target.searchParams.set('code_challenge_method', 'S256');
            target.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
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
            // Try configured secrets because the engine index itself is sealed.
            let txn: Transaction | null = null; let found: ReturnType<typeof providerAt> = null;
            const raw = cookies(req)[TXN_COOKIE];
            for (let i = 0; i < config.engines.length && !txn; i++) {
                const candidate = providerAt(config, i); if (!candidate) continue;
                try { const opened = openTransaction(raw, candidate.provider.clientSecret); if (opened.engine === i) { txn = opened; found = candidate; } } catch { /* next */ }
            }
            if (!txn || !found || req.query.state !== txn.state) throw new Error('invalid or expired sign-in transaction');
            returnPath = txn.returnPath;
            if (typeof req.query.error === 'string') throw new Error('The identity provider declined sign-in.');
            if (typeof req.query.code !== 'string' || !req.query.code) throw new Error('The identity provider returned no authorization code.');
            const metadata = await discovery(found.provider);
            const form = new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code,
                redirect_uri: `${publicOrigin(req, trusted)}/oidc/callback`, client_id: found.provider.clientId,
                client_secret: found.provider.clientSecret, code_verifier: txn.verifier });
            const tokenResponse = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form, signal: AbortSignal.timeout(15000) });
            const tokens = await tokenResponse.json() as any;
            if (!tokenResponse.ok || typeof tokens.id_token !== 'string') throw new Error('OIDC token exchange failed');
            const claims = validateIdTokenClaims(tokens.id_token, metadata, found.provider, txn.nonce);
            const body = Buffer.from(new URLSearchParams({ username: String(claims.preferred_username || claims.email || claims.sub || 'oidc'), password: `oidc:${tokens.id_token}` }).toString());
            const headers: import('http').OutgoingHttpHeaders = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-requested-with': 'OpenIntegrationEngine', 'content-length': body.length };
            sanitizeForwardHeaders(headers, req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
            const login = await engineRequest(config.engines[found.index], { method: 'POST', path: '/api/users/_login', headers, body });
            let result: any;
            try { result = JSON.parse(login.body.toString('utf8')); } catch { result = { status: login.status === 200 ? 'SUCCESS' : 'FAIL' }; }
            const status = result?.status || result;
            if (!status) throw new Error('engine rejected SSO');
            const upstreamCookies = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'] : login.headers['set-cookie'] ? [login.headers['set-cookie']] : [];
            for (const cookie of rewriteSetCookies(upstreamCookies, secure)) res.append('Set-Cookie', cookie);
            res.append('Set-Cookie', `oie-engine=${found.index}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`);
            const pluginMissing = status === 'FAIL' && /invalid (username|user name).*password/i.test(String(result.message || ''));
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
