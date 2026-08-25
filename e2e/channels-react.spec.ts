import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockEngine } from './mock.js';
import * as zipjs from '../web-administrator/client/vendor/zipjs.min.js';

zipjs.configure({ useWebWorkers: false });

/*
 * Focused coverage for the React Channels view (the grouped channel tree). The
 * legacy-parity guardrails (lists Demo Started/Demo Stopped, New Channel present,
 * column header menu hides/restores Description while Name is never offered) live
 * in channels.spec.js and must keep passing; this spec exercises the tree-grid
 * structure, the counts bar, twisty collapse, selection-gated task buttons across
 * BOTH task panes, the group selection path, and click-empty-to-clear.
 *
 * Channel groups are added via the 'GET /channelgroups' override so the grouped
 * tree shows a real group with one member channel plus the synthetic Default
 * Group for the ungrouped channel. The bulkUpdate endpoint is a multipart POST to
 * /channelgroups/_bulkUpdate (no-op in the mock; we only assert UI behavior).
 */

// A real group ("Demo Group") owning c-started; c-stopped falls into [Default Group].
const GROUPS_FIXTURE = {
    'GET /channelgroups': {
        list: {
            channelGroup: [
                {
                    '@version': '4.5.0', id: 'g-1', name: 'Demo Group', revision: 1,
                    description: 'A demo channel group',
                    channels: { channel: [{ id: 'c-started' }] }
                }
            ]
        }
    },
    // bulkUpdate target (New Group / Assign To Group / Delete Group) — accept + no-op.
    'POST /channelgroups/_bulkUpdate': ''
};

async function gotoChannels(page: any) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page).toHaveURL(/\/channels/);
}

