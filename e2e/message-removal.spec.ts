import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';
const MESSAGE_ID = '73';
const NAMES: Record<number, string> = { 0: 'Source', 2: 'Alerts', 7: 'Archive' };
const PATIENTS: Record<number, string> = { 0: 'source +&=/?#患者', 2: 'sibling-patient', 7: 'archive +&=/?#β' };
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

function withPatients(patients: Record<number, string>) {
    return { ...MESSAGE, connectorMessages: { ...MESSAGE.connectorMessages,
        entry: MESSAGE.connectorMessages.entry.map(entry => ({ ...entry, connectorMessage: {
            ...entry.connectorMessage,
            ...(Object.hasOwn(patients, entry.int) ? { metaDataMap: { entry: { string: ['PATIENT_ID', patients[entry.int]] } } } : {}),
        } })) } };
}

async function setup(page: Page, { remove = () => '', includeSource = true, rowPatients = {}, detail }: {
    remove?: () => any; includeSource?: boolean; rowPatients?: Record<number, string>; detail?: any;
} = {}) {
    const deletes: Request[] = [];
    const details: Request[] = [];
    let searches = 0;
    const row = withPatients(rowPatients);
    const message = { ...row, connectorMessages: { ...row.connectorMessages,
        entry: row.connectorMessages.entry.filter(entry => includeSource || entry.int !== 0) } };
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: () => {
            searches++;
            return { list: { message: [message] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/connectorNames`]: { map: { entry: [0, 2, 7]
            .map(int => ({ int, string: NAMES[int] })) } },
        [`GET /channels/${CID}/metaDataColumns`]: { list: { metaDataColumn: [{ name: 'PATIENT_ID', type: 'STRING' }] } },
        [`GET /channels/${CID}/messages/${MESSAGE_ID}`]: (request: Request) => {
            details.push(request);
            return typeof detail === 'function' ? detail(request, details.length) : detail ?? row;
        },
        [`GET /channels/${CID}/messages/${MESSAGE_ID}/attachments`]: '',
        'POST /channels/_auditAccessedPHIMessage': '',
        [`DELETE /channels/${CID}/messages/${MESSAGE_ID}`]: (request: Request) => {
            deletes.push(request);
            return remove();
        },
    });
    await page.goto(`/messages/${CID}`);
    await expect(page.getByRole('cell', { name: MESSAGE_ID, exact: true })).toBeVisible();
    return { deletes, details, searches: () => searches };
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

function expectTarget(request: Request, metaDataId: number, patientId?: string) {
    const url = new URL(request.url());
    expect(url.pathname).toBe(`/api/channels/${CID}/messages/${MESSAGE_ID}`);
    expect(url.searchParams.getAll('metaDataId')).toEqual([String(metaDataId)]);
    expect(url.searchParams.getAll('patientId')).toEqual(patientId === undefined ? [] : [patientId]);
}

for (const surface of ['rail', 'menu'] as const) {
    for (const metaDataId of [7, 0]) {
        test(`${surface} removal keeps ${metaDataId ? 'the destination' : 'the whole-message source'} scope`, async ({ page }) => {
            const state = await setup(page, { rowPatients: { 0: 'stale-source', 7: 'stale-archive' }, detail: withPatients(PATIENTS) });
            await openRemoval(page, surface, metaDataId);
            await expect(confirmation(page)).toContainText(MESSAGE_ID);
            const prompt = await confirmation(page).innerText();
            await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
            await expect.poll(() => state.deletes.length).toBe(1);
            expectTarget(state.deletes[0], metaDataId, PATIENTS[metaDataId]);
            if (metaDataId) {
                expect(prompt).toContain(NAMES[metaDataId]);
                expect(prompt).toMatch(/destination/i);
            } else expect(prompt).toContain('all its destinations');
            await expect.poll(state.searches).toBe(2);
        });
    }
}

for (const metaDataId of [7, 0]) {
    test(`a destination-only result removes connector ${metaDataId} with its own patient audit value`, async ({ page }) => {
        const state = await setup(page, { includeSource: false, rowPatients: { 7: 'destination-row-value' }, detail: withPatients(PATIENTS) });
        await openRemoval(page, 'menu', metaDataId);
        await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
        await expect.poll(() => state.deletes.length).toBe(1);
        expectTarget(state.deletes[0], metaDataId, PATIENTS[metaDataId]);
        await expect.poll(state.searches).toBe(2);
    });
}

for (const patientId of ['9007199254740993', '0', '']) {
    test(`cached full detail preserves ${patientId ? `patient string ${patientId}` : 'a missing patient ID'} without another lookup`, async ({ page }) => {
        const patients: Record<number, string> = { 0: PATIENTS[0], 2: PATIENTS[2] };
        if (patientId) patients[7] = patientId;
        const state = await setup(page, { rowPatients: { 7: 'search-row-patient' }, detail: withPatients(patients) });
        await page.getByRole('cell', { name: 'Archive', exact: true }).click();
        await expect(page.getByRole('tabpanel', { name: 'Raw', exact: true })).toContainText('connector-7');
        expect(state.details).toHaveLength(1);
        await page.getByRole('button', { name: 'Remove Message', exact: true }).click();
        await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
        await expect.poll(() => state.deletes.length).toBe(1);
        expectTarget(state.deletes[0], 7, patientId || undefined);
        expect(state.details).toHaveLength(1);
    });
}

test('a failed patient lookup still removes the captured destination without a borrowed audit value', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const warnings: string[] = [];
    page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
    const state = await setup(page, {
        rowPatients: { 7: 'search-row-patient' },
        detail: async (_request: Request, read: number) => {
            if (read === 1) { await gate; return withPatients(PATIENTS); }
            return { __status: 503, body: { error: 'Metadata unavailable' } };
        },
    });
    try {
        await openRemoval(page, 'rail');
        await expect(confirmation(page)).toBeVisible();
        await expect.poll(() => warnings.some(message => message.includes('Unable to read patient ID for removal audit'))).toBe(true);
        await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
        await expect.poll(() => state.deletes.length).toBe(1);
        expectTarget(state.deletes[0], 7);
        await expect.poll(state.searches).toBe(2);
    } finally {
        release();
    }
});

for (const interruption of ['selection', 'session'] as const) {
    test(`a pending patient lookup preserves its captured ${interruption === 'selection' ? 'connector after selection changes' : 'session boundary'}`, async ({ page }) => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const state = await setup(page, { detail: async () => { await gate; return withPatients(PATIENTS); } });
        try {
            await openRemoval(page, 'rail');
            await expect.poll(() => state.details.length).toBeGreaterThanOrEqual(2);
            await expect(confirmation(page)).toHaveCount(0);
            if (interruption === 'selection') await page.getByRole('cell', { name: MESSAGE_ID, exact: true }).click();
            else await page.evaluate(async () => {
                const session = await import(String('/core/engine-fetch.js'));
                session.discardEngineResponses();
            });
            const response = page.waitForResponse(response => response.request() === state.details[1]);
            release();
            await response;
            if (interruption === 'selection') {
                await expect(confirmation(page)).toContainText('Archive');
                await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
                await expect.poll(() => state.deletes.length).toBe(1);
                expectTarget(state.deletes[0], 7, PATIENTS[7]);
            } else {
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await expect(page.getByRole('dialog')).toHaveCount(0);
                expect(state.deletes).toHaveLength(0);
                expect(state.searches()).toBe(1);
            }
        } finally {
            release();
        }
    });
}

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
    const state = await setup(page, { detail: withPatients(PATIENTS) });
    await openRemoval(page, 'rail');
    await expect(confirmation(page)).toContainText('Archive');
    // A pending confirmation must keep its original target even if another
    // selection event arrives before the awaited confirmation resolves.
    await page.getByRole('cell', { name: MESSAGE_ID, exact: true, includeHidden: true }).evaluate(cell => (cell as HTMLElement).click());
    await expect(page.locator('.msg-table tr.selected')).not.toHaveClass(/child/);
    await confirmation(page).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => state.deletes.length).toBe(1);
    expectTarget(state.deletes[0], 7, PATIENTS[7]);
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
