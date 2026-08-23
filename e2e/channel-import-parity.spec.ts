import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Channel import must carry over the two things the engine does NOT apply from
 * exportData on create/update:
 *
 *  - deploy/start dependencies (exportData.dependencyIds / dependentIds), which
 *    Swing merges into the global dependency set and PUTs, and
 *  - library resource assignments (resourceIds id->name maps), whose ids are
 *    meaningless on a different server and must be re-matched by name.
 *
 * Without these an imported channel loses its ordering and deploys without its
 * libraries, silently.
 */

const OTHER_ID = 'c-upstream';

/** A channel export carrying one dependency edge and one foreign resource id. */
const CHANNEL_XML = `<channel version="4.5.0">
  <id>c-imported</id>
  <name>Imported Channel</name>
  <revision>7</revision>
  <sourceConnector version="4.5.0">
    <properties>
      <sourceConnectorProperties version="4.5.0">
        <resourceIds class="linked-hash-map">
          <entry><string>OLD-RESOURCE-UUID</string><string>Shared Libs</string></entry>
        </resourceIds>
      </sourceConnectorProperties>
    </properties>
  </sourceConnector>
  <properties version="4.5.0">
    <resourceIds class="linked-hash-map">
      <entry><string>OLD-RESOURCE-UUID</string><string>Shared Libs</string></entry>
      <entry><string>UNKNOWN-UUID</string><string>Not On This Server</string></entry>
    </resourceIds>
  </properties>
  <exportData>
    <metadata><enabled>true</enabled></metadata>
    <dependencyIds><string>${OTHER_ID}</string></dependencyIds>
    <dependentIds/>
  </exportData>
</channel>`;

/** Wire the import flow: capture the channel POST and the dependency PUT. */
async function importChannel(page: any, xml: string) {
    const captured: { channelBody: string | null; deps: string | null } = { channelBody: null, deps: null };

    await page.route('**/api/channels', async (route: any) => {
        const req = route.request();
        if (req.method() === 'POST') {
            captured.channelBody = req.postData();
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });
    await page.route('**/api/server/channelDependencies', async (route: any) => {
        const req = route.request();
        if (req.method() === 'PUT') {
            captured.deps = req.postData();
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });

    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'Import Channel' }).first()).toBeVisible();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'channel.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    return captured;
}

test('import merges the export dependency edge and strips it from the upload', async ({ page }) => {
    await mockEngine(page, {
        // One pre-existing, unrelated edge that the merge must preserve.
        'GET /server/channelDependencies': {
            set: { channelDependency: [{ dependentId: 'c-a', dependencyId: 'c-b' }] }
        },
        'GET /server/resources': { list: '' }
    });

    const captured = await importChannel(page, CHANNEL_XML);
    await expect.poll(() => captured.deps, { timeout: 8000 }).not.toBeNull();

    // The imported edge was added and the existing one kept.
    expect(captured.deps).toContain(OTHER_ID);
    expect(captured.deps).toContain('c-imported');
    expect(captured.deps).toContain('c-a');
    expect(captured.deps).toContain('c-b');

    // The uploaded channel no longer carries the (engine-ignored) id elements.
    expect(captured.channelBody).not.toContain('dependencyIds');
    expect(captured.channelBody).not.toContain('dependentIds');
});

test('import re-points resource ids by name and warns about unmatched ones', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        // The target server knows "Shared Libs" under a DIFFERENT id.
        'GET /server/resources': {
            'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties': [
                { id: 'NEW-RESOURCE-UUID', name: 'Shared Libs' }
            ]
        }
    });

    const captured = await importChannel(page, CHANNEL_XML);

    // The unmatched-resource warning is raised during the re-map, which runs before
    // the upload. toast(..., 'warn') renders a modal here, not a corner toast.
    await expect(page.getByText('Not On This Server')).toBeVisible();
    await page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();

    await expect.poll(() => captured.channelBody, { timeout: 8000 }).not.toBeNull();
    // Both occurrences (channel properties + source connector) were re-pointed.
    expect(captured.channelBody).toContain('NEW-RESOURCE-UUID');
    expect(captured.channelBody).not.toContain('OLD-RESOURCE-UUID');
    // An id whose name matches nothing here is left alone.
    expect(captured.channelBody).toContain('UNKNOWN-UUID');
});