test.describe('Channels React view', () => {
    test.beforeEach(async ({ page }) => {
        await mockEngine(page, GROUPS_FIXTURE);
    });

    test('renders the grouped channel tree with a real group and the Default Group', async ({ page }) => {
        await gotoChannels(page);

        // Both groups render as bracketed group rows (the tree, not a flat list).
        await expect(page.getByRole('gridcell', { name: '[Demo Group]', exact: true })).toBeVisible();
        await expect(page.getByRole('gridcell', { name: '[Default Group]', exact: true })).toBeVisible();

        // The member channels are listed under their groups.
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();

        // The bottom counts bar reports groups / channels / enabled.
        await expect(page.locator('.filterbar .counts')).toHaveText('2 Groups, 2 Channels, 2 Enabled');
    });

    test('keeps successfully loaded channels visible when an auxiliary load fails', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /channels/statuses': { __status: 500, body: { error: 'status service unavailable' } }
        });
        await gotoChannels(page);

        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
        await expect(page.locator('.view-body [role="alert"]')).toContainText('status service unavailable');
    });

    test('twisty collapses a group, hiding its channel rows', async ({ page }) => {
        await gotoChannels(page);
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        // The group rows each carry an expand/collapse twisty (expanded = ▾).
        const demoGroupRow = page.getByRole('row', { name: /\[Demo Group\]/ });
        await demoGroupRow.locator('.twisty').click();

        // Collapsing [Demo Group] removes its member channel from the tree, but the
        // ungrouped channel under [Default Group] stays.
        await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
    });

    test('selecting a channel reveals the selection-gated Channel Tasks', async ({ page }) => {
        await gotoChannels(page);

        // Nothing selected: the always-on tasks are present, the gated ones are not.
        await expect(page.getByRole('button', { name: 'New Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete Channel', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toHaveCount(0);

        // Click the channel row → single-selection tasks appear.
        await page.getByText('Demo Stopped', { exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toBeVisible();
        // Demo Stopped is enabled by default (metadata defaults true) → Disable shows.
        await expect(page.getByRole('button', { name: 'Disable Channel', exact: true })).toBeVisible();
        // Assign To Group (Group Tasks pane) appears once a channel is selected.
        await expect(page.getByRole('button', { name: 'Assign To Group', exact: true })).toBeVisible();
    });

    test('selecting a real group reveals Group Tasks and the group-deploy buttons', async ({ page }) => {
        await gotoChannels(page);

        // New Group is always present; the real-group tasks are gated.
        await expect(page.getByRole('button', { name: 'New Group', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit Group Details', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete Group', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toHaveCount(0);

        // Click the [Demo Group] row (not its twisty) → real-group tasks appear.
        await page.getByRole('gridcell', { name: '[Demo Group]', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Group Details', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Group', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toBeVisible();
        // A group selection makes Deploy Channel deployable (acts on the group's channels).
        await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toBeVisible();
    });

    test('imports the full channels embedded in a Swing channel-group export', async ({ page }) => {
        await gotoChannels(page);

        const channelRequest = page.waitForRequest((request: any) => {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.pathname === '/api/channels';
        });
        const groupRequest = page.waitForRequest((request: any) => {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.pathname === '/api/channelgroups/_bulkUpdate';
        });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Group', exact: true }).click();
        await (await chooser).setFiles({
            name: 'imported-group.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`
                <channelGroup version="4.5.0">
                  <id>g-imported</id>
                  <name>Imported Group</name>
                  <revision>1</revision>
                  <description>Swing export</description>
                  <channels>
                    <channel version="4.5.0">
                      <id>c-imported</id>
                      <name>Imported Channel</name>
                      <revision>1</revision>
                    </channel>
                  </channels>
                </channelGroup>`)
        });

        const importedChannel = await channelRequest;
        expect(importedChannel.postData()).toContain('<id>c-imported</id>');
        expect(importedChannel.postData()).toContain('<name>Imported Channel</name>');

        const importedGroup = await groupRequest;
        expect(importedGroup.postData()).toContain('g-imported');
        expect(importedGroup.postData()).toContain('c-imported');
        await expect(page.getByText('Imported 1 group(s) from imported-group.xml', { exact: true })).toBeVisible();
    });

    test('exports full associated channels for one group and all groups', async ({ page }) => {
        await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /channelgroups': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? `<list><channelGroup version="4.5.0"><id>g-1</id><name>Demo Group</name><revision>1</revision><description>A demo channel group</description><channels><channel version="4.5.0"><id>c-started</id><revision>1</revision></channel></channels></channelGroup></list>`
                : GROUPS_FIXTURE['GET /channelgroups'],
            'GET /channels': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? `<list>
                    <channel version="4.5.0"><id>c-started</id><nextMetaDataId>2</nextMetaDataId><name>Demo Started</name><revision>1</revision><sourceConnector><name>Source</name></sourceConnector><exportData><metadata><enabled>true</enabled></metadata></exportData></channel>
                    <channel version="4.5.0"><id>c-stopped</id><nextMetaDataId>2</nextMetaDataId><name>Demo Stopped</name><revision>1</revision><sourceConnector><name>Source</name></sourceConnector><exportData><metadata><enabled>true</enabled></metadata></exportData></channel>
                    <com.mirth.connect.model.InvalidChannel version="4.5.0"><id>c-invalid</id><name>Broken Channel</name><revision>1</revision><missingExtension>custom-connector</missingExtension></com.mirth.connect.model.InvalidChannel>
                  </list>`
                : { list: { channel: [
                    { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
                    { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
                    { '@class': 'com.mirth.connect.model.InvalidChannel', '@version': '4.5.0', id: 'c-invalid', name: 'Broken Channel', revision: 1 },
                ] } },
        });
        await gotoChannels(page);
        await page.getByRole('gridcell', { name: '[Demo Group]', exact: true }).click();

        const assertFullChannelExport = async (buttonName: string) => {
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: buttonName, exact: true }).click();
            const download = await downloadPromise;
            const file = await download.path();
            let xml: string;
            if (buttonName === 'Export All Groups') {
                expect(download.suggestedFilename()).toBe('channel-groups.zip');
                const reader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([await readFile(file)])));
                const entries: any[] = await reader.getEntries();
                expect(entries).toHaveLength(2);
                const exported = await Promise.all(entries.map(entry => entry.getData(new zipjs.TextWriter())));
                xml = exported.find(value => value.includes('<id>g-1</id>')) || '';
                const defaultXml = exported.find(value => value.includes('<id>Default Group</id>')) || '';
                expect(defaultXml).toContain('<name>[Default Group]</name>');
                expect(defaultXml).toMatch(/<channels><channel[^>]*>[\s\S]*<id>c-stopped<\/id>/);
                expect(defaultXml).toContain('<id>c-invalid</id>');
                expect(defaultXml).toContain('<missingExtension>custom-connector</missingExtension>');
                expect(defaultXml).not.toContain('<id>c-started</id>');
                await reader.close();
            } else {
                xml = await readFile(file, 'utf8');
            }
            expect(xml).toContain('<id>g-1</id>');
            expect(xml).toMatch(/<channels><channel[^>]*>[\s\S]*<id>c-started<\/id>[\s\S]*<name>Demo Started<\/name>/);
            expect(xml).toContain('<sourceConnector><name>Source</name></sourceConnector>');
        };

        await assertFullChannelExport('Export Group');
        await assertFullChannelExport('Export All Groups');

        const allChannelsDownload = page.waitForEvent('download');
        const wrap = page.locator('.dt-wrap');
        const box = await wrap.boundingBox();
        await wrap.click({ button: 'right', position: { x: 8, y: box!.height - 8 } });
        await page.getByRole('menu').getByText('Export All Channels', { exact: true }).click();
        const channelZip = await allChannelsDownload;
        expect(channelZip.suggestedFilename()).toBe('channels.zip');
        const channelReader = new zipjs.ZipReader(new zipjs.BlobReader(new Blob([await readFile(await channelZip.path())])));
        const channelEntries: any[] = await channelReader.getEntries();
        expect(channelEntries).toHaveLength(3);
        const exportedChannels = await Promise.all(channelEntries.map(entry => entry.getData(new zipjs.TextWriter())));
        const channelXml = exportedChannels[0];
        const invalidXml = exportedChannels.find(value => value.includes('<id>c-invalid</id>')) || '';
        await channelReader.close();
        expect(channelXml).toMatch(/^<channel[^>]*>/);
        expect(channelXml).not.toContain('<list>');
        expect(invalidXml).toMatch(/^<channel[^>]*>/);
        expect(invalidXml).toContain('<missingExtension>custom-connector</missingExtension>');
    });

    test('group export offers and includes linked code-template libraries like Swing', async ({ page }) => {
        await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{
                id: 'linked-library', name: 'Linked Library', includeNewChannels: false,
                enabledChannelIds: { string: ['c-started'] }, disabledChannelIds: ''
            }] } },
            'GET /channelgroups': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? '<list><channelGroup version="4.5.0"><id>g-1</id><name>Demo Group</name><channels><channel><id>c-started</id></channel></channels></channelGroup></list>'
                : GROUPS_FIXTURE['GET /channelgroups'],
            'GET /channels': (request: any) => request.headers()['accept']?.includes('application/xml')
                ? '<list><channel version="4.5.0"><id>c-started</id><name>Demo Started</name><exportData><codeTemplateLibraries/></exportData></channel></list>'
                : { list: { channel: [{ id: 'c-started', name: 'Demo Started' }, { id: 'c-stopped', name: 'Demo Stopped' }] } }
        });
        await gotoChannels(page);
        await page.getByRole('gridcell', { name: '[Demo Group]', exact: true }).click();
        await page.getByRole('button', { name: 'Export Group', exact: true }).click();

        const dialog = page.getByRole('dialog', { name: 'Export Channel' });
        await expect(dialog.getByText('Linked Library', { exact: true })).toBeVisible();
        const channelRequest = page.waitForRequest(request => {
            const url = new URL(request.url());
            return request.method() === 'GET' && url.pathname === '/api/channels'
                && url.searchParams.get('includeCodeTemplateLibraries') === 'true';
        });
        const download = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
        await channelRequest;
        await download;
    });

    test('imports Swing Default Group channels without persisting the reserved group', async ({ page }) => {
        await gotoChannels(page);
        let groupUpdate = false;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/channelgroups/_bulkUpdate') groupUpdate = true;
        });
        const channelRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Group', exact: true }).click();
        await (await chooser).setFiles({
            name: 'default-group.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`<channelGroup version="4.5.0">
                <id>Default Group</id><name>[Default Group]</name>
                <channels><channel version="4.5.0"><id>default-import</id><name>Default Import</name><revision>1</revision></channel></channels>
            </channelGroup>`)
        });

        expect((await channelRequest).postData() || '').toContain('<id>default-import</id>');
        await expect(page.getByText('Imported 1 group(s) from default-group.xml', { exact: true })).toBeVisible();
        expect(groupUpdate).toBe(false);
    });

    test('channel import preserves dependency links and remaps server-specific resource ids by name', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /server/channelDependencies': { set: { channelDependency: [
                { dependentId: 'existing-dependent', dependencyId: 'existing-prerequisite' }
            ] } },
            'GET /server/resources': { list: { directoryResourceProperties: [
                { id: 'resource-new', name: 'Shared Resource', type: 'Directory' },
                { id: 'resource-existing', name: 'Current Resource Name', type: 'Directory' }
            ] } }
        });
        await gotoChannels(page);

        const dependencyRequest = page.waitForRequest(request =>
            request.method() === 'PUT' && new URL(request.url()).pathname === '/api/server/channelDependencies');
        const channelRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Channel', exact: true }).click();
        await (await chooser).setFiles({
            name: 'dependency-channel.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`<channel version="4.5.0">
                <id>imported-channel</id><name>Imported Dependency Channel</name><revision>4</revision>
                <properties><resourceIds class="linked-hash-map"><entry><string>resource-old</string><string>Shared Resource</string></entry></resourceIds></properties>
                <sourceConnector><properties><sourceConnectorProperties><resourceIds class="linked-hash-map"><entry><string>resource-existing</string><string>Stale Resource Name</string></entry></resourceIds></sourceConnectorProperties></properties></sourceConnector>
                <destinationConnectors><connector><properties><destinationConnectorProperties><resourceIds class="linked-hash-map"><entry><string>destination-resource-old</string><string>Shared Resource</string></entry></resourceIds></destinationConnectorProperties></properties></connector></destinationConnectors>
                <exportData><dependentIds><string>downstream</string></dependentIds><dependencyIds><string>upstream</string></dependencyIds></exportData>
            </channel>`)
        });

        const dependencyBody = (await dependencyRequest).postData() || '';
        expect(dependencyBody).toContain('existing-dependent');
        expect(dependencyBody).toContain('"dependentId":"downstream","dependencyId":"imported-channel"');
        expect(dependencyBody).toContain('"dependentId":"imported-channel","dependencyId":"upstream"');
        const channelBody = (await channelRequest).postData() || '';
        expect(channelBody).toContain('<string>resource-new</string><string>Shared Resource</string>');
        expect(channelBody).toContain('<string>resource-existing</string><string>Current Resource Name</string>');
        expect(channelBody).not.toContain('resource-old');
        expect(channelBody).not.toContain('destination-resource-old');
        expect(channelBody).not.toContain('Stale Resource Name');
        expect(channelBody).not.toContain('<dependentIds>');
        expect(channelBody).not.toContain('<dependencyIds>');
    });

    test('channel import reports a dependency-save failure but still imports like Swing', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'PUT /server/channelDependencies': { __status: 500, body: { error: 'dependency write failed' } }
        });
        await gotoChannels(page);

        const channelRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Channel', exact: true }).click();
        await (await chooser).setFiles({
            name: 'dependency-failure.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`<channel version="4.5.0">
                <id>dependency-failure</id><name>Dependency Failure</name><revision>1</revision>
                <exportData><dependencyIds><string>upstream</string></dependencyIds></exportData>
            </channel>`)
        });

        const body = (await channelRequest).postData() || '';
        expect(body).toContain('<id>dependency-failure</id>');
        expect(body).not.toContain('<dependencyIds>');
        await expect(page.getByRole('dialog', { name: 'Error' })).toContainText('dependency write failed');
    });

    test('JSON channel bundles import libraries and templates in one atomic request', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'POST /codeTemplateLibraries/_bulkUpdate': {
                codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} }
            }
        });
        await gotoChannels(page);

        let legacyLibraryPut = false;
        page.on('request', request => {
            if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/codeTemplateLibraries') {
                legacyLibraryPut = true;
            }
        });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Channel', exact: true }).click();
        await (await chooser).setFiles({
            name: 'bundled-channel.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({
                id: 'json-channel', name: 'JSON Channel', revision: 3,
                exportData: { codeTemplateLibraries: { codeTemplateLibrary: [{
                    '@version': '4.5.0', id: 'json-library', name: 'JSON Library', revision: 7,
                    codeTemplates: { codeTemplate: [{
                        '@version': '4.5.0', id: 'json-template', name: 'JSON Template', revision: 9,
                        properties: { '@version': '4.5.0', type: 'FUNCTION', code: 'return true;' }
                    }] }
                }] } }
            }))
        });

        const dialog = page.getByRole('dialog', { name: 'Import Channel' });
        await expect(dialog.getByRole('button', { name: 'Yes', exact: true })).toBeVisible();
        const bulkRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
        const channelRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels');
        await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
        const body = (await bulkRequest).postData() || '';
        await channelRequest;
        expect(body).toContain('name="libraries"');
        expect(body).toContain('name="updatedCodeTemplates"');
        expect(body).toContain('"id":"json-template"');
        expect(body).toContain('"revision":0');
        expect(legacyLibraryPut).toBe(false);
    });

    test('XML channel bundles atomically merge an existing library association like Swing', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'POST /codeTemplateLibraries/_bulkUpdate': {
                codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} }
            }
        });
        await gotoChannels(page);

        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Channel', exact: true }).click();
        await (await chooser).setFiles({
            name: 'library-channel.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(`<channel version="4.5.0">
                <id>xml-library-channel</id><name>XML Library Channel</name><revision>1</revision>
                <exportData><codeTemplateLibraries><codeTemplateLibrary version="4.5.0">
                    <id>lib-1</id><name>Demo Library</name><revision>1</revision>
                    <codeTemplates><codeTemplate version="4.5.0"><id>tpl-1</id></codeTemplate></codeTemplates>
                    <includeNewChannels>false</includeNewChannels><enabledChannelIds/><disabledChannelIds/>
                </codeTemplateLibrary></codeTemplateLibraries></exportData>
            </channel>`)
        });

        const dialog = page.getByRole('dialog', { name: 'Import Channel' });
        const bulkRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
        const channelRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels');
        await dialog.getByRole('button', { name: 'Yes', exact: true }).click();

        const body = (await bulkRequest).postData() || '';
        await channelRequest;
        expect(body).toContain('"id":"lib-1"');
        expect(body).toContain('"enabledChannelIds":{"string":["xml-library-channel"]}');
        expect(body).toContain('name="updatedCodeTemplates"');
        expect(body).toContain('{"list":{"codeTemplate":[]}}');
    });

    test('Deploy Channel moves to the dashboard on success', async ({ page }) => {
        await mockEngine(page, { ...GROUPS_FIXTURE, 'POST /channels/_deploy': '' });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard/);
    });

    test('Deploy Channel warns and skips a disabled selection like Swing', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /channels': { list: { channel: [
                { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1,
                    exportData: { metadata: { enabled: true } } },
                { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1,
                    exportData: { metadata: { enabled: false } } }
            ] } },
            'POST /channels/_deploy': ''
        });
        let deployed = false;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels/_deploy') deployed = true;
        });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

        await expect(page.getByText('Disabled channels will not be deployed.', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/channels/);
        expect(deployed).toBe(false);
    });

    test('Deploy Channel can include an enabled prerequisite through Swing\'s deploy dependency path', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'GET /server/channelDependencies': { set: { channelDependency: [
                { dependentId: 'c-stopped', dependencyId: 'c-started' }
            ] } },
            'POST /channels/_deploy': ''
        });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

        const dialog = page.getByRole('dialog', { name: 'Channel dependencies' });
        await expect(dialog.getByText('Demo Started', { exact: true })).toBeVisible();
        const deployRequest = page.waitForRequest(request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/channels/_deploy');
        await dialog.getByRole('button', { name: 'Include and deploy', exact: true }).click();
        const ids = ((await deployRequest).postDataJSON()?.set?.string || []).sort();
        expect(ids).toEqual(['c-started', 'c-stopped']);
    });

    test('a deploy failure shows the error detail modal and stays on Channels', async ({ page }) => {
        await mockEngine(page, {
            ...GROUPS_FIXTURE,
            'POST /channels/_deploy': { __status: 500, body: { error: 'compile failed' } },
        });
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Deploy Channel', exact: true }).click();

        await expect(page.getByText('Channel Deployment Failed', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/channels/);
    });

    test('clicking empty space clears the selection and hides contextual tasks', async ({ page }) => {
        await gotoChannels(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();

        // Click the empty grid area below the (short) tree → selection clears.
        const wrap = page.locator('.dt-wrap');
        const box = await wrap.boundingBox();
        await wrap.click({ position: { x: 8, y: box!.height - 8 } });
        await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    });
});
