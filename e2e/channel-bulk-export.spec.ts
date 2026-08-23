import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { readFile } from 'node:fs/promises';
import * as zipjs from '../web-administrator/client/vendor/zipjs.min.js';

/*
 * Bulk export/import parity with Swing.
 *
 * Swing's "Export All" asks for a DIRECTORY and writes one file per object into
 * it, because a deserializer reads a single Channel / ChannelGroup — the
 * engine's combined <list> response is not a document any importer accepts. The
 * web client used to save that <list> as channels.xml, so its own Export All
 * output could not be imported by itself OR by Swing. Export now builds the
 * per-object files into a ZIP (the browser's version of that directory), and
 * Import Channel additionally accepts a <list> root so the old files (and a raw
 * GET /channels dump) still load.
 */

zipjs.configure({ useWebWorkers: false });

/** Engine XML for GET /channels (Accept: application/xml): the Swing <list> shape. */
const CHANNELS_XML = `<list version="4.5.0">
  <channel version="4.5.0"><id>c-started</id><name>Demo Started</name><revision>1</revision></channel>
  <channel version="4.5.0"><id>c-stopped</id><name>Demo/Stopped</name><revision>1</revision></channel>
  <channel version="4.5.0"><id>c-third</id><name>Demo_Stopped</name><revision>1</revision></channel>
</list>`;

const GROUPS_XML = `<list version="4.5.0">
  <channelGroup version="4.5.0"><id>g-1</id><name>Group A</name><revision>1</revision>
    <channels><channel><id>c-started</id></channel></channels></channelGroup>
  <channelGroup version="4.5.0"><id>g-2</id><name>Group B</name><revision>1</revision>
    <channels><channel><id>c-stopped</id></channel></channels></channelGroup>
</list>`;

const GROUPS_JSON = { list: { channelGroup: [
    { '@version': '4.5.0', id: 'g-1', name: 'Group A', revision: 1, channels: { channel: [{ id: 'c-started' }] } },
    { '@version': '4.5.0', id: 'g-2', name: 'Group B', revision: 1, channels: { channel: [{ id: 'c-stopped' }] } }
] } };

/** The XML flavour of a fixture is chosen by the request's Accept header. */
const xmlOr = (xml: string, json: any) => (req: any) =>
    (req.headers()['accept'] || '').includes('xml') ? xml : json;

/** Read a downloaded ZIP into { entryName: text }. */
async function readZip(path: string) {
    const reader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([await readFile(path)])));
    const entries = await reader.getEntries();
    const out: Record<string, string> = {};
    for (const entry of entries) out[entry.filename] = await entry.getData(new zipjs.TextWriter());
    await reader.close();
    return out;
}

/* No File System Access pickers this run, so every export lands as a captured
   download instead of a native Save-As. */
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).showDirectoryPicker;
    });
});

test('Export All Channels writes one file per channel into a ZIP', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels': xmlOr(CHANNELS_XML, { list: { channel: [
            { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
            { '@version': '4.5.0', id: 'c-stopped', name: 'Demo/Stopped', revision: 1 },
            { '@version': '4.5.0', id: 'c-third', name: 'Demo_Stopped', revision: 1 }
        ] } })
    });

    await page.goto('/channels');
    const row = page.getByText('Demo Started').first();
    await expect(row).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await row.click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Export All Channels' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('channels.zip');

    const files = await readZip(await download.path());
    // Named from the channel, '/' folded to '_' — and the name that collides
    // with the folded one is numbered rather than silently overwriting it.
    expect(Object.keys(files).sort()).toEqual(['Demo Started.xml', 'Demo_Stopped (2).xml', 'Demo_Stopped.xml']);
    // Each file is a single <channel> document (what every importer reads),
    // still carrying the version the <list> was stamped with.
    for (const text of Object.values(files)) {
        expect(text.trim().startsWith('<channel')).toBe(true);
        expect(text).not.toContain('<list');
        expect(text).toContain('version="4.5.0"');
    }
});

