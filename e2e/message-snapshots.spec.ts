import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const message = (id: number) => ({ messageId: String(id), channelId: 'c-started',
    connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } } });
const rows = (ids: number[]) => ({ list: { message: ids.map(message) } });
async function search(page: any, text: string) {
    await page.getByPlaceholder('Search message content…').fill(text);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
}
async function closeError(page: any) {
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
}

test('F05: failed search retains the displayed filter and its original message boundary for removal', async ({ page }) => {
    let maximum = 12345, removed: URLSearchParams | undefined;
    await mockEngine(page, {
        'GET /channels/c-started/messages/maxMessageId': () => ({ long: maximum }),
        'GET /channels/c-started/messages': (req: any) => new URL(req.url()).searchParams.get('textSearch') === 'failed-filter'
            ? { __status: 503, body: 'search failed' } : rows([12345]),
        'DELETE /channels/c-started/messages': (req: any) => { removed = new URL(req.url()).searchParams; return ''; },
    });
    await page.goto('/messages/c-started');
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    await search(page, 'displayed-filter');
    await expect(page.getByText(/Current Search:.*displayed-filter/)).toBeVisible();
    maximum = 99999; // New messages must not enter the older confirmed result set.
    await search(page, 'failed-filter');
    await closeError(page);
    await expect(page.getByText(/Current Search:.*displayed-filter/)).toBeVisible();
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Results', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Results', exact: true });
    await confirm.locator('input').fill('REMOVE');
    await confirm.getByRole('button', { name: 'OK', exact: true }).click();
    await expect.poll(() => removed?.get('textSearch')).toBe('displayed-filter');
    expect(removed?.get('maxMessageId')).toBe('12345');
});

for (const action of ['Remove Results', 'Reprocess Results', 'Export Results']) {
    test(`F05: ${action} rejects a count superseded by another search`, async ({ page }) => {
        let countStarted = false, writes = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            'GET /channels/c-started/messages': (req: any) => new URL(req.url()).searchParams.has('textSearch') ? rows([999])
                : rows(Array.from({ length: 21 }, (_, i) => 100 + i)),
            'DELETE /channels/c-started/messages': () => { writes++; return ''; },
            'POST /channels/c-started/messages/_reprocess': () => { writes++; return ''; },
            'POST /channels/c-started/messages/_export': () => { writes++; return ''; },
        });
        await page.route('**/api/channels/c-started/messages/count*', async route => {
            countStarted = true;
            await gate;
            await route.fulfill({ json: { long: 21 } });
        });
        await page.goto('/messages/c-started');
        await expect(page.getByRole('cell', { name: '100', exact: true })).toBeVisible();
        await page.getByRole('button', { name: action, exact: true }).click();
        await expect.poll(() => countStarted).toBe(true);
        await search(page, 'newer');
        await expect(page.getByText('999', { exact: true })).toBeVisible();
        release();
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Search changed');
        expect(writes).toBe(0);
        await closeError(page);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

test('F05: an in-flight replacement blocks operations and a superseded response cannot replace an empty result', async ({ page }) => {
    let release!: () => void, delayed = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page);
    await page.route('**/api/channels/c-started/messages?*', async route => {
        const term = new URL(route.request().url()).searchParams.get('textSearch');
        if (term === 'slow') { delayed = true; await gate; }
        await route.fulfill({ json: rows(term === 'empty' ? [] : [12345]) });
    });
    await page.goto('/messages/c-started');
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    await search(page, 'slow');
    await expect.poll(() => delayed).toBe(true);
    await page.getByRole('button', { name: 'Remove Results', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('still loading');
    await closeError(page);
    await search(page, 'empty');
    await expect(page.getByText(/Current Search:.*empty/)).toBeVisible();
    release();
    await expect(page.getByText('12345', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Current Search:.*empty/)).toBeVisible();
});

test('F05: changing the search after confirmation opens cancels removal', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, {
        'GET /channels/c-started/messages': (req: any) => rows([new URL(req.url()).searchParams.has('textSearch') ? 999 : 12345]),
        'DELETE /channels/c-started/messages': () => { writes++; return ''; },
    });
    await page.goto('/messages/c-started');
    await expect(page.getByText('12345', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Search message content…').fill('replacement');
    await page.getByRole('button', { name: 'Remove Results', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Results', exact: true });
    await expect(confirm).toBeVisible();
    // A refresh can also be triggered programmatically while a modal is open.
    await page.getByRole('button', { name: 'Search', exact: true, includeHidden: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('cell', { name: '999', exact: true, includeHidden: true })).toHaveCount(1);
    await confirm.locator('input').fill('REMOVE');
    await confirm.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Search changed');
    expect(writes).toBe(0);
});

test('F05: failed paging retains its cursor and a failed boundary lookup does not issue an unbounded search', async ({ page }) => {
    let boundaryFailed = false, searches = 0;
    await mockEngine(page, {
        'GET /channels/c-started/messages/maxMessageId': () => boundaryFailed ? { __status: 503 } : { long: 120 },
        'GET /channels/c-started/messages': (req: any) => {
            searches++;
            return Number(new URL(req.url()).searchParams.get('offset')) > 0
                ? { __status: 503 } : rows(Array.from({ length: 21 }, (_, i) => 100 + i));
        },
    });
    await page.goto('/messages/c-started');
    await expect(page.getByRole('cell', { name: '100', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next ›', exact: true }).click();
    await closeError(page);
    await expect(page.getByRole('button', { name: '‹ Prev', exact: true })).toBeDisabled();
    await expect(page.getByRole('cell', { name: '100', exact: true })).toBeVisible();
    boundaryFailed = true;
    await search(page, 'must-not-run');
    await closeError(page);
    expect(searches).toBe(2);
    await expect(page.getByText(/Current Search:.*must-not-run/)).toHaveCount(0);
});