test('a channel export with no dependencies PUTs nothing', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });

    const plain = CHANNEL_XML.replace(`<dependencyIds><string>${OTHER_ID}</string></dependencyIds>`, '');
    const captured = await importChannel(page, plain);
    await expect.poll(() => captured.channelBody, { timeout: 8000 }).not.toBeNull();
    expect(captured.deps).toBeNull();
});

test('list import remaps both dependency endpoints after id collisions resolve', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    const uploads: string[] = [];
    let dependencyBody = '';
    await page.route('**/api/channels', async route => {
        if (route.request().method() === 'POST') {
            uploads.push(route.request().postData() || '');
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });
    await page.route('**/api/server/channelDependencies', async route => {
        if (route.request().method() === 'PUT') {
            dependencyBody = route.request().postData() || '';
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });

    // The second imported channel deliberately reuses c-started, an id already
    // present on the target server. It gets a new UUID without a name prompt;
    // the first channel's edge must follow that UUID, not the unrelated target.
    const xml = `<list version="4.5.0">
      <channel><id>c-import-a</id><name>Imported A</name><revision>1</revision>
        <exportData><dependencyIds><string>c-started</string></dependencyIds></exportData>
      </channel>
      <channel><id>c-started</id><name>Imported Peer</name><revision>1</revision><exportData/></channel>
    </list>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({
        name: 'channels.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)
    });

    await expect(page.getByText('Imported 2 channel(s) from channels.xml', { exact: true })).toBeVisible();
    expect(uploads).toHaveLength(2);
    const peerUpload = uploads.find(body => body.includes('<name>Imported Peer</name>')) || '';
    const peerId = peerUpload.match(/<id>([^<]+)<\/id>/)?.[1];
    expect(peerId).toBeTruthy();
    expect(peerId).not.toBe('c-started');
    expect(dependencyBody).toContain('c-import-a');
    expect(dependencyBody).toContain(peerId!);
    expect(dependencyBody).not.toContain('c-started');
});

test('bundled XML libraries and templates use one atomic bulk update', async ({ page }) => {
    const overrides: string[] = [];
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            const override = new URL(req.url()).searchParams.get('override') || '';
            overrides.push(override);
            return override === 'false'
                ? { overrideNeeded: true, librariesSuccess: false, codeTemplateResults: {} }
                : { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} };
        }
    });
    let bulkBody = '';
    let sequentialPuts = 0;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path === '/api/codeTemplateLibraries/_bulkUpdate') {
            bulkBody = request.postData() || '';
        }
        if (request.method() === 'PUT' &&
            (path === '/api/codeTemplateLibraries' || path.startsWith('/api/codeTemplates/'))) {
            sequentialPuts++;
        }
    });
    const xml = `<channel version="4.5.0">
      <id>c-with-library</id><name>With Library</name><revision>1</revision>
      <exportData><codeTemplateLibraries><codeTemplateLibrary version="4.5.0">
        <id>lib-imported</id><name>Imported Library</name><revision>1</revision>
        <enabledChannelIds><string>c-with-library</string></enabledChannelIds>
        <codeTemplates><codeTemplate version="4.5.0">
          <id>tpl-imported</id><name>Imported Template</name><revision>1</revision>
          <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0">
            <type>FUNCTION</type><code>function imported() { return true; }</code>
          </properties>
        </codeTemplate></codeTemplates>
      </codeTemplateLibrary></codeTemplateLibraries></exportData>
    </channel>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({
        name: 'with-library.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)
    });
    const prompt = page.getByRole('dialog', { name: 'Import Channel' });
    await expect(prompt.getByText(/code template librar/i)).toBeVisible();
    await prompt.getByRole('button', { name: 'Yes', exact: true }).click();

    const conflict = page.getByRole('dialog', { name: 'Code Template Libraries Modified' });
    await expect(conflict).toContainText(/changed while the channel import was being prepared/i);
    expect(overrides).toEqual(['false']);
    await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();

    await expect(page.getByText('Imported with-library.xml', { exact: true })).toBeVisible();
    expect(overrides).toEqual(['false', 'true']);
    expect(bulkBody).toContain('lib-imported');
    expect(bulkBody).toContain('tpl-imported');
    expect(bulkBody).toContain('"list"');
    expect((bulkBody.match(/"revision":0/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(sequentialPuts).toBe(0);
});
