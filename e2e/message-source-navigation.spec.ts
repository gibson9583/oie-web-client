import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const ORIGIN = 'c-started';
const UPSTREAM = 'c-stopped';
const ORIGINAL_ID = '12345';
const LARGE_ID = '9223372036854775807';
const map = (entry: any[]) => ({ content: { map: { entry } } });
const singular = (channelId = UPSTREAM, messageId = '42') => map([
    { string: ['sourceChannelId', channelId] },
    { string: 'sourceMessageId', long: messageId },
]);

function message(channelId: string, messageId: string, sourceMapContent = map([])) {
    return {
        channelId, messageId, processed: true,
        connectorMessages: { entry: [
            { int: 0, connectorMessage: {
                metaDataId: 0, connectorName: 'Source', status: 'RECEIVED', sourceMapContent,
                raw: { content: `Source ${channelId}/${messageId}` },
            } },
            { int: 1, connectorMessage: {
                metaDataId: 1, connectorName: 'HTTP Sender', status: 'SENT', sourceMapContent,
                encoded: { content: `Destination ${channelId}/${messageId}` },
            } },
        ] },
    };
}

function matchingMessages(messages: ReturnType<typeof message>[], request: Request) {
    const url = new URL(request.url());
    const channelId = decodeURIComponent(url.pathname.split('/')[3]);
    const min = url.searchParams.get('minMessageId');
    const max = url.searchParams.get('maxMessageId');
    const text = url.searchParams.get('textSearch');
    return messages.filter(m => m.channelId === channelId
        && (min == null || BigInt(m.messageId) >= BigInt(min))
        && (max == null || BigInt(m.messageId) <= BigInt(max))
        && (!text || `Source ${channelId}/${m.messageId}`.includes(text)))
        .sort((a, b) => BigInt(a.messageId) > BigInt(b.messageId) ? -1 : 1);
}

// Explicit engine fixtures model descending IDs, ranges, counts and paging;
// missing message details fail instead of silently returning fallback data.
async function setup(page: Page, messages: ReturnType<typeof message>[], overrides = {}) {
    const searches: Request[] = [];
    const details: Request[] = [];
    const counts: Request[] = [];
    const maxima: Request[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'GET' && /^\/api\/channels\/[^/]+\/messages$/.test(path)) searches.push(request);
        if (/^\/api\/channels\/[^/]+\/messages\/\d+$/.test(path)) details.push(request);
        if (path.endsWith('/messages/count')) counts.push(request);
        if (path.endsWith('/messages/maxMessageId')) maxima.push(request);
    });
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value: string) => { (window as any).copiedMessage = value; } },
    }));
    await mockEngine(page, {
        'GET /channels/idsAndNames': { map: { entry: [
            { string: [ORIGIN, 'Origin'] }, { string: [UPSTREAM, 'Upstream'] },
        ] } },
        'GET /channels/*/metaDataColumns': '',
        'GET /channels/*/messages/maxMessageId': (request: Request) => {
            expect(request.headers().accept).toBe('application/xml');
            return `<long>${matchingMessages(messages, request)[0]?.messageId ?? '0'}</long>`;
        },
        'GET /channels/*/messages/count': (request: Request) => ({ long: matchingMessages(messages, request).length }),
        'GET /channels/*/messages': (request: Request) => {
            const params = new URL(request.url()).searchParams;
            const offset = Number(params.get('offset'));
            const limit = Number(params.get('limit'));
            return { list: { message: matchingMessages(messages, request).slice(offset, offset + limit) } };
        },
        'GET /channels/*/messages/*': (request: Request) => {
            const parts = new URL(request.url()).pathname.split('/');
            return messages.find(m => m.channelId === decodeURIComponent(parts[3]) && m.messageId === parts[5])
                ?? { __status: 404, body: { error: 'Unexpected message detail request' } };
        },
        'GET /channels/*/messages/*/attachments': { list: [] },
        ...overrides,
    });
    return { searches, details, counts, maxima };
}

