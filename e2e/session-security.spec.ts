import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { listen, startWebAdmin } from './server-harness.js';

// Only the logout goes through the real proxy. The rest of the UI uses normal
// fixtures, so the test can assert which backend receives the session cookie.
for (const selection of ['first', 'second', 'custom']) {
    test(`Switch Engine revokes the ${selection} session before changing routing`, async ({ page }) => {
        let active = true;
        const received: Array<{ engine: string; cookie: string }> = [];
        const handler = (engine: string) => (req: any, res: any) => {
            received.push({ engine, cookie: req.headers.cookie || '' });
            active = false;
            res.end('');
        };
        const first = await listen(handler('first'));
        const second = await listen(handler('second'));
        const app = await startWebAdmin({
            allowedUrls: [{ name: 'First', url: first.url }, { name: 'Second', url: second.url }],
            devMode: selection === 'custom'
        });
        try {
            await page.context().addCookies([
                { name: 'oie-engine', value: selection === 'custom' ? 'custom' : `k%3A${selection}`, url: app.url },
                { name: 'oie-engine-url', value: encodeURIComponent(second.url), url: app.url },
                { name: 'JSESSIONID', value: 'synthetic-session', domain: 'localhost', path: '/api', httpOnly: true }
            ]);
            await mockEngine(page, {
                'GET /users/current': () => active ? { user: { id: 1, username: 'admin' } } : { __status: 401 }
            });
            await page.route('**/api/users/_logout', route => route.continue());
            await page.goto(app.url + '/channels');
            await expect(page.locator('.shell')).toBeVisible();
            await page.locator('button.user-chip').click();
            const reload = page.waitForEvent('domcontentloaded');
            await page.getByRole('menuitem', { name: 'Switch Engine', exact: true }).click();
            await reload;
            await expect(page.locator('input[type=password]')).toBeVisible();
            expect(received).toEqual([{ engine: selection === 'first' ? 'first' : 'second', cookie: 'JSESSIONID=synthetic-session' }]);
            await expect(page.locator('.login-card select')).toHaveValue('k:first');
            expect((await page.context().cookies()).some(c => c.name === 'oie-engine-url')).toBe(false);
        } finally {
            app.stop();
            first.server.closeAllConnections(); second.server.closeAllConnections();
            first.server.close(); second.server.close();
        }
    });
}

test('failed logout keeps the current session and routing available for retry', async ({ page, baseURL }) => {
    let logoutStatus = 502;
    const cookies: string[] = [];
    await page.context().addCookies([{ name: 'oie-engine', value: 'k%3Asecond', url: baseURL! }]);
    await page.route('**/webadmin/config.json', route => route.fulfill({ json: {
        engines: [{ key: 'k:first', name: 'First' }, { key: 'k:second', name: 'Second' }]
    } }));
    await mockEngine(page, {
        'POST /users/_logout': (req: any) => {
            cookies.push(req.headers().cookie || '');
            return { __status: logoutStatus };
        }
    });
    await page.goto('/channels');
    await expect(page.locator('.shell')).toBeVisible();
    await page.locator('button.user-chip').click();
    await page.getByRole('menuitem', { name: 'Switch Engine', exact: true }).click();
    await expect(page.getByText('Sign-out failed. Your session may still be active. Please try again.')).toBeVisible();
    await expect(page.locator('.shell')).toBeVisible();
    expect((await page.context().cookies()).find(c => c.name === 'oie-engine')?.value).toBe('k%3Asecond');
    // Dismiss the error dialog and retry ordinary logout. A 401 means the
    // session is already gone and is a successful sign-out, not another error.
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    logoutStatus = 401;
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    expect(cookies).toHaveLength(2);
    expect(cookies.every(c => c.includes('oie-engine=k%3Asecond'))).toBe(true);
});
