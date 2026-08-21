import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { readFile } from 'node:fs/promises';
import * as zipjs from '../web-administrator/client/vendor/zipjs.min.js';

/*
 * Export -> Import round trip for attachments (issue #41). The importer only
 * ever sees the <message> blocks it scans out of the XML file, so an export
 * that wrote attachment content to sidecar files alone re-imported empty. This
 * pins the fix: with "Include Attachments" ticked, the message XML in the ZIP
 * carries the attachment inline (spliced into the <attachments> element the
 * engine serializes empty), while the sidecar file is still written too.
 */
zipjs.configure({ useWebWorkers: false });

const CID = 'c-started';
const MID = '987654321';
const MESSAGE = { messageId: MID, channelId: CID, serverId: 's1', connectorMessages: {} };
// "Hello, attachment!" — the engine hands attachment content back as base64.
const CONTENT_B64 = 'SGVsbG8sIGF0dGFjaG1lbnQh';

test('Export with attachments embeds them in the message XML', async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        // GET /messages/{id} answers from the message table only: <attachments>
        // comes back empty, which is exactly what the export has to fill in.
        [`GET /channels/${CID}/messages/${MID}`]:
            `<message><messageId>${MID}</messageId><attachments/></message>`,
        [`GET /channels/${CID}/messages/${MID}/attachments`]: {
            list: { attachment: [{ id: 'att-1', type: 'text/plain', content: CONTENT_B64 }] }
        }
    });
    // Force the download fallback (no File System Access pickers this run) so the
    // result is a captured download rather than a native Save-As / folder pick.
    await page.addInitScript(() => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).showDirectoryPicker;
    });

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText(MID)).toBeVisible();

    await page.getByRole('button', { name: 'Export Results' }).click();
    await expect(page.getByText('File Pattern:')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Include Attachments' }).check();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;

    const buf = await readFile(await download.path());
    const reader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([buf])));
    const entries = await reader.getEntries();

    const messageEntry = entries.find((e: any) => e.filename === `${CID}_message_${MID}.xml`);
    expect(messageEntry).toBeTruthy();
    const xml = await messageEntry!.getData!(new zipjs.TextWriter());
    await reader.close();

    // Self-contained: the XML the importer would POST carries the content, in
    // the shape XStream reads back into Message.attachments.
    expect(xml).toContain('<attachments><attachment>');
    expect(xml).toContain('<id>att-1</id>');
    expect(xml).toContain('<type>text/plain</type>');
    expect(xml).toContain(`<content>${CONTENT_B64}</content>`);
    expect(xml).not.toContain('<attachments/>');

    // The sidecar file is still written — decoded, and useful on its own.
    expect(entries.some((e: any) => e.filename === `${CID}_message_${MID}_attachment_att-1.txt`)).toBe(true);
});
