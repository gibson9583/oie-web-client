import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const preferenceKey = 'webadmin-prefs:e2e-server-1:1';
const invalidSize = 'Page size must be a whole number from 1 to 999.';
const events = Array.from({ length: 45 }, (_, i) => ({ id: 1000 + i, name: `Event ${1000 + i}`,
    level: 'INFORMATION', outcome: 'SUCCESS', userId: 0, eventTime: { time: 1700000000000 } }));
const eventResponse = (request: Request) => {
    const params = new URL(request.url()).searchParams;
    const offset = Number(params.get('offset')), limit = Number(params.get('limit'));
    return { list: { serverEvent: events.slice(offset, offset + limit) } };
};

async function openEvents(page: Page, overrides: Record<string, unknown> = {}, width = 1500) {
    const searches: { offset: number; limit: number }[] = [], calls: string[] = [];
    await page.setViewportSize({ width, height: 900 });
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/events' || url.pathname === '/api/events/count') calls.push(url.pathname);
        if (url.pathname === '/api/events') searches.push({ offset: Number(url.searchParams.get('offset')), limit: Number(url.searchParams.get('limit')) });
    });
    await mockEngine(page, { 'GET /events': eventResponse, 'GET /events/count': { long: 45 }, ...overrides });
    await page.goto('/events');
    await expect(page.getByRole('cell', { name: 'Event 1000', exact: true })).toBeVisible();
    return { searches, calls };
}

