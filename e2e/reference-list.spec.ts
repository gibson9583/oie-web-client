import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel, CASES } from './connector-fixtures.js';

/*
 * The filter/transformer Reference list (ReferenceTab): engine catalog entries,
 * the channel's code-template libraries, and platform.registerReferences
 * entries, each filtered on the editor's ContextType like Swing's
 * ReferenceListFactory.getCodeTemplates(category, contextType). Categories
 * order as built-ins, then user libraries, then plugin categories A-Z.
 */

const CHANNEL_ID = 'reference-channel';

const template = (id: string, name: string, contexts: string[], type = 'DRAG_AND_DROP_CODE', code?: string) => ({
    '@version': '4.6.0', id, name, revision: 1,
    contextSet: { delegate: { contextType: contexts } },
    properties: {
        '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type,
        code: code ?? (type === 'FUNCTION' ? `function ${id}() {}` : `${id}();`)
    }
});

const connector = (name: string) => {
    const c = CASES.find((k: any) => k.name === name)!;
    return { transportName: c.name, properties: (c.properties as any)() };
};
const JS_CHANNEL_ID = 'reference-js-channel';
const jsChannel = () => {
    const channel = makeChannel(JS_CHANNEL_ID, { source: connector('JavaScript Reader'), destination: connector('JavaScript Writer') });
    // Data type properties as the engine sends them, so the properties editor renders.
    Object.assign(channel.sourceConnector.transformer, { inboundProperties: {}, outboundProperties: {} });
    return channel;
};

const FIXTURES = {
    [`GET /channels/${CHANNEL_ID}`]: { channel: makeChannel(CHANNEL_ID) },
    [`GET /channels/${JS_CHANNEL_ID}`]: { channel: jsChannel() },
    'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{
        '@version': '4.6.0', id: 'lib-ref', name: 'Demo Lib', revision: 1, description: '',
        includeNewChannels: true, enabledChannelIds: '', disabledChannelIds: '',
        codeTemplates: { codeTemplate: [
            template('srcHelper', 'Src Helper', ['SOURCE_FILTER_TRANSFORMER']),
            template('deployOnly', 'Deploy Only', ['CHANNEL_DEPLOY']),
            template('respHelper', 'Resp Helper', ['DESTINATION_RESPONSE_TRANSFORMER']),
            template('postOnly', 'Post Only', ['CHANNEL_POSTPROCESSOR'], 'FUNCTION'),
            template('readerOnly', 'Reader Only', ['SOURCE_RECEIVER'], 'FUNCTION'),
            template('writerOnly', 'Writer Only', ['DESTINATION_DISPATCHER'], 'FUNCTION'),
            template('batchOnly', 'Batch Only', ['CHANNEL_BATCH'], 'FUNCTION'),
            template('reviewDollarArg', 'Dollar Arg', ['CHANNEL_DEPLOY'], 'FUNCTION', 'function reviewDollarArg($value) {}')
        ] }
    }] } }
};

