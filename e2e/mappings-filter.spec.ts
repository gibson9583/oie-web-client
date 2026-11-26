import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';

const MESSAGE = {
    messageId: '14',
    channelId: CID,
    serverId: 's1',
    receivedDate: { time: 1700000000000 },
    processed: true,
    connectorMessages: {
        entry: {
            int: 0,
            connectorMessage: {
                metaDataId: 0,
                connectorName: 'Source',
                status: 'TRANSFORMED',
                receivedDate: { time: 1700000000000 },
                sourceMapContent: {
                    content: {
                        map: {
                            entry: [
                                { string: ['headers', '{accept-encoding=[gzip,deflate,br],\nuser-agent=[Playwright/1.64.1],\naccept=[*/*]}'] },
                                { string: ['localPort', '10805'] },
                            ],
                        },
                    },
                },
                channelMapContent: {
                    content: {
                        map: {
                            entry: [
                                { string: ['patientId', 'PAT-900'] },
                                { string: ['destinationRoute', 'LAB'] },
                            ],
                        },
                    },
                },
            },
        },
    },
};

test.beforeEach(async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/maxMessageId`]: { long: 14 },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/connectorNames`]: { map: { entry: [{ int: 0, string: 'Source' }] } },
        [`GET /channels/${CID}/metaDataColumns`]: '',
        'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }] } },
        [`GET /channels/${CID}/messages/14`]: MESSAGE,
        [`GET /channels/${CID}/messages/14/attachments`]: '',
    });
});

test('Mappings cells align to the top and quick filters narrow by scope and text', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 800 });
    await page.goto(`/messages/${CID}`);
    await page.getByText('14', { exact: true }).click();
    await page.getByRole('tab', { name: 'Mappings', exact: true }).click();

    const mappings = page.locator('table.dt').filter({
        has: page.getByRole('columnheader', { name: 'Scope', exact: true }),
    });
    const firstCells = mappings.locator('tbody tr').first().locator('td');
    await expect(firstCells.nth(0)).toHaveCSS('vertical-align', 'top');
    await expect(firstCells.nth(1)).toHaveCSS('vertical-align', 'top');
    await expect(firstCells.nth(2)).toHaveCSS('vertical-align', 'top');

    const variables = mappings.locator('tbody tr td:nth-child(2)');
    await expect(variables).toHaveText(['headers', 'localPort', 'patientId', 'destinationRoute']);

    // Filter by scope pill.
    const scopeGroup = page.getByRole('group', { name: 'Filter by scope' });
    await scopeGroup.getByRole('button', { name: 'Channel', exact: true }).click();
    await expect(variables).toHaveText(['patientId', 'destinationRoute']);
    await expect(page.getByText('2 / 4', { exact: true })).toBeVisible();

    // Combine with text filter (matches value or variable, case-insensitive).
    const input = page.getByLabel('Filter mappings');
    await input.fill('pat-900');
    await expect(variables).toHaveText(['patientId']);
    await expect(page.getByText('1 / 4', { exact: true })).toBeVisible();

    // Clear text filter and switch back to All.
    await page.getByLabel('Clear mapping filter').click();
    await scopeGroup.getByRole('button', { name: 'All', exact: true }).click();
    await expect(variables).toHaveText(['headers', 'localPort', 'patientId', 'destinationRoute']);
});
