import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Phase 1 responsive foundation (issue #5): at phone width the rail is an
 * off-canvas drawer (starts closed, content full-width, toggled by the hamburger
 * + backdrop) and the topbar collapses its verbose chips to icons.
 */
test.describe('responsive — phone (375px)', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test.beforeEach(async ({ page }) => { await mockEngine(page); });

    test('rail is an off-canvas drawer that starts closed and toggles open/closed', async ({ page }) => {
        await page.goto('/');
        const shell = page.locator('.shell');

        // Starts closed on phone (content full-width), rail translated off-canvas.
        await expect(shell).toHaveClass(/rail-collapsed/);
        await expect.poll(() =>
            page.locator('.rail').evaluate((el) => Math.round(el.getBoundingClientRect().right))
        ).toBeLessThanOrEqual(1);

        // Hamburger opens the drawer.
        await page.getByRole('button', { name: 'Show navigation' }).click();
        await expect(shell).not.toHaveClass(/rail-collapsed/);
        await expect.poll(() =>
            page.locator('.rail').evaluate((el) => Math.round(el.getBoundingClientRect().left))
        ).toBe(0);

        // Backdrop closes it — tap the dimmed area to the right of the 216px drawer
        // (the backdrop's center sits under the drawer, which is above it).
        await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
        await expect(shell).toHaveClass(/rail-collapsed/);
    });

    test('topbar collapses the server chip and chip labels to icons', async ({ page }) => {
        await page.goto('/');
        // Server identity chip is hidden (it is still shown in the status bar).
        await expect(page.locator('.server-chip')).toBeHidden();
        // The account chip keeps its icon but drops the username text.
        await expect(page.locator('.user-chip')).toBeVisible();
        await expect(page.locator('.user-chip span')).toBeHidden();
    });

    test('dashboard view/tags/statistics controls collapse behind a View popover', async ({ page }) => {
        await page.goto('/dashboard');
        const displayBtn = page.getByRole('button', { name: 'View', exact: true });
        await expect(displayBtn).toBeVisible();
        // Controls are hidden until opened.
        await expect(page.locator('.dash-controls')).toBeHidden();
        await displayBtn.click();
        await expect(page.locator('.dash-controls')).toBeVisible();
        await expect(page.locator('.dash-controls').getByText('Current Statistics')).toBeVisible();
    });

    // Wide tree-tables get a min-width floor so a narrow viewport scrolls the
    // .dt-wrap horizontally instead of crushing every column to unreadable
    // truncation. (TreeTable minTableWidth — mirrors core/columns.js syncMinWidth.)
    test('dashboard table scrolls horizontally rather than squeezing columns', async ({ page }) => {
        await page.goto('/dashboard');
        const wrap = page.locator('.dt-wrap').first();
        await expect.poll(() =>
            wrap.evaluate((el) => el.scrollWidth - el.clientWidth)
        ).toBeGreaterThan(0);
    });

    // The channels status column is the tree column (carries the depth indent +
    // twisty spacer + pip), so its default width must fit "Enabled"/"Disabled".
    test('channels status cell is not clipped by its column', async ({ page }) => {
        await page.goto('/channels');
        const cell = page.locator('.status-cell').first();
        await expect(cell).toBeVisible();
        expect(await cell.evaluate((el) => {
            const td = el.closest('td');
            return td.scrollWidth > td.clientWidth + 1;
        })).toBe(false);
    });
});

test('dashboard controls stay inline (no View button) at desktop width', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.locator('.dash-options-btn')).toBeHidden();
    await expect(page.locator('.dash-controls').getByText('Current Statistics')).toBeVisible();
});

test('transformer sub-editor stacks its split panes on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    // Minimal channel so the transformer deep-link loads (source connector only).
    const CH = 'rt';
    await mockEngine(page, {
        [`GET /channels/${CH}`]: { channel: {
            '@version': '4.5.0', id: CH, name: 'RT', revision: 1, nextMetaDataId: 2,
            sourceConnector: {
                '@version': '4.5.0', metaDataId: 0, name: 'sourceConnector',
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': '4.5.0', pluginProperties: null,
                    sourceConnectorProperties: { '@version': '4.5.0', responseVariable: 'None', respondAfterProcessing: true, processBatch: false, firstResponse: false, processingThreads: 1, queueBufferSize: 1000, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } } } },
                transformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
                filter: { '@version': '4.5.0', elements: '' }, transportName: 'Channel Reader', mode: 'SOURCE', enabled: true, waitForPrevious: true },
            destinationConnectors: { connector: [] },
            properties: { '@version': '4.5.0', messageStorageMode: 'DEVELOPMENT', initialState: 'STARTED', metaDataColumns: { metaDataColumn: [] }, attachmentProperties: { '@version': '4.5.0', type: 'None', properties: null } },
            exportData: { metadata: { enabled: true } } } },
    });
    await page.goto(`/channels/${CH}/transformer/0`);
    const split = page.locator('.split-reflow');
    await expect(split).toBeVisible();
    // Stacked, not side-by-side: the outer split lays out as a column and the
    // reference panel spans (near) the full viewport rather than its 460px desktop width.
    await expect.poll(() =>
        split.evaluate((el) => getComputedStyle(el).flexDirection)
    ).toBe('column');
    const panelWidth = await page.locator('.split-reflow > .split-b').evaluate((el) => el.getBoundingClientRect().width);
    expect(panelWidth).toBeGreaterThan(320);
});

