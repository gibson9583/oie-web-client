import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

const policy = { administratorAutoLogoutIntervalEnabled: true, administratorAutoLogoutIntervalField: '1' };

for (const failure of ['stalled', 'rejected', 'expired', 'offline']) {
    test(`F13: ${failure} idle revocation immediately conceals data and reload stays locked`, async ({ page }) => {
        await page.clock.install();
        await mockEngine(page, { 'GET /server/publicSettings': policy });
        let revocations = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/api/users/_inactivityLogout', async route => {
            revocations++;
            if (failure === 'stalled') await gate;
            if (failure === 'offline') await route.abort('internetdisconnected');
            else await route.fulfill({ status: failure === 'expired' ? 401 : 503, body: 'synthetic revocation failure' });
        });
        await page.goto('/users');
        await page.getByRole('button', { name: 'New User', exact: true }).click();
        await page.getByRole('dialog', { name: 'New User', exact: true }).locator('input[type=text]').first().fill('SYNTHETIC-PRIVATE');
        await page.clock.fastForward(90_000);
        await expect.poll(() => revocations).toBe(1);
        await expect(page.locator('.shell')).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'New User', exact: true })).toHaveCount(0);
        if (failure === 'stalled') {
            await expect(page.getByRole('status')).toContainText('Session locked');
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
            // Native AbortSignal timeout bounds revocation even with the browser
            // clock paused. No response needs to arrive to reach the login card.
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 10_000 });
            release();
        }
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('.shell')).toHaveCount(0);
        // A deliberate successful sign-in clears the marker and restores access.
        await login(page);
        await expect(page.locator('.shell')).toBeVisible();
        expect(await page.evaluate(() => sessionStorage.getItem('oie-idle-locked'))).toBeNull();
    });
}

test('F13: a transient policy read recovers without restarting the idle deadline', async ({ page }) => {
    await page.clock.install();
    let reads = 0, logouts = 0;
    await mockEngine(page, {
        'GET /server/publicSettings': () => ++reads === 1 ? { __status: 503 } : policy,
        'POST /users/_inactivityLogout': () => { logouts++; return ''; },
    });
    await page.goto('/users');
    await expect(page.getByRole('button', { name: 'New User', exact: true })).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect.poll(() => reads).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(logouts).toBe(1);
});
