import { test, expect } from './base.js';
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
    await page.goto('/dashboard');
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

test('shows a persistent pip marker on each dashboard column resize handle', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const handle = page.locator('table[role="treegrid"] thead .col-resize').first();
    await expect(handle).toBeAttached();
    const marker = await handle.evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        return {
            content: style.content,
            height: style.height,
            opacity: style.opacity,
            backgroundImage: style.backgroundImage,
        };
    });
    expect(marker.content).not.toBe('none');
    expect(marker.height).toBe('12px');
    expect(Number(marker.opacity)).toBeGreaterThan(0);
    expect(marker.backgroundImage).toContain('radial-gradient');
});

test('selecting a stopped channel reveals Start and POSTs the bulk _start endpoint', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Stopped' }).first().click();

    const started = page.waitForRequest(
        (r) => new URL(r.url()).pathname === '/api/channels/_start' && r.method() === 'POST'
    );
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    expect((await started).postData()).toBe('channelId=c-stopped');
});

test('Start can include prerequisite channels and lets the engine order one bulk request', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'dependent', name: 'Dependent', state: 'STOPPED', statistics: {} },
            { channelId: 'middle', name: 'Middle', state: 'STOPPED', statistics: {} },
            { channelId: 'prerequisite', name: 'Prerequisite', state: 'STOPPED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': { set: { channelDependency: [
            { dependentId: 'dependent', dependencyId: 'middle' },
            { dependentId: 'middle', dependencyId: 'prerequisite' }
        ] } },
    });
    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Dependent' }).first().click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Channel dependencies' });
    await expect(dialog.getByText('Middle', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Prerequisite', { exact: true })).toBeVisible();
    const requestPromise = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels/_start');
    await dialog.getByRole('button', { name: 'Include and start', exact: true }).click();
    const body = (await requestPromise).postData() || '';
    expect(new URLSearchParams(body).getAll('channelId').sort()).toEqual(['dependent', 'middle', 'prerequisite']);
});

test('Stop warns about dependents and can act on only the original selection', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [
            { channelId: 'dependent', name: 'Dependent', state: 'STARTED', statistics: {} },
            { channelId: 'prerequisite', name: 'Prerequisite', state: 'STARTED', statistics: {} },
        ] } },
        'GET /server/channelDependencies': { set: { channelDependency: [
            { dependentId: 'dependent', dependencyId: 'prerequisite' }
        ] } },
    });
    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Prerequisite' }).first().click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Channel dependencies' });
    await expect(dialog.getByText('Dependent', { exact: true })).toBeVisible();
    const requestPromise = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels/_stop');
    await dialog.getByRole('button', { name: 'Selected only', exact: true }).click();
    expect((await requestPromise).postData()).toBe('channelId=prerequisite');
});

test('selecting a started channel reveals Pause and Stop (not Start)', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();

    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    // The selection-gated message/stats tasks appear too.
    await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear Statistics', exact: true })).toBeVisible();
});

test('Remove All can include running channels from a dashboard selection', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();
    await page.locator('tr', { hasText: 'Demo Stopped' }).first().click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Remove All Messages', exact: true }).click();

    const options = page.getByRole('dialog', { name: 'Remove All Messages' });
    await expect(options.getByText(/2 selected channels/)).toBeVisible();
    const includeRunning = options.getByRole('checkbox', { name: /Include selected channels that are not stopped/ });
    await expect(includeRunning).toBeEnabled();
    await expect(includeRunning).not.toBeChecked();
    await expect(options.getByRole('checkbox', { name: 'Clear statistics for affected channels' })).toBeChecked();
    await includeRunning.check();
    await options.getByRole('button', { name: 'Remove All', exact: true }).click();

    const confirmation = page.getByRole('dialog', { name: 'Remove All Messages' }).last();
    await confirmation.getByRole('textbox').fill('REMOVEALL');
    const startedRequest = page.waitForRequest((request) =>
        request.method() === 'DELETE' &&
        new URL(request.url()).pathname === '/api/channels/c-started/messages/_removeAll');
    const stoppedRequest = page.waitForRequest((request) =>
        request.method() === 'DELETE' &&
        new URL(request.url()).pathname === '/api/channels/c-stopped/messages/_removeAll');
    await confirmation.getByRole('button', { name: 'OK', exact: true }).click();

    for (const request of await Promise.all([startedRequest, stoppedRequest])) {
        const params = new URL(request.url()).searchParams;
        expect(params.get('restartRunningChannels')).toBe('true');
        expect(params.get('clearStatistics')).toBe('true');
    }
    await expect(page.getByText('Messages removed from 2 channels', { exact: true })).toBeVisible();
});

