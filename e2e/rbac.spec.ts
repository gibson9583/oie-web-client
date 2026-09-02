import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

/*
 * RBAC menu-hiding (Swing AuthorizationController port). A plugin registers an
 * authorization controller via platform.setAuthorizationController({ checkTask });
 * checkTask(taskGroup, taskName) === false hides the matching left-menu nav item,
 * task button, and right-click item. Here a test plugin denies the Dashboard nav
 * (view/doShowDashboard) and the dashboard Refresh task (dashboard/doRefreshStatuses).
 */
async function installRbacPlugin(page: any, denyExpr: any) {
    // Append a test RBAC plugin to the real manifest so the bundled plugins still load.
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        const resp = await route.fetch();
        let manifests: any[] = [];
        try { manifests = await resp.json(); } catch { /* empty */ }
        manifests.push({ id: 'test-rbac', version: '1.0.0', entry: '/plugins/test-rbac/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    // Match an optional query suffix — Vite's dev middleware appends `?import` to
    // dynamically-imported module URLs, and a bare `entry.js` glob would miss it.
    await page.route('**/plugins/test-rbac/entry.js*', (route: any) => route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: `export function register(p){ p.setAuthorizationController({ checkTask:(g,t)=> !(${denyExpr}) }); }`,
    }));
}

test('an RBAC controller hides a denied nav item and task button', async ({ page }) => {
    await installRbacPlugin(page, "(g==='view'&&t==='doShowDashboard')||(g==='dashboard'&&t==='doRefreshStatuses')");
    await mockEngine(page);
    await page.goto('/channels');

    // The Channels nav (untagged or allowed) is present; the denied Dashboard nav is gone.
    await expect(page.getByRole('button', { name: 'Channels', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);

    // Navigate to the dashboard directly: its denied "Refresh" task is hidden, but the
    // view + an allowed task still render.
    await page.goto('/dashboard');
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks).toBeVisible();
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
});

test('a denied channel task is not offered through the command palette either', async ({ page }) => {
    // Deny the channel-edit and message-browser view tasks. Hiding the taskbar
    // buttons is not enough — the palette builds its own channel entries, and
    // it must apply the same checkTask gate (#22).
    await installRbacPlugin(page, "g==='view'&&(t==='doShowChannel'||t==='doShowMessages')");
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.locator('.cmdk-field input').fill('#demo');
    // The channel exists (the dashboard just listed it), but a role denied both
    // channel tasks gets no channel entries offered.
    await expect(page.locator('.cmdk-scope')).toHaveText('Channels');
    await expect(page.locator('.cmdk-opt')).toHaveCount(0);
});

test('settings tabs the role cannot view are not offered', async ({ page }) => {
    // A Viewer-style role: every built-in settings tab denied except
    // Administrator, which is the user's own preferences and is never gated.
    // Built-in tabs used to be appended unconditionally, so the Server tab
    // rendered for everyone and its first request came back as an error dialog
    // reading "Missing permission: viewServerSettings" — the engine gates each
    // tab, and the RBAC plugin maps every built-in tab's tasks.
    await installRbacPlugin(page,
        "g.startsWith('settings_') && g!=='settings_Administrator' && !(g==='settings_Tags'&&t==='doRefresh')");
    await mockEngine(page);
    await page.goto('/settings');

    // Administrator opens first, and nothing errored.
    await expect(page.getByRole('tab', { name: 'Administrator' })).toBeVisible();
    await expect(page.getByText('Dashboard refresh interval')).toBeVisible();
    await expect(page.getByText(/Missing permission/)).toHaveCount(0);
    for (const hidden of ['Server', 'Configuration Map', 'Database Tasks', 'Resources']) {
        await expect(page.getByRole('tab', { name: hidden })).toHaveCount(0);
    }
    // View-only (doRefresh allowed, doSave denied) keeps the tab, read-only, like Swing.
    await expect(page.getByRole('tab', { name: 'Tags' })).toBeVisible();
});

test('signing in as a different user in the same tab gets a fresh page', async ({ page }) => {
    // Plugins — and the RBAC controller's permission set with them — load once
    // per page. A soft sign-out followed by a sign-in as SOMEONE ELSE used to run
    // the new session under the previous user's permissions: an administrator
    // signing in after a viewer got a view-only Settings page. Now a different
    // identity reloads, exactly as a different engine does; the same identity
    // keeps the soft path.
    let who: string | null = null;
    await mockEngine(page, {
        'GET /users/current': () => (who ? { user: { id: who === 'admin' ? 1 : 2, username: who } } : { __status: 401 }),
        'POST /users/_login': (req: any) => { who = new URLSearchParams(req.postData() || '').get('username'); return { status: 'SUCCESS' }; },
        'POST /users/_logout': () => { who = null; return ''; },
    });
    await page.goto('/');
    await login(page, 'admin', 'admin');
    await expect(page.locator('.statusbar')).toContainText('as admin');
    // The marker lands once the plugins have loaded, a beat after the shell shows.
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('admin');

    // A marker that only survives if the page is NOT reloaded.
    await page.evaluate(() => { (window as any).__softPath = true; });
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await login(page, 'viewer', 'x');
    await expect(page.locator('.statusbar')).toContainText('as viewer');
    expect(await page.evaluate(() => (window as any).__softPath), 'a different user must get a fresh page').toBeUndefined();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('viewer');

    // The SAME user signing back in keeps the soft path — no reload.
    await page.evaluate(() => { (window as any).__softPath = true; });
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await login(page, 'viewer', 'x');
    await expect(page.locator('.statusbar')).toContainText('as viewer');
    expect(await page.evaluate(() => (window as any).__softPath), 'the same user must not be reloaded').toBe(true);
});

test('with no RBAC controller, the Dashboard nav and Refresh task are visible', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
});
