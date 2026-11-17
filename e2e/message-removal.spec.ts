import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';
const MESSAGE_ID = '73';
const NAMES: Record<number, string> = { 0: 'Source', 2: 'Alerts', 7: 'Archive' };
const MESSAGE = {
    messageId: MESSAGE_ID, channelId: CID, processed: true,
    // Historical processing order differs from the current connector order.
    connectorMessages: { '@class': 'linked-hash-map', entry: [0, 7, 2].map(metaDataId => ({
        int: metaDataId,
        connectorMessage: {
            metaDataId, connectorName: NAMES[metaDataId],
            status: metaDataId === 0 ? 'TRANSFORMED' : 'SENT',
            raw: { content: `connector-${metaDataId}`, dataType: 'RAW' },
        },
    })) },
};

async function setup(page: Page, { remove = () => '', includeSource = true }: { remove?: () => any; includeSource?: boolean } = {}) {
    const deletes: Request[] = [];
    let searches = 0;
    const message = { ...MESSAGE, connectorMessages: { ...MESSAGE.connectorMessages,
        entry: MESSAGE.connectorMessages.entry.filter(entry => includeSource || entry.int !== 0) } };
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: () => {
            searches++;
            return { list: { message: [message] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/connectorNames`]: { map: { entry: [0, 2, 7]
            .map(int => ({ int, string: NAMES[int] })) } },
        [`GET /channels/${CID}/metaDataColumns`]: '',
        [`GET /channels/${CID}/messages/${MESSAGE_ID}`]: MESSAGE,
        [`GET /channels/${CID}/messages/${MESSAGE_ID}/attachments`]: '',
        [`DELETE /channels/${CID}/messages/${MESSAGE_ID}`]: (request: Request) => {
            deletes.push(request);
            return remove();
        },
    });
    await page.goto(`/messages/${CID}`);
    await expect(page.getByRole('cell', { name: MESSAGE_ID, exact: true })).toBeVisible();
    return { deletes, searches: () => searches };
}

const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Remove message', exact: true });

async function openRemoval(page: Page, surface: 'rail' | 'menu', metaDataId = 7) {
    const cell = page.getByRole('cell', { name: metaDataId === 0 ? MESSAGE_ID : NAMES[metaDataId], exact: true });
    if (surface === 'menu') {
        await cell.click({ button: 'right' });
        await page.getByRole('menu').getByRole('menuitem', { name: 'Remove Message', exact: true }).click();
    } else {
        await cell.click();
        await page.getByRole('button', { name: 'Remove Message', exact: true }).click();
    }
}

function expectTarget(request: Request, metaDataId: number) {
    const url = new URL(request.url());
    expect(url.pathname).toBe(`/api/channels/${CID}/messages/${MESSAGE_ID}`);
    expect(url.searchParams.getAll('metaDataId')).toEqual([String(metaDataId)]);
}

for (const surface of ['rail', 'menu'] as const) {
    for (const metaDataId of [7, 0]) {
        test(`${surface} removal keeps ${metaDataId ? 'the destination' : 'the whole-message source'} scope`, async ({ page }) => {
            const state = await setup(page);
            await openRemoval(page, surface, metaDataId);
            await expect(confirmation(page)).toContainText(MESSAGE_ID);
            const prompt = await confirmation(page).innerText();
            await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
            await expect.poll(() => state.deletes.length).toBe(1);
            expectTarget(state.deletes[0], metaDataId);
            if (metaDataId) {
                expect(prompt).toContain(NAMES[metaDataId]);
                expect(prompt).toMatch(/destination/i);
            } else expect(prompt).toContain('all its destinations');
            expect(prompt).toContain('The channel must be stopped for an unfinished message to be removed.');
            await expect.poll(state.searches).toBe(2);
            expect(await page.locator('.toast-msg').count()).toBe(0);
        });
    }
}

test('a destination-only result keeps the real connector scope beneath its placeholder parent', async ({ page }) => {
    const state = await setup(page, { includeSource: false });
    await openRemoval(page, 'menu');
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => state.deletes.length).toBe(1);
    expectTarget(state.deletes[0], 7);
    await expect.poll(state.searches).toBe(2);
});

test('cancel leaves the message untouched and disabling confirmation preserves destination scope', async ({ page }) => {
    const state = await setup(page);
    await openRemoval(page, 'rail');
    await confirmation(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0);
    expect(state.deletes).toHaveLength(0);
    expect(state.searches()).toBe(1);

    await page.evaluate(async () => {
        const prefs = await import(String('/core/prefs.js'));
        prefs.setPrefs({ confirmReprocessRemove: false });
    });
    await openRemoval(page, 'rail');
    await expect.poll(() => state.deletes.length).toBe(1);
    expectTarget(state.deletes[0], 7);
    await expect(confirmation(page)).toHaveCount(0);
    await expect.poll(state.searches).toBe(2);
});

test('a failed destination removal retains its scope when retried', async ({ page }) => {
    let attempts = 0;
    const state = await setup(page, { remove: () => ++attempts === 1
        ? { __status: 403, body: { error: 'Permission revoked' } } : '' });
    await openRemoval(page, 'menu');
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Remove failed:');
    expect(state.searches()).toBe(1);
    expectTarget(state.deletes[0], 7);
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();

    await openRemoval(page, 'menu');
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => state.deletes.length).toBe(2);
    expectTarget(state.deletes[1], 7);
    await expect.poll(state.searches).toBe(2);
});

test('confirmation stays bound to its destination when the selected row changes', async ({ page }) => {
    const state = await setup(page);
    await openRemoval(page, 'rail');
    await expect(confirmation(page)).toContainText('Archive');
    // A pending confirmation must keep its original target even if another
    // selection event arrives before the awaited confirmation resolves.
    await page.getByRole('cell', { name: MESSAGE_ID, exact: true, includeHidden: true }).evaluate(cell => (cell as HTMLElement).click());
    await expect(page.locator('.msg-table tr.selected')).not.toHaveClass(/child/);
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => state.deletes.length).toBe(1);
    expectTarget(state.deletes[0], 7);
});

test('a confirmation cannot delete after its session expires', async ({ page }) => {
    const state = await setup(page);
    await openRemoval(page, 'rail');
    await expect(confirmation(page)).toBeVisible();
    await page.evaluate(async () => {
        const session = await import(String('/core/engine-fetch.js'));
        session.discardEngineResponses();
    });
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0);
    expect(state.deletes).toHaveLength(0);
    expect(state.searches()).toBe(1);
});

test('a pending removal response cannot refresh results after session expiry', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const state = await setup(page, { remove: async () => { await gate; return ''; } });
    try {
        await openRemoval(page, 'rail');
        await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
        await expect.poll(() => state.deletes.length).toBe(1);
        expectTarget(state.deletes[0], 7);
        await page.evaluate(async () => {
            const session = await import(String('/core/engine-fetch.js'));
            session.discardEngineResponses();
        });
        const response = page.waitForResponse(response => response.request() === state.deletes[0]);
        release();
        await response;
        // Let the completed response's promise continuations settle before
        // checking that neither a fresh search nor a stale toast was emitted.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(state.searches()).toBe(1);
        await expect(page.locator('.toast-msg')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
        release();
    }
});
