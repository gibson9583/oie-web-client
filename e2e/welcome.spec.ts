import { test, expect } from '@playwright/test';
import { mockEngine, login } from './mock.js';

/*
 * First-login "Welcome" wizard (Swing FirstLoginDialog parity). It appears after
 * a successful login when the engine's "firstlogin" user preference is unset or
 * truthy, and clears that flag on Finish. See client/react/welcome.js.
 */
test.describe('first-login welcome wizard', () => {
    test('prompts for password + profile on first login, then clears the flag', async ({ page }) => {
        let authed = false;
        let firstloginCleared = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            // New user: firstlogin not yet completed → wizard should show.
            'GET /users/*/preferences/firstlogin': 'true',
            'PUT /users/*/preferences/firstlogin': () => { firstloginCleared = true; return ''; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        // The welcome modal blocks the shell until completed.
        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.shell')).toHaveCount(0);

        const pw = dialog.locator('input[type=password]');
        await pw.nth(0).fill('S3cretPass!');
        await pw.nth(1).fill('S3cretPass!');
        await dialog.getByRole('button', { name: 'Finish' }).click();

        // Modal closes, flag cleared, shell mounts.
        await expect(page.locator('.modal')).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });
        expect(firstloginCleared).toBe(true);
    });

    test('mismatched passwords keep the wizard open', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': 'true',
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        const pw = dialog.locator('input[type=password]');
        await pw.nth(0).fill('S3cretPass!');
        await pw.nth(1).fill('different');
        await dialog.getByRole('button', { name: 'Finish' }).click();

        await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 15_000 });
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible();
    });

    test('no wizard once first-login is complete', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': 'false',
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        // Straight into the shell, no welcome modal.
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Welcome to Open Integration Engine')).toHaveCount(0);
    });
});
