import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const CID = 'c-started';
const PATH = `/channels/${CID}/messages`;
const message = (id: number, channelId = CID) => ({ messageId: String(id), channelId,
    connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } } });
const rows = Array.from({ length: 21 }, (_, index) => message(1000 - index));
const feedback = (page: Page) => page.getByRole('status').filter({ hasText: /^Search/ });
const results = (page: Page) => page.getByRole('region', { name: 'Message results', exact: true });
const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
};
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function open(page: Page, fixtures = {}, query = '') {
    await page.setViewportSize({ width: 1600, height: 900 });
    await mockEngine(page, {
        [`GET ${PATH}`]: { list: { message: rows } },
        [`GET ${PATH}/count`]: { long: rows.length },
        'GET /channels/idsAndNames': { map: { entry: [{ string: [CID, 'Demo Started'] }, { string: ['c-stopped', 'Demo Stopped'] }] } },
        ...fixtures,
    });
    await page.goto(`/messages/${CID}${query}`);
}

async function closeError(page: Page) {
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
}

test('pending replacements remain visible with collapsed filters and guard stale paging and Count clicks', async ({ page }) => {
    const hold = gate();
    let searches = 0, counts = 0;
    await open(page, {
        [`GET ${PATH}`]: async () => {
            if (++searches > 1) await hold.promise;
            return { list: { message: rows } };
        },
        [`GET ${PATH}/count`]: () => { counts++; return { long: rows.length }; },
    });
    try {
        await expect(feedback(page)).toHaveText('Search complete.');
        await expect(page.getByRole('button', { name: 'Next ›', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Count', exact: true })).toBeEnabled();
        await page.getByPlaceholder('Search message content…').fill('staged criterion');
        // Run all three handlers before React can render disabled controls.
        // The refs must protect the displayed cursor at action time too.
        await page.evaluate(() => {
            const click = (label: string) => (Array.from(document.querySelectorAll('button'))
                .find(button => button.textContent === label) as HTMLButtonElement).click();
            click('Search'); click('Next ›'); click('Count');
        });
        await expect.poll(() => searches).toBe(2);
        await expect(feedback(page)).toHaveText('Searching messages…');
        // Progress belongs to the existing header, without another row of
        // spacing between the criteria panel and results.
        const assertCompactFeedback = async () => {
            const geometry = await feedback(page).evaluate(element => {
                const panel = document.querySelector('.filter-collapse')!.getBoundingClientRect();
                const table = document.querySelector('[aria-label="Message results"] .dt-wrap')!.getBoundingClientRect();
                const text = document.createRange();
                text.selectNodeContents(element.lastElementChild!);
                return { inHeader: !!element.closest('.panel-header'), gap: table.top - panel.bottom,
                    right: text.getBoundingClientRect().right, viewport: innerWidth };
            });
            expect(geometry.inHeader).toBe(true);
            expect(geometry.gap).toBeLessThanOrEqual(26);
            expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
        };
        await assertCompactFeedback();
        await expect(results(page)).toHaveAttribute('aria-busy', 'true');
        expect(await feedback(page).evaluate(element => !!element.closest('[aria-busy="true"]'))).toBe(false);
        const search = page.getByRole('button', { name: 'Search', exact: true });
        await expect(search).toBeEnabled();
        await expect(search).toHaveAttribute('aria-busy', 'true');
        await expect(search.locator('.msg-search-spinner')).toBeVisible();
        for (const label of ['« First', '‹ Prev', 'Next ›', 'Last »', 'Count']) {
            await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
        }
        await expect(page.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(feedback(page)).toContainText('Searching messages…');
        await page.getByRole('button', { name: 'Search Criteria', exact: true }).click();
        await expect(feedback(page)).toBeVisible();
        await page.setViewportSize({ width: 800, height: 900 });
        await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
        await expect(feedback(page)).toBeVisible();
        await expect(search).toHaveCount(0);
        const filtersBox = await page.getByRole('button', { name: 'Filters', exact: true }).boundingBox();
        expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(800);
        await assertCompactFeedback();
        hold.release();
        await expect(feedback(page)).toHaveText('Search complete.');
        await expect(results(page)).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByRole('button', { name: 'Next ›', exact: true })).toBeEnabled();
        expect(searches).toBe(2);
        expect(counts).toBe(0);
    } finally { hold.release(); }
});

test('a failed replacement preserves the completed result and a retry can complete with no matches', async ({ page }) => {
    let searches = 0, fail = false, empty = false, counts = 0;
    await open(page, {
        [`GET ${PATH}`]: () => {
            searches++;
            return fail ? { __status: 503, body: { error: 'Search unavailable' } } : { list: { message: empty ? [] : rows } };
        },
        [`GET ${PATH}/count`]: () => { counts++; return { long: rows.length }; },
    });
    await expect(feedback(page)).toHaveText('Search complete.');
    const summary = await page.getByText(/^Current Search:/).textContent();
    const countsBefore = await page.locator('.counts').textContent();
    fail = true;
    await page.getByPlaceholder('Search message content…').fill('new criteria');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await closeError(page);
    await expect(feedback(page)).toHaveText('Search failed. Try Search again.');
    await expect(page.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
    await expect(page.getByText(/^Current Search:/)).toHaveText(summary!);
    await expect(page.locator('.counts')).toHaveText(countsBefore!);
    await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
    await expect(results(page)).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Count', exact: true }).click();
    await expect(page.locator('.counts')).toHaveText('1–20 of 21');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(feedback(page)).toContainText('Search failed.');
    fail = false; empty = true;
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(feedback(page)).toHaveText('Search complete. No messages found.');
    await expect(results(page)).toContainText('No messages found');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(feedback(page)).toHaveText('Search complete. No messages found.');
    expect(searches).toBe(3);
    expect(counts).toBe(1);
});

for (const failure of ['metadata', 'boundary', 'position', 'messages']) {
    test(`an initial ${failure} failure is not reported as an empty success and can be retried`, async ({ page }) => {
        let fail = true, searches = 0;
        const refused = { __status: 503, body: { error: `${failure} unavailable` } };
        await open(page, {
            [`GET /channels/${CID}/metaDataColumns`]: () => failure === 'metadata' && fail ? refused : { list: {} },
            [`GET ${PATH}/maxMessageId`]: () => failure === 'boundary' && fail ? refused : { long: 1000 },
            [`GET ${PATH}/count`]: () => failure === 'position' && fail ? refused : { long: 2 },
            [`GET ${PATH}`]: () => { searches++; return failure === 'messages' && fail ? refused : { list: { message: [message(42)] } }; },
        }, failure === 'position' ? '?messageId=42' : '');
        await closeError(page);
        await expect(feedback(page)).toContainText(failure === 'metadata' ? 'Search could not start.' : 'Search failed.');
        await expect(results(page)).toHaveAttribute('aria-busy', 'false');
        await expect(results(page)).toContainText('Search did not complete.');
        await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
        expect(searches).toBe(failure === 'messages' ? 1 : 0);
        fail = false;
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(feedback(page)).toHaveText('Search complete.');
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
    });
}

for (const failure of ['connectorNames', 'idsAndNames']) {
    test(`${failure} discovery failure does not mislabel a successful message search`, async ({ page }) => {
        const path = failure === 'connectorNames' ? `/channels/${CID}/connectorNames` : '/channels/idsAndNames';
        await open(page, { [`GET ${path}`]: { __status: 503, body: { error: 'Names unavailable' } } });
        await closeError(page);
        await expect(feedback(page)).toHaveText('Search complete.');
        await expect(page.getByRole('cell', { name: '1000', exact: true })).toBeVisible();
    });
}

for (const olderFails of [false, true]) {
    for (const olderFirst of [false, true]) {
        test(`superseded ${olderFails ? 'failure' : 'success'} ${olderFirst ? 'before' : 'after'} the latest response cannot change its feedback`, async ({ page }) => {
            const old = gate(), latest = gate();
            let searches = 0;
            await open(page, {
                [`GET ${PATH}`]: async () => {
                    const call = ++searches;
                    if (call === 2) {
                        await old.promise;
                        return olderFails ? { __status: 503, body: { error: 'Old search failed' } } : { list: { message: [message(2)] } };
                    }
                    if (call === 3) { await latest.promise; return { list: { message: [] } }; }
                    return { list: { message: [message(1)] } };
                },
            });
            try {
                await expect(feedback(page)).toHaveText('Search complete.');
                await page.getByRole('button', { name: 'Search', exact: true }).click();
                await expect.poll(() => searches).toBe(2);
                await page.getByPlaceholder('Search message content…').fill('latest');
                await page.getByPlaceholder('Search message content…').press('Enter');
                await expect.poll(() => searches).toBe(3);
                const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api${PATH}`);
                if (olderFirst) {
                    old.release();
                    await (await oldResponse).finished();
                    await settle(page);
                    await expect(feedback(page)).toHaveText('Searching messages…');
                    await expect(results(page)).toHaveAttribute('aria-busy', 'true');
                    latest.release();
                    await expect(feedback(page)).toHaveText('Search complete. No messages found.');
                } else {
                    latest.release();
                    await expect(feedback(page)).toHaveText('Search complete. No messages found.');
                    const finished = page.waitForResponse(response => new URL(response.url()).pathname === `/api${PATH}`);
                    old.release();
                    await (await finished).finished();
                    await settle(page);
                }
                await expect(feedback(page)).toHaveText('Search complete. No messages found.');
                await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
                await expect(page.getByRole('cell', { name: '2', exact: true })).toHaveCount(0);
                await expect(page.getByText(/^Current Search:/)).toContainText('latest');
            } finally { old.release(); latest.release(); }
        });
    }
}

test('an earlier Count cannot end a pending search or change the latest pager', async ({ page }) => {
    const count = gate(), search = gate();
    let searches = 0, counts = 0;
    await open(page, {
        [`GET ${PATH}`]: async () => { if (++searches > 1) await search.promise; return { list: { message: rows } }; },
        [`GET ${PATH}/count`]: async () => { counts++; await count.promise; return { long: 100 }; },
    });
    try {
        await expect(feedback(page)).toHaveText('Search complete.');
        await page.getByRole('button', { name: 'Count', exact: true }).click();
        await expect.poll(() => counts).toBe(1);
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect.poll(() => searches).toBe(2);
        const counted = page.waitForResponse(response => new URL(response.url()).pathname === `/api${PATH}/count`);
        count.release();
        await (await counted).finished();
        await settle(page);
        await expect(feedback(page)).toContainText('Searching messages…');
        await expect(results(page)).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.counts')).toHaveText('1–20 of ?');
        search.release();
        await expect(feedback(page)).toHaveText('Search complete.');
        await expect(page.locator('.counts')).toHaveText('1–20 of ?');
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
    } finally { count.release(); search.release(); }
});

test('a completed message removal refresh supersedes a pending response from before the write', async ({ page }) => {
    const hold = gate();
    let searches = 0, removed = false;
    await open(page, {
        [`GET ${PATH}`]: async () => {
            const snapshot = removed ? [] : [message(42)];
            if (++searches === 2) await hold.promise;
            return { list: { message: snapshot } };
        },
        [`GET ${PATH}/42`]: message(42),
        [`DELETE ${PATH}/42`]: () => { removed = true; return ''; },
    });
    try {
        await expect(feedback(page)).toHaveText('Search complete.');
        await page.getByRole('cell', { name: '42', exact: true }).click();
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect.poll(() => searches).toBe(2);
        await page.getByRole('button', { name: 'Remove Message', exact: true }).click();
        await page.getByRole('dialog', { name: 'Remove message', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
        await expect.poll(() => searches).toBe(3);
        await expect(feedback(page)).toHaveText('Search complete. No messages found.');
        const finished = page.waitForResponse(response => new URL(response.url()).pathname === `/api${PATH}`);
        hold.release();
        await (await finished).finished();
        await settle(page);
        await expect(feedback(page)).toHaveText('Search complete. No messages found.');
        await expect(page.getByRole('cell', { name: '42', exact: true })).toHaveCount(0);
        await expect(page.locator('.counts')).toHaveText('No results');
    } finally { hold.release(); }
});

test('an empty page after pruning reports only that page as empty', async ({ page }) => {
    await open(page, {
        [`GET ${PATH}`]: (request: Request) => ({ list: { message: new URL(request.url()).searchParams.get('offset') === '0' ? rows : [] } }),
    });
    await expect(feedback(page)).toHaveText('Search complete.');
    await page.getByRole('button', { name: 'Next ›', exact: true }).click();
    await expect(feedback(page)).toHaveText('Search complete. No messages on this page.');
    await expect(results(page)).toContainText('No messages on this page');
    await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
});

test('invalid navigation targets do not claim an empty search and a manual search recovers', async ({ page }) => {
    await open(page, {}, '?messageId=invalid');
    await expect(feedback(page)).toHaveText('Search not run. Check the message ID.');
    await expect(results(page)).toContainText('Search did not complete.');
    await expect(page.getByText('No messages found', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(feedback(page)).toHaveText('Search complete.');
});

for (const leave of ['channel', 'session']) {
    test(`late search feedback is discarded after a ${leave} change`, async ({ page }) => {
        const hold = gate();
        let searches = 0;
        await open(page, {
            [`GET ${PATH}`]: async () => {
                if (++searches > 1) { await hold.promise; return { __status: 503, body: { error: 'Old search failed' } }; }
                return { list: { message: rows } };
            },
            'GET /channels/c-stopped/messages': { list: { message: [message(77, 'c-stopped')] } },
            'GET /session-expiry-probe': { __status: 401 },
        });
        try {
            await expect(feedback(page)).toHaveText('Search complete.');
            await page.getByRole('button', { name: 'Search', exact: true }).click();
            await expect.poll(() => searches).toBe(2);
            if (leave === 'channel') {
                await page.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('c-stopped');
                await expect(page.getByRole('cell', { name: '77', exact: true })).toBeVisible();
            } else {
                await page.evaluate(async () => {
                    const api = await import(String('/core/api.js'));
                    await api.get('/session-expiry-probe').catch(() => {});
                });
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            }
            const finished = page.waitForResponse(response => new URL(response.url()).pathname === `/api${PATH}`);
            hold.release();
            await (await finished).finished();
            await settle(page);
            await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
            if (leave === 'channel') await expect(feedback(page)).toHaveText('Search complete.');
            else await expect(feedback(page)).toHaveCount(0);
        } finally { hold.release(); }
    });
}

test('pending search indicators respect reduced motion', async ({ page }) => {
    const hold = gate();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { [`GET ${PATH}`]: async () => { await hold.promise; return { list: { message: [] } }; } });
    try {
        await expect(feedback(page)).toHaveText('Searching messages…');
        const spinners = page.locator('.msg-search-spinner');
        await expect(spinners).toHaveCount(2);
        expect(await spinners.evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === 'none'))).toBe(true);
        hold.release();
        await expect(feedback(page)).toHaveText('Search complete. No messages found.');
    } finally { hold.release(); }
});

for (const width of [800, 500]) {
    test(`metadata failure feedback uses the full narrow row at ${width}px`, async ({ page }, testInfo) => {
        await open(page, {
            [`GET /channels/${CID}/metaDataColumns`]: { __status: 503, body: { error: 'Metadata unavailable' } },
        });
        await closeError(page);
        await page.setViewportSize({ width, height: 900 });
        // Resizing to phone width turns the expanded navigation into a drawer.
        const backdrop = page.locator('.rail-backdrop');
        if (await backdrop.isVisible()) await backdrop.click();
        await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
        await expect(feedback(page)).toHaveText('Search could not start. Channel metadata failed to load. Try Search again.');
        const geometry = await feedback(page).evaluate(element => {
            const text = element.lastElementChild!;
            return {
                width: element.getBoundingClientRect().width,
                rowWidth: element.parentElement!.getBoundingClientRect().width,
                textHeight: text.getBoundingClientRect().height,
                lineHeight: parseFloat(getComputedStyle(text).lineHeight),
            };
        });
        expect(geometry.width).toBeGreaterThanOrEqual(geometry.rowWidth - 1);
        expect(geometry.textHeight).toBeLessThanOrEqual(geometry.lineHeight * (width === 500 ? 2 : 1) + 1);
        await page.screenshot({ path: testInfo.outputPath('narrow-metadata-failure.png'), animations: 'disabled' });
    });
}

for (const action of ['Next ›', '‹ Prev', '« First', 'Last »', 'Remove Message']) {
    test(`${action} failure does not suggest Search as a retry of the displayed result`, async ({ page }) => {
        let fail = false;
        const requests: URLSearchParams[] = [];
        await open(page, {
            [`GET ${PATH}`]: (request: Request) => {
                const params = new URL(request.url()).searchParams;
                requests.push(params);
                if (fail) return { __status: 503, body: { error: 'Messages unavailable' } };
                return { list: { message: Array.from({ length: 21 }, (_, i) => message(1000 - Number(params.get('offset')) - i)) } };
            },
            [`GET ${PATH}/count`]: { long: 100 },
            [`GET ${PATH}/980`]: message(980),
            [`DELETE ${PATH}/980`]: () => { fail = true; return ''; },
        });
        await expect(feedback(page)).toHaveText('Search complete.');
        await page.getByRole('button', { name: 'Count', exact: true }).click();
        await expect(page.locator('.counts')).toHaveText('1–20 of 100');
        await page.getByRole('button', { name: 'Next ›', exact: true }).click();
        await expect(page.locator('.counts')).toHaveText('21–40 of 100');
        const summary = await page.getByText(/^Current Search:/).textContent();
        // Staged criteria differ from the committed result used by paging and
        // post-write refreshes. Search would start a different query at page 1.
        await page.getByPlaceholder('Search message content…').fill('staged criteria');
        if (action === 'Remove Message') {
            await page.getByRole('cell', { name: '980', exact: true }).click();
            await page.getByRole('button', { name: action, exact: true }).click();
            await page.getByRole('dialog', { name: 'Remove message', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
        } else {
            fail = true;
            await page.getByRole('button', { name: action, exact: true }).click();
        }
        await closeError(page);
        await expect(feedback(page)).toHaveText('Search failed.');
        await expect(page.locator('.counts')).toHaveText('21–40 of 100');
        await expect(page.getByText(/^Current Search:/)).toHaveText(summary!);
        expect(requests.at(-1)!.get('textSearch')).toBeNull();
        expect(requests.at(-1)!.get('offset')).toBe(action === 'Next ›' ? '40' : action === 'Last »' ? '80' : action === 'Remove Message' ? '20' : '0');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await closeError(page);
        await expect(feedback(page)).toHaveText('Search failed. Try Search again.');
        expect(requests.at(-1)!.get('textSearch')).toBe('staged criteria');
        expect(requests.at(-1)!.get('offset')).toBe('0');
    });
}
