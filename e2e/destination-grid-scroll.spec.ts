import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * Issue #129: with many destinations the Destinations grid scrolls on its own,
 * and the destination editor below it stays on screen.
 */

const CHANNEL_ID = 'many-destinations';

function channelWith(count: number) {
    const channel = makeChannel(CHANNEL_ID);
    const first = channel.destinationConnectors.connector[0];
    channel.destinationConnectors.connector = Array.from({ length: count }, (_, i) => ({
        ...first, metaDataId: i + 1, name: `Destination ${i + 1}`
    }));
    channel.nextMetaDataId = count + 1;
    return channel;
}

test('a long destinations grid scrolls and keeps the editor visible', async ({ page }) => {
    await mockEngine(page, { [`GET /channels/${CHANNEL_ID}`]: { channel: channelWith(30) } });
    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();

    const grid = page.locator('.dest-grid > .dt-wrap');
    await expect(grid.locator('tbody tr')).toHaveCount(30);
    expect(await grid.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight)).toBe(true);

    await expect(page.getByText('Connector Type:')).toBeInViewport();

    const last = grid.locator('tbody tr').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
});
