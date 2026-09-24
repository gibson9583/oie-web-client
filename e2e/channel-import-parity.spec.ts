import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

type Model = Record<string, any>;
const existingGroups = () => [{ id: 'g-1', name: 'Demo Group', revision: 7, channels: { channel: [{ id: 'c-started' }] } }];
const template = (id: string) => ({ id, name: id, revision: 3, properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION', code: 'original code' } });
const library = (id: string, templates: Model[] = []) => ({ id, name: id, revision: 4, includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '', codeTemplates: { codeTemplate: templates } });
const importedLibrary = `<codeTemplateLibrary version="4.6.0"><id>lib</id><name>lib</name><revision>0</revision><includeNewChannels>false</includeNewChannels><enabledChannelIds/><disabledChannelIds/><codeTemplates><codeTemplate version="4.6.0"><id>tpl</id><name>tpl</name><revision>0</revision><properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties" version="4.6.0"><type>FUNCTION</type><code>imported code</code></properties></codeTemplate></codeTemplates></codeTemplateLibrary>`;
const channelXml = (id: string, name: string, libraries = '') => `<channel version="4.6.0"><id>${id}</id><name>${name}</name><revision>1</revision>${libraries ? `<exportData><codeTemplateLibraries>${libraries}</codeTemplateLibraries></exportData>` : ''}</channel>`;
const groupXml = (id: string, name: string, channels = '<channel><id>c-stopped</id></channel>') => `<channelGroup version="4.6.0"><id>${id}</id><name>${name}</name><revision>1</revision><channels>${channels}</channels></channelGroup>`;

async function setup(page: Page, overrides: Model = {}) {
    const writes: { path: string; override: string | null; parts: Model }[] = [];
    await page.addInitScript(() => {
        const fetch = window.fetch;
        (window as any).__importForms = [];
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const [, init] = args;
            if (init?.body instanceof FormData) {
                const fields = await Promise.all([...init.body.entries()].map(async ([key, value]) => [key, JSON.parse(typeof value === 'string' ? value : await value.text())]));
                (window as any).__importForms.push(Object.fromEntries(fields));
            }
            return fetch(...args);
        };
    });
    const record = async (request: any, result: any) => {
        const url = new URL(request.url());
        const parts = await page.evaluate(() => (window as any).__importForms.shift());
        writes.push({ path: url.pathname, override: url.searchParams.get('override'), parts });
        return result;
    };
    await mockEngine(page, {
        'GET /channelgroups': { list: { channelGroup: existingGroups() } },
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [] } },
        'POST /channelgroups/_bulkUpdate': (request: any) => record(request, true),
        'POST /codeTemplateLibraries/_bulkUpdate': (request: any) => record(request, { codeTemplateLibrarySaveResult: { librariesSuccess: true, overrideNeeded: false, codeTemplateResults: {} } }),
        ...overrides
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    return writes;
}

async function importFile(page: Page, xml: string, task = 'Import Group') {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: task, exact: true }).click();
    const format = xml.trim().startsWith('<') ? 'xml' : 'json';
    await (await chooser).setFiles({ name: `parity.${format}`, mimeType: `application/${format}`, buffer: Buffer.from(xml) });
}

type ChannelWrite = { override: string | null; startEdit: string | null; body: string | null };
function channelWrite(request: any): ChannelWrite {
    const params = new URL(request.url()).searchParams;
    return { override: params.get('override'), startEdit: params.get('startEdit'), body: request.postData() };
}
function importChannelContent(format: 'xml' | 'json', id = 'c-started', name = 'Demo Started') {
    return format === 'xml' ? channelXml(id, name) : JSON.stringify({ channel: { '@version': '4.6.0', id, name, revision: 1 } });
}
const latestChannel = (userId?: number | string) => ({ channel: { id: 'c-started', name: 'Demo Started', revision: 8,
    exportData: { metadata: { userId, lastModified: { time: 1_900_000_000_000, timezone: 'UTC' } } } } });
