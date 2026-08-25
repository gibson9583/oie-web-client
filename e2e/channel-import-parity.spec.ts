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
async function importChannel(page: any, content: string, name = 'channel.xml', mimeType = 'application/xml') {
    const captured: { channelBody: string | null; deps: string | null } = { channelBody: null, deps: null };

    await page.route('**/api/channels', async (route: any) => {
        const req = route.request();
        if (req.method() === 'POST') {
            captured.channelBody = req.postData();
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":true}' });
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
    await chooser.setFiles({ name, mimeType, buffer: Buffer.from(content) });

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
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":true}' });
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
                : { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: { entry: [{ string: 'tpl-imported', codeTemplateUpdateResult: { success: true } }] } };
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

test('a web-native JSON export imports with its dependencies and resources intact', async ({ page }) => {
    /* The Import Channel button accepts the editor's own JSON export, which is
       GET /channels/{id} verbatim — same exportData edges and resourceIds maps
       as the XML. The JSON branch must not lose what the XML branch preserves. */
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': {
            'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties': [
                { id: 'NEW-RESOURCE-UUID', name: 'Shared Libs' }
            ]
        }
    });

    const json = JSON.stringify({
        channel: {
            '@version': '4.5.0',
            id: 'c-json-import',
            name: 'Json Imported Channel',
            revision: 3,
            sourceConnector: { properties: { sourceConnectorProperties: {
                // Deliberately the bare one-entry shape XStream-JSON emits.
                resourceIds: { '@class': 'linked-hash-map', entry: { string: ['OLD-RESOURCE-UUID', 'Shared Libs'] } }
            } } },
            properties: { resourceIds: { '@class': 'linked-hash-map', entry: [{ string: ['OLD-RESOURCE-UUID', 'Shared Libs'] }] } },
            exportData: {
                metadata: { enabled: true },
                dependencyIds: { string: 'c-upstream' },
                dependentIds: { string: ['c-downstream'] }
            }
        }
    });

    const captured = await importChannel(page, json, 'channel.json', 'application/json');
    await expect.poll(() => captured.deps, { timeout: 8000 }).not.toBeNull();

    // Both edges landed with the right orientation.
    const putEdges = JSON.parse(captured.deps!).set.channelDependency;
    expect(putEdges).toContainEqual({ dependentId: 'c-json-import', dependencyId: 'c-upstream' });
    expect(putEdges).toContainEqual({ dependentId: 'c-downstream', dependencyId: 'c-json-import' });

    // The upload carries neither id list, and every resourceIds map (channel
    // properties AND connector) was re-pointed by name.
    const uploaded = JSON.parse(captured.channelBody!).channel;
    expect(uploaded.exportData.dependencyIds).toBeUndefined();
    expect(uploaded.exportData.dependentIds).toBeUndefined();
    const flat = JSON.stringify(uploaded);
    expect(flat).toContain('NEW-RESOURCE-UUID');
    expect(flat).not.toContain('OLD-RESOURCE-UUID');
});

test('cancelling one group-embedded channel keeps the edges of channels already imported', async ({ page }) => {
    /* The channels already uploaded had their dependency elements stripped, so
       their edges exist only in the deferred merge — a cancel on a later
       channel's collision prompt must still flush them. */
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    const uploads: string[] = [];
    let dependencyBody = '';
    await page.route('**/api/channels', async route => {
        if (route.request().method() === 'POST') {
            uploads.push(route.request().postData() || '');
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":true}' });
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

    const xml = `<channelGroup version="4.5.0">
      <id>g-cancel</id><name>Cancel Group</name><revision>1</revision>
      <channels>
        <channel version="4.5.0"><id>c-grp-a</id><name>Group Channel A</name><revision>1</revision>
          <exportData><dependencyIds><string>${OTHER_ID}</string></dependencyIds></exportData>
        </channel>
        <channel version="4.5.0"><id>c-grp-b</id><name>Demo Started</name><revision>1</revision><exportData/></channel>
      </channels>
    </channelGroup>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({ name: 'group.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    // The second channel collides with the fixture "Demo Started" by name:
    // acknowledge the warning, decline overwrite, cancel at the rename prompt.
    const warning = page.getByRole('dialog', { name: 'Warning' });
    await expect(warning).toContainText('already exists');
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    const overwrite = page.getByRole('dialog', { name: 'Import Channel' });
    await overwrite.getByRole('button', { name: 'No', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Import Channel' });
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Channel A was uploaded before the cancel; its edge must still land.
    await expect.poll(() => dependencyBody, { timeout: 8000 }).not.toBe('');
    expect(dependencyBody).toContain('c-grp-a');
    expect(dependencyBody).toContain(OTHER_ID);
    expect(uploads).toHaveLength(1);
});

test('the JSON channel path enforces the same version gate as the XML path', async ({ page }) => {
    // A .json extension must not bypass the migration gate the XML path runs.
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    let posts = 0;
    await page.route('**/api/channels', async route => {
        if (route.request().method() === 'POST') { posts++; return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
        return route.fallback();
    });

    const json = JSON.stringify({ channel: { '@version': '9.9.9', id: 'c-future', name: 'Future Channel', revision: 1 } });

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(json) });

    const dialog = page.getByRole('dialog', { name: 'Information' });
    await expect(dialog).toContainText('originated from a newer version');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(posts).toBe(0);
});

test('a rejected POST /channels (boolean false) fails the import instead of reporting success', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    await page.route('**/api/channels', async (route: any) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":false}' });
        }
        return route.fallback();
    });

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({
        name: 'rejected.xml', mimeType: 'application/xml',
        buffer: Buffer.from('<channel version="4.5.0"><id>c-rejected</id><name>Rejected Channel</name><revision>1</revision></channel>')
    });

    await expect(page.getByText(/engine rejected channel "Rejected Channel"/).first()).toBeVisible();
    await expect(page.getByText('Imported rejected.xml', { exact: true })).toHaveCount(0);
});

test('group mutations are refused while the group list is a failed-load stand-in', async ({ page }) => {
    /* /channelgroups answered 500, so [] is standing in for the real set. A
       group save rebuilds the COMPLETE set — running it now would post only the
       new content and delete every existing group. */
    let groupPosts = 0;
    await mockEngine(page, {
        'GET /channelgroups': { __status: 500, body: { message: 'groups unavailable' } },
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /channelgroups/_bulkUpdate': () => { groupPosts++; return ''; }
    });

    await page.goto('/channels');
    await expect(page.getByText(/Could not load/).first()).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({
        name: 'group.xml', mimeType: 'application/xml',
        buffer: Buffer.from(`<channelGroup version="4.5.0">
          <id>g-blocked</id><name>Blocked Group</name><revision>1</revision>
          <channels><channel version="4.5.0"><id>c-blocked</id><name>Blocked Channel</name><revision>1</revision></channel></channels>
        </channelGroup>`)
    });

    await expect(page.getByText(/group list failed to load/).first()).toBeVisible();
    expect(groupPosts).toBe(0);
});

test('group mutations stay locked until the initial group baseline is committed', async ({ page }) => {
    let groupPosts = 0;
    let releaseGroups!: () => void;
    const groupsHeld = new Promise<void>(resolve => { releaseGroups = resolve; });
    await mockEngine(page, {
        'POST /channelgroups/_bulkUpdate': () => { groupPosts++; return { boolean: true }; }
    });
    await page.route('**/api/channelgroups', async route => {
        await groupsHeld;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: '' }) });
    });

    const groupRequest = page.waitForRequest(request =>
        request.method() === 'GET' && new URL(request.url()).pathname === '/api/channelgroups');
    await page.goto('/channels');
    await groupRequest;

    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Group' });
    await dialog.locator('input[type=text]').fill('Too Early');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page.getByText(/group list failed to load/).first()).toBeVisible();
    expect(groupPosts).toBe(0);

    const groupResponse = page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/channelgroups');
    releaseGroups();
    await groupResponse;
});

test('cancelling the group-library prompt aborts BEFORE anything is created', async ({ page }) => {
    /* The decision is taken up front: once channels are posted a Cancel cannot
       be honored (there is no rollback), so nothing may be posted yet. */
    let channelPosts = 0;
    let groupPosts = 0;
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() !== 'POST') return;
        if (path === '/api/channels') channelPosts++;
        if (path === '/api/channelgroups/_bulkUpdate') groupPosts++;
    });
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });

    const xml = `<channelGroup version="4.5.0">
      <id>g-libs</id><name>Group With Libraries</name><revision>1</revision>
      <channels><channel version="4.5.0">
        <id>c-lib-child</id><name>Library Child</name><revision>1</revision>
        <exportData><codeTemplateLibraries><codeTemplateLibrary version="4.5.0">
          <id>lib-bundled</id><name>Bundled Library</name><revision>1</revision>
        </codeTemplateLibrary></codeTemplateLibraries></exportData>
      </channel></channels>
    </channelGroup>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({ name: 'group-libs.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    const prompt = page.getByRole('dialog', { name: 'Import Channel' });
    await expect(prompt.getByText(/code template librar/i)).toBeVisible();
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByRole('dialog', { name: 'Import Channel' })).toBeHidden();
    expect(channelPosts).toBe(0);
    expect(groupPosts).toBe(0);
});

test('a rejected JSON import (boolean false) fails instead of reporting success', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    await page.route('**/api/channels', async (route: any) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":false}' });
        }
        return route.fallback();
    });

    const json = JSON.stringify({ channel: { '@version': '4.5.0', id: 'c-rejected-json', name: 'Rejected Json Channel', revision: 1 } });

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({ name: 'rejected.json', mimeType: 'application/json', buffer: Buffer.from(json) });

    await expect(page.getByText(/engine rejected channel "Rejected Json Channel"/).first()).toBeVisible();
    await expect(page.getByText('Imported rejected.json', { exact: true })).toHaveCount(0);
});

test('a channel identity appearing after collision resolution cancels instead of being overwritten', async ({ page }) => {
    let identityReads = 0;
    let posts = 0;
    const base = { map: { entry: [{ string: ['c-existing', 'Existing Channel'] }] } };
    await mockEngine(page, {
        'GET /channels/idsAndNames': () => {
            identityReads++;
            return identityReads === 1 ? base : { map: { entry: [
                { string: ['c-existing', 'Existing Channel'] },
                { string: ['c-race', 'Raced Channel'] }
            ] } };
        },
        'POST /channels': () => { posts++; return { boolean: true }; }
    });

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({
        name: 'raced.xml', mimeType: 'application/xml',
        buffer: Buffer.from('<channel version="4.5.0"><id>c-race</id><name>Raced Channel</name><revision>1</revision></channel>')
    });

    await expect(page.getByText(/channel list changed while the import was being confirmed/).first()).toBeVisible();
    expect(posts).toBe(0);
});

test('single-channel export refuses an empty or wrong engine answer', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/c-started': ''
    });
    await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await page.goto('/channels');
    await page.getByRole('gridcell', { name: 'Demo Started', exact: true }).click();
    await page.getByRole('button', { name: 'Export Channel', exact: true }).click();

    await expect(page.getByText(/Export failed:[\s\S]*did not return channel/).first()).toBeVisible();
    expect(downloads).toBe(0);
});

