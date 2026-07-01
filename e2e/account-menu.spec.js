import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Top-right account menu (issue #8: the old chip was a logout-only control that
 * read as "go to profile", with "Sign out" visible only on hover). The chip now
 * opens an account menu whose items are always visible text — no hover needed.
 */

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('account chip opens a menu with the signed-in header and all items visible', async ({ page }) => {
    await page.goto('/');

    // The chip shows who is signed in; the caret signals it opens a menu.
    const chip = page.locator('button.user-chip');
    await expect(chip).toContainText('admin');

    await chip.click();
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();

    // Non-interactive "signed in as" header.
    await expect(menu.locator('.ctx-head-name')).toHaveText('admin');
    await expect(menu.locator('.ctx-head-sub')).toHaveText('Admin User');

    // Every action is real, always-visible text — not a hover-only tooltip.
    for (const label of ['Edit Account', 'Change Password', 'Settings', 'Sign out']) {
        await expect(menu.getByRole('button', { name: label })).toBeVisible();
    }
});

test('Sign out returns to the login screen', async ({ page }) => {
    let loggedOut = false;
    page.on('request', (r) => {
        if (r.method() === 'POST' && /\/users\/_logout$/.test(new URL(r.url()).pathname)) loggedOut = true;
    });

    await page.goto('/');
    await page.locator('button.user-chip').click();
    await page.locator('.ctx-menu').getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(loggedOut).toBe(true);
});

test('Change Password opens the self-service modal for the current user', async ({ page }) => {
    await page.goto('/');
    await page.locator('button.user-chip').click();
    await page.locator('.ctx-menu').getByRole('button', { name: 'Change Password' }).click();

    // Same modal the Users grid uses, scoped to the signed-in user.
    await expect(page.getByText('Change Password — admin')).toBeVisible();
});

test('Settings jumps to the Administrator (user prefs) tab, not Server', async ({ page }) => {
    await page.goto('/');
    await page.locator('button.user-chip').click();
    await page.locator('.ctx-menu').getByRole('button', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings\?tab=administrator/);
    // The Administrator tab is the active one (not the default Server tab).
    await expect(page.locator('.tab.active')).toHaveText(/Administrator/);
});
