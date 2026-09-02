import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
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
