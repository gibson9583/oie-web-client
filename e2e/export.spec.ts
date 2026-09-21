import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as zipjs from '../web-administrator/client/vendor/zipjs.min.js';

/*
 * End-to-end check of the Export Results dialog's "My Computer" path — the one
 * that builds the ZIP client-side via core/zip.js (now @zip.js/zip.js). Proves
 * the dialog opens, fetches the results, and produces a real, readable archive.
 */
zipjs.configure({ useWebWorkers: false });

const CID = 'c-started';
const MESSAGE = { messageId: '987654321', channelId: CID, serverId: 's1', connectorMessages: {} };

test('Export Results builds a downloadable ZIP (My Computer)', async ({ page }) => {
    const auditPaths: string[] = [];
    let successAuditBody = '';
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path.includes('_auditExportMessages')) {
            auditPaths.push(path);
            if (path.endsWith('Success')) successAuditBody = request.postData() || '';
        }
    });
    await mockEngine(page, {
        // Paginated search: the message on the first batch, empty after (loop terminates).
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        // The per-message XML fetch the export performs for "XML serialized message".
        [`GET /channels/${CID}/messages/987654321`]: '<message><messageId>987654321</messageId></message>',
        [`GET /channels/${CID}/messages/987654321/attachments`]: {
            list: { attachment: [{ id: 'att-1', content: 'aGVsbG8=', type: 'text/plain', encrypt: false }] }
        },
    });
    // Force the download fallback (no File System Access pickers this run) so the
    // result is a captured download rather than a native Save-As / folder pick.
    await page.addInitScript(() => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).showDirectoryPicker;
    });

    await page.goto(`/messages/${CID}`);
    // Auto-search populated the results grid.
    await expect(page.getByText('987654321')).toBeVisible();

    // Open the dialog and export with defaults (XML serialized · My Computer).
    await page.getByRole('button', { name: 'Export Results' }).click();
    await expect(page.getByText('File Pattern:')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Include Attachments' }).check();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // It's a real ZIP containing the exported message file.
    const buf = await readFile(await download.path());
    const reader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([buf])));
    const entries = await reader.getEntries();
    const xmlEntry: any = entries.find((e: any) => e.filename.endsWith('.xml'));
    const exportedXml = await xmlEntry.getData(new zipjs.TextWriter());
    await reader.close();
    expect(entries.length).toBeGreaterThan(0);
    expect(exportedXml).toContain('<attachments><attachment>');
    expect(exportedXml).toContain('<id>att-1</id>');
    expect(exportedXml).toContain('<content>aGVsbG8=</content>');
    await expect.poll(() => auditPaths).toEqual([
        '/api/channels/_auditExportMessages',
        '/api/channels/_auditExportMessagesSuccess'
    ]);
    expect(successAuditBody).toContain('<string>rootPath</string><string>My Computer</string>');
    expect(successAuditBody).toContain('<string>exportCount</string><string>1</string>');
    expect(successAuditBody).toContain('<string>includeAttachments</string><string>true</string>');
    expect(successAuditBody).toContain('<string>compressionFormat</string><string>zip</string>');
    expect(successAuditBody).toContain('<string>passwordProtected</string><string>false</string>');
});

