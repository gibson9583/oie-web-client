import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

// The engine returns an XStream map, and api.handle unwraps its root once.
// Plain { id: name } fixtures would miss the original non-dashboard crash.
const singleton = (id = 'clinical-alpha', name = 'Clinical Admissions') => ({
    map: { entry: { string: [id, name] } },
});
const channelPath = '/api/channels/idsAndNames';
const isChannelNames = (url: string) => new URL(url).pathname === channelPath;

async function open(page: Page) {
    await expect(page.locator('.shell')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    return page.getByRole('combobox', { name: 'Search views, channels and commands' });
}

function recordErrors(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

async function settleResponse(page: Page, response: Awaited<ReturnType<Page['waitForResponse']>>) {
    await response.finished();
    // Allow the response callback and React render to finish without a fixed sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

test('direct Channels landing decodes a singleton XStream map and navigates to edit', async ({ page }) => {
    const errors = recordErrors(page);
    let calls = 0;
    await mockEngine(page, {
        'GET /channels/idsAndNames': () => { calls++; return singleton(); },
        'GET /channels/clinical-alpha': { channel: makeChannel('clinical-alpha') },
    });
    await page.goto('/channels');
    const query = await open(page);
    await query.fill('#clinical');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Clinical Admissions', 'Clinical Admissions']);
    await expect(page.locator('.cmdk-opt .cmdk-hint')).toHaveText(['edit', 'messages']);
    await page.locator('.cmdk-opt').filter({ has: page.locator('.cmdk-hint', { hasText: /^edit$/ }) }).click();
    await expect(page).toHaveURL(/\/channels\/clinical-alpha\/edit$/);
    await expect(page.locator('.cmdk')).toHaveCount(0);
    expect(calls).toBe(1);
    expect(errors).toEqual([]);
});

test('direct Events landing decodes multiple entries for ordinary and scoped searches, then opens messages', async ({ page }) => {
    const errors = recordErrors(page);
    // Follow palette navigation through the XML detail reader, using the actual
    // engine serializer fixture from the control-character regression.
    const xml = (await readFile(new URL('./fixtures/message-control-characters.xml', import.meta.url), 'utf8'))
        .replaceAll('c-started', 'clinical-beta');
    const detailAccept: string[] = [];
    await mockEngine(page, {
        'GET /channels/idsAndNames': { map: { entry: [
            { string: ['clinical-alpha', 'Clinical Admissions'] },
            { string: ['clinical-beta', 'Clinical Results'] },
        ] } },
        'GET /channels/clinical-beta': { channel: makeChannel('clinical-beta') },
        'GET /channels/clinical-beta/messages': { list: { message: [{
            messageId: 12345, channelId: 'clinical-beta', processed: true,
            connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } },
        }] } },
        'GET /channels/clinical-beta/messages/12345': (request: any) => {
            detailAccept.push(request.headers().accept);
            return xml;
        },
        'GET /channels/clinical-beta/messages/12345/attachments': { list: [] },
    });
    // Monaco probes clipboard.write in WebKit; support that API as well as the
    // toolbar's writeText, keeping all clipboard activity inside the test page.
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        // Consume ClipboardItem promises as the browser would. Monaco cancels
        // obsolete pending items; a no-op mock leaves those rejections unhandled.
        write: async (items: ClipboardItem[]) => {
            await Promise.all(items.flatMap(item => item.types.map(type => item.getType(type))));
        },
        writeText: async (value: string) => { (window as any).paletteCopiedMessage = value; },
    } }));
    await page.goto('/events');
    const query = await open(page);
    // Typing `c` used to invoke Highlight with an object-valued channel name.
    await query.fill('c');
    await expect(page.locator('.cmdk-opt .cmdk-label', { hasText: 'Clinical Admissions' })).toHaveCount(2);
    await expect(page.locator('.cmdk-opt .cmdk-label', { hasText: 'Clinical Results' })).toHaveCount(2);
    await query.fill('#results');
    await expect(page.locator('.cmdk-scope')).toHaveText('Channels');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Clinical Results', 'Clinical Results']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/messages\/clinical-beta$/);
    await expect(page.locator('.cmdk')).toHaveCount(0);
    await page.getByText('12345', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(await page.evaluate(() => (window as any).paletteCopiedMessage))
        .toBe('  SYNTHETIC-NCPDP\x1cFIELD\x1dGROUP\x1eSEGMENT\tLINE\nCR\r<>&"\' café 😀 \uE0000; &#x1c;  ');
    expect(detailAccept).toEqual(['application/xml']);
    expect(errors).toEqual([]);
});

