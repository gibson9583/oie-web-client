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
    await (await chooser).setFiles({ name: 'parity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
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


test('new channel imports use the guarded update endpoint and stop on an intervening creation', async ({ page }) => {
    const calls: { override: string | null; startEdit: string | null }[] = [];
    await setup(page, { 'PUT /channels/new-channel': (request: any) => {
        const url = new URL(request.url());
        calls.push({ override: url.searchParams.get('override'), startEdit: url.searchParams.get('startEdit') });
        return false;
    } });
    await importFile(page, channelXml('new-channel', 'New Channel'), 'Import Channel');
    await expect(page.getByRole('dialog', { name: 'Error' })).toContainText('channel changed during import');
    expect(calls).toEqual([{ override: 'false', startEdit: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/) }]);
});

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
