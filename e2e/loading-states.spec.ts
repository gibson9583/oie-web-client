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
        await expect(page.getByRole('status').filter({ hasText: 'Searching messages…' })).toBeVisible();
        await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
        hold.release();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Search complete.' })).toBeVisible();

        hold.gate();
        empty = true;
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Searching messages…' })).toHaveText('Searching messages…');
        hold.release();
        await expect(page.getByText('No messages found', { exact: true })).toBeVisible();
    } finally {
        hold.release();
    }
});

test('invalid page size during bootstrap clears loading and allows a corrected search', async ({ page }) => {
    const hold = holdable();
    let searches = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/connectorNames`]: async () => {
            await hold.wait();
            return { map: { entry: { int: 0, string: 'Source' } } };
        },
        [`GET /channels/${CID}/messages`]: () => {
            searches++;
            return { list: { message: [message('42')] } };
        },
    });
    hold.gate();
    try {
        await page.goto(`/messages/${CID}`);
        await expect(page.getByRole('status').filter({ hasText: 'Searching messages…' })).toBeVisible();
        await page.getByRole('spinbutton', { name: 'Page Size', exact: true }).fill('');
        hold.release();
        await expect(page.getByText('Page size must be a whole number from 1 to 999.')).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Search not run.' })).toBeVisible();
        expect(searches).toBe(0);
        await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.getByRole('spinbutton', { name: 'Page Size', exact: true }).fill('20');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
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