test('attachment failure aborts XML export and never emits a success audit', async ({ page }) => {
    const auditPaths: string[] = [];
    let downloaded = false;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path.includes('_auditExportMessages')) auditPaths.push(path);
    });
    page.on('download', () => { downloaded = true; });
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/messages/987654321`]: '<message><messageId>987654321</messageId></message>',
        [`GET /channels/${CID}/messages/987654321/attachments`]: {
            __status: 500, body: { error: 'attachment export unavailable' }
        }
    });
    await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText('987654321', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export Results' }).click();
    await page.getByRole('checkbox', { name: 'Include Attachments' }).check();
    await page.getByRole('button', { name: 'Export', exact: true }).click();

    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText('attachment export unavailable');
    expect(downloaded).toBe(false);
    expect(auditPaths).toEqual(['/api/channels/_auditExportMessages']);
});

async function installExportPicker(page: Page, mode: 'cancel' | 'pending' | 'save' | 'pending-stream' | 'pending-write' | 'pending-close' = 'cancel') {
    await page.addInitScript(({ mode }: any) => {
        const probe: any = (window as any).exportProbe = { pickers: 0, writes: 0, closes: 0, aborts: 0, ...JSON.parse(sessionStorage.getItem('exportProbe') || '{}') };
        const record = (key: string) => { probe[key]++; sessionStorage.setItem('exportProbe', JSON.stringify(probe)); };
        const pause = () => new Promise<void>(resolve => { probe.release = resolve; });
        (window as any).showSaveFilePicker = async () => {
            record('pickers');
            if (mode === 'cancel') throw new DOMException('Picker cancelled', 'AbortError');
            if (mode === 'pending') await pause();
            return { createWritable: async () => {
                if (mode === 'pending-stream') await pause();
                return {
                    write: async (blob: Blob) => {
                        probe.bytes = blob.size; record('writes');
                        if (mode === 'pending-write') await pause();
                    },
                    close: async () => {
                        if (mode === 'pending-close') await pause();
                        record('closes');
                    },
                    abort: async () => { record('aborts'); },
                };
            } };
        };
    }, { mode });
}

async function openExport(page: Page, server = false) {
    await page.goto(`/messages/${CID}`);
    await expect(page.getByText(MESSAGE.messageId, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export Results', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export Results', exact: true });
    if (server) {
        await dialog.getByRole('radio', { name: 'Server', exact: true }).check();
        await dialog.getByPlaceholder('/path/accessible/by/server').fill('/tmp/message-export-fixture');
    }
    return dialog;
}

for (const scenario of [
    { server: false, end: 'Cancel', status: 200 },
    { server: false, end: 'Escape', status: 503 },
    { server: true, end: 'Cancel', status: 200 },
    { server: true, end: 'Close', status: 200 },
    { server: false, end: 'expiry', status: 200 },
    { server: true, end: 'cookie-change', status: 200 },
]) {
    test(`Export Results ${scenario.server ? 'server' : 'computer'} ${scenario.end} during audit prevents late work (${scenario.status})`, async ({ page }) => {
        await installExportPicker(page);
        let audits = 0, searches = 0, exports = 0, successAudits = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: (request: any) => { if (new URL(request.url()).searchParams.get('limit') === '100') searches++; return { list: { message: [MESSAGE] } }; },
            'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/_auditExportMessages': async () => { audits++; await gate; return { __status: scenario.status }; },
            [`POST /channels/${CID}/messages/_export`]: () => { exports++; return { long: 1 }; },
            'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
        });
        const dialog = await openExport(page, scenario.server);
        const searchesBefore = searches;
        await dialog.getByRole('button', { name: 'Export', exact: true }).evaluate(button => {
            (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
        });
        await expect.poll(() => audits).toBe(1);
        await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
        if (scenario.end === 'expiry') {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else if (scenario.end === 'cookie-change') {
            await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
        } else if (scenario.end === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: scenario.end, exact: true }).click();
        const response = page.waitForResponse('**/api/channels/_auditExportMessages');
        release();
        await response;
        // Both success and failure continuations must leave the dismissed form closed.
        await page.waitForTimeout(150);
        if (scenario.end === 'cookie-change') await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).exportProbe.pickers)).toBe(0);
        expect(audits).toBe(1);
        expect(searches).toBe(searchesBefore);
        expect(exports).toBe(0);
        expect(successAudits).toBe(0);
        if (['expiry', 'cookie-change'].includes(scenario.end)) {
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        }
    });
}

for (const end of ['Cancel', 'expiry', 'cookie-change']) {
    test(`Export Results ${end} while the native picker is pending prevents data reads and writes`, async ({ page }) => {
        await installExportPicker(page, 'pending');
        let searches = 0, successAudits = 0;
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: (request: any) => { if (new URL(request.url()).searchParams.get('limit') === '100') searches++; return { list: { message: [MESSAGE] } }; },
            'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
        });
        const dialog = await openExport(page);
        const searchesBefore = searches;
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).exportProbe.pickers)).toBe(1);
        if (end === 'expiry') {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else if (end === 'cookie-change') {
            await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
        } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.evaluate(() => (window as any).exportProbe.release());
        await page.waitForTimeout(150);
        if (end === 'cookie-change') await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(searches).toBe(searchesBefore);
        expect(successAudits).toBe(0);
        expect(await page.evaluate(() => (window as any).exportProbe.writes)).toBe(0);
    });
}

for (const end of ['Cancel', 'expiry']) {
    test(`Export Results ${end} while message XML is pending does not request attachments or save a partial ZIP`, async ({ page }) => {
        await installExportPicker(page, 'save');
        let xmlStarted = false, attachments = 0, successAudits = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}`]: async () => {
                xmlStarted = true; await gate; return `<message><messageId>${MESSAGE.messageId}</messageId></message>`;
            },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}/attachments`]: () => { attachments++; return { list: {} }; },
            'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
        });
        const dialog = await openExport(page);
        await dialog.getByRole('checkbox', { name: 'Include Attachments' }).check();
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => xmlStarted).toBe(true);
        if (end === 'expiry') {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        const response = page.waitForResponse(`**/api/channels/${CID}/messages/${MESSAGE.messageId}`);
        release();
        await response;
        await page.waitForTimeout(150);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(attachments).toBe(0);
        expect(successAudits).toBe(0);
        expect(await page.evaluate(() => (window as any).exportProbe.writes)).toBe(0);
    });
}

test('Export Results failed audit can retry and a cancelled native picker permits a new attempt', async ({ page }) => {
    await installExportPicker(page);
    let audits = 0, successAudits = 0, searches = 0;
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (request: any) => { if (new URL(request.url()).searchParams.get('limit') === '100') searches++; return { list: { message: [MESSAGE] } }; },
        'POST /channels/_auditExportMessages': () => ++audits === 1 ? { __status: 503, body: 'audit unavailable' } : '',
        'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
    });
    const dialog = await openExport(page);
    const searchesBefore = searches;
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('audit unavailable');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    expect(await page.evaluate(() => (window as any).exportProbe.pickers)).toBe(0);
    for (let attempt = 1; attempt <= 2; attempt++) {
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).exportProbe.pickers)).toBe(attempt);
        await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    }
    expect(audits).toBe(3);
    expect(searches).toBe(searchesBefore);
    expect(successAudits).toBe(0);
});

for (const server of [false, true]) {
    test(`Export Results ${server ? 'server' : 'native file'} success keeps audit and completion ordering`, async ({ page }) => {
        await installExportPicker(page, 'save');
        const events: string[] = [];
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}`]: () => {
                events.push('data'); return `<message><messageId>${MESSAGE.messageId}</messageId></message>`;
            },
            'POST /channels/_auditExportMessages': () => { events.push('audit'); return ''; },
            [`POST /channels/${CID}/messages/_export`]: () => { events.push('server'); return { long: 1 }; },
            'POST /channels/_auditExportMessagesSuccess': async () => {
                if (!server) expect(await page.evaluate(() => (window as any).exportProbe.closes)).toBe(1);
                events.push('success'); return '';
            },
        });
        const dialog = await openExport(page, server);
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(events).toEqual(['audit', server ? 'server' : 'data', 'success']);
        if (!server) {
            expect(await page.evaluate(() => (window as any).exportProbe.writes)).toBe(1);
            expect(await page.evaluate(() => (window as any).exportProbe.bytes)).toBeGreaterThan(0);
        }
    });
}

