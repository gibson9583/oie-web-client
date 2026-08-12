import { test, expect } from '@playwright/test';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { mockEngine } from './mock.js';

/*
 * OIDC login, end to end, with the IdP and the ENGINE-SIDE of the flow mocked
 * by a real local HTTP server. mockEngine() only intercepts requests the
 * BROWSER makes — but /oidc/start and /oidc/callback run inside the Node
 * server (discovery, token exchange, and the engine _login are server-side
 * fetches), so this spec boots its own web-admin instance on a fresh port,
 * configured against a local stand-in that plays both the IdP and the engine.
 *
 * Wire shapes deliberately match the real engine: the /public probe answers in
 * the {"string": "<json>"} envelope extension servlets produce, and _login
 * answers a LoginStatus wrapped under its XStream root key. These are exactly
 * the shapes the BFF must unwrap — regression coverage for real-engine parity.
 */

const CLIENT_ID = 'web-admin';
const CLIENT_SECRET = 'e2e-test-client-secret';

let stub: http.Server;            // plays IdP + engine, server-side only
let app: ChildProcess;            // the web administrator under test
let appUrl: string;
let idpUrl: string;

// Per-test knobs, reset in beforeEach.
let authorizeMode: 'ok' | 'denied' = 'ok';
let loginStatus: { status: number; body: unknown } | null = null;
const received: { authorize?: URLSearchParams; token?: URLSearchParams; login?: URLSearchParams } = {};
const pending = new Map<string, { nonce: string; challenge: string }>();

function b64url(value: Buffer | string): string { return Buffer.from(value).toString('base64url'); }

function idToken(nonce: string): string {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({
        iss: idpUrl, aud: CLIENT_ID, nonce, iat: now, exp: now + 300,
        sub: 'subject-1', preferred_username: 'jdoe', email: 'jdoe@example.test'
    }));
    // The web tier checks claims only; signature verification is the (mocked)
    // engine plugin's job, so any signature bytes will do here.
    return `${header}.${payload}.${b64url('sig')}`;
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = (probe.address() as net.AddressInfo).port;
            probe.close(() => resolve(port));
        });
    });
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function stubHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(String(req.url), idpUrl);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
        return json(200, { issuer: idpUrl, authorization_endpoint: `${idpUrl}/authorize`, token_endpoint: `${idpUrl}/token` });
    }
    if (url.pathname === '/authorize') {
        received.authorize = url.searchParams;
        const back = new URL(String(url.searchParams.get('redirect_uri')));
        back.searchParams.set('state', String(url.searchParams.get('state')));
        if (authorizeMode === 'denied') {
            back.searchParams.set('error', 'access_denied');
        } else {
            const code = crypto.randomBytes(8).toString('hex');
            pending.set(code, { nonce: String(url.searchParams.get('nonce')), challenge: String(url.searchParams.get('code_challenge')) });
            back.searchParams.set('code', code);
        }
        res.writeHead(302, { location: back.toString() });
        res.end();
        return;
    }
    if (url.pathname === '/token') {
        void readBody(req).then((body) => {
            const form = new URLSearchParams(body);
            received.token = form;
            const grant = pending.get(String(form.get('code')));
            const hashed = crypto.createHash('sha256').update(String(form.get('code_verifier'))).digest('base64url');
            if (!grant || form.get('client_secret') !== CLIENT_SECRET || hashed !== grant.challenge) {
                return json(400, { error: 'invalid_grant' });
            }
            pending.delete(String(form.get('code')));
            return json(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken(grant.nonce) });
        });
        return;
    }
    if (url.pathname === '/api/extensions/oidcauth/public') {
        // Engine wire shape: a String-returning extension servlet answers
        // {"string": "<the json text>"} — the probe must unwrap this.
        return json(200, { string: JSON.stringify({ configured: true, discoveryUrl: `${idpUrl}/.well-known/openid-configuration`, clientId: CLIENT_ID }) });
    }
    if (url.pathname === '/api/users/_login') {
        void readBody(req).then((body) => {
            received.login = new URLSearchParams(body);
            if (loginStatus) return json(loginStatus.status, loginStatus.body);
            return json(200,
                { 'com.mirth.connect.model.LoginStatus': { status: 'SUCCESS', message: '', updatedUsername: 'jdoe' } },
                { 'set-cookie': 'JSESSIONID=e2e-engine-session; Path=/; HttpOnly' });
        });
        return;
    }
    json(404, { error: 'unexpected path ' + url.pathname });
}

