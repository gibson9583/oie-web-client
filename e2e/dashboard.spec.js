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

test('starting a PAUSED channel POSTs _resume, not _start (matches Swing doStart)', async ({ page }) => {
    // A paused channel has a stopped source + running destinations; the engine's
    // _start is a no-op on it, so "Start" must call _resume to restart the source.
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'c-paused', name: 'Demo Paused', state: 'PAUSED', statistics: {} },
        ] } },
    });
    await page.goto('/');
    await expect(page.getByText('Demo Paused')).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Paused' }).first().click();

    // Regression guard: _start must NOT be called for a paused channel.
    let startCalled = false;
    page.on('request', (r) => {
        if (/\/api\/channels\/c-paused\/_start$/.test(r.url()) && r.method() === 'POST') startCalled = true;
    });
    const resumed = page.waitForRequest(
        (r) => /\/api\/channels\/c-paused\/_resume$/.test(r.url()) && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start' }).click();
    await resumed;
    expect(startCalled).toBe(false);
});
