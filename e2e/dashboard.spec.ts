import { test, expect } from './base.js';
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
        (r) => new URL(r.url()).pathname === '/api/channels/_start' && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start' }).click();
    expect((await started).postData()).toBe('channelId=c-stopped');
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
        if (new URL(r.url()).pathname === '/api/channels/_start' && r.method() === 'POST') startCalled = true;
    });
    const resumed = page.waitForRequest(
        (r) => new URL(r.url()).pathname === '/api/channels/_resume' && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start' }).click();
    expect((await resumed).postData()).toBe('channelId=c-paused');
    expect(startCalled).toBe(false);
});

for (const action of ['sidebar', 'channel context menu', 'group context menu', 'group selection sidebar']) {
    test(`Send Message rejects multiple channels from the ${action}`, async ({ page }) => {
        let reads = 0, sends = 0;
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (/\/channels\/[^/]+\/(status|connectorNames)$/.test(path)) reads++;
            if (request.method() === 'POST' && path.endsWith('/messagesWithObj')) sends++;
        });
        await page.goto('/dashboard');
        if (action.startsWith('group')) {
            await page.locator('tr', { hasText: '[Default Group]' }).click({ button: 'right' });
            if (action === 'group selection sidebar') await page.keyboard.press('Escape');
        } else {
            await page.getByText('Demo Started', { exact: true }).click();
            await page.getByText('Demo Stopped', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
            if (action === 'channel context menu') await page.getByText('Demo Stopped', { exact: true }).click({ button: 'right' });
        }
        if (action.endsWith('context menu')) {
            await page.getByRole('menuitem', { name: 'Send Message', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        }
        await expect(page.getByRole('dialog', { name: 'Warning', exact: true }))
            .toContainText('This operation can only be performed on a single channel.');
        await expect(page.getByRole('dialog', { name: 'Message', exact: true })).toHaveCount(0);
        expect(reads).toBe(0);
        expect(sends).toBe(0);
    });
}

for (const action of ['channel context menu', 'single-channel group']) {
    test(`Send Message uses the explicit channel from a ${action}`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        const reads: string[] = [];
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (/\/channels\/[^/]+\/status$/.test(path)) reads.push(path);
        });
        if (action === 'single-channel group') {
            await mockEngine(page, { 'GET /channelgroups': { list: { channelGroup: {
                id: 'single', name: 'Single channel group', channels: { channel: { id: 'c-stopped' } }
            } } } });
        }
        await page.goto('/dashboard');
        await page.getByText('Demo Started', { exact: true }).click();
        if (action === 'single-channel group') {
            await page.locator('tr', { hasText: '[Single channel group]' }).click({ button: 'right' });
        } else {
            // Right-clicking an unselected row replaces the original selection.
            await page.getByText('Demo Stopped', { exact: true }).click({ button: 'right' });
        }
        await page.getByRole('menuitem', { name: 'Send Message', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Message', exact: true })).toBeVisible();
        expect(reads).toEqual(['/api/channels/c-stopped/status']);
    });
}