async function acceptChannelOverwrite(page: Page) {
    await page.getByRole('dialog', { name: 'Warning', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Channel', exact: true }).getByRole('button', { name: 'Yes', exact: true }).click();
}

test('group import remaps same-ID different-name groups and preserves unrelated groups', async ({ page }) => {
    const writes = await setup(page);
    await importFile(page, groupXml('g-1', 'Imported Group'));
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    const groups = writes[0].parts.channelGroups.set.channelGroup;
    expect(writes[0].override).toBe('false');
    expect(groups).toHaveLength(2);
    expect(groups.find((group: Model) => group.id === 'g-1').name).toBe('Demo Group');
    expect(groups.find((group: Model) => group.name === 'Imported Group').id).not.toBe('g-1');
});

test('named-group overwrite is explicit and replaces its membership without deleting unrelated groups', async ({ page }) => {
    const writes = await setup(page);
    await importFile(page, groupXml('g-1', 'Demo Group'));
    const dialog = page.getByRole('dialog', { name: 'Import Group' });
    await expect(dialog).toContainText('overwrite the existing group');
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    expect(writes[0].parts.channelGroups.set.channelGroup).toEqual([expect.objectContaining({ id: 'g-1', revision: 7, channels: { channel: [{ id: 'c-stopped' }] } })]);
});

test('named-group create-new keeps the existing group', async ({ page }) => {
    const writes = await setup(page);
    await importFile(page, groupXml('g-1', 'Demo Group'));
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'No', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Group' });
    await dialog.getByRole('textbox').fill('Imported Copy');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    const groups = writes[0].parts.channelGroups.set.channelGroup;
    expect(groups).toHaveLength(2);
    expect(groups.find((group: Model) => group.name === 'Demo Group').id).toBe('g-1');
    expect(groups.find((group: Model) => group.name === 'Imported Copy').id).not.toBe('g-1');
});

test('group changes made while the conflict dialog is open are not overwritten', async ({ page }) => {
    let groups = existingGroups();
    const writes = await setup(page, { 'GET /channelgroups': () => ({ list: { channelGroup: groups } }) });
    await importFile(page, groupXml('g-1', 'Demo Group'));
    const dialog = page.getByRole('dialog', { name: 'Import Group' });
    await expect(dialog).toBeVisible();
    groups = [{ ...groups[0], revision: 8 }];
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText('Channel groups changed during import');
    expect(writes).toHaveLength(0);
});

test('shared group library exports contain each template only once', async ({ page }) => {
    const writes = await setup(page);
    await importFile(page, groupXml('new-group', 'Imported Group', channelXml('first', 'First', importedLibrary) + channelXml('second', 'Second', importedLibrary)));
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    const bulk = writes.find(write => write.path.includes('codeTemplateLibraries'))!;
    expect(bulk.override).toBe('false');
    expect(bulk.parts.libraries.list.codeTemplateLibrary[0].codeTemplates.codeTemplate).toEqual([{ '@version': '4.6.0', id: 'tpl' }]);
    expect(bulk.parts.updatedCodeTemplates.list.codeTemplate).toHaveLength(1);
    expect(bulk.parts.libraries.list.codeTemplateLibrary[0].enabledChannelIds.string).toEqual(['first', 'second']);
});

test('bundled library overwrite asks separately before replacing existing template code', async ({ page }) => {
    const writes = await setup(page, { 'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [library('lib', [template('tpl'), template('keep')]), library('untouched')] } } });
    await importFile(page, channelXml('new-channel', 'New Channel', importedLibrary), 'Import Channel');
    await page.getByRole('dialog', { name: 'Import Channel' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Library Conflict' }).getByRole('button', { name: 'Overwrite', exact: true }).click();
    expect(writes).toHaveLength(0);
    await page.getByRole('dialog', { name: 'Import Code Template Conflict' }).getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page.getByText('Imported parity.xml', { exact: true })).toBeVisible();
    const bulk = writes[0];
    expect(bulk.parts.libraries.list.codeTemplateLibrary).toHaveLength(2);
    expect(bulk.parts.libraries.list.codeTemplateLibrary[0].codeTemplates.codeTemplate.map((item: Model) => item.id)).toEqual(['tpl', 'keep']);
    expect(bulk.parts.updatedCodeTemplates.list.codeTemplate[0]).toMatchObject({ id: 'tpl', revision: 3, properties: { code: 'imported code' } });
    expect(bulk.parts.removedLibraryIds.set.string).toEqual([]);
});

for (const result of [
    { librariesSuccess: false, overrideNeeded: true },
    { librariesSuccess: true, overrideNeeded: false, codeTemplateResults: { entry: { codeTemplateUpdateResult: { success: false, cause: { detailMessage: 'template rejected' } } } } }
]) test(`bundled libraries abort following writes on ${result.overrideNeeded ? 'concurrent edits' : 'partial template failure'}`, async ({ page }) => {
    let bulkWrites = 0, channelWrites = 0;
    await setup(page, {
        'POST /codeTemplateLibraries/_bulkUpdate': () => { bulkWrites++; return { codeTemplateLibrarySaveResult: result }; },
        'PUT /channels/*': () => { channelWrites++; return true; }
    });
    await importFile(page, groupXml('new-group', 'Imported Group', channelXml('first', 'First', importedLibrary)));
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText(result.overrideNeeded ? 'changed during import' : 'template rejected');
    expect(bulkWrites).toBe(1);
    expect(channelWrites).toBe(0);
});

test('a failed embedded channel is excluded while successful channels remain imported', async ({ page }) => {
    const writes = await setup(page, { 'PUT /channels/*': (request: any) => request.postData().includes('<id>bad</id>')
        ? { __status: 500, body: 'channel rejected' } : true });
    await importFile(page, groupXml('new', 'Imported Group', channelXml('good', 'Good') + channelXml('bad', 'Bad')));
    // The final summary is the top modal; the retained per-channel error sits
    // below it. Assert and dismiss the summary before inspecting error details.
    const summary = page.getByRole('dialog', { name: 'Warning', exact: true });
    await expect(summary).toContainText('Imported 1 group(s) from parity.xml; 1 channel(s) were skipped or failed.');
    await summary.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('channel rejected');
    const groups = writes[0].parts.channelGroups.set.channelGroup;
    expect(groups.find((group: Model) => group.id === 'new').channels.channel).toEqual([{ id: 'good' }]);
});

test('an unreadable group baseline prevents library and channel writes', async ({ page }) => {
    let failRead = false, channelWrites = 0;
    const writes = await setup(page, {
        'GET /channelgroups': () => failRead ? { __status: 500, body: 'group read rejected' } : { list: { channelGroup: existingGroups() } },
        'PUT /channels/*': () => { channelWrites++; return true; }
    });
    failRead = true;
    await importFile(page, groupXml('new', 'Imported Group', channelXml('new-channel', 'New Channel', importedLibrary)));
    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText('group read rejected');
    expect(writes).toHaveLength(0);
    expect(channelWrites).toBe(0);
});

test('cancelling a group rename keeps completed channels and sends no group write', async ({ page }) => {
    let channelWrites = 0;
    const writes = await setup(page, { 'PUT /channels/*': () => { channelWrites++; return true; } });
    await importFile(page, groupXml('g-1', 'Demo Group', channelXml('new-channel', 'New Channel')));
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Group import cancelled. 1 channel(s) already imported have been kept.', { exact: true })).toBeVisible();
    expect(channelWrites).toBe(1);
    expect(writes).toHaveLength(0);
});


test('group libraries bind to the final copied channel ID instead of a colliding server channel', async ({ page }) => {
    let created = '';
    const writes = await setup(page, { 'PUT /channels/*': (request: any) => { created = request.postData(); return true; } });
    const bundled = importedLibrary.replace('<enabledChannelIds/>', '<enabledChannelIds><string>c-started</string></enabledChannelIds>');
    await importFile(page, groupXml('new-group', 'Imported Group', channelXml('c-started', 'Different Channel', bundled)));
    await page.getByRole('dialog', { name: 'Import Group' }).getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    const finalId = created.match(/<id>([^<]+)<\/id>/)?.[1];
    expect(finalId).toBeTruthy();
    expect(finalId).not.toBe('c-started');
    const bulk = writes.find(write => write.path.includes('codeTemplateLibraries'))!;
    expect(bulk.parts.libraries.list.codeTemplateLibrary[0].enabledChannelIds.string).toEqual([finalId]);
    const groups = writes.find(write => write.path.includes('channelgroups'))!.parts.channelGroups.set.channelGroup;
    expect(groups.find((group: Model) => group.id === 'new-group').channels.channel).toEqual([{ id: finalId }]);
    expect(groups.find((group: Model) => group.id === 'g-1').channels.channel).toEqual([{ id: 'c-started' }]);
});


for (const stage of ['warning', 'overwrite', 'rename']) test(`channel import closes without another dialog when the session expires during ${stage}`, async ({ page }) => {
    let channelWrites = 0;
    await setup(page, {
        'GET /session-expiry-probe': { __status: 401 },
        'PUT /channels/*': () => { channelWrites++; return true; }
    });
    await importFile(page, channelXml('c-started', 'Demo Started'), 'Import Channel');
    await expect(page.getByRole('dialog', { name: 'Warning', exact: true })).toBeVisible();
    if (stage !== 'warning') {
        await page.getByRole('dialog', { name: 'Warning', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Import Channel', exact: true })).toBeVisible();
        if (stage === 'rename') await page.getByRole('dialog', { name: 'Import Channel', exact: true }).getByRole('button', { name: 'No', exact: true }).click();
    }
    await page.evaluate(async () => {
        const api = await import(String('/core/api.js'));
        await api.get('/session-expiry-probe').catch(() => {});
    });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(channelWrites).toBe(0);
});


for (const format of ['xml', 'json'] as const) {
    for (const clock of ['2001-01-01T00:00:00Z', '2040-01-01T00:00:00Z']) {
        test(`${format} overwrite import omits startEdit with browser clock ${clock.slice(0, 4)}`, async ({ page }) => {
            const calls: ChannelWrite[] = [];
            let latestReads = 0;
            await page.clock.setFixedTime(new Date(clock));
            await setup(page, {
                'GET /channels/c-started': () => { latestReads++; return latestChannel(2); },
                'PUT /channels/c-started': (request: any) => { calls.push(channelWrite(request)); return true; }
            });
            await importFile(page, importChannelContent(format), 'Import Channel');
            await acceptChannelOverwrite(page);
            await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
            expect(calls).toEqual([{ override: 'false', startEdit: null, body: expect.any(String) }]);
            expect(latestReads).toBe(0);
        });
    }

    test(`${format} import retries a conflict saved by the current user without prompting`, async ({ page }) => {
        const calls: ChannelWrite[] = [], events: string[] = [];
        await setup(page, {
            'GET /channels/c-started': () => { events.push('read'); return latestChannel('1'); },
            'PUT /channels/c-started': (request: any) => {
                const call = channelWrite(request);
                calls.push(call); events.push(`write:${call.override}`);
                return calls.length > 1;
            }
        });
        await importFile(page, importChannelContent(format), 'Import Channel');
        await acceptChannelOverwrite(page);
        await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
        expect(events).toEqual(['write:false', 'read', 'write:true']);
        expect(calls).toEqual([
            { override: 'false', startEdit: null, body: expect.any(String) },
            { override: 'true', startEdit: null, body: calls[0].body }
        ]);
        await expect(page.getByRole('dialog', { name: 'Channel Modified', exact: true })).toHaveCount(0);
    });

    for (const saver of ['another user', 'unknown user'] as const) {
        for (const choice of ['Overwrite', 'Cancel'] as const) {
            test(`${format} import lets the user ${choice.toLowerCase()} a conflict saved by ${saver}`, async ({ page }) => {
                const calls: ChannelWrite[] = [];
                let latestReads = 0;
                await setup(page, {
                    'GET /channels/c-started': () => { latestReads++; return latestChannel(saver === 'another user' ? 2 : undefined); },
                    'PUT /channels/c-started': (request: any) => { calls.push(channelWrite(request)); return calls.length > 1; }
                });
                await importFile(page, importChannelContent(format), 'Import Channel');
                await acceptChannelOverwrite(page);
                const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
                await expect(conflict).toContainText('Overwrite the saved channel with your changes?');
                expect(calls).toHaveLength(1);
                expect(latestReads).toBe(1);
                await conflict.getByRole('button', { name: choice, exact: true }).click();
                if (choice === 'Overwrite') {
                    await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
                    expect(calls).toEqual([
                        { override: 'false', startEdit: null, body: expect.any(String) },
                        { override: 'true', startEdit: null, body: calls[0].body }
                    ]);
                } else {
                    await expect(conflict).toHaveCount(0);
                    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
                    await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toHaveCount(0);
                    expect(calls).toHaveLength(1);
                    // Cancellation releases the import action and a fresh attempt
                    // starts guarded, rather than retaining an override decision.
                    await importFile(page, importChannelContent(format), 'Import Channel');
                    await acceptChannelOverwrite(page);
                    await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
                    expect(calls).toHaveLength(2);
                    expect(calls[1].override).toBe('false');
                }
            });
        }
    }

    test(`${format} new channel import handles an intervening creation with the same overwrite choice`, async ({ page }) => {
        const calls: ChannelWrite[] = [];
        let latestReads = 0;
        await setup(page, {
            'GET /channels/new-channel': () => { latestReads++; return { channel: { ...latestChannel(2).channel, id: 'new-channel' } }; },
            'PUT /channels/new-channel': (request: any) => { calls.push(channelWrite(request)); return calls.length > 1; }
        });
        await importFile(page, importChannelContent(format, 'new-channel', 'New Channel'), 'Import Channel');
        await page.getByRole('dialog', { name: 'Channel Modified', exact: true }).getByRole('button', { name: 'Overwrite', exact: true }).click();
        await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
        expect(latestReads).toBe(1);
        expect(calls).toEqual([
            { override: 'false', startEdit: null, body: expect.any(String) },
            { override: 'true', startEdit: null, body: calls[0].body }
        ]);
    });

    test(`${format} conflict lookup and library bindings use the resolved overwrite ID`, async ({ page }) => {
        const sourceId = 'exported-channel', calls: (ChannelWrite & { id: string })[] = [];
        let latestReads = 0, sourceReads = 0;
        const writes = await setup(page, {
            'GET /channels/c-started': () => { latestReads++; return latestChannel(2); },
            'GET /channels/exported-channel': () => { sourceReads++; return { channel: { ...latestChannel(1).channel, id: sourceId } }; },
            'PUT /channels/*': (request: any) => {
                calls.push({ ...channelWrite(request), id: new URL(request.url()).pathname.split('/').at(-1)! });
                return calls.length > 1;
            }
        });
        const content = format === 'xml'
            ? channelXml(sourceId, 'Demo Started', importedLibrary.replace('<enabledChannelIds/>', `<enabledChannelIds><string>${sourceId}</string></enabledChannelIds>`))
            : JSON.stringify({ channel: { '@version': '4.6.0', id: sourceId, name: 'Demo Started', revision: 1,
                exportData: { codeTemplateLibraries: { codeTemplateLibrary: [{ ...library('lib', [template('tpl')]), enabledChannelIds: { string: [sourceId] } }] } } } });
        await importFile(page, content, 'Import Channel');
        await acceptChannelOverwrite(page);
        await page.getByRole('dialog', { name: 'Import Channel', exact: true }).getByRole('button', { name: 'Yes', exact: true }).click();
        const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
        await expect(conflict).toBeVisible();
        expect(latestReads).toBe(1);
        expect(sourceReads).toBe(0);
        expect(calls).toHaveLength(1);
        await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();
        await expect(page.getByText(`Imported parity.${format}`, { exact: true })).toBeVisible();
        expect(calls).toEqual([
            { id: 'c-started', override: 'false', startEdit: null, body: expect.any(String) },
            { id: 'c-started', override: 'true', startEdit: null, body: calls[0].body }
        ]);
        expect(calls[0].body).not.toContain(sourceId);
        expect(calls[0].body).not.toContain('codeTemplateLibraries');
        const libraries = writes.filter(write => write.path.includes('codeTemplateLibraries'));
        expect(libraries).toHaveLength(1);
        expect(libraries[0].parts.libraries.list.codeTemplateLibrary[0].enabledChannelIds.string).toEqual(['c-started']);
    });
}

for (const failure of ['lookup error', 'missing channel', 'wrong channel ID', 'retry rejected', 'retry error'] as const) {
    test(`channel overwrite import stops safely on ${failure}`, async ({ page }) => {
        const calls: ChannelWrite[] = [];
        let latestReads = 0;
        await setup(page, {
            'GET /channels/c-started': () => {
                latestReads++;
                if (failure === 'lookup error') return { __status: 500, body: 'latest channel lookup failed' };
                if (failure === 'missing channel') return { channel: null };
                if (failure === 'wrong channel ID') return { channel: { ...latestChannel(1).channel, id: 'another-channel' } };
                return latestChannel(1);
            },
            'PUT /channels/c-started': (request: any) => {
                calls.push(channelWrite(request));
                return calls.length > 1 && failure === 'retry error' ? { __status: 500, body: 'forced overwrite failed' } : false;
            }
        });
        await importFile(page, channelXml('c-started', 'Demo Started'), 'Import Channel');
        await acceptChannelOverwrite(page);
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toBeVisible();
        if (failure === 'lookup error') await expect(error).toContainText('latest channel lookup failed');
        if (failure === 'retry error') await expect(error).toContainText('forced overwrite failed');
        if (failure === 'retry rejected') await expect(error).toContainText('engine did not confirm the channel save');
        expect(latestReads).toBe(1);
        expect(calls.map(call => call.override)).toEqual(failure.startsWith('retry') ? ['false', 'true'] : ['false']);
        expect(calls.every(call => call.startEdit === null)).toBe(true);
        await expect(page.getByText('Imported parity.xml', { exact: true })).toHaveCount(0);
    });
}

test('group import keeps completed libraries once and skips a declined channel conflict', async ({ page }) => {
    const calls: { id: string; override: string | null; startEdit: string | null }[] = [];
    const writes = await setup(page, {
        'GET /channels/c-started': latestChannel(2),
        'PUT /channels/*': (request: any) => {
            const id = new URL(request.url()).pathname.split('/').at(-1)!;
            const { override, startEdit } = channelWrite(request);
            calls.push({ id, override, startEdit });
            return id !== 'c-started';
        }
    });
    await importFile(page, groupXml('new-group', 'Imported Group', channelXml('c-started', 'Demo Started', importedLibrary) + channelXml('good', 'Good')));
    await acceptChannelOverwrite(page);
    await page.getByRole('dialog', { name: 'Import Group', exact: true }).getByRole('button', { name: 'Yes', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Channel Modified', exact: true });
    await expect(conflict).toBeVisible();
    expect(writes.filter(write => write.path.includes('codeTemplateLibraries'))).toHaveLength(1);
    expect(writes.filter(write => write.path.includes('channelgroups'))).toHaveLength(0);
    await conflict.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Warning', exact: true })).toContainText('Imported 1 group(s) from parity.xml; 1 channel(s) were skipped or failed.');
    expect(calls).toEqual([
        { id: 'c-started', override: 'false', startEdit: null },
        { id: 'good', override: 'false', startEdit: null }
    ]);
    const libraries = writes.filter(write => write.path.includes('codeTemplateLibraries'));
    expect(libraries).toHaveLength(1);
    expect(libraries[0].parts.libraries.list.codeTemplateLibrary[0].enabledChannelIds.string).toEqual(['c-started']);
    const groups = writes.find(write => write.path.includes('channelgroups'))!.parts.channelGroups.set.channelGroup;
    expect(groups.find((group: Model) => group.id === 'new-group').channels.channel).toEqual([{ id: 'good' }]);
    expect(groups.find((group: Model) => group.id === 'g-1').channels.channel).toEqual([{ id: 'c-started' }]);
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
});

test('group conflict retry sends the same channel without repeating bundled library writes', async ({ page }) => {
    const calls: ChannelWrite[] = [];
    const writes = await setup(page, {
        'GET /channels/c-started': latestChannel(1),
        'PUT /channels/c-started': (request: any) => { calls.push(channelWrite(request)); return calls.length > 1; }
    });
    await importFile(page, groupXml('new-group', 'Imported Group', channelXml('c-started', 'Demo Started', importedLibrary)));
    await acceptChannelOverwrite(page);
    await page.getByRole('dialog', { name: 'Import Group', exact: true }).getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported 1 group(s) from parity.xml', { exact: true })).toBeVisible();
    expect(calls).toEqual([
        { override: 'false', startEdit: null, body: expect.any(String) },
        { override: 'true', startEdit: null, body: calls[0].body }
    ]);
    expect(calls[0].body).not.toContain('<codeTemplateLibraries>');
    expect(writes.filter(write => write.path.includes('codeTemplateLibraries'))).toHaveLength(1);
    const groups = writes.find(write => write.path.includes('channelgroups'))!.parts.channelGroups.set.channelGroup;
    expect(groups.find((group: Model) => group.id === 'new-group').channels.channel).toEqual([{ id: 'c-started' }]);
    expect(groups.find((group: Model) => group.id === 'g-1').channels).toBeNull();
});

for (const stage of ['lookup', 'prompt', 'retry'] as const) {
    test(`group channel conflict stops further writes when the session expires during ${stage}`, async ({ page }) => {
        const calls: ChannelWrite[] = [];
        const writes = await setup(page, {
            'GET /session-expiry-probe': { __status: 401 },
            'GET /channels/c-started': stage === 'lookup' ? { __status: 401 } : latestChannel(stage === 'prompt' ? 2 : 1),
            'PUT /channels/*': (request: any) => {
                calls.push(channelWrite(request));
                return calls.length > 1 ? { __status: 401 } : false;
            }
        });
        await importFile(page, groupXml('new-group', 'Imported Group', channelXml('c-started', 'Demo Started') + channelXml('good', 'Good')));
        await acceptChannelOverwrite(page);
        if (stage === 'prompt') {
            await expect(page.getByRole('dialog', { name: 'Channel Modified', exact: true })).toBeVisible();
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        }
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(calls.map(call => call.override)).toEqual(stage === 'retry' ? ['false', 'true'] : ['false']);
        expect(writes).toHaveLength(0);
    });
}

test('a group reference preceding its channel definition does not suppress the import', async ({ page }) => {
    let channelWrites = 0;
    const writes = await setup(page, { 'PUT /channels/later-channel': () => { channelWrites++; return true; } });
    await importFile(page, `<list>${groupXml('first-group', 'First Group', '<channel><id>later-channel</id></channel>')}${groupXml('second-group', 'Second Group', channelXml('later-channel', 'Later Channel'))}</list>`);
    // A collection wrapper has no serialized object version; accept the normal
    // Swing migration confirmation before exercising membership ordering.
    await page.getByRole('dialog', { name: 'Select an Option', exact: true })
        .getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported 2 group(s) from parity.xml', { exact: true })).toBeVisible();
    expect(channelWrites).toBe(1);
    const groups = writes[0].parts.channelGroups.set.channelGroup;
    expect(groups.find((group: Model) => group.id === 'second-group').channels.channel).toEqual([{ id: 'later-channel' }]);
    expect(groups.find((group: Model) => group.id === 'first-group').channels).toBeNull();
});