test('re-emits dashboard:selection on channel selection', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    // Subscribe to the shared store bus the way a dashboard tab/plugin would.
    await page.evaluate(async () => {
        const store = await import('/core/store.js' as any);
        (window as any).__lastSelection = null;
        store.on('dashboard:selection', (sel: any) => { (window as any).__lastSelection = sel; });
    });

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();

    await expect.poll(async () =>
        page.evaluate(() => ((window as any).__lastSelection || []).map((s: any) => s.channelId))
    ).toEqual(['c-started']);
});

test('expands connector child rows and double-click opens the filtered message browser', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': STATUSES_WITH_CONNECTORS });
    await page.goto('/dashboard');
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
    await expect(page).toHaveURL(/\/messages\/c-conn\?metaDataId=1$/);
});

// A started channel whose destination has queueing toggled per-test.
const channelWithDest = (queueEnabled: any) => ({
    list: {
        dashboardStatus: [
            {
                channelId: 'c-conn', name: 'Conn Channel', state: 'STARTED', statistics: {},
                childStatuses: {
                    dashboardStatus: [
                        { channelId: 'c-conn', metaDataId: 0, name: 'Source', state: 'STARTED', statistics: {} },
                        { channelId: 'c-conn', metaDataId: 1, name: 'Destination 1', state: 'STARTED', statistics: {}, queueEnabled },
                    ],
                },
            },
        ],
    },
});

test('stopping a non-queued destination connector warns instead of silently doing nothing', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': channelWithDest(false) });

    // Track whether the per-connector stop was POSTed — it must NOT be.
    let stopCalled = false;
    page.on('request', (r) => {
        if (/\/api\/channels\/c-conn\/connector\/1\/_stop$/.test(r.url())) stopCalled = true;
    });

    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Conn Channel' }).first().locator('.twisty').click();
    await expect(page.getByText('Destination 1', { exact: true })).toBeVisible();

    // Right-click the destination connector row → Stop Connector.
    await page.locator('tr', { hasText: 'Destination 1' }).first().click({ button: 'right' });
    await page.getByRole('menu').getByText('Stop Connector', { exact: true }).click();

    // Swing-parity warning; the connector is left running (no _stop POST).
    await expect(page.getByText(/queueing is not enabled/i)).toBeVisible();
    await expect(page.getByText(/Queueing must be enabled for a destination connector/i)).toBeVisible();
    expect(stopCalled).toBe(false);
});

test('stopping a queued destination connector stops it with no warning', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': channelWithDest(true) });
    await page.goto('/dashboard');
    await page.locator('tr', { hasText: 'Conn Channel' }).first().locator('.twisty').click();
    await expect(page.getByText('Destination 1', { exact: true })).toBeVisible();

    const stopReq = page.waitForRequest(
        (r) => /\/api\/channels\/c-conn\/connector\/1\/_stop$/.test(r.url()) && r.method() === 'POST'
    );
    await page.locator('tr', { hasText: 'Destination 1' }).first().click({ button: 'right' });
    await page.getByRole('menu').getByText('Stop Connector', { exact: true }).click();

    await stopReq;   // the connector WAS stopped
    await expect(page.getByText(/queueing is not enabled/i)).toHaveCount(0);
});

