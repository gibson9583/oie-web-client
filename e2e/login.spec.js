import { test, expect } from '@playwright/test';
import { mockEngine, login } from './mock.js';

test.describe('login', () => {
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

        // Booted into the shell with the dashboard's channel rows.
        await expect(page.locator('.shell')).toBeVisible();
        await expect(page.getByText('Demo Started')).toBeVisible();
    });

    test('shows an error on bad credentials', async ({ page }) => {
        await mockEngine(page, {
            'GET /users/current': { __status: 401 },
            'POST /users/_login': { status: 'FAIL' },
        });

        await page.goto('/');
        await login(page, 'admin', 'wrong');

        await expect(page.getByText('Invalid username or password.')).toBeVisible();
        // Still on the login screen.
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
});