for (const status of [200, 401]) {
    test(`Export Results drops a late count (${status}) when the initiating session ends`, async ({ page }) => {
        let countStarted = false;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: Array.from({ length: 21 }, (_, i) => ({ ...MESSAGE, messageId: String(100 + i) })) } },
            [`GET /channels/${CID}/messages/count`]: async () => { countStarted = true; await gate; return status === 401 ? { __status: 401 } : { long: 21 }; },
            'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
        });
        await page.goto(`/messages/${CID}`);
        await expect(page.getByRole('cell', { name: '100', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Export Results', exact: true }).click();
        await expect.poll(() => countStarted).toBe(true);
        if (status === 200) {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        }
        const response = page.waitForResponse(`**/api/channels/${CID}/messages/count?*`);
        release();
        await response;
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.waitForTimeout(150);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

for (const mode of ['pending-stream', 'pending-write'] as const) {
    for (const end of ['Cancel', 'expiry', 'cookie-change']) {
        test(`Export Results ${end} during ${mode} aborts the owned file without committing or auditing success`, async ({ page }) => {
            await installExportPicker(page, mode);
            let successAudits = 0;
            await mockEngine(page, {
                [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
                [`GET /channels/${CID}/messages/${MESSAGE.messageId}`]: `<message><messageId>${MESSAGE.messageId}</messageId></message>`,
                'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
                'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
            });
            const dialog = await openExport(page);
            await dialog.getByRole('button', { name: 'Export', exact: true }).click();
            await expect.poll(() => page.evaluate(() => typeof (window as any).exportProbe.release)).toBe('function');
            if (end === 'expiry') {
                await page.evaluate(async () => {
                    const api = await import(String('/core/api.js'));
                    await api.get('/session-expiry-probe').catch(() => {});
                });
            } else if (end === 'cookie-change') {
                await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
            } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.evaluate(() => (window as any).exportProbe.release());
            await expect.poll(() => page.evaluate(() => (window as any).exportProbe.aborts).catch(() => undefined)).toBe(1);
            if (end === 'cookie-change') await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            await expect(page.getByRole('dialog')).toHaveCount(0);
            expect(await page.evaluate(() => (window as any).exportProbe.writes)).toBe(mode === 'pending-write' ? 1 : 0);
            expect(await page.evaluate(() => (window as any).exportProbe.closes)).toBe(0);
            expect(successAudits).toBe(0);
        });
    }
}

for (const end of ['Cancel', 'expiry']) {
    test(`Export Results ${end} during file commit records completion only through its original session`, async ({ page }) => {
        await installExportPicker(page, 'pending-close');
        let successAudits = 0;
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}`]: `<message><messageId>${MESSAGE.messageId}</messageId></message>`,
            'GET /session-expiry-probe': { __status: 401 },
            'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/_auditExportMessagesSuccess': () => { successAudits++; return ''; },
        });
        const dialog = await openExport(page);
        await dialog.getByRole('button', { name: 'Export', exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof (window as any).exportProbe.release)).toBe('function');
        if (end === 'expiry') {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.evaluate(() => (window as any).exportProbe.release());
        await expect.poll(() => page.evaluate(() => (window as any).exportProbe.closes)).toBe(1);
        if (end === 'Cancel') await expect.poll(() => successAudits).toBe(1);
        await page.waitForTimeout(150);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).exportProbe.aborts)).toBe(0);
        expect(successAudits).toBe(end === 'Cancel' ? 1 : 0);
    });
}

for (const mode of ['pending', 'pending-stream'] as const) {
    for (const expire of [false, true]) {
        test(`saveFile without a caller guard ${expire ? 'rejects expiry' : 'saves normally'} during ${mode}`, async ({ page }) => {
            await installExportPicker(page, mode);
            await mockEngine(page, { 'GET /session-expiry-probe': { __status: 401 } });
            await page.goto('/messages/c-started');
            await expect(page.getByRole('button', { name: 'Export Results', exact: true })).toBeVisible();
            await page.evaluate(async () => {
                const ui = await import(String('/core/ui.js'));
                void ui.saveFile('session-owned.txt', 'text/plain', 'synthetic session-owned content')
                    .then(() => { (window as any).directSaveOutcome = 'saved'; })
                    .catch(() => { (window as any).directSaveOutcome = 'rejected'; });
            });
            await expect.poll(() => page.evaluate(() => typeof (window as any).exportProbe.release)).toBe('function');
            if (expire) {
                await page.evaluate(async () => {
                    const api = await import(String('/core/api.js'));
                    await api.get('/session-expiry-probe').catch(() => {});
                });
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            }
            await page.evaluate(() => (window as any).exportProbe.release());
            await expect.poll(() => page.evaluate(() => (window as any).directSaveOutcome)).toBe(expire ? 'rejected' : 'saved');
            expect(await page.evaluate(() => (window as any).exportProbe.writes)).toBe(expire ? 0 : 1);
            expect(await page.evaluate(() => (window as any).exportProbe.closes)).toBe(expire ? 0 : 1);
            expect(await page.evaluate(() => (window as any).exportProbe.aborts)).toBe(expire && mode === 'pending-stream' ? 1 : 0);
            await expect(page.getByRole('dialog')).toHaveCount(0);
        });
    }
}

for (const outcome of ['save', 'picker-cancel', 'expiry-picker', 'expiry-content', 'read-failure']) {
    test(`attachment export ${outcome} keeps the initiating session and reports only completed saves`, async ({ page }) => {
        await installExportPicker(page, outcome === 'picker-cancel' ? 'cancel' : outcome === 'expiry-picker' ? 'pending' : 'save');
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        let contentReads = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const detailed = { ...MESSAGE, connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } } };
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: [detailed] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}`]: detailed,
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}/attachments`]: { list: { attachment: [{ id: 'file-1', type: 'application/octet-stream' }] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}/attachments/file-1`]: async () => {
                contentReads++;
                if (outcome === 'expiry-content') await gate;
                return outcome === 'read-failure' ? { __status: 503 } : { attachment: { content: 'c3ludGhldGlj', type: 'application/octet-stream' } };
            },
            'GET /session-expiry-probe': { __status: 401 },
        });
        await page.goto(`/messages/${CID}`);
        await page.getByRole('cell', { name: MESSAGE.messageId, exact: true }).click();
        await page.getByRole('tab', { name: 'Attachments', exact: true }).click();
        await page.getByRole('button', { name: 'Export', exact: true }).click();
        if (outcome === 'expiry-picker' || outcome === 'expiry-content') {
            if (outcome === 'expiry-picker') await expect.poll(() => page.evaluate(() => typeof (window as any).exportProbe.release)).toBe('function');
            else await expect.poll(() => contentReads).toBe(1);
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            if (outcome === 'expiry-picker') await page.evaluate(() => (window as any).exportProbe.release());
            else release();
            await page.waitForTimeout(200);
            await expect(page.getByRole('dialog')).toHaveCount(0);
        } else if (outcome === 'read-failure') {
            await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Failed to export attachment');
        } else if (outcome === 'save') {
            await expect(page.getByText('Attachment exported', { exact: true })).toBeVisible();
        } else {
            await expect.poll(() => page.evaluate(() => (window as any).exportProbe.pickers)).toBe(1);
            await page.waitForTimeout(150);
        }
        expect(await page.evaluate(() => (window as any).exportProbe.closes)).toBe(outcome === 'save' ? 1 : 0);
        if (outcome !== 'save') await expect(page.getByText('Attachment exported', { exact: true })).toHaveCount(0);
        if (outcome === 'expiry-picker' || outcome === 'picker-cancel') expect(contentReads).toBe(0);
        expect(errors).toEqual([]);
    });
}

for (const expire of [false, true]) {
    test(`attachment export discovery ${expire ? 'stops after expiry' : 'opens its attachment selector'}`, async ({ page }) => {
        let started = false;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${CID}/messages`]: { list: { message: [MESSAGE] } },
            [`GET /channels/${CID}/messages/${MESSAGE.messageId}/attachments`]: async () => {
                started = true; await gate;
                return { list: { attachment: [{ id: 'file-1', type: 'application/octet-stream' }, { id: 'file-2', type: 'application/octet-stream' }] } };
            },
            'GET /session-expiry-probe': { __status: 401 },
        });
        await page.goto(`/messages/${CID}`);
        await page.getByRole('cell', { name: MESSAGE.messageId, exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Export Attachment', exact: true }).click();
        await expect.poll(() => started).toBe(true);
        if (expire) {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        }
        release();
        if (expire) {
            await page.waitForTimeout(200);
            await expect(page.getByRole('dialog')).toHaveCount(0);
        } else {
            await expect(page.getByRole('dialog', { name: `Attachments — Message ${MESSAGE.messageId}`, exact: true })).toContainText('file-1');
            await expect(page.getByRole('dialog')).toContainText('file-2');
        }
    });
}
