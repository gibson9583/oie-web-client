import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Page } from '@playwright/test';

const IMPORT_XML = '<list><message><messageId>11</messageId></message><message><messageId>22</messageId></message></list>';

async function chooseMessages(page: Page) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Messages', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await (await choosing).setFiles({ name: 'messages.xml', mimeType: 'application/xml', buffer: Buffer.from(IMPORT_XML) });
}

for (const first of ['401', 'late-success', 'late-failure', 'cookie-change']) {
    test(`message import stops after ${first} ends its initiating session`, async ({ page }) => {
        let imports = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/c-started/messages/_import': async () => {
                imports++;
                if (imports === 1) {
                    await gate;
                    if (first === '401') return { __status: 401 };
                    if (first === 'late-failure') return { __status: 503 };
                }
                return '';
            },
        });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        await expect.poll(() => imports).toBe(1);
        if (first.startsWith('late-')) {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else if (first === 'cookie-change') {
            await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
        }
        const response = page.waitForResponse('**/api/channels/c-started/messages/_import');
        release();
        await response;
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.waitForTimeout(150);
        expect(imports).toBe(1);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

for (const outcome of ['load', 'error']) {
    test(`message import ignores a file ${outcome} after forced session expiry`, async ({ page }) => {
        await page.addInitScript(outcome => {
            const read = FileReader.prototype.readAsText;
            FileReader.prototype.readAsText = function (...args) {
                (window as any).completeMessageRead = () => new Promise<void>(resolve => {
                    if (outcome === 'error') { this.dispatchEvent(new ProgressEvent('error')); resolve(); }
                    else {
                        this.addEventListener('loadend', () => resolve(), { once: true });
                        read.apply(this, args);
                    }
                });
            };
        }, outcome);
        let imports = 0;
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/c-started/messages/_import': () => { imports++; return ''; },
        });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        await expect.poll(() => page.evaluate(() => typeof (window as any).completeMessageRead)).toBe('function');
        await page.evaluate(async () => {
            const api = await import(String('/core/api.js'));
            await api.get('/session-expiry-probe').catch(() => {});
        });
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.evaluate(() => (window as any).completeMessageRead());
        await page.waitForTimeout(150);
        expect(imports).toBe(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

for (const partial of [false, true]) {
    test(`message import preserves ${partial ? 'partial failure counts' : 'successful XML requests'}`, async ({ page }) => {
        const bodies: string[] = [];
        await mockEngine(page, { 'POST /channels/c-started/messages/_import': (request: any) => {
            expect(request.headers()['content-type']).toContain('application/xml');
            bodies.push(request.postData());
            return partial && bodies.length === 1 ? { __status: 503, body: { message: 'message rejected' } } : '';
        } });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        if (partial) {
            await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText(/Imported 1 message\(s\); 1 failed:.*message rejected/);
        } else await expect(page.getByText('Imported 2 message(s)', { exact: true })).toBeVisible();
        expect(bodies).toEqual(['<message><messageId>11</messageId></message>', '<message><messageId>22</messageId></message>']);
    });
}


test('message server import posts the selected path and recursion flag using the Swing endpoint', async ({ page }) => {
    const writes: { body: string | null; recursive: string | null }[] = [];
    await mockEngine(page, { 'POST /channels/c-started/messages/_importFromPath': (request: any) => {
        expect(request.headers()['content-type']).toContain('text/plain');
        writes.push({ body: request.postData(), recursive: new URL(request.url()).searchParams.get('includeSubfolders') });
        return { messageImportResult: { totalCount: 3, successCount: 2 } };
    } });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Messages', exact: true });
    await dialog.getByLabel('Import From', { exact: true }).selectOption('server');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please enter');
    expect(writes).toHaveLength(0);
    await dialog.getByLabel('Server File/Folder/Archive', { exact: true }).fill('/tmp/export.tar.gz');
    await dialog.getByLabel('Include Sub-folders').uncheck();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('2 out of 3 message(s) have been successfully imported from /tmp/export.tar.gz.', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ body: '/tmp/export.tar.gz', recursive: 'false' }]);
});

test('local ZIP import includes nested files and preserves per-message failure counts', async ({ page }) => {
    const { createZip } = await import('../web-administrator/client/core/zip.js');
    const zip = createZip();
    zip.add('root.xml', '<message><messageId>11</messageId></message>');
    zip.add('nested/second.xml', '<message><messageId>22</messageId></message>');
    zip.add('attachment.txt', 'not serialized message data');
    const bytes = Buffer.from(await (await zip.blob()).arrayBuffer());
    const bodies: string[] = [];
    await mockEngine(page, { 'POST /channels/c-started/messages/_import': (request: any) => {
        bodies.push(request.postData()); return bodies.length === 1 ? { __status: 503, body: { message: 'rejected' } } : '';
    } });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog', { name: 'Import Messages', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await (await chooser).setFiles({ name: 'messages.zip', mimeType: 'application/zip', buffer: bytes });
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Imported 1 message(s); 1 failed');
    expect(bodies).toEqual(['<message><messageId>11</messageId></message>', '<message><messageId>22</messageId></message>']);
});

test('local TAR/BZip2 import works in the browser', async ({ page }) => {
    let imports = 0;
    await mockEngine(page, { 'POST /channels/c-started/messages/_import': () => { imports++; return ''; } });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog', { name: 'Import Messages', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await (await chooser).setFiles({ name: 'messages.tar.bz2', mimeType: 'application/octet-stream', buffer: Buffer.from('QlpoOTFBWSZTWQwJQ5wAADnfgsIiQAHnBQAgBABmhh5AAgABCCAASGhTTJ6mm1MgNA0GSgDQANNNqP1RRutqmBN4AJr0IAzLqgk4FqzXLTFtEmj5OhCySkGNg1IfsTIchyGnEMlXhAhiFQlmT+LuSKcKEgGBKHOA', 'base64') });
    await expect(page.getByText('Imported 1 message(s)', { exact: true })).toBeVisible();
    expect(imports).toBe(1);
});

test('cancelling message import produces no writes and releases the action lock', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, { 'POST /channels/c-started/messages/_import': () => { writes++; return ''; } });
    await page.goto('/messages/c-started');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Messages', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    expect(writes).toBe(0);
});

for (const recursive of [false, true]) {
    test(`local folder import ${recursive ? 'includes' : 'excludes'} nested messages`, async ({ page }) => {
        const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const folder = await mkdtemp(join(tmpdir(), 'oie-message-import-'));
        try {
            await mkdir(join(folder, 'nested'));
            await writeFile(join(folder, 'root.xml'), '<message><messageId>11</messageId></message>');
            await writeFile(join(folder, 'nested', 'child.xml'), '<message><messageId>22</messageId></message>');
            const bodies: string[] = [];
            await mockEngine(page, { 'POST /channels/c-started/messages/_import': (request: any) => { bodies.push(request.postData()); return ''; } });
            await page.goto('/messages/c-started');
            await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Import Messages', exact: true });
            await dialog.getByLabel('Import From', { exact: true }).selectOption('folder');
            if (!recursive) await dialog.getByLabel('Include Sub-folders').uncheck();
            const chooser = page.waitForEvent('filechooser');
            await dialog.getByRole('button', { name: 'Import', exact: true }).click();
            await (await chooser).setFiles(folder);
            await expect(page.getByText(`Imported ${recursive ? 2 : 1} message(s)`, { exact: true })).toBeVisible();
            expect(bodies).toHaveLength(recursive ? 2 : 1);
            expect(bodies).toContain('<message><messageId>11</messageId></message>');
        } finally { await rm(folder, { recursive: true, force: true }); }
    });
}