test('Export All Channels aborts visibly when linked libraries cannot be loaded', async ({ page }) => {
    await mockEngine(page, {
        'GET /codeTemplateLibraries': {
            __status: 500,
            body: { message: 'code-template service unavailable' }
        }
    });
    let exportFetches = 0;
    page.on('request', request => {
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.pathname === '/api/channels'
            && (request.headers()['accept'] || '').includes('xml')) exportFetches++;
    });

    await page.goto('/channels');
    const row = page.getByText('Demo Started').first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Export All Channels' }).click();

    await expect(page.getByText(/Export failed:.*code-template service unavailable/i)).toBeVisible();
    expect(exportFetches).toBe(0);
});

test('Export All Groups writes one file per group, channels hydrated', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels': xmlOr(CHANNELS_XML, { list: { channel: [
            { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
            { '@version': '4.5.0', id: 'c-stopped', name: 'Demo/Stopped', revision: 1 }
        ] } }),
        'GET /channelgroups': xmlOr(GROUPS_XML, GROUPS_JSON)
    });

    await page.goto('/channels');
    await expect(page.getByText('[Group A]').first()).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export All Groups' }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('channel-groups.zip');

    const files = await readZip(await download.path());
    expect(Object.keys(files).sort()).toEqual(['Group A.xml', 'Group B.xml']);
    expect(files['Group A.xml'].trim().startsWith('<channelGroup')).toBe(true);
    // The membership reference was replaced by the whole channel, so the file
    // can recreate the group AND its channels on another server.
    expect(files['Group A.xml']).toContain('<name>Demo Started</name>');
    expect(files['Group B.xml']).toContain('<name>Demo/Stopped</name>');
});

test('group export offers and includes linked code-template libraries', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels': xmlOr(CHANNELS_XML, { list: { channel: [
            { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
            { '@version': '4.5.0', id: 'c-stopped', name: 'Demo/Stopped', revision: 1 }
        ] } }),
        'GET /channelgroups': xmlOr(GROUPS_XML, GROUPS_JSON),
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{
            id: 'lib-linked', name: 'Linked Helpers', includeNewChannels: false,
            enabledChannelIds: { string: ['c-started'] }, disabledChannelIds: ''
        }] } }
    });

    await page.goto('/channels');
    await expect(page.getByText('[Group A]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Export All Groups' }).first().click();

    const prompt = page.getByRole('dialog', { name: 'Export Channel' });
    await expect(prompt.getByText('Linked Helpers', { exact: true })).toBeVisible();
    const bundledRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return request.method() === 'GET' && url.pathname === '/api/channels'
            && url.searchParams.get('includeCodeTemplateLibraries') === 'true';
    });
    const download = page.waitForEvent('download');
    await prompt.getByRole('button', { name: 'Yes', exact: true }).click();

    await bundledRequest;
    await download;
});

test('Import Channel accepts a <list> file and imports every channel in it', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': '',
        'GET /server/resources': { list: '' }
    });

    const posted: string[] = [];
    await page.route('**/api/channels', async (route: any) => {
        const req = route.request();
        if (req.method() === 'POST') {
            posted.push(req.postData() || '');
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });

    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'Import Channel' }).first()).toBeVisible();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'channels.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from(`<list version="4.5.0">
  <channel version="4.5.0"><id>c-bulk-1</id><name>Bulk One</name><revision>1</revision></channel>
  <channel version="4.5.0"><id>c-bulk-2</id><name>Bulk Two</name><revision>1</revision></channel>
</list>`)
    });

    await expect.poll(() => posted.length, { timeout: 8000 }).toBe(2);
    // Each channel is uploaded on its own — the engine's create endpoint takes a
    // single Channel, never the list wrapper.
    for (const body of posted) {
        expect(body.trim().startsWith('<channel')).toBe(true);
        expect(body).not.toContain('<list');
    }
    expect(posted.join()).toContain('Bulk One');
    expect(posted.join()).toContain('Bulk Two');
    // A list import reports a tally, not a single channel name.
    await expect(page.locator('.toast-msg', { hasText: 'Imported 2 channel(s)' })).toBeVisible();
});
