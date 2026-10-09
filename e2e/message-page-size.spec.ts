import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const path = '/channels/c-started/messages';
const preferenceKey = 'webadmin-prefs:e2e-server-1:1';
const message = (id: number) => ({ messageId: String(id), channelId: 'c-started',
    connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } } });
type Search = { offset: number; limit: number };

async function openBrowser(page: Page, beforeSearch?: (search: Search) => Promise<unknown>) {
    const searches: Search[] = [], calls: string[] = [];
    await page.setViewportSize({ width: 1500, height: 900 });
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.includes('/messages') || pathname.endsWith('/metaDataColumns') || pathname.includes('_audit')) calls.push(pathname);
    });
    await mockEngine(page, {
        [`GET ${path}`]: async (request: Request) => {
            const params = new URL(request.url()).searchParams;
            const search = { offset: Number(params.get('offset')), limit: Number(params.get('limit')) };
            searches.push(search);
            const response = await beforeSearch?.(search);
            return response ?? { list: { message: Array.from({ length: 45 }, (_, i) => message(1000 + i))
                .slice(search.offset, search.offset + search.limit) } };
        },
        [`GET ${path}/count`]: { long: 45 },
    });
    await page.goto('/messages/c-started');
    await expect(page.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
    return { searches, calls };
}

async function closeError(page: Page, text: string) {
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText(text);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

test('custom page sizes apply through Search, Enter and Refresh with Swing lookahead', async ({ page }) => {
    const { searches } = await openBrowser(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await expect(size).toHaveValue('20');
    await expect(size).toHaveAttribute('min', '1');
    await expect(size).toHaveAttribute('max', '999');
    for (const [value, action, shown] of [['1', 'Search', 1], ['37', 'Enter', 37], ['999', 'Refresh', 45], ['001', 'Search', 1]] as const) {
        const before = searches.length;
        await size.fill(value);
        expect(searches).toHaveLength(before);
        if (action === 'Enter') await size.press('Enter');
        else await page.getByRole('button', { name: action, exact: true }).click();
        await expect.poll(() => searches.length).toBe(before + 1);
        expect(searches.at(-1)).toEqual({ offset: 0, limit: Number(value) + 1 });
        await expect(page.locator('table.msg-table tbody tr')).toHaveCount(shown);
        await expect(page.locator('.counts')).toHaveText(`1–${shown} of ${shown === 45 ? '45' : '?'}`);
    }
});

test('invalid page sizes reject every new-search entry point without engine requests', async ({ page }) => {
    const { calls } = await openBrowser(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    for (const [index, value] of ['', '0', '-1', '1.5', '1000', '1e2'].entries()) {
        await size.fill(value);
        const before = [...calls];
        if (index % 4 === 0) await size.press('Enter');
        else if (index % 4 === 3) await page.getByPlaceholder('Search message content…').press('Enter');
        else await page.getByRole('button', { name: index % 4 === 1 ? 'Search' : 'Refresh', exact: true }).click();
        await closeError(page, 'Page size must be a whole number from 1 to 999.');
        expect(calls).toEqual(before);
        await expect(page.locator('.counts')).toHaveText('1–20 of ?');
    }
    await size.fill('1');
    await size.press('Enter');
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
});

test('pagination and Count use the committed page size while the draft changes or is invalid', async ({ page }) => {
    const { searches, calls } = await openBrowser(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await size.fill('1');
    await size.press('Enter');
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    await size.fill('37');
    await page.getByRole('button', { name: 'Next ›', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('2–2 of ?');
    expect(searches.at(-1)).toEqual({ offset: 1, limit: 2 });
    await size.fill('');
    await page.getByRole('button', { name: '‹ Prev', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    expect(searches.at(-1)).toEqual({ offset: 0, limit: 2 });
    await page.getByRole('button', { name: 'Count', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('1–1 of 45');
    expect(calls.filter(call => call.endsWith('/count'))).toHaveLength(1);
    await page.getByRole('button', { name: 'Last »', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('45–45 of 45');
    expect(searches.at(-1)).toEqual({ offset: 44, limit: 2 });
    await expect(page.getByRole('cell', { name: '1044', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next ›', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '« First', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('1–1 of 45');
    expect(searches.at(-1)).toEqual({ offset: 0, limit: 2 });
});

test('Reset restores the configured default without searching or saving browser edits', async ({ page }) => {
    await page.addInitScript(key => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ messagePageSize: 37 }));
    }, preferenceKey);
    const { searches } = await openBrowser(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await expect(size).toHaveValue('37');
    expect(searches).toEqual([{ offset: 0, limit: 38 }]);
    await size.fill('1');
    await size.press('Enter');
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(size).toHaveValue('37');
    expect(searches).toHaveLength(2);
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).messagePageSize, preferenceKey)).toBe(37);
    await page.reload();
    await expect(size).toHaveValue('37');
    await expect(page.locator('.counts')).toHaveText('1–37 of ?');
    expect(searches.at(-1)).toEqual({ offset: 0, limit: 38 });
});

test('a failed replacement retains the previous page size and can be retried', async ({ page }) => {
    let fail = true;
    const { searches } = await openBrowser(page, async search => search.limit === 38 && fail
        ? { __status: 500, body: { error: 'query unavailable' } } : undefined);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await size.fill('1');
    await size.press('Enter');
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    await size.fill('37');
    await size.press('Enter');
    await closeError(page, 'query unavailable');
    await expect(page.locator('.counts')).toHaveText('1–1 of ?');
    await page.getByRole('button', { name: 'Next ›', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('2–2 of ?');
    expect(searches.at(-1)).toEqual({ offset: 1, limit: 2 });
    fail = false;
    await size.press('Enter');
    await expect(page.locator('.counts')).toHaveText('1–37 of ?');
    expect(searches.at(-1)).toEqual({ offset: 0, limit: 38 });
});

for (const replacement of ['invalid', 'newer'] as const) {
    test(`a pending page-size search ${replacement === 'invalid' ? 'survives an invalid submission' : 'yields to a newer search'}`, async ({ page }) => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const { searches } = await openBrowser(page, async search => { if (search.limit === 38) await gate; });
        const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
        try {
            await size.fill('37');
            await size.press('Enter');
            await expect.poll(() => searches.at(-1)?.limit).toBe(38);
            await size.fill(replacement === 'invalid' ? '' : '1');
            await size.press('Enter');
            if (replacement === 'invalid') await closeError(page, 'Page size must be a whole number from 1 to 999.');
            else await expect(page.locator('.counts')).toHaveText('1–1 of ?');
            const completed = page.waitForResponse(response => new URL(response.url()).pathname === `/api${path}`
                && new URL(response.url()).searchParams.get('limit') === '38');
            release();
            await (await completed).finished();
            // Let the older response's promise continuation update React before checking.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect(page.locator('.counts')).toHaveText(replacement === 'invalid' ? '1–37 of ?' : '1–1 of ?');
            expect(searches).toHaveLength(replacement === 'invalid' ? 2 : 3);
        } finally { release(); }
    });
}
