import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);   // authenticated happy-path defaults
});

test('boots straight to the dashboard with channel rows', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.shell')).toBeVisible();
    await expect(page.getByText('Demo Started')).toBeVisible();
    await expect(page.getByText('Demo Stopped')).toBeVisible();
    // Server identity chip resolves from /server/version + /server/settings.
    await expect(page.getByText(/E2E Engine.*v4\.5\.0/)).toBeVisible();
});

test('starting a stopped channel POSTs _start', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Demo Stopped')).toBeVisible();

    // Select the stopped channel's row → the Start task becomes available.
    await page.locator('tr', { hasText: 'Demo Stopped' }).first().click();

    const started = page.waitForRequest(
        (r) => /\/api\/channels\/c-stopped\/_start$/.test(r.url()) && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start' }).click();
    await started;
});
