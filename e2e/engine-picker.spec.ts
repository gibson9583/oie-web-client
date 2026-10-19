import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

/*
 * Multi-engine login picker. The engine list comes from /webadmin/config.json
 * (served by the node server, NOT the /api mock), so each test routes that URL
 * to supply the engines / devMode it wants. The picker only affects which engine
 * the proxy targets (an oie-engine cookie) — here we assert the UI shape and that
 * the cookie is written before login.
 */

function routeConfig(page: any, config: any) {
    return page.route('**/webadmin/config.json', (route: any) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) }));
}

const TWO_ENGINES = {
    engines: [
        { key: 'k:production', name: 'Production' },
        { key: 'k:staging', name: 'Staging' },
    ],
    devMode: false,
    version: '0.1.0',
};

test.describe('engine picker', () => {
    test('multiple engines show a dropdown by name', async ({ page }) => {
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

        const select = page.locator('.login-card select');
        await expect(select).toBeVisible();
        await expect(select.locator('option')).toHaveText(['Production', 'Staging']);
        // No devMode → no manual URL escape hatch.
        await expect(page.getByText('Custom URL…')).toHaveCount(0);
    });

    test('picker remembers the last selected engine', async ({ page, baseURL }) => {
        // The prior choice persists in the oie-engine cookie (the engine's stable
        // key, not its list position); the picker preselects it instead of
        // snapping back to the first engine.
        await page.context().addCookies([{ name: 'oie-engine', value: 'k%3Astaging', url: baseURL }]);
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await expect(page.locator('.login-card select')).toHaveValue('k:staging');
    });

    test('a remembered engine that was removed forces an explicit choice (issue #53)', async ({ page, baseURL }) => {
        // The saved key no longer matches any engine — the picker must NOT guess
        // (the old positional cookie silently landed on the first entry). It shows
        // a placeholder and refuses to sign in until an engine is chosen.
        await page.context().addCookies([{ name: 'oie-engine', value: 'k%3Aremoved', url: baseURL }]);
        await routeConfig(page, TWO_ENGINES);
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        const select = page.locator('.login-card select');
        await expect(select).toHaveValue('');
        await expect(select.locator('option').first()).toHaveText('Select an engine…');

        await login(page, 'admin', 'admin');
        await expect(page.locator('.login-error')).toHaveText('Choose an engine.');

        // Picking a real engine replaces the placeholder and unblocks sign-in.
        await select.selectOption('k:production');
        await expect(select.locator('option')).toHaveText(['Production', 'Staging']);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    });

    test('single engine hides the picker (just user/password)', async ({ page }) => {
        await routeConfig(page, { engines: [{ key: 'k:only', name: 'Only' }], devMode: false });
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await expect(page.locator('.login-card select')).toHaveCount(0);
    });

    test('devMode offers a Custom URL option that reveals a URL field', async ({ page }) => {
        await routeConfig(page, { engines: [{ key: 'k:prod', name: 'Prod' }], devMode: true });
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

        const select = page.locator('.login-card select');
        await expect(select).toBeVisible();
        await expect(page.getByPlaceholder('https://host:8443')).toHaveCount(0);
        await select.selectOption('custom');
        await expect(page.getByPlaceholder('https://host:8443')).toBeVisible();

        // A scheme-less URL is refused here with a usable message — the proxy
        // could only answer it with a generic ENGINE_UNKNOWN refusal.
        await page.getByPlaceholder('https://host:8443').fill('localhost:8443');
        await login(page, 'admin', 'admin');
        await expect(page.locator('.login-error')).toHaveText('Enter a full engine URL, e.g. https://host:8443.');
    });

    test('a mid-session ENGINE_UNKNOWN refusal drops the tab to the login screen', async ({ page }) => {
        // The engine this session rode was removed from allowedUrls (server now
        // answers 421) — the tab must land back on the login screen with a
        // reason, not error-storm in place (issue #53).
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page);   // signed in, boots into the shell

        await page.goto('/');
        // The shell appears before authorization discovery completes. Wait for
        // dashboard data so this refusal exercises an established session.
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        // From now on the server refuses to route ANY /api call for this tab
        // (registered after mockEngine, so it takes precedence). The shell's
        // background polling hits it on its own — no user action required.
        await page.route('**/api/**', (route) => route.fulfill({
            status: 421,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ENGINE_UNKNOWN', message: 'The selected engine is no longer available on this server. Choose an engine and sign in again.' }),
        }));

        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.login-notice')).toHaveText('The engine you were signed in to is no longer available — choose an engine and sign in again.');
    });

    test('an ENGINE_UNKNOWN refusal during authorization bootstrap fails closed and Reload restores engine selection', async ({ page, baseURL }) => {
        await page.context().addCookies([{ name: 'oie-engine', value: 'k%3Aproduction', url: baseURL }]);
        let config = TWO_ENGINES;
        await page.route('**/webadmin/config.json', route => route.fulfill({ json: config }));
        await mockEngine(page);
        const refusal = {
            status: 421,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'ENGINE_UNKNOWN', message: 'The selected engine is no longer available on this server. Choose an engine and sign in again.' }),
        };
        await page.route('**/api/webplugins', route => route.fulfill(refusal));

        await page.goto('/');
        await expect(page.getByRole('alert').filter({ hasText: 'Unable to load access controls' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
        await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);

        // A removed engine remains refused after reload; an explicitly chosen
        // available engine can authenticate and finish loading the dashboard.
        config = { ...TWO_ENGINES, engines: [
            { key: 'k:staging', name: 'Staging' },
            { key: 'k:test', name: 'Test' },
        ] };
        await page.unroute('**/api/webplugins');
        await page.route('**/api/**', async route => {
            const cookie = (await route.request().allHeaders())['cookie'] || '';
            return /(?:^|;\s*)oie-engine=k%3Astaging(?:;|$)/.test(cookie)
                ? route.fallback()
                : route.fulfill(refusal);
        });
        await page.getByRole('button', { name: 'Reload', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 15_000 });
        const select = page.locator('.login-card select');
        await expect(select).toHaveValue('');
        await expect(select.locator('option')).toHaveText(['Select an engine…', 'Staging', 'Test']);
        await select.selectOption('k:staging');
        await login(page, 'admin', 'admin');
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        const cookies = await page.context().cookies();
        expect(decodeURIComponent(cookies.find(cookie => cookie.name === 'oie-engine')?.value ?? '')).toBe('k:staging');
    });

    test('account menu offers Switch Engine when more than one engine', async ({ page }) => {
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page);   // defaults: current → signed in, boots into the shell

        await page.goto('/');
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Switch Engine' })).toBeVisible();
    });

    test('account menu hides Switch Engine with a single engine', async ({ page }) => {
        await routeConfig(page, { engines: [{ key: 'k:only', name: 'Only' }], devMode: false });
        await mockEngine(page);

        await page.goto('/');
        await page.locator('button.user-chip').click();
        await expect(page.getByRole('menu')).toBeVisible();
        await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Switch Engine' })).toHaveCount(0);
    });

    test('re-login to a different engine forces a full reload (no stale plugins)', async ({ page }) => {
        await routeConfig(page, TWO_ENGINES);
        let authed = true;   // boots straight into the shell on engine 0
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'POST /users/_logout': () => { authed = false; return {}; },
        });

        await page.goto('/');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        // No cookie yet, so plugins were discovered against the server default —
        // the first engine, recorded under its key so a later sign-in that keeps
        // the preselected first engine reads as "same engine" (soft path).
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-engine'))).toBe('k:production');

        // A sentinel that a full page reload wipes but a soft (in-page) transition keeps.
        await page.evaluate(() => { (window as any).__survivedReload = true; });

        // Soft sign-out → back to the login screen (no reload yet).
        await page.locator('button.user-chip').click();
        await page.getByRole('menu').getByRole('menuitem', { name: 'Sign out' }).click();
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        expect(await page.evaluate(() => (window as any).__survivedReload)).toBe(true);

        // Pick the OTHER engine and sign in → the engine changed, so a hard reload runs.
        await page.locator('.login-card select').selectOption('k:staging');
        await login(page, 'admin', 'admin');

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => (window as any).__survivedReload)).toBeUndefined();   // reload cleared it
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-engine'))).toBe('k:staging');
    });

    test('selecting an engine writes the oie-engine cookie on login', async ({ page }) => {
        await routeConfig(page, TWO_ENGINES);
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await page.locator('.login-card select').selectOption('k:staging');
        await login(page, 'admin', 'admin');

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        const cookies = await page.context().cookies();
        const sel = cookies.find((c) => c.name === 'oie-engine');
        expect(decodeURIComponent(sel?.value ?? '')).toBe('k:staging');   // the engine's key, not its position
    });
});
