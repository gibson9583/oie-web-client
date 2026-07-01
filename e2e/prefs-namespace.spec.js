import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Every local setting is namespaced by BOTH the engine's server id (GET /server/id
 * = 'e2e-server-1') AND the signed-in user id (SAMPLE_USER.id = 1): key form
 * `<base>:<serverId>:<userId>`. So a different engine — or a different user on the
 * same browser — keeps separate settings, and two users can't clobber each other's
 * theme. A global `oie-theme` cache drives flash-free first paint before login.
 */

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('theme is stored under the per-server, per-user key (plus a global cache)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();

    await expect.poll(() =>
        page.evaluate(() => localStorage.getItem('oie-theme:e2e-server-1:1'))
    ).toBe('dark');
    // Global "last used" cache (flash-free first paint before the user is known).
    expect(await page.evaluate(() => localStorage.getItem('oie-theme'))).toBe('dark');
});

test('system preferences are stored under the per-server, per-user key', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    await expect(page.getByRole('button', { name: 'Administrator', exact: true })).toHaveClass(/active/);

    // Dashboard refresh interval is the only number input on the tab.
    await page.locator('input[type=number]').fill('42');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Preferences saved')).toBeVisible();

    const scoped = await page.evaluate(() => localStorage.getItem('webadmin-prefs:e2e-server-1:1'));
    expect(scoped).toContain('"dashboardRefreshSeconds":42');
    // Neither the bare key nor the server-only key is written.
    expect(await page.evaluate(() => localStorage.getItem('webadmin-prefs'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('webadmin-prefs:e2e-server-1'))).toBeNull();
});

test("on login, the signed-in user's saved theme wins over the last-used cache", async ({ page }) => {
    // Simulate: the last user left the global cache on 'light', but THIS user (id 1)
    // previously saved 'dark'. On login the per-user value must win (the reported bug
    // was user 1 inheriting user 2's theme because it was keyed per-server only).
    await page.addInitScript(() => {
        localStorage.setItem('oie-theme', 'light');               // last-used (some other user)
        localStorage.setItem('oie-theme:e2e-server-1:1', 'dark'); // user 1's own saved theme
    });
    await page.goto('/');

    await expect.poll(() =>
        page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe('dark');
});