const PLUGIN = `
    export function register(p) {
        p.registerReferences('Zeta Functions', [
            { name: 'Zeta Everywhere', description: 'Zeta.', code: 'zeta()' },
            { name: 'Zeta Call', code: 'function zetaCall(a, b) {}', type: 'FUNCTION' },
            { name: 'Ref Helper', code: 'function $refHelper($value) {}', type: 'FUNCTION' }
        ]);
        p.registerReferences('Alpha Functions', [
            { name: 'Alpha Source Only', code: 'alpha()', contexts: ['SOURCE_FILTER_TRANSFORMER'] },
            { name: 'Alpha Postprocessor Only', code: 'alphaPost()', contexts: ['CHANNEL_POSTPROCESSOR'] },
            { name: 'Alpha Reader Only', code: 'alphaReader()', contexts: ['SOURCE_RECEIVER'] },
            { name: 'Alpha Writer Only', code: 'alphaWriter()', contexts: ['DESTINATION_DISPATCHER'] },
            { name: 'Alpha Batch Only', code: 'alphaBatch()', contexts: ['CHANNEL_BATCH'] }
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

    // $ in a function or parameter name is inserted literally, not as a snippet variable.
    for (const [typed, call] of [['$refH', '$refHelper($value)'], ['reviewDol', 'reviewDollarArg($value)']]) {
        await page.keyboard.press('Escape');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(typed);
        await expect(async () => {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+Space');
            await expect(page.locator('.suggest-widget .monaco-list-row', { hasText: call }).first()).toBeVisible({ timeout: 2000 });
        }).toPass();
        await page.locator('.suggest-widget .monaco-list-row', { hasText: call }).first().click();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate((text) => (window as any).monaco.editor.getModels()
            .some((m: any) => m.getValue().includes(text)), call)).toBe(true);
    }

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

// The completion provider's inputs: the active Reference entries and code-template functions.
const activeScope = (page: any) => page.evaluate(async () => {
    const path = '/core/script-completions.js';
    const m = await import(path);
    return {
        references: m.getActiveReferences().map((r: any) => r.name),
        templates: m.getActiveCompletions().map((t: any) => t.name)
    };
});
const scriptSelect = (page: any) => page.locator('select:has(option[value="postprocessingScript"])');
const openPostprocessor = async (page: any) => {
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await scriptSelect(page).selectOption('postprocessingScript');
    await expect.poll(async () => {
        const scope = await activeScope(page);
        return scope.references.includes('Alpha Postprocessor Only') && scope.templates.includes('postOnly');
    }).toBe(true);
};
const EMPTY = { references: [], templates: [] };

// The scope a connector editor takes on focus: its own context's entries only.
const expectScope = async (page: any, own: [string, string], others: string[]) => {
    await expect.poll(async () => {
        const scope = await activeScope(page);
        return scope.references.includes(own[0]) && scope.templates.includes(own[1]);
    }).toBe(true);
    const scope = await activeScope(page);
    for (const name of others) {
        expect(scope.references).not.toContain(name);
        expect(scope.templates).not.toContain(name);
    }
};
const POST = ['Alpha Postprocessor Only', 'postOnly'];

test('the JavaScript Reader and Writer editors complete in their own contexts, not the Scripts tab\'s', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${JS_CHANNEL_ID}/edit`);

    // Postprocessor -> Source: the Scripts scope is gone; the JavaScript Reader
    // takes SOURCE_RECEIVER when focused.
    await openPostprocessor(page);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await expect.poll(() => activeScope(page)).toEqual(EMPTY);
    await page.locator('.ce .monaco-editor').first().click();
    await expectScope(page, ['Alpha Reader Only', 'readerOnly'], [...POST, 'Alpha Writer Only', 'writerOnly']);
    await page.keyboard.type('readerOnl');
    await expect(async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+Space');
        await expect(page.locator('.suggest-widget .monaco-list-row', { hasText: 'readerOnly()' }).first()).toBeVisible({ timeout: 2000 });
    }).toPass();
    await page.keyboard.press('Escape');

    // Postprocessor -> Destinations: the JavaScript Writer takes DESTINATION_DISPATCHER.
    await openPostprocessor(page);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect.poll(() => activeScope(page)).toEqual(EMPTY);
    await page.locator('.ce .monaco-editor').first().click();
    await expectScope(page, ['Alpha Writer Only', 'writerOnly'], [...POST, 'Alpha Reader Only', 'readerOnly']);

    // Back to Scripts: the scope follows the script that shows.
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await expect(scriptSelect(page)).toHaveValue('deployScript');
    await expect.poll(async () => (await activeScope(page)).references).toContain('Zeta Call');
    const deploy = await activeScope(page);
    for (const name of [...POST, 'Alpha Writer Only', 'writerOnly']) {
        expect(deploy.references).not.toContain(name);
        expect(deploy.templates).not.toContain(name);
    }
    await openPostprocessor(page);
});

