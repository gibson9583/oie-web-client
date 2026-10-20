import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';
const names: Record<number, string> = {
    0: 'Source', 2: 'Create Dicom message File Writer',
    3: 'Send Dicom message', 4: 'Get Dicom message vars',
};

// OIE 4.6.0's connector-message search orders by CHAIN_ID, ORDER_ID.
// DonkeyMessageController preserves that order in Message's LinkedHashMap,
// and Swing's MessageBrowserTableModel iterates its keys without sorting IDs.
function message(id: number, order: number[], includeSource: boolean) {
    const entries = [0, ...order].map((metaDataId, index) => ({
        int: metaDataId,
        connectorMessage: {
            metaDataId, connectorName: names[metaDataId],
            chainId: index < 3 ? 0 : 1, orderId: index < 3 ? index : 1,
            status: metaDataId === 0 ? 'TRANSFORMED' : 'SENT',
            // Timestamps do not determine processing order (parallel chains).
            receivedDate: { time: 1700000000000 - index },
            encoded: { content: `connector-${metaDataId}`, dataType: 'RAW' },
        },
    }));
    return {
        messageId: id, channelId: CID, processed: true,
        connectorMessages: { '@class': 'linked-hash-map',
            entry: entries.filter(entry => includeSource || entry.int !== 0) },
    };
}

for (const includeSource of [true, false]) {
    test(`preserves each message's destination order ${includeSource ? 'with' : 'without'} its source`, async ({ page }) => {
        const messages = [message(25, [4, 2, 3], includeSource), message(24, [2, 3, 4], includeSource)];
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: messages } },
            [`GET /channels/${CID}/messages/count`]: { long: 2 },
            // Current connector configuration differs from message 25's history.
            [`GET /channels/${CID}/connectorNames`]: { map: { entry: [0, 2, 3, 4]
                .map(int => ({ int, string: names[int] })) } },
            [`GET /channels/${CID}/messages/25`]: messages[0],
            [`GET /channels/${CID}/messages/25/attachments`]: '',
        });
        await page.goto(`/messages/${CID}`);
        const destinations = page.locator('.msg-table tbody tr.child');
        const expected = [4, 2, 3, 2, 3, 4].map(id => names[id]);
        await expect(destinations).toHaveCount(6);
        await expect(destinations.locator('td:nth-child(3)')).toHaveText(expected);

        // A row still selects its actual connector ID after reordering.
        await destinations.first().click();
        await expect(destinations.first()).toHaveClass(/selected/);
        await expect(page.getByRole('tabpanel', { name: 'Encoded', exact: true })).toContainText('connector-4');

        // User sorting, collapsing and repeated searches preserve child order.
        await page.getByRole('columnheader', { name: 'Received Date', exact: true }).click();
        await expect(destinations.locator('td:nth-child(3)')).toHaveText(expected);
        const toggle = page.locator('.msg-table tbody .msg-twisty').first();
        await toggle.click();
        await expect(destinations).toHaveCount(3);
        await toggle.click();
        await expect(destinations.locator('td:nth-child(3)')).toHaveText(expected);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(destinations.locator('td:nth-child(3)')).toHaveText(expected);
    });
}

test('a singleton destination and an empty result remain valid', async ({ page }) => {
    const single = message(25, [4], false);
    let reads = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: () => ({ list: { message: reads++ === 0
            ? [{ ...single, connectorMessages: { entry: single.connectorMessages.entry[0] } }] : [] } }),
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
    });
    await page.goto(`/messages/${CID}`);
    await expect(page.locator('.msg-table tbody tr.child')).toHaveCount(1);
    await expect(page.getByRole('cell', { name: names[4], exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('No messages found', { exact: true })).toBeVisible();
});
