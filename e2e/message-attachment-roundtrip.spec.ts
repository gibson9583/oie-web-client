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
 * engine serializes empty), while the sidecar file is still written too. It
 * then imports that exact XML to cover nested Response.message elements, which
 * must not be mistaken for additional top-level Message objects.
 */
zipjs.configure({ useWebWorkers: false });

const CID = 'c-started';
const MID = '987654321';
const MESSAGE = { messageId: MID, channelId: CID, serverId: 's1', connectorMessages: {} };
// "Hello, attachment!" — the engine hands attachment content back as base64.
const CONTENT_B64 = 'SGVsbG8sIGF0dGFjaG1lbnQh';
const SERIALIZED_MESSAGE = `<message>
  <messageId>${MID}</messageId>
  <serverId>s1</serverId>
  <channelId>${CID}</channelId>
  <processed>true</processed>
  <attachments/>
  <connectorMessages class="linked-hash-map">
    <entry>
      <int>0</int>
      <connectorMessage>
        <messageId>${MID}</messageId>
        <metaDataId>0</metaDataId>
        <responseMap>
          <entry><string>first</string><response><message>nested response one</message></response></entry>
          <entry><string>second</string><response><message>nested response two</message></response></entry>
        </responseMap>
      </connectorMessage>
    </entry>
  </connectorMessages>
</message>`;

test('Export with attachments embeds and re-imports the complete message XML', async ({ page }) => {
    let importedXml = '';
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        // Attachments are loaded separately, so the serialized Message starts
        // with an empty list which the browser export has to fill in.
        [`GET /channels/${CID}/messages/${MID}`]: SERIALIZED_MESSAGE,
        [`GET /channels/${CID}/messages/${MID}/attachments`]: {
            list: { attachment: [{ id: 'att-1', type: 'text/plain', content: CONTENT_B64 }] }
        },
        [`POST /channels/${CID}/messages/_import`]: (req: any) => {
            importedXml = req.postData() || '';
            return {};
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

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: `${CID}_message_${MID}.xml`,
        mimeType: 'application/xml',
        buffer: Buffer.from(xml)
    });

    await expect.poll(() => importedXml).not.toBe('');
    expect(importedXml).toContain('<connectorMessages class="linked-hash-map">');
    expect(importedXml).toContain('<message>nested response one</message>');
    expect(importedXml).toContain('<message>nested response two</message>');
    expect(importedXml).toContain('<attachments><attachment>');
    await expect(page.getByText('Imported 1 message(s)', { exact: true })).toBeVisible();
});

test('Import rejects payload XML that is not a serialized engine Message', async ({ page }) => {
    let posts = 0;
    await mockEngine(page, {
        [`POST /channels/${CID}/messages/_import`]: () => { posts++; return {}; }
    });
    await page.goto(`/messages/${CID}`);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'payload.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<message><patient>not an engine object</patient></message>')
    });

    await expect(page.getByText(/No serialized messages found/)).toBeVisible();
    expect(posts).toBe(0);
});

test('Export with attachments fails visibly instead of producing an incomplete archive', async ({ page }) => {
    await mockEngine(page, {
        [`GET /channels/${CID}/messages`]: (req: any) => {
            const offset = Number(new URL(req.url()).searchParams.get('offset') || 0);
            return { list: { message: offset > 0 ? [] : [MESSAGE] } };
        },
        [`GET /channels/${CID}/messages/count`]: { long: 1 },
        [`GET /channels/${CID}/messages/${MID}`]: SERIALIZED_MESSAGE,
        [`GET /channels/${CID}/messages/${MID}/attachments`]: {
            __status: 500,
            body: { message: 'attachment store offline' }
        }
    });
    await page.addInitScript(() => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).showDirectoryPicker;
    });
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await page.goto(`/messages/${CID}`);
    await expect(page.getByText(MID)).toBeVisible();
    await page.getByRole('button', { name: 'Export Results' }).click();
    await page.getByRole('checkbox', { name: 'Include Attachments' }).check();
    await page.getByRole('button', { name: 'Export', exact: true }).click();

    await expect(page.getByText(/Export failed: could not read attachments.*attachment store offline/i)).toBeVisible();
    expect(downloads).toBe(0);
});
