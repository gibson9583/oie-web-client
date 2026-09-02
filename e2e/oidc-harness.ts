/*
 * Shared scaffolding for the OIDC specs.
 *
 * mockEngine() only intercepts requests the BROWSER makes, but /oidc/start and
 * /oidc/callback run inside the Node server — discovery, the token exchange, and
 * the engine _login are all server-side fetches. So each OIDC spec boots its own
 * web-administrator against local stand-ins and drives the real flow.
 *
 * That scaffolding was written twice, and the copies had already drifted: the
 * IdP is the piece both specs must agree on (it is the thing under test on the
 * other side of every redirect), and a divergence between two hand-maintained
 * mock providers shows up as a passing suite and a failing deployment. The
 * pieces that genuinely differ per spec — what the ENGINE answers — stay in the
 * specs, where the assertions can see them.
 */

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

export const CLIENT_ID = 'web-admin';
export const CLIENT_SECRET = 'e2e-test-client-secret';

export function b64url(value: Buffer | string): string { return Buffer.from(value).toString('base64url'); }

export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = (probe.address() as net.AddressInfo).port;
            probe.close(() => resolve(port));
        });
    });
}

export function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

export function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
}

export function idToken(issuer: string, nonce: string, claims: Record<string, unknown> = {}): string {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({
        iss: issuer, aud: CLIENT_ID, nonce, iat: now, exp: now + 300,
        sub: 'subject-1', preferred_username: 'jdoe', email: 'jdoe@example.test', ...claims
    }));
    // The web tier checks claims only; signature verification is the (mocked)
    // engine plugin's job, so any signature bytes will do here.
    return `${header}.${payload}.${b64url('sig')}`;
}

export type IdpOptions = {
    /** The issuer origin, read late — the port is only known at beforeAll. */
    issuer: () => string;
    /** 'denied' sends back error=access_denied instead of a code. */
    mode?: () => 'ok' | 'denied';
    onAuthorize?: (params: URLSearchParams) => void;
    onToken?: (form: URLSearchParams) => void;
};

/**
 * Serves the three IdP endpoints and reports whether it handled the request, so
 * a spec whose stub also plays the engine can compose the two on one port:
 *
 *     if (handleIdp(req, res, options)) return;
 *
 * The PKCE and client-secret checks are real. A stub that accepted any verifier
 * would make the /oidc/start half of the flow untested — the code challenge
 * would still be sent, just never checked against anything.
 */
export function handleIdp(req: http.IncomingMessage, res: http.ServerResponse, options: IdpOptions): boolean {
    const issuer = options.issuer();
    const url = new URL(String(req.url), issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
        json(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` });
        return true;
    }
    if (url.pathname === '/authorize') {
        options.onAuthorize?.(url.searchParams);
        const back = new URL(String(url.searchParams.get('redirect_uri')));
        back.searchParams.set('state', String(url.searchParams.get('state')));
        if (options.mode?.() === 'denied') {
            back.searchParams.set('error', 'access_denied');
        } else {
            const code = crypto.randomBytes(8).toString('hex');
            pending.set(code, { nonce: String(url.searchParams.get('nonce')), challenge: String(url.searchParams.get('code_challenge')) });
            back.searchParams.set('code', code);
        }
        res.writeHead(302, { location: back.toString() });
        res.end();
        return true;
    }
    if (url.pathname === '/token') {
        void readBody(req).then((body) => {
            const form = new URLSearchParams(body);
            options.onToken?.(form);
            const grant = pending.get(String(form.get('code')));
            const hashed = crypto.createHash('sha256').update(String(form.get('code_verifier'))).digest('base64url');
            if (!grant || form.get('client_secret') !== CLIENT_SECRET || hashed !== grant.challenge) {
                return json(res, 400, { error: 'invalid_grant' });
            }
            pending.delete(String(form.get('code')));
            return json(res, 200, { access_token: 'at', token_type: 'Bearer', id_token: idToken(issuer, grant.nonce) });
        });
        return true;
    }
    return false;
}

/** Authorization codes issued but not yet redeemed, keyed by code. */
const pending = new Map<string, { nonce: string; challenge: string }>();

/** The engine /public probe's answer, in the engine's own wire shape. */
export function publicProbeBody(issuer: string): { string: string } {
    // A String-returning extension servlet is serialized as {"string": "<json>"}
    // (XStream shape) — the BFF must unwrap it, so the mock must produce it.
    return { string: JSON.stringify({ configured: true, discoveryUrl: `${issuer}/.well-known/openid-configuration`, clientId: CLIENT_ID }) };
}

export async function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
    const port = await freePort();
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${port}` };
}

/**
 * Boots a real web administrator against the given config and waits until it
 * serves the pre-auth config document. Reports the child's stderr on failure —
 * without it a misconfiguration reads as a bare 20s timeout.
 */
export async function startWebAdmin(config: unknown): Promise<{ process: ChildProcess; url: string; stop: () => void }> {
    const port = await freePort();
    const url = `http://localhost:${port}`;
    // Playwright runs from the repo root (the config's directory).
    const serverDir = path.resolve(process.cwd(), 'web-administrator');
    const stderr: string[] = [];
    const child = spawn('node', ['server/index.js'], {
        cwd: serverDir,
        env: { ...process.env, WEBADMIN_PORT: String(port), WEBADMIN_CONFIG_JSON: JSON.stringify(config) },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr!.on('data', (chunk) => stderr.push(String(chunk)));

    // Ready when the pre-auth config document answers (its first request also
    // exercises the engine /public probe against the stub).
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            const res = await fetch(`${url}/webadmin/config.json`);
            if (res.ok) break;
        } catch { /* not up yet */ }
        if (child.exitCode != null) throw new Error(`web admin exited early:\n${stderr.join('')}`);
        if (Date.now() > deadline) throw new Error(`web admin never became ready:\n${stderr.join('')}`);
        await new Promise((r) => setTimeout(r, 200));
    }
    return { process: child, url, stop: () => child.kill() };
}
