import { test, expect } from '@playwright/test';
import { mockEngine, login } from './mock.js';

/*
 * Multi-engine login picker. The engine list comes from /webadmin/config.json
 * (served by the node server, NOT the /api mock), so each test routes that URL
 * to supply the engines / devMode it wants. The picker only affects which engine
 * the proxy targets (an oie-engine cookie) — here we assert the UI shape and that
 * the cookie is written before login.
 */

function routeConfig(page, config) {
    return page.route('**/webadmin/config.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) }));
}

const TWO_ENGINES = {
    engines: [
        { name: 'Production', url: 'https://prod:8443' },
        { name: 'Staging', url: 'https://stage:8443' },
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
        // The prior choice persists in the oie-engine cookie; the picker preselects it
        // instead of snapping back to the first engine.
        await page.context().addCookies([{ name: 'oie-engine', value: '1', url: baseURL }]);
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await expect(page.locator('.login-card select')).toHaveValue('1');
    });

    test('single engine hides the picker (just user/password)', async ({ page }) => {
        await routeConfig(page, { engines: [{ name: 'Only', url: 'https://only:8443' }], devMode: false });
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await expect(page.locator('.login-card select')).toHaveCount(0);
    });

    test('devMode offers a Custom URL option that reveals a URL field', async ({ page }) => {
        await routeConfig(page, { engines: [{ name: 'Prod', url: 'https://prod:8443' }], devMode: true });
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

        const select = page.locator('.login-card select');
        await expect(select).toBeVisible();
        await expect(page.getByPlaceholder('https://host:8443')).toHaveCount(0);
        await select.selectOption('custom');
        await expect(page.getByPlaceholder('https://host:8443')).toBeVisible();
    });

    test('account menu offers Switch Engine when more than one engine', async ({ page }) => {
        await routeConfig(page, TWO_ENGINES);
        await mockEngine(page);   // defaults: current → signed in, boots into the shell

        await page.goto('/');
        await page.locator('button.user-chip').click();
        await expect(page.locator('.ctx-menu').getByRole('button', { name: 'Switch Engine' })).toBeVisible();
    });

    test('account menu hides Switch Engine with a single engine', async ({ page }) => {
        await routeConfig(page, { engines: [{ name: 'Only', url: 'https://only:8443' }], devMode: false });
        await mockEngine(page);

        await page.goto('/');
        await page.locator('button.user-chip').click();
        await expect(page.locator('.ctx-menu')).toBeVisible();
        await expect(page.locator('.ctx-menu').getByRole('button', { name: 'Switch Engine' })).toHaveCount(0);
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
        // Plugins were discovered against engine 0.
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-engine'))).toBe('0');

        // A sentinel that a full page reload wipes but a soft (in-page) transition keeps.
        await page.evaluate(() => { window.__survivedReload = true; });

        // Soft sign-out → back to the login screen (no reload yet).
        await page.locator('button.user-chip').click();
        await page.locator('.ctx-menu').getByRole('button', { name: 'Sign out' }).click();
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        expect(await page.evaluate(() => window.__survivedReload)).toBe(true);

        // Pick the OTHER engine and sign in → the engine changed, so a hard reload runs.
        await page.locator('.login-card select').selectOption('1');
        await login(page, 'admin', 'admin');

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.__survivedReload)).toBeUndefined();   // reload cleared it
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-engine'))).toBe('1');
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
        await page.locator('.login-card select').selectOption('1');   // Staging (index 1)
        await login(page, 'admin', 'admin');

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        const cookies = await page.context().cookies();
        const sel = cookies.find((c) => c.name === 'oie-engine');
        expect(sel?.value).toBe('1');
    });
});
