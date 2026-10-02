import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * The filter/transformer Reference list (ReferenceTab): engine catalog entries,
 * the channel's code-template libraries, and platform.registerReferences
 * entries, each filtered on the editor's ContextType like Swing's
 * ReferenceListFactory.getCodeTemplates(category, contextType). Categories
 * order as built-ins, then user libraries, then plugin categories A-Z.
 */

const CHANNEL_ID = 'reference-channel';

const template = (id: string, name: string, contexts: string[]) => ({
    '@version': '4.6.0', id, name, revision: 1,
    contextSet: { delegate: { contextType: contexts } },
    properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'DRAG_AND_DROP_CODE', code: `${id}();` }
});

const FIXTURES = {
    [`GET /channels/${CHANNEL_ID}`]: { channel: makeChannel(CHANNEL_ID) },
    'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{
        '@version': '4.6.0', id: 'lib-ref', name: 'Demo Lib', revision: 1, description: '',
        includeNewChannels: true, enabledChannelIds: '', disabledChannelIds: '',
        codeTemplates: { codeTemplate: [
            template('srcHelper', 'Src Helper', ['SOURCE_FILTER_TRANSFORMER']),
            template('deployOnly', 'Deploy Only', ['CHANNEL_DEPLOY']),
            template('respHelper', 'Resp Helper', ['DESTINATION_RESPONSE_TRANSFORMER'])
        ] }
    }] } }
};

const PLUGIN = `
    export function register(p) {
        p.registerReferences('Zeta Functions', [
            { name: 'Zeta Everywhere', description: 'Zeta.', code: 'zeta()' },
            { name: 'Zeta Call', code: 'function zetaCall(a, b) {}', type: 'FUNCTION' }
        ]);
        p.registerReferences('Alpha Functions', [
            { name: 'Alpha Source Only', code: 'alpha()', contexts: ['SOURCE_FILTER_TRANSFORMER'] },
            { name: 'Alpha Postprocessor Only', code: 'alphaPost()', contexts: ['CHANNEL_POSTPROCESSOR'] }
        ]);
        p.registerReferences('Conversion Functions', [{ name: 'Convert Demo to XML', code: 'demo()' }]);
        // Malformed entries are dropped, not rendered.
        p.registerReferences('Broken Functions', [
            { code: 'nameless()' },
            { name: 'String Contexts', code: 'bad()', contexts: 'SOURCE_FILTER_TRANSFORMER' }
        ]);
        p.registerReferences({ not: 'a string' }, [{ name: 'Object Category', code: 'obj()' }]);
    }`;

async function installPlugin(page: any) {
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        const resp = await route.fetch();
        let manifests: any[] = [];
        try { manifests = await resp.json(); } catch { /* empty */ }
        manifests.push({ id: 'test-references', version: '1.0.0', entry: '/plugins/test-references/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    await page.route('**/plugins/test-references/entry.js*', (route: any) => route.fulfill({
        status: 200, contentType: 'application/javascript', body: PLUGIN
    }));
}

const panel = (page: any) => page.locator('div.p-3:has(> .field label:text-is("Category"))');
const categorySelect = (page: any) => panel(page).locator('.field:has(label:text-is("Category")) select');
const rows = (page: any) => panel(page).locator('.step-item .truncate');

test('source transformer: context-filtered catalog, library and plugin references in Swing order', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);

    // The library loads asynchronously; its category joins once it arrives.
    await expect(categorySelect(page).locator('option', { hasText: 'Demo Lib' })).toHaveCount(1);
    expect(await categorySelect(page).locator('option').allTextContents()).toEqual([
        'All', 'Conversion Functions', 'Logging and Alerts', 'Database Functions', 'Utility Functions',
        'Date Functions', 'Message Functions', 'Map Functions', 'Channel Functions',
        'Demo Lib',
        'Alpha Functions', 'File Reader Functions', 'HTTP Listener Functions', 'HTTP Sender Functions', 'Zeta Functions'
    ]);

    // A plugin entry joins an existing built-in category.
    await categorySelect(page).selectOption('Conversion Functions');
    await expect(rows(page).filter({ hasText: 'Convert Demo to XML' })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: 'Convert XML to JSON' })).toHaveCount(1);

    // Library templates are filtered on their context set.
    await categorySelect(page).selectOption('Demo Lib');
    await expect(rows(page)).toHaveText(['Src Helper']);

    // Postprocessor-only catalog entries stay out of a transformer.
    await categorySelect(page).selectOption('All');
    await panel(page).getByPlaceholder('Filter…').fill('Merged Connector');
    await expect(panel(page).getByText('No matches')).toBeVisible();
});

test('response transformer: response entries in, source-only library and plugin entries out', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${CHANNEL_ID}/response/1`);

    await expect(categorySelect(page).locator('option', { hasText: 'Demo Lib' })).toHaveCount(1);
    expect(await categorySelect(page).locator('option').allTextContents()).toEqual([
        'All', 'Conversion Functions', 'Logging and Alerts', 'Database Functions', 'Utility Functions',
        'Date Functions', 'Message Functions', 'Response Transformer', 'Map Functions', 'Channel Functions',
        'Demo Lib',
        'File Reader Functions', 'HTTP Listener Functions', 'HTTP Sender Functions', 'Zeta Functions'
    ]);

    await categorySelect(page).selectOption('Demo Lib');
    await expect(rows(page)).toHaveText(['Resp Helper']);
});

// The Reference entries the script editors' completion provider offers now.
const activeReferences = (page: any) => page.evaluate(async () => {
    const path = '/core/script-completions.js';
    return (await import(path)).getActiveReferences().map((r: any) => r.name);
});

test('script autocomplete offers the editor context\'s Reference entries', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();

    // Deploy script: global catalog and plugin entries, nothing scoped elsewhere.
    await expect.poll(() => activeReferences(page)).toContain('Log an Info Statement');
    const deploy = await activeReferences(page);
    expect(deploy).toEqual(expect.arrayContaining(['Zeta Everywhere', 'Zeta Call']));
    for (const name of ['Get Merged Connector Message', 'Create Segment (individual)', 'Alpha Postprocessor Only', 'Alpha Source Only']) {
        expect(deploy).not.toContain(name);
    }

    // A FUNCTION entry completes as a call.
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('zetaC');
    await page.keyboard.press('Control+Space');
    await page.locator('.suggest-widget .monaco-list-row', { hasText: 'zetaCall(a, b)' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).monaco.editor.getModels()
        .some((m: any) => m.getValue().includes('zetaCall(a, b)')))).toBe(true);

    // Never after a member dot.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.keyboard.type('logger.zet');
    await page.keyboard.press('Control+Space');
    // Word-based suggestions still offer the document's own `zetaCall` text.
    await expect(page.locator('.suggest-widget .monaco-list-row').first()).toBeVisible();
    await expect(page.locator('.suggest-widget .monaco-list-row', { hasText: 'Zeta Everywhere' })).toHaveCount(0);
    await expect(page.locator('.suggest-widget .monaco-list-row', { hasText: 'zetaCall(a, b)' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Postprocessor script: its own entries join.
    await page.locator('select:has(option[value="postprocessingScript"])').selectOption('postprocessingScript');
    await expect.poll(() => activeReferences(page)).toEqual(expect.arrayContaining(['Get Merged Connector Message', 'Alpha Postprocessor Only']));
});
