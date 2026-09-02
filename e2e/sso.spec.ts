import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

/*
 * OIDC sign-in with the flow in the ENGINE (the oie-oidc-auth extension).
 *
 * The login card asks the extension's pre-auth /public endpoint whether the
 * selected engine offers SSO, posts /start for the provider URL, is sent back to
 * /oidc/callback, posts the code and state to /callback for a one-time ticket,
 * and redeems the ticket through the ordinary /users/_login — so the session,
 * the audit event, and any second factor are exactly what a password gets.
 *
 * Everything the browser touches is mocked in the browser, in the engine's wire
 * shapes: String-returning extension servlets arrive as {"string": "<json>"},
 * and the login answers as a LoginStatus under its XStream root key. The
 * provider is a route on a foreign origin that just sends the browser back.
 * There is no web-tier server code to exercise any more; that is the point.
 */

const IDP = 'https://idp.test';
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
};

async function mockSso(page: any, baseURL: string, knobs: Knobs = {}) {
    const received: any = { start: null, callback: null, logins: [] as any[] };
    let authed = false;
    await mockEngine(page, {
        'GET /extensions/oidcauth/public': knobs.configured === false
            ? { __status: 404 }
            : envelope({ configured: true, discoveryUrl: `${IDP}/.well-known/openid-configuration`, clientId: 'web-admin', providerLabel: 'Acme SSO', autoRedirect: false }),
        'POST /extensions/oidcauth/start': (req: any) => {
            received.start = JSON.parse(JSON.parse(req.postData() || '{}').string);
            return envelope(knobs.start || { ok: true, authorizeUrl: `${IDP}/authorize?client_id=web-admin&state=state-1&nonce=n` });
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
    // The provider. It never sees the secret or the verifier; it echoes the state
    // and hands back a code — or a refusal.
    await page.route(`${IDP}/**`, (route: any) => {
        const url = new URL(route.request().url());
        const back = new URL('/oidc/callback', baseURL);
        if (knobs.provider === 'denied') back.searchParams.set('error', 'access_denied');
        else back.searchParams.set('code', 'code-1');
        back.searchParams.set('state', url.searchParams.get('state') || '');
        route.fulfill({ status: 302, headers: { location: back.toString() } });
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
        expect(new URL(page.url()).search).toBe('');
        expect(new URL(page.url()).pathname).toMatch(/\/dashboard$/);
        expect(await page.evaluate(() => sessionStorage.getItem('oie-sso-session'))).toBe('1');
        await expect(page.locator('.statusbar')).toContainText('as jdoe');
    });

    test('comes back to the route it left from', async ({ page, baseURL }) => {
        const received = await mockSso(page, baseURL!);
        await page.goto('/channels');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(received.start.return).toBe('/channels');
        expect(new URL(page.url()).pathname).toMatch(/\/channels$/);
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
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.getByText('The identity provider declined sign-in.')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('input[type=password]')).toBeVisible();
        expect(received.callback).toBeNull();   // nothing to exchange, so nothing was sent
    });

    test("the engine's refusal to complete the exchange is explained", async ({ page, baseURL }) => {
        await mockSso(page, baseURL!, { callback: { ok: false, message: 'SSO sign-in could not be completed. Try again, or use local sign-in.' } });
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
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

    test('with several engines, the flow is routed to the one selected', async ({ page, baseURL }) => {
        await page.route('**/webadmin/config.json', (route: any) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ engines: [{ key: 'k:production', name: 'Production' }, { key: 'k:staging', name: 'Staging' }], devMode: false })
        }));
        const received = await mockSso(page, baseURL!);
        const cookiesSeen: string[] = [];
        await page.route('**/api/extensions/oidcauth/start', (route: any) => { cookiesSeen.push(route.request().headers()['cookie'] || ''); route.fallback(); });
        await page.goto('/');
        await page.locator('select').selectOption('k:staging');
        await page.getByRole('button', { name: 'Sign in with Acme SSO' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        // The routing cookie carried the picker's choice, so the proxy asked Staging.
        expect(cookiesSeen[0]).toContain('oie-engine=k%3Astaging');
        expect(received.logins[0].password).toBe('oidc:ticket:ticket-1');
    });
});