function mappingTable(page: Page) {
    return page.locator('table.dt').filter({ has: page.getByRole('columnheader', { name: 'Scope', exact: true }) });
}

async function openOriginMappings(page: Page, destination = false) {
    await page.goto(`/messages/${ORIGIN}`);
    await page.getByRole('cell', { name: destination ? 'HTTP Sender' : ORIGINAL_ID, exact: true }).click();
    await page.getByRole('tab', { name: 'Mappings', exact: true }).click();
}

async function expectSourceContent(page: Page, channelId: string, messageId: string) {
    await expect(page.locator('table.msg-table tr.selected')).toContainText(messageId);
    await expect(page.locator('table.msg-table tr.selected')).toBeInViewport();
    await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(await page.evaluate(() => (window as any).copiedMessage)).toBe(`Source ${channelId}/${messageId}`);
}

function expectPageSearch(request: Request, channelId: string, maximum: string, offset = 0) {
    const url = new URL(request.url());
    expect(url.pathname).toBe(`/api/channels/${channelId}/messages`);
    expect(url.searchParams.has('minMessageId')).toBe(false);
    expect(url.searchParams.get('maxMessageId')).toBe(maximum);
    expect(url.searchParams.get('offset')).toBe(String(offset));
    expect(url.searchParams.get('limit')).toBe('21');
}

function gappedMessages() {
    return Array.from({ length: 45 }, (_, i) => message(UPSTREAM, String(300 - i * 3)));
}