test('a failed library save aborts the group import before any channel exists', async ({ page }) => {
    /* Swing saves consolidated libraries FIRST and aborts on failure
       (ChannelPanel.importGroup) — creating channels whose templates never
       arrived leaves them broken behind a success toast. */
    let channelPosts = 0;
    let groupPosts = 0;
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() !== 'POST') return;
        if (path === '/api/channels') channelPosts++;
        if (path === '/api/channelgroups/_bulkUpdate') groupPosts++;
    });
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /codeTemplateLibraries/_bulkUpdate': { __status: 500, body: { message: 'library store offline' } }
    });

    const xml = `<channelGroup version="4.5.0">
      <id>g-lib-fail</id><name>Library Failure Group</name><revision>1</revision>
      <channels><channel version="4.5.0">
        <id>c-lib-fail</id><name>Library Failure Channel</name><revision>1</revision>
        <exportData><codeTemplateLibraries><codeTemplateLibrary version="4.5.0">
          <id>lib-fail</id><name>Failing Library</name><revision>1</revision>
        </codeTemplateLibrary></codeTemplateLibraries></exportData>
      </channel></channels>
    </channelGroup>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({ name: 'group-lib-fail.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    const prompt = page.getByRole('dialog', { name: 'Import Channel' });
    await expect(prompt.getByText(/code template librar/i)).toBeVisible();
    await prompt.getByRole('button', { name: 'Yes', exact: true }).click();

    await expect(page.getByText(/library store offline/).first()).toBeVisible();
    expect(channelPosts).toBe(0);
    expect(groupPosts).toBe(0);
});

test('an unconfirmed channel POST (200 {}) is not reported as an import', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });
    await page.route('**/api/channels', async (route: any) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fallback();
    });

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    await (await chooser).setFiles({
        name: 'unconfirmed.xml', mimeType: 'application/xml',
        buffer: Buffer.from('<channel version="4.5.0"><id>c-unconfirmed</id><name>Unconfirmed Channel</name><revision>1</revision></channel>')
    });

    await expect(page.getByText(/did not confirm channel "Unconfirmed Channel"/).first()).toBeVisible();
    await expect(page.getByText('Imported unconfirmed.xml', { exact: true })).toHaveCount(0);
});

test('a failed duplicate-channel creation leaves NO phantom group membership', async ({ page }) => {
    /* Two groups carry c-dupe: the first defines it, the second references it.
       Its creation fails — no group may still reference it, or the saved set
       carries a member that points at nothing. */
    let groupBody = '';
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /channelgroups/_bulkUpdate': (req: any) => { groupBody = req.postData() || ''; return { boolean: true }; }
    });
    await page.route('**/api/channels', async (route: any) => {
        if (route.request().method() === 'POST') {
            const body = route.request().postData() || '';
            return body.includes('Dupe Channel')
                ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
                : route.fulfill({ status: 200, contentType: 'application/json', body: '{"boolean":true}' });
        }
        return route.fallback();
    });

    const xml = `<list version="4.5.0">
      <channelGroup version="4.5.0"><id>g-one</id><name>Group One</name><revision>1</revision>
        <channels>
          <channel version="4.5.0"><id>c-dupe</id><name>Dupe Channel</name><revision>1</revision></channel>
          <channel version="4.5.0"><id>c-fine</id><name>Fine Channel</name><revision>1</revision></channel>
        </channels></channelGroup>
      <channelGroup version="4.5.0"><id>g-two</id><name>Group Two</name><revision>1</revision>
        <channels><channel><id>c-dupe</id></channel></channels></channelGroup>
    </list>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({ name: 'groups.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    await expect(page.getByText(/Imported 2 group\(s\), 1 channel\(s\)[\s\S]*skipped 1/).first()).toBeVisible();
    expect(groupBody).toContain('c-fine');
    expect(groupBody).not.toContain('c-dupe');
});

