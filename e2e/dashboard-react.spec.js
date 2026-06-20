import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Focused coverage for the React dashboard port (react/views/dashboard.jsx):
 * the channel status tree-table, the selection-gated "Dashboard Tasks" pane,
 * the per-connector child rows (twisty expand + double-click → message browser),
 * and a selection re-emitting 'dashboard:selection'.
 *
 * The default fixtures' SAMPLE_STATUSES have no connector children, so the
 * connector test overrides GET /channels/statuses with a started channel that
 * carries one source + one destination childStatus (the DashboardStatus
 * childStatuses.dashboardStatus XStream shape the view's childrenOf() reads).
 * That same shape is reported as a needed fixture.
 */

// A started channel with two connector child rows (source + a destination).
const STATUSES_WITH_CONNECTORS = {
    list: {
        dashboardStatus: [
            {
                channelId: 'c-conn', name: 'Conn Channel', state: 'STARTED', statistics: {},
                childStatuses: {
                    dashboardStatus: [
                        { channelId: 'c-conn', metaDataId: 0, name: 'Source', state: 'STARTED', statistics: {} },
                        { channelId: 'c-conn', metaDataId: 1, name: 'Destination 1', state: 'STARTED', statistics: {} },
                    ],
                },
            },
            { channelId: 'c-stopped', name: 'Demo Stopped', state: 'STOPPED', statistics: {} },
        ],
    },
};

test('renders the status board with the Dashboard Tasks pane', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');
    await expect(page.locator('.shell')).toBeVisible();

    // Channel rows from SAMPLE_STATUSES.
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();

    // The Dashboard Tasks pane + its always-present Refresh task.
    await expect(page.getByText('Dashboard Tasks', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();

    // No selection yet → the contextual channel-control tasks stay hidden.
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});

test('selecting a stopped channel reveals Start and POSTs _start', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Stopped' }).first().click();

    const started = page.waitForRequest(
        (r) => /\/api\/channels\/c-stopped\/_start$/.test(r.url()) && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await started;
});

test('selecting a started channel reveals Pause and Stop (not Start)', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();

    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    // The selection-gated message/stats tasks appear too.
    await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear Statistics', exact: true })).toBeVisible();
});

test('re-emits dashboard:selection on channel selection', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    // Subscribe to the shared store bus the way a dashboard tab/plugin would.
    await page.evaluate(async () => {
        const store = await import('/core/store.js');
        window.__lastSelection = null;
        store.on('dashboard:selection', (sel) => { window.__lastSelection = sel; });
    });

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();

    await expect.poll(async () =>
        page.evaluate(() => (window.__lastSelection || []).map((s) => s.channelId))
    ).toEqual(['c-started']);
});

test('expands connector child rows and double-click opens the filtered message browser', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': STATUSES_WITH_CONNECTORS });
    await page.goto('/#/dashboard');
    await expect(page.getByText('Conn Channel', { exact: true })).toBeVisible();

    // Connector rows are hidden until the channel's twisty is expanded.
    await expect(page.getByText('Destination 1', { exact: true })).toHaveCount(0);

    // Click the twisty in the channel row to expand its connectors.
    await page.locator('tr', { hasText: 'Conn Channel' }).first().locator('.twisty').click();
    await expect(page.getByText('Source', { exact: true })).toBeVisible();
    await expect(page.getByText('Destination 1', { exact: true })).toBeVisible();

    // Selecting the connector re-renders the table (rebuilding the row), so
    // resolve the row again before double-clicking. Double-click → the message
    // browser scoped to that connector (channelId + metaDataId).
    await page.locator('tr', { hasText: 'Destination 1' }).first().click();
    await page.locator('tr', { hasText: 'Destination 1' }).first().dblclick();
    await expect(page).toHaveURL(/#\/messages\/c-conn\?metaDataId=1$/);
});