async function expectEmptyAdvancedBounds(page: Page) {
    await page.getByRole('button', { name: 'Advanced…', exact: true }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced Search Filter', exact: true });
    await expect(advanced.locator('input[type="number"]').nth(0)).toHaveValue('');
    await expect(advanced.locator('input[type="number"]').nth(1)).toHaveValue('');
    await advanced.getByRole('button', { name: 'Cancel', exact: true }).click();
}

test('source navigation finds first, boundary, middle and last pages despite gaps in IDs', async ({ page }) => {
    const rows = gappedMessages();
    const { searches, counts, details } = await setup(page, rows);
    for (const index of [0, 19, 20, 30, 44]) {
        const before = searches.length;
        const target = rows[index].messageId;
        const offset = Math.floor(index / 20) * 20;
        await page.goto(`/messages/${UPSTREAM}?messageId=${target}`);
        await expectSourceContent(page, UPSTREAM, target);
        expect(searches).toHaveLength(before + 1);
        expectPageSearch(searches.at(-1)!, UPSTREAM, '300', offset);
        for (const row of rows.slice(offset, offset + 20)) {
            await expect(page.getByRole('cell', { name: row.messageId, exact: true })).toBeVisible();
        }
        if (index > 0) {
            const params = new URL(counts.at(-1)!.url()).searchParams;
            expect(params.get('minMessageId')).toBe(target);
            expect(params.get('maxMessageId')).toBe('300');
        }
        await expect(page.getByRole('button', { name: '‹ Prev', exact: true })).toBeEnabled({ enabled: offset > 0 });
        await expect(page.getByRole('button', { name: 'Next ›', exact: true })).toBeEnabled({ enabled: offset + 20 < rows.length });
        if (index === 20) {
            const fullCount = page.waitForResponse(response => {
                const url = new URL(response.url());
                return url.pathname.endsWith('/messages/count') && !url.searchParams.has('minMessageId');
            });
            await page.getByRole('button', { name: 'Count', exact: true }).click();
            await (await fullCount).finished();
            expect(new URL(counts.at(-1)!.url()).searchParams.get('maxMessageId')).toBe('300');
        }
    }
    expect(details).toHaveLength(5);
    // Paging after target selection keeps the complete channel result set.
    await page.getByRole('button', { name: '‹ Prev', exact: true }).click();
    await expect(page.getByRole('cell', { name: rows[20].messageId, exact: true })).toBeVisible();
    expectPageSearch(searches.at(-1)!, UPSTREAM, '300', 20);
    await expect(page.locator('table.msg-table tr.selected')).toHaveCount(0);
});

test('source navigation freezes its maximum across arrivals and corrects a pruning page shift', async ({ page }) => {
    const rows = gappedMessages();
    let mutate: 'arrival' | 'prune' | null = 'arrival';
    const { searches, counts } = await setup(page, rows, {
        [`GET /channels/${UPSTREAM}/messages/count`]: (request: Request) => {
            const count = matchingMessages(rows, request).length;
            if (mutate === 'arrival') rows.unshift(message(UPSTREAM, '303'));
            if (mutate === 'prune') rows.splice(0, 2);
            mutate = null;
            return { long: count };
        },
    });
    await page.goto(`/messages/${UPSTREAM}?messageId=243`);
    await expectSourceContent(page, UPSTREAM, '243');
    expectPageSearch(searches[0], UPSTREAM, '300');
    await expect(page.getByRole('cell', { name: '303', exact: true })).toHaveCount(0);
    expect(counts).toHaveLength(1);

    // Target240 starts at index21 after arrival; pruning two newer rows moves
    // it to index19, outside the originally calculated page.
    mutate = 'prune';
    await page.goto(`/messages/${UPSTREAM}?messageId=240`);
    await expectSourceContent(page, UPSTREAM, '240');
    expectPageSearch(searches[1], UPSTREAM, '303', 20);
    expectPageSearch(searches[2], UPSTREAM, '303', 0);
    expect(counts).toHaveLength(3);
    expect(searches).toHaveLength(3);
});

test('a removed target leaves neighboring results usable without selecting another message', async ({ page }) => {
    const rows = gappedMessages().filter(row => row.messageId !== '240');
    const { searches, counts, details } = await setup(page, rows);
    await page.goto(`/messages/${UPSTREAM}?messageId=240`);
    await expect(page.getByText(/message 240.*could not be located/i)).toBeVisible();
    expect(details).toHaveLength(0);
    expect(counts).toHaveLength(2);
    expect(searches).toHaveLength(1);
    expectPageSearch(searches[0], UPSTREAM, '300', 0);
    await expect(page.getByRole('cell', { name: '243', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next ›', exact: true }).click();
    await page.getByRole('cell', { name: '237', exact: true }).click();
    await expectSourceContent(page, UPSTREAM, '237');
    expectPageSearch(searches[1], UPSTREAM, '300', 20);

    // A missing oldest target with exactly two pages must land on the second
    // real page, rather than calculating an empty page past the final result.
    rows.splice(40);
    await page.goto(`/messages/${UPSTREAM}?messageId=1`);
    await expect(page.getByText(/message 1.*could not be located/i)).toBeVisible();
    expectPageSearch(searches.at(-1)!, UPSTREAM, '300', 20);
    await expect(page.getByRole('cell', { name: rows[39].messageId, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next ›', exact: true })).toBeDisabled();
    expect(details).toHaveLength(1);
});

for (const action of ['Enter', 'Refresh']) {
    test(`source navigation permits ${action}, new searches, and manual exact criteria`, async ({ page }) => {
        const { searches } = await setup(page, [
            message(ORIGIN, ORIGINAL_ID, singular()), message(UPSTREAM, '42'), message(UPSTREAM, '43'),
        ]);
        await openOriginMappings(page);
        await mappingTable(page).getByRole('link', { name: '42', exact: true }).click();
        await expectSourceContent(page, UPSTREAM, '42');
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        expectPageSearch(searches[1], UPSTREAM, '43');
        await expectEmptyAdvancedBounds(page);

        const text = page.getByPlaceholder('Search message content…');
        await text.fill('43');
        if (action === 'Enter') await text.press('Enter');
        else await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(page.getByRole('cell', { name: '42', exact: true })).toHaveCount(0);
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/messages/${UPSTREAM}$`));
        expectPageSearch(searches[2], UPSTREAM, '43');
        expect(new URL(searches[2].url()).searchParams.get('textSearch')).toBe('43');

        await text.fill('');
        await page.getByRole('button', { name: 'Advanced…', exact: true }).click();
        const advanced = page.getByRole('dialog', { name: 'Advanced Search Filter', exact: true });
        await advanced.locator('input[type="number"]').nth(0).fill('42');
        await advanced.locator('input[type="number"]').nth(1).fill('42');
        await advanced.getByRole('button', { name: 'OK', exact: true }).click();
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toHaveCount(0);
        await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect.poll(() => searches.length).toBe(5);
        for (const request of searches.slice(3)) {
            const params = new URL(request.url()).searchParams;
            expect(params.get('minMessageId')).toBe('42');
            expect(params.get('maxMessageId')).toBe('42');
        }
        await page.reload();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        expectPageSearch(searches[5], UPSTREAM, '43');
    });
}

test('a delayed navigation count cannot replace a newer ordinary search', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let countStarted = false;
    const { searches, details } = await setup(page, [message(UPSTREAM, '42'), message(UPSTREAM, '43')], {
        [`GET /channels/${UPSTREAM}/messages/count`]: async () => {
            countStarted = true;
            await gate;
            return { long: 2 };
        },
    });
    try {
        await page.goto(`/messages/${UPSTREAM}?messageId=42`);
        await expect.poll(() => countStarted).toBe(true);
        expect(searches).toHaveLength(0);
        await page.getByPlaceholder('Search message content…').fill('43');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('cell', { name: '43', exact: true }).click();
        await expectSourceContent(page, UPSTREAM, '43');
        const finished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/messages/count'));
        release();
        await (await finished).finished();
        await expectSourceContent(page, UPSTREAM, '43');
        expect(searches).toHaveLength(1);
        expectPageSearch(searches[0], UPSTREAM, '43');
        expect(details).toHaveLength(1);
    } finally {
        release();
    }
});

for (const endpoint of ['maxMessageId', 'count', 'search', 'metadata']) {
    test(`a ${endpoint} failure is visible and an ordinary search can recover`, async ({ page }) => {
        const rows = [message(UPSTREAM, '42'), message(UPSTREAM, '43')];
        const path = endpoint === 'metadata' ? 'metaDataColumns'
            : endpoint === 'search' ? 'messages' : `messages/${endpoint}`;
        let attempts = 0;
        const { searches, details } = await setup(page, rows, {
            [`GET /channels/${UPSTREAM}/${path}`]: (request: Request) => {
                if (++attempts === 1) return { __status: 403, body: { error: `${endpoint} unavailable` } };
                if (endpoint === 'maxMessageId') return '<long>43</long>';
                if (endpoint === 'metadata') return '';
                if (endpoint === 'count') return { long: matchingMessages(rows, request).length };
                return { list: { message: matchingMessages(rows, request) } };
            },
        });
        await page.goto(`/messages/${UPSTREAM}?messageId=42`);
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toContainText(`${endpoint} unavailable`);
        expect(details).toHaveLength(0);
        expect(searches).toHaveLength(endpoint === 'search' ? 1 : 0);
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        await expect(page.locator('table.msg-table tr.selected')).toHaveCount(0);
        expectPageSearch(searches.at(-1)!, UPSTREAM, '43');
        await expect(page).toHaveURL(new RegExp(`/messages/${UPSTREAM}$`));
    });
}

test('result operations use the normal channel filter and cannot navigate after leaving', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let deletion: Request | undefined;
    const { searches } = await setup(page, [message(UPSTREAM, '42'), message(UPSTREAM, '43')], {
        [`DELETE /channels/${UPSTREAM}/messages`]: async (request: Request) => {
            deletion = request;
            await gate;
            return '';
        },
    });
    try {
        await page.goto(`/messages/${UPSTREAM}?messageId=42`);
        await expectSourceContent(page, UPSTREAM, '42');
        await page.getByRole('button', { name: 'Remove Results', exact: true }).click();
        const confirm = page.getByRole('dialog', { name: 'Remove Results', exact: true });
        await expect(confirm).toContainText('all 2 message(s)');
        await confirm.locator('input').fill('REMOVE');
        await confirm.getByRole('button', { name: 'OK', exact: true }).click();
        await expect.poll(() => !!deletion).toBe(true);
        const params = new URL(deletion!.url()).searchParams;
        expect(params.has('minMessageId')).toBe(false);
        expect(params.get('maxMessageId')).toBe('43');
        await page.getByRole('button', { name: 'Channels', exact: true }).click();
        await expect(page).toHaveURL(/\/channels$/);
        const finished = page.waitForResponse(response => response.request() === deletion);
        release();
        await (await finished).finished();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(page).toHaveURL(/\/channels$/);
        expect(searches).toHaveLength(1);
    } finally {
        release();
    }
});

test('singular source links from a destination open source content and preserve Back and reload', async ({ page }) => {
    const { searches, details } = await setup(page, [
        message(ORIGIN, ORIGINAL_ID, singular()), message(UPSTREAM, '42'),
    ]);
    await openOriginMappings(page, true);
    const links = mappingTable(page).getByRole('link');
    await expect(links).toHaveText([UPSTREAM, '42']);
    for (const link of await links.all()) {
        await expect(link).toHaveAttribute('href', `/messages/${UPSTREAM}?messageId=42`);
        await expect(link).toHaveAttribute('title', `Open message 42 in channel ${UPSTREAM}`);
    }
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`/messages/${UPSTREAM}\\?messageId=42$`));
    await expectSourceContent(page, UPSTREAM, '42');
    expectPageSearch(searches[1], UPSTREAM, '42');
    expect(new URL(details.at(-1)!.url()).pathname).toBe(`/api/channels/${UPSTREAM}/messages/42`);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/messages/${ORIGIN}\\?messageId=${ORIGINAL_ID}$`));
    await expectSourceContent(page, ORIGIN, ORIGINAL_ID);
    expectPageSearch(searches[2], ORIGIN, ORIGINAL_ID);
    await page.goForward();
    await expectSourceContent(page, UPSTREAM, '42');
    await page.reload();
    await expectSourceContent(page, UPSTREAM, '42');
    expect(searches).toHaveLength(5);
    searches.slice(3).forEach(request => expectPageSearch(request, UPSTREAM, '42'));
});

test('plural references pair repeated channels by index and support keyboard navigation within a channel', async ({ page }) => {
    const references = map([
        { string: 'sourceChannelIds', list: { string: [UPSTREAM, ORIGIN, UPSTREAM] } },
        { string: 'sourceMessageIds', list: { long: ['41', '42', '43'] } },
    ]);
    const { searches } = await setup(page, [
        message(ORIGIN, ORIGINAL_ID, references), message(UPSTREAM, '41'),
        message(ORIGIN, '42'), message(UPSTREAM, '43'),
    ]);
    await openOriginMappings(page);
    const rows = mappingTable(page).locator('tbody tr');
    const channels = rows.filter({ has: page.getByRole('cell', { name: 'sourceChannelIds', exact: true }) }).getByRole('link');
    const ids = rows.filter({ has: page.getByRole('cell', { name: 'sourceMessageIds', exact: true }) }).getByRole('link');
    await expect(channels).toHaveText([UPSTREAM, ORIGIN, UPSTREAM]);
    await expect(ids).toHaveText(['41', '42', '43']);
    for (const [i, channelId] of [UPSTREAM, ORIGIN, UPSTREAM].entries()) {
        const href = `/messages/${channelId}?messageId=${41 + i}`;
        await expect(channels.nth(i)).toHaveAttribute('href', href);
        await expect(ids.nth(i)).toHaveAttribute('href', href);
    }
    await ids.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/messages/${ORIGIN}\\?messageId=42$`));
    await expectSourceContent(page, ORIGIN, '42');
    expectPageSearch(searches[1], ORIGIN, ORIGINAL_ID);
});

test('malformed pairs and references outside the source map remain ordinary mapping values', async ({ page }) => {
    const origin = message(ORIGIN, ORIGINAL_ID, map([
        { string: ['sourceChannelId', UPSTREAM] },
        { string: 'sourceMessageId', long: '-42' },
        { string: 'sourceChannelIds', list: { string: [UPSTREAM, ORIGIN] } },
        { string: 'sourceMessageIds', list: { long: ['42'] } },
        { string: ['ordinaryValue', 'keep this value'] },
    ]));
    Object.assign(origin.connectorMessages.entry[0].connectorMessage, {
        connectorMapContent: singular(), channelMapContent: singular(), responseMapContent: singular(),
    });
    await setup(page, [origin]);
    await openOriginMappings(page);
    const mappings = mappingTable(page);
    await expect(mappings.locator('tbody tr')).toHaveCount(11);
    await expect(mappings.getByRole('link')).toHaveCount(0);
    await mappings.getByRole('cell', { name: 'ordinaryValue', exact: true }).dblclick();
    await expect(page.getByRole('dialog', { name: 'Mapping Value' })).toContainText('keep this value');
});

test('Long.MAX_VALUE source IDs stay exact in links, XML searches, and detail URLs', async ({ page }) => {
    const previous = String(BigInt(LARGE_ID) - 1n);
    const { searches, details, counts, maxima } = await setup(page, [
        message(ORIGIN, ORIGINAL_ID, singular(UPSTREAM, LARGE_ID)), message(UPSTREAM, LARGE_ID), message(UPSTREAM, previous),
    ]);
    await openOriginMappings(page);
    const link = mappingTable(page).getByRole('link', { name: LARGE_ID, exact: true });
    await expect(link).toHaveAttribute('href', `/messages/${UPSTREAM}?messageId=${LARGE_ID}`);
    await link.click();
    await expectSourceContent(page, UPSTREAM, LARGE_ID);
    expectPageSearch(searches[1], UPSTREAM, LARGE_ID);
    expect(searches[1].headers().accept).toBe('application/xml');
    expect(new URL(details.at(-1)!.url()).pathname).toBe(`/api/channels/${UPSTREAM}/messages/${LARGE_ID}`);
    expect(details.at(-1)!.headers().accept).toBe('application/xml');
    expect(maxima.at(-1)!.headers().accept).toBe('application/xml');
    await page.goto(`/messages/${UPSTREAM}?messageId=${previous}`);
    await expectSourceContent(page, UPSTREAM, previous);
    expectPageSearch(searches.at(-1)!, UPSTREAM, LARGE_ID);
    const params = new URL(counts.at(-1)!.url()).searchParams;
    expect(params.get('minMessageId')).toBe(previous);
    expect(params.get('maxMessageId')).toBe(LARGE_ID);
});

test('an absent source message reports unavailability without fetching a different message', async ({ page }) => {
    const { searches, details } = await setup(page, []);
    await page.goto(`/messages/${UPSTREAM}?messageId=42`);
    await expect(page.getByText(/message 42.*could not be located/i)).toBeVisible();
    expect(searches.length).toBeLessThanOrEqual(1);
    expect(details).toHaveLength(0);
    await expect(page.getByRole('tab', { name: 'Raw', exact: true })).toHaveCount(0);
});

test('invalid message query IDs fail without a broad search', async ({ page }) => {
    const { searches, details } = await setup(page, [message(ORIGIN, ORIGINAL_ID)]);
    for (const id of ['invalid', '0', '9223372036854775808', '']) {
        await page.goto(`/messages/${ORIGIN}?messageId=${id}`);
        await expect(page.getByText(/invalid message/i)).toBeVisible();
        expect(searches).toHaveLength(0);
        expect(details).toHaveLength(0);
    }
});

test('a delayed source detail cannot replace the originating message after Back', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let detailStarted = false;
    const upstream = message(UPSTREAM, '42');
    await setup(page, [message(ORIGIN, ORIGINAL_ID, singular()), upstream], {
        [`GET /channels/${UPSTREAM}/messages/42`]: async () => {
            detailStarted = true;
            await gate;
            return upstream;
        },
    });
    try {
        await openOriginMappings(page);
        await mappingTable(page).getByRole('link', { name: '42', exact: true }).click();
        await expect.poll(() => detailStarted).toBe(true);
        await page.goBack();
        await expectSourceContent(page, ORIGIN, ORIGINAL_ID);
        const finished = page.waitForResponse(response =>
            new URL(response.url()).pathname === `/api/channels/${UPSTREAM}/messages/42`);
        release();
        await (await finished).finished();
        await expectSourceContent(page, ORIGIN, ORIGINAL_ID);
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
    } finally {
        release();
    }
});

test('a manual search before channel names load supersedes source navigation', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let namesStarted = false;
    const { searches, details } = await setup(page, [message(UPSTREAM, '43')], {
        'GET /channels/idsAndNames': async () => {
            namesStarted = true;
            await gate;
            return { map: { entry: [{ string: [UPSTREAM, 'Upstream'] }] } };
        },
    });
    try {
        await page.goto(`/messages/${UPSTREAM}?messageId=42`);
        // Names load after connector discovery and metadata; pause bootstrap
        // here while the Search button is already available to the user.
        await expect.poll(() => namesStarted).toBe(true);
        expect(searches).toHaveLength(0);
        await page.getByRole('button', { name: 'Advanced…', exact: true }).click();
        const advanced = page.getByRole('dialog', { name: 'Advanced Search Filter', exact: true });
        await expect(advanced.locator('input[type="number"]').nth(0)).toHaveValue('');
        await expect(advanced.locator('input[type="number"]').nth(1)).toHaveValue('');
        await advanced.getByRole('button', { name: 'OK', exact: true }).click();
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/messages/${UPSTREAM}$`));
        expectPageSearch(searches[0], UPSTREAM, '43');
        await expect(page.locator('table.msg-table tr.selected')).toHaveCount(0);
        release();
        await expect(page.getByText('Channel Messages - Upstream', { exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        expect(searches).toHaveLength(1);
        expect(details).toHaveLength(0);
    } finally {
        release();
    }
});

test('source links block both middle and normal clicks after the browser session changes', async ({ page }) => {
    const { searches, details } = await setup(page, [
        message(ORIGIN, ORIGINAL_ID, singular()), message(UPSTREAM, '42'),
    ], {
        'GET /users/current': (request: Request) => request.headers()['x-oie-context']?.includes('replacement-navigation')
            ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
    });
    for (const [index, type] of ['auxclick', 'click'].entries()) {
        await page.context().clearCookies();
        await openOriginMappings(page);
        const prevented = await mappingTable(page).getByRole('link', { name: '42', exact: true }).evaluate((link, eventType) => {
            document.cookie = `oie-login=replacement-navigation-${eventType}; path=/`;
            const event = new MouseEvent(eventType, { button: eventType === 'auxclick' ? 1 : 0, bubbles: true, cancelable: true });
            link.dispatchEvent(event);
            return event.defaultPrevented;
        }, type);
        expect(prevented).toBe(true);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        expect(searches).toHaveLength(index + 1);
        expect(details).toHaveLength(index + 1);
        expect(new URL(page.url()).pathname).not.toBe(`/messages/${UPSTREAM}`);
        expect(page.context().pages()).toHaveLength(1);
    }
});

test('invalid positioning counts fail without searching and ordinary searches recover', async ({ page }) => {
    let rank: unknown;
    const { searches, details } = await setup(page, [message(UPSTREAM, '42'), message(UPSTREAM, '43')], {
        [`GET /channels/${UPSTREAM}/messages/count`]: () => ({ long: rank }),
    });
    for (const invalid of [null, 'oops', -1, 1.5, '2147483661']) {
        rank = invalid;
        const before = searches.length;
        await page.goto(`/messages/${UPSTREAM}?messageId=42`);
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toContainText('Unable to determine the message page');
        expect(searches).toHaveLength(before);
        expect(details).toHaveLength(0);
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('cell', { name: '43', exact: true })).toBeVisible();
        expect(searches).toHaveLength(before + 1);
        expectPageSearch(searches.at(-1)!, UPSTREAM, '43');
        expect(details).toHaveLength(0);
    }
});
