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
// Fires when the BFF performs its server-side engine login (the first leg), so a
// test can change engine state mid-flight.
let onEngineLogin: (() => void) | null = null;
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
            onEngineLogin?.();
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
    onEngineLogin = null;
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

    /*
     * An SSO user has no engine password — the credential lives at the IdP, and
     * the engine-local one it would set is never consulted. Offering "Change
     * Password" invites someone to create a credential that does nothing.
     * Paired with the break-glass case below: the suppression is scoped to HOW
     * the session was established, not to the account.
     */
    test('an SSO session is not offered a password to change', async ({ page }) => {
        await mockEngine(page, {
            'GET /users/current': (req: any) => (String(req.headers()['cookie'] || '').includes('JSESSIONID=e2e-engine-session')
                ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 }),
        });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        await page.locator('button.user-chip').click();
        const menu = page.getByRole('menu');
        // Edit Account proves the menu opened — otherwise the absence below
        // would pass against a menu that never rendered.
        await expect(menu.getByRole('menuitem', { name: 'Edit Account' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Change Password' })).toHaveCount(0);

        // The profile modal still opens, with its password pair greyed and the
        // reason shown rather than silently missing.
        await menu.getByRole('menuitem', { name: 'Edit Account' }).click();
        await expect(page.getByText('Your password is managed by your identity provider.')).toBeVisible();
        await expect(page.locator('.modal input[type=password]').first()).toBeDisabled();
    });

    test('a break-glass local sign-in keeps its password controls', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Use local sign-in' }).click();
        await page.getByPlaceholder('admin').fill('admin');
        await page.locator('input[type=password]').fill('admin');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        // Signing in with a local password means there IS one to change — even
        // on an account the IdP also knows.
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Change Password' })).toBeVisible();
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

        // The preference is remembered per engine, so the NEXT visit to the login
        // card opens on local rather than SSO. Reloading while still signed in
        // only re-renders the shell, which says nothing either way — drop the
        // session first, so what comes back is the card.
        authed = false;
        await page.reload();
        await expect(page.locator('input[type=password]')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Sign in with SSO' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toHaveCount(0);
        // Stored against THIS engine's stable key, not globally — a global flag
        // would opt every engine out of SSO because one of them once needed
        // break-glass. ("Primary" in the config below; k:primary at runtime.)
        expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oie-login-mode:'))))
            .toEqual(['oie-login-mode:k:primary']);
        expect(await page.evaluate(() => localStorage.getItem('oie-login-mode:k:primary'))).toBe('local');

        // Choosing SSO again clears it rather than leaving a sticky override.
        await page.getByRole('button', { name: 'Sign in with SSO' }).click();
        expect(await page.evaluate(() => localStorage.getItem('oie-login-mode:k:primary'))).toBeNull();
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

    test('a roleless account under RBAC gets the missing-permissions explanation', async ({ page }) => {
        // The engine session is real, but RBAC denies a user with no role even
        // users/current (403) — the card must point at roles, not cookies.
        await mockEngine(page, { 'GET /users/current': { __status: 403 } });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText(/no permissions on this engine/)).toBeVisible({ timeout: 15_000 });
    });

    test('a failed SSO attempt leaves no SSO mark on the local sign-in that follows', async ({ page }) => {
        // The 403 above tells the user to sign in another way, and the obvious
        // move is break-glass local sign-in IN THIS TAB. If the failed attempt
        // recorded an SSO session anyway, that local session — which really does
        // have a password — would be denied its Change Password control. Nothing
        // clears such a mark either: clearSsoSession only runs on a logout or
        // expiry drop, and neither happens when no session was ever created.
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 403 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText(/no permissions on this engine/)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBeNull();

        // Same tab, no reload: sign in locally and keep the password affordance.
        // (The 403 branch reports the error but leaves the card in SSO mode, so
        // the break-glass switch is an explicit click — as in the test above.)
        await page.getByRole('button', { name: 'Use local sign-in' }).click();
        await page.getByPlaceholder('admin').fill('admin');
        await page.locator('input[type=password]').fill('admin');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Change Password' })).toBeVisible();
    });

    test('an SSO primary hands off to the engine MFA plugin and completes', async ({ page }) => {
        // Swing's ExtendedLoginStatus composition, over SSO: the engine accepts the
        // ID token as the FIRST factor and answers a non-success status naming a
        // client MFA plugin. The BFF relays clientPluginClass + the opaque
        // challenge through the result cookie, and the login card hands off to the
        // registered authenticator exactly as it would after a password primary.
        // Only the first leg is server-side; the second runs from the browser.
        // Sized and shaped like the reference plugin's real enrolment challenge —
        // mode + a signed challenge token + secret + otpauth URI — because this is
        // the only path where the challenge rides a COOKIE, and the message cap
        // there is the thing most likely to break it. A long issuer plus the
        // email-shaped username an IdP hands out clears 600 characters on nothing
        // exotic; an undersized fixture would never notice.
        const challenge = `${'c'.repeat(250)}.${Date.now()}.${'s'.repeat(43)}`;
        const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
        const account = 'jane.doe.with.a.long.name@enterprise.example.test';
        // enrol, not verify: secret + otpauthUri only ever appear in the enrolment
        // message, so labelling this 'verify' would be a shape the plugin cannot
        // produce. It is also the realistic case — a JIT-provisioned SSO user is
        // enrolling on first login — and it is the large payload, which is what
        // makes the cookie's message cap matter here at all.
        const message = JSON.stringify({
            mode: 'enroll',
            challenge,
            secret,
            otpauthUri: `otpauth://totp/${encodeURIComponent('Open Integration Engine Production Cluster')}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent('Open Integration Engine Production Cluster')}`
        });
        expect(message.length).toBeGreaterThan(600);   // the fixture must actually exercise the cap
        // 401, as the engine really answers: UserServlet throws UNAUTHORIZED for
        // any non-SUCCESS LoginStatus, ExtendedLoginStatus included. The BFF must
        // read the BODY rather than trusting the status.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.ExtendedLoginStatus': {
            status: 'FAIL',
            clientPluginClass: 'builtin:otp',
            updatedUsername: 'jdoe',
            message
        } } };

        let secondLeg: { data: string | null; body: string } | null = null;
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 }),
            'POST /users/_login': (req: any) => {
                secondLeg = { data: req.headers()['x-mirth-login-data'] ?? null, body: req.postData() || '' };
                authed = true;
                return { 'com.mirth.connect.model.LoginStatus': { status: 'SUCCESS', message: '' } };
            }
        });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        // The second factor is demanded, not skipped, and the enrolment material
        // arrived whole — the grouped secret is rendered from the same challenge
        // JSON that would be unparseable if the cookie had clipped it.
        await expect(page.getByText('Set up two-factor authentication')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(secret.replace(/(.{4})/g, '$1 ').trim())).toBeVisible();
        await page.locator('input[inputmode="numeric"]').fill('123456');
        await page.getByRole('button', { name: 'Activate' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        // The first leg really was the SSO hand-off, so this is a composition and
        // not two unrelated logins that happen to succeed.
        expect(String(received.login!.get('password'))).toMatch(/^oidc:/);
        // The second leg carried the factor in the header the engine reads, with
        // the challenge echoed back INTACT — the cookie cap must not have clipped
        // it — and no password.
        expect(secondLeg).not.toBeNull();
        const relayed = JSON.parse(Buffer.from(secondLeg!.data!, 'base64').toString('utf8'));
        expect(relayed).toEqual({ challenge, code: '123456' });
        // …and it signed in as the username the PRIMARY status returned, which is
        // the engine's say on identity, not anything the browser chose.
        expect(new URLSearchParams(secondLeg!.body).get('username')).toBe('jdoe');

        // A second factor does not make the session any less an SSO session: it
        // must still be marked, or the account menu offers an SSO user a Change
        // Password that writes a credential SSO never consults.
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).not.toBeNull();
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Change Password' })).toHaveCount(0);
    });

    test('an MFA challenge is not swallowed when the tab already holds a session', async ({ page }) => {
        // The shell's boot effect consumes the result cookie before LoginForm
        // mounts, and it only acts on SUCCESS. A live session at that moment used
        // to mean the challenge was read, discarded, and the shell rendered as if
        // the attempt had simply worked — the second factor silently never asked
        // for. Here `current` succeeds throughout, which is exactly that race.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.ExtendedLoginStatus': {
            status: 'FAIL',
            clientPluginClass: 'builtin:otp',
            updatedUsername: 'jdoe',
            message: JSON.stringify({ mode: 'verify', challenge: 'c' })
        } } };
        // A session that appears DURING the round trip — another tab signing in,
        // say. Not signed in when the card renders, signed in by the time the
        // callback lands, which is the window the shell's boot effect sees.
        let sessionExists = false;
        await mockEngine(page, {
            'GET /users/current': () => (sessionExists ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 })
        });
        await page.goto(appUrl + '/');
        // The stub's _login is the callback's server-side first leg, so this fires
        // mid-flight, exactly between the card rendering and the redirect back.
        onEngineLogin = () => { sessionExists = true; };
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        // The factor is demanded rather than skipped past into the shell.
        await expect(page.getByText('Two-factor authentication')).toBeVisible({ timeout: 15_000 });
    });

    test('an engine REFUSAL is not swallowed when the tab already holds a session', async ({ page }) => {
        // The same swallow as the test above, through the door that was left open:
        // the shell's guard checked for clientPluginClass, so it caught a second
        // factor and let a plain refusal through. That is the worse case of the
        // two. Someone whose access was revoked at the IdP signs in, the ENGINE
        // turns them away, and because this tab still holds yesterday's session
        // they land in a working admin UI with no message — the revocation
        // silently undone by a stale cookie.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.LoginStatus': {
            status: 'FAIL',
            message: 'SSO sign-in was rejected.'
        } } };
        let sessionExists = false;
        await mockEngine(page, {
            'GET /users/current': () => (sessionExists ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 })
        });
        await page.goto(appUrl + '/');
        onEngineLogin = () => { sessionExists = true; };
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        // The refusal is reported, and the shell is NOT rendered on the old session.
        await expect(page.getByText('SSO sign-in was rejected.')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.shell')).toHaveCount(0);
        // Break-glass stays reachable, as on every other failure path.
        await expect(page.locator('input[type=password]')).toBeVisible();
    });

    test('a refusal that names only a status still explains itself', async ({ page }) => {
        // The SSO path read result.message and nothing else, so a status carrying
        // no message — a locked-out account, an expired password, a version
        // mismatch — reported "SSO sign-in failed" and sent the user back to the
        // IdP, which will keep on succeeding: the rejection is the engine's. The
        // password path has always named these; both now use the same table.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.LoginStatus': { status: 'FAIL_LOCKED_OUT' } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        await expect(page.getByText('Account locked out. Try again later.')).toBeVisible({ timeout: 15_000 });
    });

    test('cancelling the second factor leaves local sign-in reachable', async ({ page }) => {
        // A dismissed MFA prompt must not strand the user on a blank card: the
        // authenticator resolves a FAIL, which the card reports inline.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.ExtendedLoginStatus': {
            status: 'FAIL',
            clientPluginClass: 'builtin:otp',
            updatedUsername: 'jdoe',
            message: JSON.stringify({ mode: 'verify', challenge: 'c' })
        } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        await expect(page.getByText('Two-factor authentication')).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByText('Cancelled.')).toBeVisible({ timeout: 15_000 });
        // Deliberately still in SSO mode, unlike an IdP rejection (which calls
        // chooseLocal(true)): abandoning the second factor is not a reason to give
        // up on SSO, so the provider button stays primary and the retry is one
        // click. The break-glass path stays reachable behind the toggle.
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        await expect(page.locator('input[type=password]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Use local sign-in' })).toBeVisible();
    });

    test('an SSO primary naming an MFA method this client lacks says so', async ({ page }) => {
        // Registration is bundled and pre-login (an engine-served plugin cannot
        // provide MFA — it needs the session it is meant to grant), so an engine
        // configured with a method the web client does not ship must fail with an
        // explanation rather than a generic rejection.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.ExtendedLoginStatus': {
            status: 'FAIL',
            clientPluginClass: 'com.example.WebAuthnClientPlugin',
            updatedUsername: 'jdoe',
            message: '{}'
        } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();

        // The whole message, including the remediation — asserting only the shared
        // prefix would pass while the SSO branch silently dropped the advice, and
        // this is the path where the user has no local password to fall back on.
        await expect(page.getByText('This engine requires a multi-factor login method that is not available in the web administrator. '
            + 'Use the desktop Administrator, or install the matching web login plugin.')).toBeVisible({ timeout: 15_000 });
    });

    test('a retry after a rejected attempt forces IdP re-authentication', async ({ page }) => {
        // The IdP's own SSO session silently replays the same account; after a
        // rejection the retry must carry prompt=login so the user can switch.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.LoginStatus': { status: 'FAIL', message: 'SSO sign-in was rejected.' } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('SSO sign-in was rejected.')).toBeVisible({ timeout: 15_000 });
        expect(received.authorize!.get('prompt')).toBeNull();

        // The failure dropped the card into local mode; go back to SSO and retry.
        await page.getByRole('button', { name: 'Sign in with SSO' }).click();
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('SSO sign-in was rejected.')).toBeVisible({ timeout: 15_000 });
        expect(received.authorize!.get('prompt')).toBe('login');
    });

    test('an engine without the OIDC extension yields the install hint', async ({ page }) => {
        // The plugin absent, local auth answers its real rejection wording.
        loginStatus = { status: 401, body: { 'com.mirth.connect.model.LoginStatus': { status: 'FAIL', message: 'Incorrect username or password.' } } };
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.goto(appUrl + '/');

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText(/OIDC Authentication extension is installed/)).toBeVisible({ timeout: 15_000 });
    });

    test('an SSO session arms no spurious reload for the next sign-in', async ({ page }) => {
        // Plugins are discovered once per page load and recorded against the
        // engine they came from; login.tsx hard-reloads when the next sign-in
        // targets a different one. The SSO callback decides the routing cookie
        // server-side, so what the shell records here has to equal what the login
        // card will later compute — otherwise EVERY SSO sign-in is followed by a
        // needless full reload. Single-engine: both must be ''. This guards the
        // callback's `routable` predicate; the client clears the cookie before
        // /oidc/start, so it does not also cover the server's own clear.
        await mockEngine(page, {
            'GET /users/current': (req: any) => (String(req.headers()['cookie'] || '').includes('JSESSIONID=e2e-engine-session')
                ? { user: { id: 1, username: 'jdoe' } } : { __status: 401 }),
        });
        await page.goto(appUrl + '/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        // Polled: startEngine() writes this at the END of its effect, after
        // loadPlugins() resolves — a visible .shell does not imply the write.
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-engine'))).toBe('');
        // …and the callback left no routing cookie behind to contradict it.
        const routing = (await page.context().cookies()).find((c) => c.name === 'oie-engine');
        expect(routing?.value ?? '').toBe('');
    });

    // Single-engine mode has no picker, so an unresolvable remembered choice must
    // not blank the selection the way it does behind a picker: with sel:'' the
    // engine never resolves and the SSO affordance vanishes entirely. `0` is
    // exactly what the pre-key build's callback wrote, and an SSO-only account
    // has no local sign-in to clear it with — the login card would be a dead end.
    for (const stale of ['0', 'k%3Aremoved']) {
        test(`a stale oie-engine cookie (${stale}) does not strand single-engine SSO`, async ({ page }) => {
            await page.context().addCookies([{ name: 'oie-engine', value: stale, url: appUrl }]);
            await mockEngine(page, { 'GET /users/current': { __status: 401 } });
            await page.goto(appUrl + '/');

            await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
            await expect(page.locator('input[type=password]')).toHaveCount(0);
        });
    }
});
