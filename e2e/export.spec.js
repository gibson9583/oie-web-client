import { test, expect } from '@playwright/test';
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
    await mockEngine(page, {
        // Paginated search: the message on the first batch, empty after (loop terminates).
        [`GET /channels/${CID}/messages`]: (req) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        // The per-message XML fetch the export performs for "XML serialized message".
        [`GET /channels/${CID}/messages/987654321`]: '<message><messageId>987654321</messageId></message>',
    });
    // Force the download fallback (no File System Access pickers this run) so the
    // result is a captured download rather than a native Save-As / folder pick.
    await page.addInitScript(() => {
        delete window.showSaveFilePicker;
        delete window.showDirectoryPicker;
    });

    await page.goto(`/#/messages/${CID}`);
    // Auto-search populated the results grid.
    await expect(page.getByText('987654321')).toBeVisible();

    // Open the dialog and export with defaults (XML serialized · My Computer).
    await page.getByRole('button', { name: 'Export Results' }).click();
    await expect(page.getByText('File Pattern:')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // It's a real ZIP containing the exported message file.
    const buf = await readFile(await download.path());
    const reader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([buf])));
    const entries = await reader.getEntries();
    await reader.close();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.filename.endsWith('.xml'))).toBe(true);
});