for (const [name, response] of [
    ['malformed map', { map: { entry: { string: { unexpected: 'object' } } } }],
    ['empty map', { map: {} }],
    ['rejected request', { __status: 500, body: { error: 'Fixture unavailable' } }],
] as const) {
    test(`${name} leaves views and commands usable and retries on a later opening`, async ({ page }) => {
        const errors = recordErrors(page);
        let calls = 0;
        await mockEngine(page, {
            'GET /channels/idsAndNames': () => ++calls === 1 ? response : singleton(),
        });
        await page.goto('/channels');
        const received = page.waitForResponse(res => isChannelNames(res.url()));
        const query = await open(page);
        await settleResponse(page, await received);
        await query.fill('#');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        await expect(page.locator('.cmdk-empty')).toBeVisible();
        await query.fill('>prune');
        await expect(page.locator('.cmdk-opt')).toHaveCount(1);
        await expect(page.locator('.cmdk-opt')).toContainText('Data Pruner');
        await query.fill('/events');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/events$/);
        await expect(page.locator('.cmdk')).toHaveCount(0);
        await (await open(page)).fill('#clinical');
        await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Clinical Admissions', 'Clinical Admissions']);
        expect(calls).toBe(2);
        expect(errors).toEqual([]);
    });
}

test('malformed map entries cannot hide valid channels or become object-valued labels', async ({ page }) => {
    const errors = recordErrors(page);
    await mockEngine(page, {
        'GET /channels/idsAndNames': { map: { entry: [
            { string: ['clinical-alpha', 'Clinical Admissions'] },
            { string: ['bad-name', { value: 'not a String' }] },
            { string: [{ value: 'not an ID' }, 'Invalid ID'] },
            { string: ['missing-name'] },
            { string: ['', 'Empty ID'] },
            null,
        ] } },
    });
    await page.goto('/events');
    const query = await open(page);
    await query.fill('#');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Clinical Admissions', 'Clinical Admissions']);
    await query.fill('c');
    await expect(page.locator('.cmdk-opt .cmdk-label', { hasText: 'Clinical Admissions' })).toHaveCount(2);
    expect(errors).toEqual([]);
});

test('primitive channel names render as text and empty names fall back to the channel ID', async ({ page }) => {
    const errors = recordErrors(page);
    await mockEngine(page, {
        'GET /channels/idsAndNames': { map: { entry: [
            { string: ['numeric-name', 27] },
            { string: ['boolean-name', false] },
            { string: ['null-name', null] },
            { string: ['empty-name', ''] },
        ] } },
    });
    await page.goto('/events');
    const query = await open(page);
    await query.fill('#');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText([
        '27', '27', 'false', 'false', 'null-name', 'null-name', 'empty-name', 'empty-name',
    ]);
    await query.fill('#false');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['false', 'false']);
    expect(errors).toEqual([]);
});

