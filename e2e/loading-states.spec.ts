import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { SAMPLE_EVENTS, SAMPLE_STATUSES } from './fixtures.js';

const CID = 'c-started';

// A response held until release(); gate() arms the next one.
function holdable() {
    let release = () => {};
    let held = Promise.resolve();
    return {
        gate() { held = new Promise<void>(resolve => { release = resolve; }); },
        wait: () => held,
        release: () => release(),
    };
}

const message = (messageId: string) => ({
    channelId: CID, messageId, processed: true,
    connectorMessages: { entry: [{ int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } }] },
});

test('the message browser shows loading until a response, then keeps rows during a later search', async ({ page }) => {
    const hold = holdable();
    let empty = false;
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: async () => {
            await hold.wait();
            return { list: { message: empty ? [] : [message('42')] } };
        },
    });
    hold.gate();
    try {
        await page.goto(`/messages/${CID}`);
        await expect(page.getByText('Loading messages…')).toBeVisible();
        await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
        hold.release();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
        await expect(page.getByText('Loading messages…')).toHaveCount(0);

        hold.gate();
        empty = true;
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
        await expect(page.getByText('Loading messages…')).toHaveCount(0);
        hold.release();
        await expect(page.getByText('No messages found', { exact: true })).toBeVisible();
    } finally {
        hold.release();
    }
});

test('events show loading until a response, then keep rows during a later search', async ({ page }) => {
    const hold = holdable();
    let empty = false;
    await mockEngine(page, {
        'GET /events': async () => {
            await hold.wait();
            return { list: { serverEvent: empty ? [] : SAMPLE_EVENTS } };
        },
    });
    hold.gate();
    try {
        await page.goto('/events');
        await expect(page.getByRole('status').filter({ hasText: 'Loading events…' })).toBeVisible();
        await expect(page.getByText('No events found', { exact: true })).toBeHidden();
        hold.release();
        await expect(page.getByText('Server startup')).toBeVisible();
        await expect(page.getByText('Loading events…')).toHaveCount(0);

        hold.gate();
        empty = true;
        await page.getByRole('button', { name: 'Search', exact: true }).first().click();
        await expect(page.getByText('Server startup')).toBeVisible();
        await expect(page.getByText('Loading events…')).toHaveCount(0);
        hold.release();
        await expect(page.getByText('No events found', { exact: true })).toBeVisible();
    } finally {
        hold.release();
    }
});

test('the dashboard shows loading until the first status response', async ({ page }) => {
    const hold = holdable();
    await mockEngine(page, {
        'GET /channels/statuses': async () => {
            await hold.wait();
            return { list: { dashboardStatus: SAMPLE_STATUSES } };
        },
    });
    hold.gate();
    try {
        await page.goto('/');
        await expect(page.getByRole('status').filter({ hasText: 'Loading channels…' })).toBeVisible();
        await expect(page.getByText('No deployed channels')).toHaveCount(0);
        await expect(page.getByText('[Default Group]')).toHaveCount(0);
        await expect(page.getByText(/Deployed Channel/)).toHaveCount(0);
        hold.release();
        await expect(page.getByText('Demo Started').first()).toBeVisible();
        await expect(page.getByText('Loading channels…')).toHaveCount(0);
    } finally {
        hold.release();
    }
});
