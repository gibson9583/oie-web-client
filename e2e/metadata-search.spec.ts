import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';
const KEY = `oie-meta-search-keys:${CID}:e2e-server-1:1`;
const KEYS = [
    { column: 'ACCESSION_NUMBER', operator: '=', ignoreCase: true },
    { column: 'FACILITY', operator: 'STARTS WITH', ignoreCase: false },
];
const COLUMNS = { list: { metaDataColumn: KEYS.map(k => ({ name: k.column, type: 'STRING' })) } };
const FIXTURES = {
    [`GET /channels/${CID}/metaDataColumns`]: COLUMNS,
    [`GET /channels/${CID}/messages`]: { list: { message: [] } },
};

async function openAdvanced(page: Page) {
    await page.getByRole('button', { name: 'Advanced…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Advanced Search Filter' });
    return { dialog, table: dialog.locator('table', { hasText: 'Metadata' }) };
}

async function savedKeys(page: Page) {
    return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
}

async function search(page: Page) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/channels/${CID}/messages`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    return new URL((await response).url()).searchParams;
}

test.beforeEach(async ({ page }) => {
    await mockEngine(page, FIXTURES);
    await page.addInitScript(({ key, keys }) => localStorage.setItem(key, JSON.stringify(keys)), { key: KEY, keys: KEYS });
});

test('keeps unused remembered rows across unrelated edits and honors explicit deletion', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    let { dialog, table } = await openAdvanced(page);
    await table.locator('input[type="text"]').first().fill('SECRET');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();

    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('input[type="text"]').first()).toHaveValue('SECRET');
    await expect(table.locator('input[type="text"]').nth(1)).toHaveValue('');
    await dialog.getByRole('checkbox', { name: 'Has Error', exact: true }).check();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(await savedKeys(page)).toEqual(KEYS);
    let params = await search(page);
    expect(params.getAll('metaDataCaseInsensitiveSearch')).toEqual(['ACCESSION_NUMBER = SECRET']);
    expect(params.has('metaDataSearch')).toBe(false);
    expect(params.get('error')).toBe('true');

    // Delete only the unused row, then reopen: neither duplicate nor resurrect it.
    ({ dialog, table } = await openAdvanced(page));
    await table.locator('tbody tr').nth(1).click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).nth(1).click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(await savedKeys(page)).toEqual(KEYS.slice(0, 1));
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.locator('input[type="text"]')).toHaveValue('SECRET');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).nth(1).click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(await savedKeys(page)).toBeNull();
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    params = await search(page);
    expect(params.has('metaDataSearch')).toBe(false);
    expect(params.has('metaDataCaseInsensitiveSearch')).toBe(false);
});

test('keeps blank remembered rows inactive after editing and preserves Cancel and Reset', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    let { dialog, table } = await openAdvanced(page);
    await table.locator('input[type="text"]').first().fill('SECRET');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    ({ dialog, table } = await openAdvanced(page));
    await table.locator('input[type="text"]').first().fill('');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('input[type="text"]').first()).toHaveValue('SECRET');
    await table.locator('input[type="text"]').first().fill('');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const params = await search(page);
    expect(params.has('metaDataSearch')).toBe(false);
    expect(params.has('metaDataCaseInsensitiveSearch')).toBe(false);
    expect(await savedKeys(page)).toEqual(KEYS);
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await table.locator('input[type="text"]').first().fill('UNAPPLIED');
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('input[type="text"]').first()).toHaveValue('');
    expect(await savedKeys(page)).toEqual(KEYS);
});

test('retains an explicit empty-string filter and an empty draft when storage fails', async ({ page }) => {
    await page.goto(`/messages/${CID}`);
    await page.evaluate(key => {
        localStorage.removeItem(key);
        const remove = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (name) {
            if (name === key) throw new DOMException('Unavailable storage', 'SecurityError');
            return remove.call(this, name);
        };
    }, KEY);
    let { dialog, table } = await openAdvanced(page);
    await dialog.getByRole('button', { name: 'New', exact: true }).nth(1).click();
    await table.locator('select').nth(1).selectOption('=');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    ({ dialog, table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect((await search(page)).getAll('metaDataSearch')).toEqual(['ACCESSION_NUMBER = ']);
    ({ dialog, table } = await openAdvanced(page));
    await dialog.getByRole('button', { name: 'Delete', exact: true }).nth(1).click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(await savedKeys(page)).not.toBeNull(); // removeItem failed.
    ({ table } = await openAdvanced(page));
    await expect(table.locator('tbody tr')).toHaveCount(0); // In-memory deletion still wins.
});

for (const firstLoader of ['bootstrap', 'search']) {
    for (const fails of [false, true]) {
        test(`shares metadata discovery and permits retry (first: ${firstLoader}, failure: ${fails})`, async ({ page }) => {
            let releaseMetadata!: () => void;
            let releaseConnectors!: () => void;
            const metadata = new Promise<void>(resolve => { releaseMetadata = resolve; });
            const connectors = new Promise<void>(resolve => { releaseConnectors = resolve; });
            let calls = 0;
            let searches = 0;
            await mockEngine(page, {
                ...FIXTURES,
                [`GET /channels/${CID}/connectorNames`]: async () => {
                    if (firstLoader === 'search') await connectors;
                    return { map: { entry: [{ int: 0, string: 'Source' }] } };
                },
                [`GET /channels/${CID}/metaDataColumns`]: async () => {
                    const call = ++calls;
                    if (call === 1) {
                        await metadata;
                        if (fails) return { __status: 500, body: { error: 'metadata failure' } };
                    }
                    return COLUMNS;
                },
                [`GET /channels/${CID}/messages`]: () => {
                    searches++;
                    return { list: { message: [] } };
                },
            });
            try {
                await page.goto(`/messages/${CID}`);
                const button = page.getByRole('button', { name: 'Advanced…', exact: true });
                if (firstLoader === 'bootstrap') await expect.poll(() => calls).toBe(1);
                await page.getByRole('button', { name: 'Search', exact: true }).click();
                await expect.poll(() => calls).toBe(1);
                // A second explicit search supersedes the first, but still shares
                // metadata discovery with it and with the bootstrap effect.
                await page.getByRole('button', { name: 'Search', exact: true }).click();
                releaseConnectors();
                await expect(button).toBeDisabled();
                const bootstrapped = page.waitForResponse(r => new URL(r.url()).pathname === '/api/channels/idsAndNames');
                releaseMetadata();
                await (await bootstrapped).finished();
                if (fails) {
                    const error = page.getByRole('dialog', { name: 'Error', exact: true });
                    await expect(error).toHaveCount(1);
                    await expect(error).toContainText('metadata failure');
                    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
                    await expect(button).toBeDisabled();
                    expect(calls).toBe(1);
                    expect(searches).toBe(0);
                    expect(await savedKeys(page)).toEqual(KEYS);
                    await search(page);
                }
                await expect.poll(() => searches).toBe(1);
                expect(calls).toBe(fails ? 2 : 1);
                await expect(button).toBeEnabled();
                await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
                const { table } = await openAdvanced(page);
                await expect(table.locator('tbody tr')).toHaveCount(2);
                await expect(table.locator('select').first()).toHaveValue('ACCESSION_NUMBER');
                expect(await savedKeys(page)).toEqual(KEYS);
            } finally { releaseConnectors(); releaseMetadata(); }
        });
    }
}