test('a populated dashboard cache bypasses the fallback endpoint', async ({ page }) => {
    let calls = 0;
    await mockEngine(page, {
        'GET /channels/idsAndNames': () => { calls++; return { __status: 500 }; },
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await (await open(page)).fill('#demo');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText([
        'Demo Started', 'Demo Started', 'Demo Stopped', 'Demo Stopped',
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
    await (await open(page)).fill('#demo');
    await expect(page.locator('.cmdk-opt')).toHaveCount(4);
    expect(calls).toBe(0);
});

test('closing and reopening while pending prevents the earlier response from replacing current results', async ({ page }) => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, {
        'GET /channels/idsAndNames': async () => {
            if (++calls === 1) { await gate; return singleton('stale', 'Stale Clinical'); }
            return singleton('fresh', 'Fresh Clinical');
        },
    });
    try {
        await page.goto('/events');
        await (await open(page)).fill('#');
        await expect.poll(() => calls).toBe(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.cmdk')).toHaveCount(0);
        await (await open(page)).fill('#');
        await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Fresh Clinical', 'Fresh Clinical']);
        const staleResponse = page.waitForResponse(async res => isChannelNames(res.url())
            && (await res.json()).map?.entry?.string?.[0] === 'stale');
        release();
        await settleResponse(page, await staleResponse);
        await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Fresh Clinical', 'Fresh Clinical']);
        expect(calls).toBe(2);
    } finally { release(); }
});

test('a response arriving after close does not reopen the palette or seed stale fallback data', async ({ page }) => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, {
        'GET /channels/idsAndNames': async () => {
            if (++calls === 1) { await gate; return singleton('stale', 'Stale Clinical'); }
            return singleton('fresh', 'Fresh Clinical');
        },
    });
    try {
        await page.goto('/events');
        await open(page);
        await expect.poll(() => calls).toBe(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.cmdk')).toHaveCount(0);
        const received = page.waitForResponse(res => isChannelNames(res.url()));
        release();
        await settleResponse(page, await received);
        await expect(page.locator('.cmdk')).toHaveCount(0);
        await (await open(page)).fill('#');
        await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Fresh Clinical', 'Fresh Clinical']);
        expect(calls).toBe(2);
    } finally { release(); }
});

test('successful fallback results are reused when the palette is reopened', async ({ page }) => {
    let calls = 0;
    await mockEngine(page, {
        'GET /channels/idsAndNames': () => { calls++; return singleton(); },
    });
    await page.goto('/events');
    await (await open(page)).fill('#clinical');
    await expect(page.locator('.cmdk-opt')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
    await (await open(page)).fill('#clinical');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Clinical Admissions', 'Clinical Admissions']);
    expect(calls).toBe(1);
});

async function denyChannelTasks(page: Page, denied: string[]) {
    await page.route('**/webadmin/plugins.json', async route => {
        const response = await route.fetch();
        const manifests = await response.json();
        manifests.push({ id: 'test-palette-rbac', version: '1.0.0', entry: '/plugins/test-palette-rbac/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    await page.route('**/plugins/test-palette-rbac/entry.js*', route => route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: `export function register(p){
            p.setAuthorizationController({checkTask:(g,t)=>g!=='view'||!${JSON.stringify(denied)}.includes(t)});
            window.paletteRbacProbe = { installed: true, active: () => ({
                edit: p.checkTask('view', 'doShowChannel'),
                messages: p.checkTask('view', 'doShowMessages'),
                events: p.checkTask('view', 'doShowEvents')
            }) };
        }`,
    }));
}

for (const [name, denied, hints] of [
    ['edit only', ['doShowMessages'], ['edit']],
    ['messages only', ['doShowChannel'], ['messages']],
    ['neither channel action', ['doShowChannel', 'doShowMessages'], []],
] as const) {
    test(`fallback channel actions respect permission gating: ${name}`, async ({ page }) => {
        let calls = 0;
        await denyChannelTasks(page, [...denied]);
        await mockEngine(page, {
            'GET /channels/idsAndNames': () => { calls++; return singleton(); },
        });
        await page.goto('/events');
        // The shell may render before asynchronous plugin registration finishes.
        // Verify the installed controller, not just the injected module request.
        await expect.poll(() => page.evaluate(() => {
            const probe = (window as any).paletteRbacProbe;
            return probe ? { installed: probe.installed, ...probe.active() } : null;
        })).toEqual({ installed: true, edit: hints.some(hint => hint === 'edit'), messages: hints.some(hint => hint === 'messages'), events: true });
        const query = await open(page);
        await query.fill('#clinical');
        await expect(page.locator('.cmdk-opt .cmdk-hint')).toHaveText([...hints]);
        await query.fill('/events');
        await expect(page.locator('.cmdk-opt')).toHaveCount(1);
        expect(calls).toBe(hints.length ? 1 : 0);
    });
}

test('a fallback 401 follows session expiry and removes the palette', async ({ page }) => {
    await mockEngine(page, { 'GET /channels/idsAndNames': { __status: 401 } });
    await page.goto('/events');
    await expect(page.locator('.shell')).toBeVisible();
    // Do not wait for the transient dialog: expiry may unmount it immediately.
    await page.keyboard.press('Control+k');
    await expect(page.locator('input[type=password]')).toBeVisible();
    await expect(page.locator('.login-notice')).toContainText(/session expired/i);
    await expect(page.locator('.cmdk')).toHaveCount(0);
});