test.beforeAll(async () => {
    const stubPort = await freePort();
    idpUrl = `http://127.0.0.1:${stubPort}`;
    stub = http.createServer(stubHandler);
    await new Promise<void>((resolve) => stub.listen(stubPort, '127.0.0.1', resolve));

    const appPort = await freePort();
    appUrl = `http://localhost:${appPort}`;
    // Playwright runs from the repo root (the config's directory).
    const serverDir = path.resolve(process.cwd(), 'web-administrator');
    const stderr: string[] = [];
    app = spawn('node', ['server/index.js'], {
        cwd: serverDir,
        env: {
            ...process.env,
            WEBADMIN_PORT: String(appPort),
            WEBADMIN_CONFIG_JSON: JSON.stringify({
                allowedUrls: [{ name: 'Primary', url: idpUrl }],
                oidc: { Primary: { enabled: true, clientSecret: CLIENT_SECRET, providerLabel: 'Acme SSO' } }
            })
        },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    app.stderr!.on('data', (chunk) => stderr.push(String(chunk)));

    // Ready when the pre-auth config document answers (its first request also
    // exercises the engine /public probe against the stub).
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            const res = await fetch(`${appUrl}/webadmin/config.json`);
            if (res.ok) break;
        } catch { /* not up yet */ }
        if (app.exitCode != null) throw new Error(`web admin exited early:\n${stderr.join('')}`);
        if (Date.now() > deadline) throw new Error(`web admin never became ready:\n${stderr.join('')}`);
        await new Promise((r) => setTimeout(r, 200));
    }
});

test.afterAll(async () => {
    app?.kill();
    await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
});

test.beforeEach(() => {
    authorizeMode = 'ok';
    loginStatus = null;
    delete received.authorize; delete received.token; delete received.login;
});

test.describe('OIDC login', () => {
    test('SSO takes over the login card and completes the code flow to the dashboard', async ({ page }) => {
        // Signed in only once the callback has relayed the engine's session
        // cookie — which doubles as an assertion that the relay happens.
        await mockEngine(page, {
            'GET /users/current': (req: any) => (String(req.headers()['cookie'] || '').includes('JSESSIONID=e2e-engine-session')
                ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 }),
        });
        await page.goto(appUrl + '/');

        // SSO-first: the provider button leads, the local form is behind the toggle.
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        await expect(page.locator('input[type=password]')).toHaveCount(0);

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });

        // The authorization request was a real PKCE + confidential-client flow…
        expect(received.authorize!.get('code_challenge_method')).toBe('S256');
        expect(received.authorize!.get('response_type')).toBe('code');
        expect(received.token!.get('client_secret')).toBe(CLIENT_SECRET);
        // …and the engine received the ID token hand-off, never a password.
        const password = String(received.login!.get('password'));
        expect(password).toMatch(/^oidc:/);
        const claims = JSON.parse(Buffer.from(password.slice(5).split('.')[1], 'base64url').toString('utf8'));
        expect(claims.nonce).toBe(received.authorize!.get('nonce'));
        expect(claims.aud).toBe(CLIENT_ID);
        expect(received.login!.get('username')).toBe('jdoe');
    });

    test('toggles to local sign-in (break-glass) and back', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS', message: 'ok' }; },
        });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Use local sign-in' }).click();
        // The local form appears with a way back to SSO.
        await expect(page.locator('input[type=password]')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();

        // Local login still works — the engine sees a password, not a token.
        await page.getByPlaceholder('admin').fill('admin');
        await page.locator('input[type=password]').fill('admin');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(received.login).toBeUndefined();   // nothing reached the server-side login path

        // The preference is remembered per engine, so a reload stays on local.
        await page.reload();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    });

    test('an IdP decline is surfaced inline with local sign-in reachable', async ({ page }) => {
        authorizeMode = 'denied';
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('The identity provider declined sign-in.')).toBeVisible({ timeout: 15_000 });
        // Break-glass: the failure drops the card into local mode.
        await expect(page.locator('input[type=password]')).toBeVisible();
    });

    test('an engine without the OIDC extension yields the install hint', async ({ page }) => {
        // The plugin absent, local auth answers its real rejection wording.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.LoginStatus': { status: 'FAIL', message: 'Incorrect username or password.' } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText(/OIDC Authentication extension is installed/)).toBeVisible({ timeout: 15_000 });
    });
});
