import { test, expect } from './base.js';
import type { Page } from '@playwright/test';
import { mockEngine, login } from './mock.js';
import { listen, startWebAdmin } from './server-harness.js';

/*
 * OIDC sign-in with the flow in the ENGINE (the oie-oidc-auth extension).
 *
 * The login card asks the extension's pre-auth /public endpoint whether the
 * selected engine offers SSO, posts /start for the provider URL, is sent back to
 * /oidc/callback, posts the code and state to /callback for a one-time ticket,
 * and redeems the ticket through the ordinary /users/_login — so the session,
 * the audit event, and any second factor are exactly what a password gets.
 *
 * Engine endpoints are mocked in the browser, in the engine's wire
 * shapes: String-returning extension servlets arrive as {"string": "<json>"},
 * and the login answers as a LoginStatus under its XStream root key. The
 * provider is an owned loopback server on a separate origin. Its real HTTP
 * redirect works across browser engines, including WebKit (which cannot
 * fulfill an intercepted navigation with a synthetic 302).
 */

const providers = new WeakMap<object, any>();
test.afterEach(async ({ page }) => {
    const server = providers.get(page);
    if (server) {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        providers.delete(page);
    }
});

test.describe('authentication mode after interrupted SSO setup', () => {
    const welcome = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Open Integration Engine', exact: true });

    async function mockHandoff(page: Page, multiEngine = false) {
        const state = {
            user: null as { id: number; username: string } | null,
            requireWelcome: true,
            notifySso: false,
            logouts: 0,
            setupWrites: 0,
            rejectLocal: false,
        };
        await mockEngine(page, {
            'GET /users/current': () => state.user ? { user: state.user } : { __status: 401 },
            'POST /extensions/oidcauth/callback': envelope({ ok: true, ticket: 'handoff-ticket', returnPath: '/' }),
            'POST /users/_login': (request: any) => {
                const username = new URLSearchParams(request.postData() || '').get('username') || '';
                if (username !== 'oidc' && state.rejectLocal) return loginStatus('FAIL');
                state.user = username === 'oidc' ? { id: 1, username: 'sso-user' } : { id: 2, username };
                return loginStatus('SUCCESS');
            },
            'POST /users/_logout': () => { state.user = null; state.logouts++; return ''; },
            'GET /users/*/preferences/firstlogin': () => String(state.requireWelcome),
            'GET /server/publicSettings': () => ({ publicServerSettings: {
                loginNotificationEnabled: state.notifySso && state.user?.username === 'sso-user',
                loginNotificationMessage: 'Accept this login notification.',
            } }),
            'GET /handoff-expiry': () => { state.user = null; return { __status: 401 }; },
            'PUT /users/*/password': () => { state.setupWrites++; return ''; },
            'PUT /users/*': () => { state.setupWrites++; return ''; },
            'PUT /users/*/preferences/firstlogin': () => { state.setupWrites++; return ''; },
        });
        if (multiEngine) await page.route('**/webadmin/config.json', route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ engines: [{ key: 'k:first', name: 'First' }, { key: 'k:second', name: 'Second' }] }),
        }));
        return state;
    }

    for (const branch of ['soft login', 'permission reload', 'engine reload']) {
        test(`local login replaces expired SSO mode through ${branch}`, async ({ page }) => {
            const state = await mockHandoff(page, branch === 'engine reload');
            if (branch !== 'soft login') {
                // Let a real shell load plugins and record its engine/user. These
                // markers force the next sign-in through the actual reload paths.
                state.requireWelcome = false;
                await page.goto('/');
                await login(page, 'previous-user');
                await expect(page.locator('.statusbar')).toContainText('as previous-user');
                await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('previous-user');
                await page.getByRole('button', { name: 'Logout', exact: true }).click();
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
                state.requireWelcome = true;
            }
            // Exercise callback redemption and the real SSO mode assignment.
            await page.goto('/oidc/callback?code=handoff-code&state=handoff-state');
            await expect(welcome(page)).toBeVisible();
            expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
            await page.evaluate(async () => {
                const api = await import('@oie/web-api');
                await api.default.get('/handoff-expiry').catch(() => {});
            });
            await expect(welcome(page)).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
            if (branch === 'engine reload') await page.locator('select').selectOption('k:second');
            await page.evaluate(() => { (window as any).authModeDocument = true; });
            const logoutsBeforeCancel = state.logouts;
            await login(page, 'local-admin', 'temporary');
            await expect(welcome(page)).toBeVisible();
            expect(await page.evaluate(() => !!(window as any).authModeDocument)).toBe(branch === 'soft login');
            expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBeNull();
            await page.keyboard.press('Escape');
            await expect(page.getByText('Sign-in canceled — set a new password to continue.')).toBeVisible();
            await expect(page.locator('.shell')).toHaveCount(0);
            expect(state.logouts).toBe(logoutsBeforeCancel + 1);
            expect(state.setupWrites).toBe(0);

            // A returning local account also regains its password affordance.
            state.requireWelcome = false;
            await login(page, 'local-admin', 'temporary');
            await expect(page.locator('.statusbar')).toContainText('as local-admin');
            await page.locator('button.user-chip').click();
            await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Change Password', exact: true })).toBeVisible();
        });
    }

    test('local login replaces SSO mode after declining the login notification', async ({ page }) => {
        const state = await mockHandoff(page);
        state.notifySso = true;
        await page.goto('/oidc/callback?code=handoff-code&state=handoff-state');
        const notification = page.getByRole('dialog', { name: 'Login Notification', exact: true });
        await expect(notification).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
        await notification.getByRole('button', { name: 'I Decline', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
        await login(page, 'local-admin', 'temporary');
        await expect(welcome(page)).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBeNull();
        await page.keyboard.press('Escape');
        await expect(page.getByText('Sign-in canceled — set a new password to continue.')).toBeVisible();
        await expect(page.locator('.shell')).toHaveCount(0);
        expect(state.logouts).toBe(2);
        expect(state.setupWrites).toBe(0);
    });

    test('an authenticated SSO account retains its Welcome exemption', async ({ page }) => {
        const state = await mockHandoff(page);
        await page.goto('/oidc/callback?code=handoff-code&state=handoff-state');
        await expect(welcome(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.statusbar')).toContainText('as sso-user');
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Change Password', exact: true })).toHaveCount(0);
        expect(state.logouts).toBe(0);
        expect(state.setupWrites).toBe(0);
    });

    test('failed local credentials do not replace an authenticated SSO mode', async ({ page }) => {
        const state = await mockHandoff(page);
        await page.goto('/oidc/callback?code=handoff-code&state=handoff-state');
        await expect(welcome(page)).toBeVisible();
        await page.evaluate(async () => {
            const api = await import('@oie/web-api');
            await api.default.get('/handoff-expiry').catch(() => {});
        });
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
        state.rejectLocal = true;
        await login(page, 'local-admin', 'wrong-password');
        await expect(page.getByText('Invalid username or password.')).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
        await expect(page.locator('.shell')).toHaveCount(0);
        expect(state.setupWrites).toBe(0);
    });
});
const envelope = (body: unknown) => ({ string: JSON.stringify(body) });
const loginStatus = (status: string, extra: Record<string, unknown> = {}) =>
    ({ 'com.mirth.connect.model.LoginStatus': { status, message: '', ...extra } });

type Knobs = {
    configured?: boolean;
    start?: unknown;
    callback?: unknown;
    login?: unknown;
    currentAfterLogin?: unknown;
    provider?: 'ok' | 'denied';
    /** The engine's policy sends visitors straight to the provider. */
    autoRedirect?: boolean;
    /** The tab already holds an engine session when the page loads. */
    signedIn?: boolean;
};

async function mockSso(page: any, baseURL: string, knobs: Knobs = {}) {
    const received: any = { start: null, callback: null, logins: [] as any[] };
    const provider = await listen(async (req, res) => {
        if (received.beforeRedirect) await received.beforeRedirect();
        const url = new URL(req.url || '/', 'http://provider');
        const back = new URL('/oidc/callback', baseURL);
        if (knobs.provider === 'denied') back.searchParams.set('error', 'access_denied');
        else back.searchParams.set('code', 'code-1');
        back.searchParams.set('state', url.searchParams.get('state') || '');
        res.writeHead(302, { location: received.callbackUrl || back.toString() });
        res.end();
    });
    providers.set(page, provider.server);
    received.providerUrl = provider.url;
    let authed = !!knobs.signedIn;
    await mockEngine(page, {
        'GET /extensions/oidcauth/public': knobs.configured === false
            ? { __status: 404 }
            : envelope({ configured: true, providerLabel: 'Acme SSO', autoRedirect: !!knobs.autoRedirect }),
        'POST /users/_logout': () => { authed = false; return ''; },
        'POST /extensions/oidcauth/start': (req: any) => {
            received.start = JSON.parse(JSON.parse(req.postData() || '{}').string);
            return envelope(knobs.start || { ok: true, authorizeUrl: `${provider.url}/authorize?client_id=web-admin&state=state-1&nonce=n` });
        },
        'POST /extensions/oidcauth/callback': (req: any) => {
            received.callback = JSON.parse(JSON.parse(req.postData() || '{}').string);
            return envelope(knobs.callback || { ok: true, ticket: 'ticket-1', returnPath: received.start?.return || '/' });
        },
        'POST /users/_login': (req: any) => {
            received.logins.push(Object.fromEntries(new URLSearchParams(req.postData() || '')));
            authed = true;
            return knobs.login || loginStatus('SUCCESS', { updatedUsername: 'jdoe' });
        },
        'GET /users/current': () => (authed ? (knobs.currentAfterLogin || { user: { id: 1, username: 'jdoe' } }) : { __status: 401 }),
    });
    return received;
}

test.describe('SSO through the engine', () => {
    test('takes over the login card and completes the code flow to the dashboard', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!);
        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        await expect(page.locator('input[type=password]')).toHaveCount(0);

        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        // Each step carried exactly what the engine needs and nothing else.
        expect(received.start).toEqual({ return: '/', prompt: '' });
        expect(received.callback).toEqual({ code: 'code-1', state: 'state-1' });
        expect(received.logins).toHaveLength(1);
        expect(received.logins[0].password).toBe('oidc:ticket:ticket-1');   // the ticket IS the credential
        // The provider's code is gone from the address bar, and the session is marked as SSO.
        await expect(page).toHaveURL(/\/dashboard$/);
        expect(new URL(page.url()).search).toBe('');
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
        await expect(page.locator('.statusbar')).toContainText('as jdoe');
    });

    test('comes back to the route it left from', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!);
        await page.goto('/channels');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(received.start.return).toBe('/channels');
        await expect(page).toHaveURL(/\/channels$/);
    });

    test('a callback cannot cross a login change made while the tab was at the provider', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!);
        received.beforeRedirect = async () => {
            await page.context().addCookies([{ name: 'oie-login', value: 'another-tab-login', url: baseURL! }]);
        };
        received.callbackUrl = `${baseURL}/oidc/callback?code=old-code&state=old-state`;
        await page.goto('/');
        const callbackPage = page.waitForURL(/\/oidc\/callback/, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await callbackPage;
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-oidc-context')).catch(() => 'navigating')).toBeNull();
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        expect(received.start).not.toBeNull();
        expect(received.callback).toBeNull();
        expect(received.logins).toEqual([]);
    });

    test('an SSO session is not offered a password to change', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!);
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await page.locator('button.user-chip').click();
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: 'Edit Account' })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Change Password' })).toHaveCount(0);
    });

    test('a provider decline is surfaced inline with local sign-in reachable', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!, { provider: 'denied' });
        await page.goto('/');
        // Measure the error UI after the real cross-origin redirect returns.
        // Under WebKit load, navigation itself can consume the assertion window.
        const returned = page.waitForURL(/\/oidc\/callback\?/, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await returned;
        await expect(page.getByText('The identity provider declined sign-in.')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('input[type=password]')).toBeVisible();
        expect(received.callback).toBeNull();   // nothing to exchange, so nothing was sent
    });

    test("the engine's refusal to complete the exchange is explained", async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { callback: { ok: false, message: 'SSO sign-in could not be completed. Try again, or use local sign-in.' } });
        await page.goto('/');
        const returned = page.waitForURL(/\/oidc\/callback\?/, { waitUntil: 'commit' });
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await returned;
        await expect(page.getByText('SSO sign-in could not be completed. Try again, or use local sign-in.')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('input[type=password]')).toBeVisible();
    });

    test("the engine's refusal at login names its reason even without a message", async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { login: loginStatus('FAIL_LOCKED_OUT') });
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('Account locked out. Try again later.')).toBeVisible({ timeout: 15_000 });
    });

    test('a retry after a rejected attempt forces provider re-authentication', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!, { login: loginStatus('FAIL', { message: 'SSO sign-in was rejected.' }) });
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('SSO sign-in was rejected.')).toBeVisible({ timeout: 15_000 });
        // The card dropped to local mode; go back to SSO and try again.
        await page.getByRole('button', { name: 'Sign in with SSO' }).click();
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect.poll(() => received.start?.prompt).toBe('login');
    });

    test('a roleless account under RBAC gets the missing-permissions explanation', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { currentAfterLogin: { __status: 403 } });
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText(/no permissions on this engine/)).toBeVisible({ timeout: 15_000 });
    });

    test('an SSO primary hands off to the engine MFA plugin', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, {
            login: { 'com.mirth.connect.model.ExtendedLoginStatus': {
                status: 'FAIL', clientPluginClass: 'builtin:otp', updatedUsername: 'jdoe',
                message: JSON.stringify({ mode: 'verify', challenge: 'c' })
            } }
        });
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        // The factor is demanded rather than skipped past into the shell.
        await expect(page.getByText('Two-factor authentication')).toBeVisible({ timeout: 15_000 });
    });

    test('an engine without the extension offers local sign-in only', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { configured: false });
        await page.goto('/');
        await expect(page.locator('input[type=password]')).toBeVisible();
        await expect(page.getByRole('button', { name: /Sign in with/ })).toHaveCount(0);
    });

    test('with several engines, the flow is routed to the one selected', async ({ page }) => {
        const selected: string[] = [];
        let received: any;
        const handler = (engine: string) => async (req: any, res: any) => {
            res.setHeader('Content-Type', 'application/json');
            if (req.url !== '/api/extensions/oidcauth/start') { res.end('{}'); return; }
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            received.start = JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).string);
            selected.push(engine);
            res.end(JSON.stringify(envelope({ ok: true, authorizeUrl: `${received.providerUrl}/authorize?state=state-1` })));
        };
        const production = await listen(handler('production'));
        const staging = await listen(handler('staging'));
        const app = await startWebAdmin({ allowedUrls: [
            { name: 'Production', url: production.url }, { name: 'Staging', url: staging.url },
        ] });
        try {
            received = await mockSso(page, app.url);
            // This request reaches the real Node proxy and chosen upstream;
            // WebKit interception metadata does not expose its routing cookie.
            await page.route('**/api/extensions/oidcauth/start', route => route.continue());
            await page.goto(app.url + '/');
            await page.locator('select').selectOption('k:staging');
            await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
            await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
            expect(selected).toEqual(['staging']);
            expect(received.logins[0].password).toBe('oidc:ticket:ticket-1');
        } finally {
            app.stop();
            production.server.closeAllConnections(); staging.server.closeAllConnections();
            production.server.close(); staging.server.close();
        }
    });

    test('signing out with auto-redirect on shows the card instead of bouncing back to the provider', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!, { autoRedirect: true });
        await page.goto('/');
        // No click: the card sends the browser to the provider by itself.
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(received.logins).toHaveLength(1);

        await page.locator('button.user-chip').click();
        await page.getByRole('menu').getByRole('menuitem', { name: 'Sign out' }).click();
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        // The provider's own session is still alive, so a redirect here would have
        // signed the user straight back in. The card stays, and nothing was redeemed.
        await page.waitForTimeout(750);
        await expect(page.getByRole('button', { name: 'Sign in with Acme SSO' })).toBeVisible();
        expect(received.logins).toHaveLength(1);
    });

    test('a stray error callback does not evict a signed-in user', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { signedIn: true });
        // A link anyone can craft, opened in a tab that never started a sign-in.
        await page.goto('/oidc/callback?error=access_denied');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.statusbar')).toContainText('as jdoe');
        await expect(page).not.toHaveURL(/oidc\/callback/);
        await expect(page.getByText('The identity provider declined sign-in.')).toHaveCount(0);
    });

    test('a declined attempt this tab started is reported even over a live session', async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { signedIn: true });
        await page.goto('/');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        // What /start leaves behind before sending the browser away.
        await page.evaluate(() => sessionStorage.setItem('oie-oidc-pending', '1'));
        await page.goto('/oidc/callback?error=access_denied');
        await expect(page.getByText('The identity provider declined sign-in.')).toBeVisible({ timeout: 15_000 });
    });

    test('a genuine answer reaches the login card over a live session even without the marker', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!, { signedIn: true });
        await page.goto('/oidc/callback?code=code-1&state=state-1');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        // The code was relayed and redeemed: the answer was not thrown away.
        expect(received.callback).toEqual({ code: 'code-1', state: 'state-1' });
        expect(received.logins).toHaveLength(1);
    });
});