test('the batch script dialog completes in CHANNEL_BATCH and gives the Reader its scope back', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${JS_CHANNEL_ID}/guided`);
    await page.locator('.wiz-step', { hasText: 'Source' }).click();

    await page.locator('.ce .monaco-editor').first().click();
    await expectScope(page, ['Alpha Reader Only', 'readerOnly'], ['Alpha Batch Only', 'batchOnly']);

    await page.getByRole('button', { name: /Edit properties/ }).click();
    await page.locator('div:has(> .cform-section-title:text-is("Inbound properties"))')
        .getByRole('button', { name: /^Edit/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Script', exact: true });
    await dialog.locator('.monaco-editor').click();
    await expectScope(page, ['Alpha Batch Only', 'batchOnly'], ['Alpha Reader Only', 'readerOnly', ...POST]);

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectScope(page, ['Alpha Reader Only', 'readerOnly'], ['Alpha Batch Only', 'batchOnly']);
});

// Code template libraries that answer 503 until `state.down` is cleared.
// `failed()` resolves when the completion scope reports the next failed load.
const flakyLibraries = (page: any) => {
    const state = { down: true, requests: 0 };
    return {
        state,
        fixtures: {
            ...FIXTURES,
            'GET /codeTemplateLibraries': () => {
                state.requests++;
                return state.down ? { __status: 503 } : FIXTURES['GET /codeTemplateLibraries'];
            }
        },
        failed: () => page.waitForEvent('console', (m: any) => m.text().includes('could not load code templates'))
    };
};
const refocus = async (page: any, editor: any) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await editor.click();
};

test('refocusing the JavaScript Reader retries a failed code-template load', async ({ page }) => {
    await installPlugin(page);
    const libraries = flakyLibraries(page);
    await mockEngine(page, libraries.fixtures);
    await page.goto(`/channels/${JS_CHANNEL_ID}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const reader = page.locator('.ce .monaco-editor').first();

    const failed = libraries.failed();
    await reader.click();
    await failed;
    expect((await activeScope(page)).templates).toEqual([]);

    // The engine recovers; focusing the editor again loads the templates.
    libraries.state.down = false;
    const requests = libraries.state.requests;
    await refocus(page, reader);
    await expectScope(page, ['Alpha Reader Only', 'readerOnly'], POST);
    expect(libraries.state.requests).toBeGreaterThan(requests);
});

test('refocusing the batch script dialog retries the load and still gives the Reader its scope back', async ({ page }) => {
    await installPlugin(page);
    const libraries = flakyLibraries(page);
    await mockEngine(page, libraries.fixtures);
    await page.goto(`/channels/${JS_CHANNEL_ID}/guided`);
    await page.locator('.wiz-step', { hasText: 'Source' }).click();

    let failed = libraries.failed();
    await page.locator('.ce .monaco-editor').first().click();
    await failed;

    await page.getByRole('button', { name: /Edit properties/ }).click();
    await page.locator('div:has(> .cform-section-title:text-is("Inbound properties"))')
        .getByRole('button', { name: /^Edit/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Script', exact: true });
    const editor = dialog.locator('.monaco-editor');
    failed = libraries.failed();
    await editor.click();
    await failed;

    libraries.state.down = false;
    await refocus(page, editor);
    await expectScope(page, ['Alpha Batch Only', 'batchOnly'], ['Alpha Reader Only', 'readerOnly']);

    // The refocus kept the scope the dialog displaced: closing returns it to the Reader.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectScope(page, ['Alpha Reader Only', 'readerOnly'], ['Alpha Batch Only', 'batchOnly']);
});

test('a template load that finishes after the scope is cleared does not restore it', async ({ page }) => {
    await installPlugin(page);
    await mockEngine(page, FIXTURES);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/codeTemplateLibraries*', async (route: any) => { await gate; await route.fallback(); });
    await page.goto(`/channels/${JS_CHANNEL_ID}/edit`);

    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    await scriptSelect(page).selectOption('postprocessingScript');
    await page.getByRole('tab', { name: 'Source', exact: true }).click();

    const loaded = page.waitForResponse('**/api/codeTemplateLibraries*');
    release();
    await loaded;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(await activeScope(page)).toEqual(EMPTY);
});
