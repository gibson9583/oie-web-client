import { test, expect } from '@playwright/test';
import { mockEngine, login } from './mock.js';

test.describe('login', () => {
    test('a grace-period login offers the change-password dialog', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS_GRACE_PERIOD', message: 'Your password expires in 3 days.' }; },
        });

        await page.goto('/');
        await login(page, 'admin', 'admin');

        // Login succeeded (grace = success) AND the engine's message is surfaced
        // with the offer to change the password now.
        await expect(page.getByText('Your password expires in 3 days.')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Change Password' })).toBeVisible();

        // Accepting opens the change-password modal for the signed-in user.
        await page.getByRole('button', { name: 'Change Password' }).click();
        await expect(page.getByText('Change Password — admin')).toBeVisible();
    });

    test('signs in and reaches the dashboard', async ({ page }) => {
        // current → 401 until login succeeds, so the login screen shows first.
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

        await login(page, 'admin', 'admin');

        // Booted into the shell with the dashboard's channel rows. Generous
        // timeout: the login→shell transition (register views + load plugins) can
        // be slow under parallel-worker contention on the shared dev server.
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });
    });

    test('shows an error on bad credentials', async ({ page }) => {
        await mockEngine(page, {
            'GET /users/current': { __status: 401 },
            'POST /users/_login': { status: 'FAIL' },
        });

        await page.goto('/');
        // Wait for the login form to render before interacting (the auth gate
        // resolves api.auth.current() before showing it).
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'wrong');

        await expect(page.getByText('Invalid username or password.')).toBeVisible({ timeout: 15_000 });
        // Still on the login screen.
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
});