test('a malformed group-list answer locks group mutations like a failed load', async ({ page }) => {
    /* 200 {} is not "a server with no groups": treating it as one arms the
       full-set rebuild, and the Overwrite retry would delete every real group. */
    let groupPosts = 0;
    await mockEngine(page, {
        'GET /channelgroups': {},
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /channelgroups/_bulkUpdate': () => { groupPosts++; return { boolean: true }; }
    });

    await page.goto('/channels');
    await expect(page.getByText(/Could not load/).first()).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({
        name: 'group.xml', mimeType: 'application/xml',
        buffer: Buffer.from(`<channelGroup version="4.5.0">
          <id>g-x</id><name>Group X</name><revision>1</revision>
          <channels><channel version="4.5.0"><id>c-x</id><name>Channel X</name><revision>1</revision></channel></channels>
        </channelGroup>`)
    });

    await expect(page.getByText(/group list failed to load/).first()).toBeVisible();
    expect(groupPosts).toBe(0);
});

const unsafeGroupLists: Array<[string, any]> = [
    ['bare array', []],
    ['empty named wrapper', { list: { channelGroup: [] } }],
    ['group without an id', { list: { channelGroup: [{ name: 'Malformed Group', channels: '' }] } }],
    ['duplicate group ids', { list: { channelGroup: [
        { id: 'g-duplicate', name: 'One', revision: 1, channels: '' },
        { id: 'g-duplicate', name: 'Two', revision: 1, channels: '' }
    ] } }],
    ['group without a name', { list: { channelGroup: [
        { id: 'g-1', revision: 1, channels: '' }
    ] } }],
    ['group without a revision', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', channels: '' }
    ] } }],
    ['duplicate group names', { list: { channelGroup: [
        { id: 'g-1', name: 'Duplicate', revision: 1, channels: '' },
        { id: 'g-2', name: 'Duplicate', revision: 1, channels: '' }
    ] } }],
    ['missing membership list', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1 }
    ] } }],
    ['malformed membership wrapper', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1, channels: {} }
    ] } }],
    ['bare membership array', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1, channels: [] }
    ] } }],
    ['empty named membership wrapper', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1, channels: { channel: [] } }
    ] } }],
    ['membership without a channel id', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1, channels: { channel: [{ name: 'No Id' }] } }
    ] } }],
    ['duplicate membership in one group', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1,
            channels: { channel: [{ id: 'c-shared' }, { id: 'c-shared' }] } }
    ] } }],
    ['membership duplicated across groups', { list: { channelGroup: [
        { id: 'g-1', name: 'Group One', revision: 1, channels: { channel: [{ id: 'c-shared' }] } },
        { id: 'g-2', name: 'Group Two', revision: 1, channels: { channel: [{ id: 'c-shared' }] } }
    ] } }]
];
for (const [wireCase, response] of unsafeGroupLists) {
    test(`a group-list ${wireCase} cannot unlock whole-set mutations`, async ({ page }) => {
        let groupPosts = 0;
        await mockEngine(page, {
            'GET /channelgroups': response,
            'POST /channelgroups/_bulkUpdate': () => { groupPosts++; return { boolean: true }; }
        });

        await page.goto('/channels');
        await expect(page.getByText(/Could not load.*groups/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'New Group', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New Group' });
        await dialog.locator('input[type=text]').fill('Must Not Save');
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();

        await expect(page.getByText(/group list failed to load/).first()).toBeVisible();
        expect(groupPosts).toBe(0);
    });
}

test('an empty-body group-list answer locks whole-set mutations', async ({ page }) => {
    /* No HTTP body parses as null. It is not the engine's genuine empty <list/>
       and must never unlock a replacement built from the [] render fallback. */
    let groupPosts = 0;
    await mockEngine(page, {
        'GET /channelgroups': '',
        'POST /channelgroups/_bulkUpdate': () => { groupPosts++; return { boolean: true }; }
    });

    await page.goto('/channels');
    await expect(page.getByText(/Could not load/).first()).toBeVisible();
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Group' });
    await dialog.locator('input[type=text]').fill('Must Not Save');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page.getByText(/group list failed to load/).first()).toBeVisible();
    expect(groupPosts).toBe(0);
});

test('group Import as New keeps one replacement id for a shared bundled template', async ({ page }) => {
    let bulkBody = '';
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' },
        'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
            bulkBody = req.postData() || '';
            const ids = [...new Set(bulkBody.match(uuidRe) || [])];
            return {
                overrideNeeded: false,
                librariesSuccess: true,
                codeTemplateResults: { entry: ids.map(id => ({
                    string: id,
                    codeTemplateUpdateResult: { success: true }
                })) }
            };
        }
    });

    const library = (channelId: string) => `<codeTemplateLibrary version="4.5.0">
      <id>lib-1</id><name>Demo Library</name><revision>1</revision>
      <enabledChannelIds><string>${channelId}</string></enabledChannelIds>
      <codeTemplates><codeTemplate version="4.5.0">
        <id>tpl-1</id><name>Trim Whitespace</name><revision>1</revision>
        <properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.5.0">
          <type>FUNCTION</type><code>function trim(s) { return 'different'; }</code>
        </properties>
      </codeTemplate></codeTemplates>
    </codeTemplateLibrary>`;
    const xml = `<channelGroup version="4.5.0">
      <id>g-shared-template</id><name>Shared Template Group</name><revision>1</revision>
      <channels>
        <channel version="4.5.0"><id>c-shared-a</id><name>Shared A</name><revision>1</revision>
          <exportData><codeTemplateLibraries>${library('c-shared-a')}</codeTemplateLibraries></exportData></channel>
        <channel version="4.5.0"><id>c-shared-b</id><name>Shared B</name><revision>1</revision>
          <exportData><codeTemplateLibraries>${library('c-shared-b')}</codeTemplateLibraries></exportData></channel>
      </channels>
    </channelGroup>`;

    await page.goto('/channels');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Group', exact: true }).click();
    await (await chooser).setFiles({ name: 'shared-template.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    const librariesPrompt = page.getByRole('dialog', { name: 'Import Channel' });
    await librariesPrompt.getByRole('button', { name: 'Yes', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Import Code Templates' });
    await expect(conflict).toContainText('1 bundled code template');
    await conflict.getByRole('button', { name: 'Import as New', exact: true }).click();

    await expect.poll(() => bulkBody).not.toBe('');
    const replacementIds = [...new Set(bulkBody.match(uuidRe) || [])];
    expect(replacementIds).toHaveLength(1);
    // The one replacement is referenced by both channel/library copies, rather
    // than each occurrence receiving a different identity.
    expect((bulkBody.match(new RegExp(replacementIds[0], 'g')) || []).length).toBeGreaterThan(1);
});
