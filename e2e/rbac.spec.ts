import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

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

test('with no RBAC controller, the Dashboard nav and Refresh task are visible', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
});