test('destination connector editor stacks the cform and left-aligns wait-for-previous when narrow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    const CH = 'dch';
    await mockEngine(page, {
        [`GET /channels/${CH}`]: { channel: {
            '@version': '4.5.0', id: CH, name: 'DCh', revision: 1, nextMetaDataId: 2,
            sourceConnector: {
                '@version': '4.5.0', metaDataId: 0, name: 'sourceConnector',
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': '4.5.0', pluginProperties: null,
                    sourceConnectorProperties: { '@version': '4.5.0', responseVariable: 'None', respondAfterProcessing: true, processBatch: false, firstResponse: false, processingThreads: 1, queueBufferSize: 1000, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } } } },
                transformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
                filter: { '@version': '4.5.0', elements: '' }, transportName: 'Channel Reader', mode: 'SOURCE', enabled: true, waitForPrevious: true },
            destinationConnectors: { connector: [{
                '@version': '4.5.0', metaDataId: 1, name: 'Dest',
                properties: { '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties', '@version': '4.5.0', pluginProperties: null,
                    destinationConnectorProperties: { '@version': '4.5.0', queueEnabled: false, sendFirst: false, retryIntervalMillis: 10000, regenerateTemplate: false, retryCount: 0, rotate: false, includeFilterTransformer: false, threadCount: 1, threadAssignmentVariable: null, validateResponse: false, reattachAttachments: true, resourceIds: { '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } }, queueBufferSize: 1000 },
                    channelId: 'none', channelTemplate: '${message.encodedData}' },
                transformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
                responseTransformer: { '@version': '4.5.0', elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
                filter: { '@version': '4.5.0', elements: '' }, transportName: 'Channel Writer', mode: 'DESTINATION', enabled: true, waitForPrevious: true }] },
            properties: { '@version': '4.5.0', messageStorageMode: 'DEVELOPMENT', initialState: 'STARTED', metaDataColumns: { metaDataColumn: [] }, attachmentProperties: { '@version': '4.5.0', type: 'None', properties: null } },
            exportData: { metadata: { enabled: true } } } },
    });
    await page.goto(`/channels/${CH}/edit`);
    await page.getByRole('button', { name: 'Destinations', exact: true }).click();
    // The connector cform stacks to one column (regression guard: the stacking rule
    // must win over the later base .cform-grid definition on source order).
    const grid = page.locator('.cform-grid').first();
    await expect(grid).toBeVisible();
    await expect.poll(() =>
        grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    ).toBe(1);
    // Wait-for-previous is not right-floated once its row is narrow (margin-left auto → 0).
    const marginLeft = await page.locator('.dest-wait-push').evaluate((el) => getComputedStyle(el).marginLeft);
    expect(marginLeft).toBe('0px');
});

test('events filter criteria collapse into a Filters popover when narrow', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await mockEngine(page);
    await page.goto('/events');
    const filtersBtn = page.getByRole('button', { name: 'Filters', exact: true });
    await expect(filtersBtn).toBeVisible();
    await expect(page.locator('.filter-popover')).toBeHidden();
    await filtersBtn.click();
    await expect(page.locator('.filter-popover')).toBeVisible();
    await expect(page.locator('.filter-popover').getByText('Start Time')).toBeVisible();
    // Advanced fields show directly in the popover (no nested Advanced toggle).
    await expect(page.locator('.filter-popover').getByText('Server Id')).toBeVisible();
    await expect(page.locator('.filter-popover .filter-adv-toggle')).toBeHidden();
});

test('dashboard collapses to the View menu before the bar wraps (~900px)', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await mockEngine(page);
    await page.goto('/dashboard');
    // At 900px the filter bar is ~660px (rail still shown) — narrow enough that the
    // controls would wrap, so they collapse behind the View button instead.
    await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible();
    await expect(page.locator('.dash-controls')).toBeHidden();
});