test('double-clicking the channel name text opens the message browser', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/statuses': STATUSES_WITH_CONNECTORS });
    await page.goto('/dashboard');

    // Double-click the channel NAME directly on a not-yet-selected row. The first
    // click selects + re-renders the row, which used to break the native dblclick;
    // the whole row (minus the twisty) must still activate on the first attempt.
    await page.getByText('Conn Channel', { exact: true }).dblclick();
    await expect(page).toHaveURL(/\/messages\/c-conn$/);
});

test('Server Log keeps its entries when the selection changes (no remount wipe)', async ({ page }) => {
    // Regression: the dock tab was keyed on a selection signature, so any click
    // remounted the Server Log tab and wiped its accumulated entries.
    await mockEngine(page, {
        'GET /extensions/serverlog': { serverLogItem: [
            { id: '1', level: 'ERROR', category: 'test', lineNumber: '1',
              message: 'boom log entry', date: { time: 1700000000000, timezone: 'UTC' } },
        ] },
    });
    await page.goto('/dashboard');

    // The Server Log is the default dock tab; its entry appears.
    await expect(page.getByText('boom log entry').first()).toBeVisible();

    // Selecting a channel used to remount the tab and clear the log.
    await page.locator('tr', { hasText: 'Demo Stopped' }).first().click();

    // The entry survives the selection change.
    await expect(page.getByText('boom log entry').first()).toBeVisible();
    await expect(page.getByText('No server log entries yet.')).toHaveCount(0);
});

test('Send Message opens the editor dialog from the dashboard task pane', async ({ page }) => {
    // The dialog lives in the message browser, which the dashboard now loads on
    // demand rather than importing statically — so this also pins that the
    // deferred import actually resolves when the task is invoked.
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.locator('tr', { hasText: 'Demo Started' }).first().click();
    await page.getByRole('button', { name: 'Send Message', exact: true }).click();

    // The dialog is titled "Message" and carries the Process Message action; the
    // destination picker only appears for a channel that has destinations, which
    // the dashboard fixtures deliberately do not give this one.
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Process Message', exact: true })).toBeVisible();
});

// Stats: On/Off SLIDES the KPI strip (a 0fr↔1fr grid track) rather than mounting
// and unmounting it. Two things regress easily here: the closed strip has to take
// up zero height — its own padding is why it can't be the collapsing grid item,
// which cost a ~20px ghost gap above the table — and the transition has to still
// be declared on the wrapper rather than lost to a refactor.
test('the Stats toggle slides the KPI strip shut, leaving no gap above the table', async ({ page }) => {
    // Wider than the default viewport: at 1280 the filter bar sits right at the
    // 880px container wall, which folds the Stats toggle into the View popover.
    await page.setViewportSize({ width: 1600, height: 900 });
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const wrap = page.locator('.dash-kpis-wrap');
    const height = async () => (await wrap.boundingBox())!.height;
    // Scoped to the strip: "Received" is also a status-table column header.
    const receivedCard = page.locator('.dash-kpi .k-lbl', { hasText: 'Received' });

    // Stats default to On: the strip is open, and it animates rather than jumping.
    await expect(receivedCard).toBeVisible();
    expect(await height()).toBeGreaterThan(40);
    // (Open also declares the deferred `overflow` step, hence the trailing "0s".)
    expect(await wrap.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0\.22s/);

    // Off → collapses to exactly zero (not to its padding) and is hidden from AT.
    await page.getByTitle('Hide stat cards').click();
    await expect.poll(height, { timeout: 3000 }).toBe(0);
    await expect(wrap).toHaveAttribute('aria-hidden', 'true');
    await expect(receivedCard).toBeHidden();

    // On → back to full height, and the strip stops being clipped so the cards'
    // shadows aren't cut off at rest.
    // (`overflow` flips only once the slide has finished, hence the poll.)
    await page.getByTitle('Show stat cards').click();
    await expect.poll(height, { timeout: 3000 }).toBeGreaterThan(40);
    await expect.poll(() => wrap.evaluate((el) => getComputedStyle(el).overflow), { timeout: 3000 })
        .toBe('visible');
});