async function submit(page: Page, action: string) {
    if (action === 'size') await page.getByRole('spinbutton', { name: 'Page Size', exact: true }).press('Enter');
    else if (action === 'name') await page.getByPlaceholder('Event name contains…').press('Enter');
    else if (action === 'refresh') {
        await page.getByRole('cell', { name: 'Event 1000', exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
    } else await page.locator(action === 'task' ? '.view-tasks' : '.filter-popover').getByRole('button', { name: 'Search', exact: true }).click();
}

async function closeError(page: Page, text = invalidSize) {
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText(text);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

test('custom event page sizes apply through both Search buttons, Enter and context Refresh', async ({ page }) => {
    const { searches, calls } = await openEvents(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await expect(size).toHaveValue('100');
    await expect(size).toHaveAttribute('min', '1');
    await expect(size).toHaveAttribute('max', '999');
    for (const [value, action] of [['1', 'criteria'], ['37', 'size'], ['999', 'task'], ['001', 'refresh']]) {
        const before = searches.length;
        await size.fill(value);
        expect(searches).toHaveLength(before);
        await submit(page, action);
        await expect(page.locator('.counts')).toHaveText(`1–${Math.min(Number(value), 45)} of 45`);
        expect(searches).toHaveLength(before + 1);
        // Events retain their existing exact limit and separate count request.
        expect(searches.at(-1)).toEqual({ offset: 0, limit: Number(value) });
        await expect(page.locator('.dt-wrap table.dt tbody tr')).toHaveCount(Math.min(Number(value), 45));
        expect(calls.filter(call => call.endsWith('/count'))).toHaveLength(searches.length);
    }
});

test('invalid event sizes block all search entry points without search or count requests', async ({ page }) => {
    const { calls } = await openEvents(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    for (const [value, action] of [['', 'size'], ['0', 'criteria'], ['-1', 'task'], ['1.5', 'name'], ['1000', 'refresh'], ['1e2', 'size']]) {
        await size.fill(value);
        const before = [...calls];
        await submit(page, action);
        await closeError(page);
        expect(calls).toEqual(before);
        await expect(page.locator('.counts')).toHaveText('1–45 of 45');
    }
    await size.fill('1');
    await submit(page, 'name');
    await expect(page.locator('.counts')).toHaveText('1–1 of 45');
});

test('event pagination retains the committed size while the draft changes or is invalid', async ({ page }) => {
    const { searches } = await openEvents(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await size.fill('37');
    await submit(page, 'size');
    await expect(page.locator('.counts')).toHaveText('1–37 of 45');
    await size.fill('1');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('38–45 of 45');
    expect(searches.at(-1)).toEqual({ offset: 37, limit: 37 });
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await size.fill('');
    await page.getByRole('button', { name: 'Prev', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('1–37 of 45');
    expect(searches.at(-1)).toEqual({ offset: 0, limit: 37 });
});

test('event browser edits do not persist over the configured default', async ({ page }) => {
    await page.addInitScript(key => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ eventPageSize: 37 }));
    }, preferenceKey);
    const { searches } = await openEvents(page);
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await expect(size).toHaveValue('37');
    expect(searches).toEqual([{ offset: 0, limit: 37 }]);
    await size.fill('1');
    await submit(page, 'size');
    await expect(page.locator('.counts')).toHaveText('1–1 of 45');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).eventPageSize, preferenceKey)).toBe(37);
    await page.reload();
    await expect(size).toHaveValue('37');
    await expect(page.locator('.counts')).toHaveText('1–37 of 45');
});

for (const failure of ['search', 'count']) {
    test(`custom event page sizes can be retried after ${failure} failure`, async ({ page }) => {
        let fail = false;
        const { searches } = await openEvents(page, {
            [`GET /events${failure === 'count' ? '/count' : ''}`]: (request: Request) => fail
                ? { __status: 500, body: { error: `${failure} unavailable` } }
                : failure === 'count' ? { long: 45 } : eventResponse(request),
        });
        fail = true;
        await page.getByRole('spinbutton', { name: 'Page Size', exact: true }).fill('1');
        await submit(page, 'size');
        await closeError(page, `${failure} unavailable`);
        fail = false;
        await submit(page, 'size');
        await expect(page.locator('.counts')).toHaveText('1–1 of 45');
        expect(searches.at(-1)).toEqual({ offset: 0, limit: 1 });
    });
}

for (const replacement of ['invalid', 'newer'] as const) {
    test(`pending event page-size search ${replacement === 'invalid' ? 'survives invalid input' : 'yields to a newer search'}`, async ({ page }) => {
        let release!: () => void;
        let counts = 0;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const { searches, calls } = await openEvents(page, { 'GET /events': async (request: Request) => {
            if (replacement === 'invalid' && new URL(request.url()).searchParams.get('limit') === '37') await gate;
            return eventResponse(request);
        }, 'GET /events/count': async () => {
            if (++counts === 2 && replacement === 'newer') await gate;
            return { long: 45 };
        } });
        const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
        try {
            await size.fill('37');
            await submit(page, 'size');
            await expect.poll(() => searches.at(-1)?.limit).toBe(37);
            await expect.poll(() => calls.length).toBe(4);
            await size.fill(replacement === 'invalid' ? '' : '1');
            await submit(page, 'size');
            if (replacement === 'invalid') { await closeError(page); expect(calls).toHaveLength(4); }
            else await expect(page.locator('.counts')).toHaveText('1–1 of 45');
            const completed = page.waitForResponse(response => replacement === 'newer'
                ? new URL(response.url()).pathname === '/api/events/count'
                : new URL(response.url()).pathname === '/api/events' && new URL(response.url()).searchParams.get('limit') === '37');
            release();
            await (await completed).finished();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect(page.locator('.counts')).toHaveText(replacement === 'invalid' ? '1–37 of 45' : '1–1 of 45');
        } finally { release(); }
    });
}

test('narrow event filters retain an invalid draft after the error is acknowledged', async ({ page }) => {
    const { calls } = await openEvents(page, {}, 700);
    const filters = page.getByRole('button', { name: 'Filters', exact: true });
    const size = page.getByRole('spinbutton', { name: 'Page Size', exact: true });
    await filters.click();
    await size.fill('0');
    const before = [...calls];
    await submit(page, 'criteria');
    await closeError(page);
    expect(calls).toEqual(before);
    await expect(size).toHaveCount(0);
    await filters.click();
    await expect(size).toHaveValue('0');
    await submit(page, 'size');
    await closeError(page);
    expect(calls).toEqual(before);
    if (!await size.isVisible()) await filters.click();
    await expect(size).toHaveValue('0');
    await size.fill('1');
    await submit(page, 'size');
    await expect(page.locator('.counts')).toHaveText('1–1 of 45');
});
