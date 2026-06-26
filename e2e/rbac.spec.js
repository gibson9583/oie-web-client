import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * RBAC menu-hiding (Swing AuthorizationController port). A plugin registers an
 * authorization controller via platform.setAuthorizationController({ checkTask });
 * checkTask(taskGroup, taskName) === false hides the matching left-menu nav item,
 * task button, and right-click item. Here a test plugin denies the Dashboard nav
 * (view/doShowDashboard) and the dashboard Refresh task (dashboard/doRefreshStatuses).
 */
async function installRbacPlugin(page, denyExpr) {
    // Append a test RBAC plugin to the real manifest so the bundled plugins still load.
    await page.route('**/webadmin/plugins.json', async (route) => {
        const resp = await route.fetch();
        let manifests = [];
        try { manifests = await resp.json(); } catch { /* empty */ }
        manifests.push({ id: 'test-rbac', version: '1.0.0', entry: '/plugins/test-rbac/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    await page.route('**/plugins/test-rbac/entry.js', (route) => route.fulfill({
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

test('with no RBAC controller, the Dashboard nav and Refresh task are visible', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
});
