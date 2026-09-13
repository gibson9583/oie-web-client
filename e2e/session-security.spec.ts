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
            if (req.url === '/api/users/_login') {
                res.setHeader('Set-Cookie', 'JSESSIONID=synthetic-session; Path=/api; HttpOnly');
                res.end('');
                return;
            }
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
                { name: 'oie-engine-url', value: encodeURIComponent(second.url), url: app.url }
            ]);
            await page.request.post(app.url + '/api/users/_login');
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

for (const newEngine of ['first', 'second']) {
    test(`a stale settings save is blocked after a new login on ${newEngine}`, async ({ page }) => {
        const writes: string[] = [];
        const engine = await listen((req, res) => { writes.push(req.url || ''); res.end(''); });
        const app = await startWebAdmin({ allowedUrls: [
            { name: 'First', url: engine.url }, { name: 'Second', url: engine.url + '/second' }
        ] });
        try {
            await page.context().addCookies([
                { name: 'oie-engine', value: 'k%3Afirst', url: app.url },
                { name: 'oie-login', value: 'old-login', url: app.url }
            ]);
            await mockEngine(page, {
                'GET /server/settings': (req: any) => ({ serverSettings: {
                    serverName: (req.headers().cookie || '').includes('k%3Asecond') ? 'second' : 'first'
                } })
            });
            await page.route('**/api/server/settings', route => route.request().method() === 'PUT' ? route.continue() : route.fallback());
            await page.goto(app.url + '/settings');
            const name = page.locator('.field', { has: page.getByText('Server name', { exact: true }) }).locator('input');
            await expect(name).toHaveValue('first');
            await name.fill('old-engine-secrets');
            const reload = page.waitForEvent('domcontentloaded');
            // Simulate another tab's cookie changes and click the old Save in
            // one task: no focus event or polling interval can rescue the test.
            await page.evaluate(next => {
                document.cookie = `oie-engine=k%3A${next}; path=/`;
                document.cookie = 'oie-login=new-login; path=/';
                [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Save')!.click();
            }, newEngine);
            await reload;
            await expect(name).toHaveValue(newEngine);
            expect(writes).toEqual([]);
        } finally { app.stop(); engine.server.closeAllConnections(); engine.server.close(); }
    });
}

for (const exit of ['expiry', 'logout', 'idle']) {
    test(`channel credentials are discarded without persistence on ${exit}`, async ({ page }) => {
        let expired = false;
        if (exit === 'idle') await page.clock.install();
        await mockEngine(page, {
            'GET /users/current': () => expired ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'GET /server/publicSettings': { publicSettings: {
                administratorAutoLogoutIntervalEnabled: exit === 'idle', administratorAutoLogoutIntervalField: '1'
            } }
        });
        await page.goto('/channels');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        await page.evaluate(async () => {
            const store = await import(String('/core/store.js'));
            store.setState('editingChannel', { id: 'synthetic', sourceConnector: { properties: { password: 'SYNTHETIC-DB-SECRET' } } });
            store.setState('editingChannelDirty', true);
        });
        if (exit === 'expiry') {
            expired = true;
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/users/current').catch(() => {});
            });
        } else if (exit === 'logout') {
            await page.locator('button.user-chip').click();
            await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
        } else {
            await page.clock.fastForward(90_000);
        }
        await expect(page.locator('input[type=password]')).toBeVisible();
        expect(await page.evaluate(async () => {
            const store = await import(String('/core/store.js'));
            return { channel: store.getState('editingChannel'), local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) };
        })).toEqual({ channel: null, local: expect.not.stringContaining('SYNTHETIC-DB-SECRET'), session: expect.not.stringContaining('SYNTHETIC-DB-SECRET') });
    });
}

test('startup purges legacy drafts from every account before sign-in', async ({ page }) => {
    await page.addInitScript(() => {
        for (const key of ['webadmin.channel-draft', 'webadmin.channel-draft:engine-a:1', 'webadmin.channel-draft:engine-b:2']) {
            localStorage.setItem(key, 'SYNTHETIC-OLD-SECRET');
        }
        localStorage.setItem('oie-theme:engine-b:2', 'dark');
    });
    await mockEngine(page, { 'GET /users/current': { __status: 401 } });
    await page.goto('/');
    await expect(page.locator('input[type=password]')).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('SYNTHETIC-OLD-SECRET');
    expect(await page.evaluate(() => localStorage.getItem('oie-theme:engine-b:2'))).toBe('dark');
});
