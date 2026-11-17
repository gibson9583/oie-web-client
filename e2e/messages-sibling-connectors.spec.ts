import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';

const FULL_MESSAGE = {
    messageId: '325',
    channelId: CID,
    serverId: 's1',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [
            {
                int: 0,
                connectorMessage: {
                    metaDataId: 0,
                    connectorName: 'Source',
                    status: 'TRANSFORMED',
                    receivedDate: { time: 1700000000000 },
                    raw: { content: 'MSH|^~\\&|LIS|HOSP|EHR|HOSP|20261117||ORU^R01|325|P|2.5.1' },
                    metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PAT-325'] }] },
                },
            },
            {
                int: 1,
                connectorMessage: {
                    metaDataId: 1,
                    connectorName: 'Validate results',
                    status: 'SENT',
                    receivedDate: { time: 1700000001000 },
                    sendDate: { time: 1700000002000 },
                    encoded: { content: '<validated>true</validated>', dataType: 'XML' },
                    metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PAT-325'] }] },
                },
            },
            {
                int: 2,
                connectorMessage: {
                    metaDataId: 2,
                    connectorName: 'Order confirm panel',
                    status: 'ERROR',
                    receivedDate: { time: 1700000003000 },
                    processingErrorContent: { content: 'Connection refused: order-confirm:8443' },
                    metaDataMap: { entry: [{ string: ['PATIENT_ID', 'PAT-325'] }] },
                },
            },
        ],
    },
};

// Filtered search result (e.g. status=ERROR): only connector 2 is returned by GET /messages.
const FILTERED_MESSAGE = {
    messageId: '325',
    channelId: CID,
    serverId: 's1',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: [FULL_MESSAGE.connectorMessages.entry[2]],
    },
};

function setupFilteredMock(page: any, onPhiAudit?: (body: string) => void) {
    return mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [FILTERED_MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/maxMessageId`]: { long: 325 },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/connectorNames`]: {
            map: {
                entry: [
                    { int: 0, string: 'Source' },
                    { int: 1, string: 'Validate results' },
                    { int: 2, string: 'Order confirm panel' },
                ],
            },
        },
        [`GET /channels/${CID}/metaDataColumns`]: {
            list: { metaDataColumn: [{ name: 'PATIENT_ID', type: 'STRING', mappingName: 'patient_id' }] },
        },
        'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'LAB · Critical values'] }] } },
        [`GET /channels/${CID}/messages/325`]: FULL_MESSAGE,
        [`GET /channels/${CID}/messages/325/attachments`]: '',
        'POST /channels/_auditAccessedPHIMessage': (req: any) => {
            onPhiAudit?.(req.postData() || '');
            return '';
        },
    });
}

test('clicking the Show all connectors icon beside the message ID reveals Source and sibling destinations', async ({ page }) => {
    const audits: string[] = [];
    await setupFilteredMock(page, body => audits.push(body));
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}`);
    await expect(page.getByRole('cell', { name: 'Order confirm panel', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Validate results', exact: true })).toHaveCount(0);

    // Click the icon button beside message ID 325.
    const showAllIcon = page.locator('button.msg-show-all[title="Show all connectors for message 325"]');
    await expect(showAllIcon).toBeVisible();
    await showAllIcon.click();

    // Source and sibling destinations are revealed in the table, and the icon disappears once all connectors are shown.
    await expect(page.getByRole('cell', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Validate results', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Order confirm panel', exact: true })).toBeVisible();
    await expect( page.getByRole('tab', { name: 'Raw', exact: true })).toBeVisible();
    await expect(showAllIcon).toHaveCount(0);
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.at(-1)).toContain('PAT-325');
});

test('Show All Connectors in Message Tasks rail reveals sibling connectors while keeping the current selection', async ({ page }) => {
    await setupFilteredMock(page);
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}`);
    await page.getByRole('cell', { name: 'Order confirm panel', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Errors', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Validate results', exact: true })).toHaveCount(0);

    const railBtn = page.locator('.view-tasks').getByRole('button', { name: 'Show All Connectors', exact: true });
    await expect(railBtn).toBeVisible();
    await railBtn.click();

    await expect(page.getByRole('cell', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Validate results', exact: true })).toBeVisible();
    await expect(railBtn).toHaveCount(0);
});

test('Show All Connectors in the row right-click context menu reveals sibling connectors', async ({ page }) => {
    await setupFilteredMock(page);
    await page.setViewportSize({ width: 1500, height: 800 });

    await page.goto(`/messages/${CID}`);
    const destCell = page.getByRole('cell', { name: 'Order confirm panel', exact: true });
    await expect(destCell).toBeVisible();

    await destCell.click({ button: 'right' });
    const menuItem = page.getByRole('menuitem', { name: 'Show All Connectors', exact: true });
    await expect(menuItem).toBeVisible();
    await menuItem.click();

    await expect(page.getByRole('cell', { name: 'Source', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Validate results', exact: true })).toBeVisible();
});

