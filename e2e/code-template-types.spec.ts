import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

type Model = Record<string, any>;
const BASIC_CLASS = 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties';
const CUSTOM_CLASS = 'com.example.templates.SampleCodeTemplateProperties';
const SOURCE = 'command invoke(value)\n    emit value\n';
const EDITED = 'command invoke(value)\n    emit "001" + value\n';
const clone = <T>(value: T): T => structuredClone(value);
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

// A synthetic plugin stores opaque source and settings outside the host model.
// Its non-JavaScript source must survive editing, switching, and serialization
// without leaking into JavaScript validation or completion services.
function sampleProperties() {
    return { '@class': CUSTOM_CLASS, '@version': '4.6.0', type: 'FUNCTION', functionName: 'sample_function',
        customSource: SOURCE, profileId: '232030e4-aa0d-39fc-a889-fed1318ef412',
        profileName: 'Sample execution profile', timeoutMillis: 30000,
        contextInputs: { string: ['message.encodedData'] }, contractVersion: 1 };
}
function template(id: string, name: string, properties: Model): Model {
    return { '@version': '4.6.0', id, name, revision: 3,
        contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } }, properties };
}
function fixtures(): Model[] {
    return [{ '@version': '4.6.0', id: 'library', name: 'Shared Functions', revision: 4, description: 'Original description',
        includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '',
        codeTemplates: { codeTemplate: [
            template('sample-1', 'Sample Helper', sampleProperties()),
            template('js-1', 'JavaScript Helper', { '@class': BASIC_CLASS, '@version': '4.6.0', type: 'FUNCTION', code: 'function js_helper() { return "original"; }' })
        ] } }];
}

const pluginSource = `
export function register(platform) {
    const React = platform.React;
    platform.registerCodeTemplateType('sample-function-test', {
        label: 'Sample Function', propertiesClass: ${JSON.stringify(CUSTOM_CLASS)},
        contexts: ['SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER', 'DESTINATION_RESPONSE_TRANSFORMER'],
        create: ({version}) => ({ ...${JSON.stringify(sampleProperties())}, '@version': version }),
        component: ({ properties, onChange, readOnly }) => React.createElement('div', {className:'flex flex-col flex-1'},
            React.createElement('label', null, 'Function name', React.createElement('input', {
                'aria-label': 'Sample function name', value: properties.functionName, readOnly,
                onChange: event => { if (!readOnly) { properties.functionName = event.target.value; onChange(); } }
            })),
            React.createElement('label', null, 'Sample source', React.createElement('textarea', {
                'aria-label': 'Sample source', value: properties.customSource, readOnly, rows: 12,
                onChange: event => { if (!readOnly) { properties.customSource = event.target.value; onChange(); } }
            }))
        ),
        validateSave: ({properties}) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(properties.functionName) ? null : 'Enter a valid function name',
        getCompletionCode: ({properties}) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(properties.functionName)
            ? 'function ' + properties.functionName + '(value) {}' : null,
        validate: async ({properties}) => {
            window.__templateValidationStarted = (window.__templateValidationStarted || 0) + 1;
            window.__templateValidationSnapshot = properties;
            window.__templateValidationSettled = false;
            const result = await new Promise(resolve => { window.__finishTemplateValidation = resolve; });
            window.__templateValidationSettled = true;
            return result;
        }
    });
    window.__templateProviderReady = true;
}`;

async function install(page: Page, enabled = true) {
    // Capture the outgoing browser FormData before fetch: WebKit's postData()
    // omits Blob bodies, whereas this observes the exact JSON in all browsers.
    await page.addInitScript(() => {
        const fetchOriginal = window.fetch;
        (window as any).__templateWrites = [];
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            const [input, init] = args;
            const url = new URL(input instanceof globalThis.Request ? input.url : String(input), location.href);
            if (url.pathname === '/api/codeTemplateLibraries/_bulkUpdate' && init?.body instanceof FormData) {
                const parts: Record<string, any> = {};
                for (const [name, value] of init.body.entries()) parts[name] = JSON.parse(typeof value === 'string' ? value : await value.text());
                (window as any).__templateWrites.push(parts);
            }
            return fetchOriginal(...args);
        };
    });
    const state = { libraries: fixtures(), writes: [] as Model[], jsValidations: 0 };
    const stored = new Map(state.libraries.flatMap(lib => lib.codeTemplates.codeTemplate).map((tpl: Model) => [tpl.id, clone(tpl)]));
    await mockEngine(page, {
        'GET /webplugins': enabled ? ['template-test'] : [],
        'GET /webplugins/template-test/plugin.json': {
            id: 'template-test', name: 'Code Template Contract Test', version: '1.0.0', oie: { apiMin: '4.10' }, client: { entry: 'web/plugin.js' }
        },
        'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: clone(state.libraries) } }),
        'POST /javascript/_validate': () => { state.jsValidations++; return { error: null }; },
        'POST /codeTemplateLibraries/_bulkUpdate': async () => {
            const payload = await page.evaluate(() => (window as any).__templateWrites.shift());
            expect(payload).toBeTruthy();
            state.writes.push(payload);
            const results: Model = {};
            for (const updated of array<Model>(payload.updatedCodeTemplates.list.codeTemplate)) {
                const saved: Model = { ...clone(updated), revision: updated.revision + 1 };
                stored.set(saved.id, saved);
                results[saved.id] = { success: true, newRevision: saved.revision };
            }
            state.libraries = array<Model>(payload.libraries.list.codeTemplateLibrary).map(library => ({ ...clone(library),
                codeTemplates: { codeTemplate: array<Model>(library.codeTemplates?.codeTemplate).map(ref => clone(stored.get(ref.id))) }
            }));
            return { codeTemplateLibrarySaveResult: { librariesSuccess: true, overrideNeeded: false, codeTemplateResults: results } };
        }
    });
    if (enabled) await page.route('**/api/webplugins/template-test/web/plugin.js*', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: pluginSource
    }));
    return state;
}

const typeSelect = (page: Page) => page.locator('.field:has(> label:text-is("Type")) > select');
const nameInput = (page: Page) => page.locator('.field:has(> label:text-is("Name")) > input');
async function open(page: Page, id = 'sample-1') {
    await page.goto('/code-templates?templateId=' + id);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
}
async function save(page: Page) {
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText('Code templates saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
}

test('custom properties select the provider and Save preserves opaque source and serialized properties', async ({ page }) => {
    const state = await install(page);
    await open(page);
    await expect(typeSelect(page)).toHaveValue('sample-function-test');
    await expect(page.getByLabel('Sample source', { exact: true })).toHaveValue(SOURCE);
    await page.getByLabel('Sample source', { exact: true }).fill(EDITED);
    await page.getByLabel('Sample function name', { exact: true }).fill('new_sample_function');
    await save(page);
    expect(state.writes).toHaveLength(1);
    const saved = state.writes[0].updatedCodeTemplates.list.codeTemplate[0];
    expect(saved.properties).toEqual({ ...sampleProperties(), customSource: EDITED, functionName: 'new_sample_function' });
    expect(saved.properties).not.toHaveProperty('code');
    expect(state.writes[0].libraries.list.codeTemplateLibrary[0].codeTemplates.codeTemplate).toEqual([
        { '@version': '4.6.0', id: 'sample-1' }, { '@version': '4.6.0', id: 'js-1' }
    ]);
    await expect(page.getByLabel('Sample source', { exact: true })).toHaveValue(EDITED);
    expect(state.jsValidations).toBe(0);
});

test('switching between JavaScript and custom types restores separate unsaved source drafts', async ({ page }) => {
    const state = await install(page);
    await open(page, 'js-1');
    await expect(typeSelect(page).locator('option')).toHaveText(['Function', 'Drag-and-Drop Code Block', 'Compiled Code Block', 'Sample Function']);
    await typeSelect(page).selectOption('sample-function-test');
    await page.getByLabel('Sample source', { exact: true }).fill(EDITED);
    await typeSelect(page).selectOption('COMPILED_CODE');
    await expect(page.getByLabel('Sample source', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ce-monaco .view-lines')).toContainText('function js_helper()');
    await typeSelect(page).selectOption('sample-function-test');
    await expect(page.getByLabel('Sample source', { exact: true })).toHaveValue(EDITED);
    await save(page);
    expect(state.writes[0].updatedCodeTemplates.list.codeTemplate[0].properties).toEqual({ ...sampleProperties(), customSource: EDITED });
});

test('built-in type changes keep the JavaScript editor and its undo history', async ({ page }) => {
    await install(page);
    await open(page, 'js-1');
    await expect(page.locator('.ce-monaco .view-lines')).toContainText('function js_helper()');
    await page.evaluate(() => {
        const editor = (window as any).monaco.editor.getEditors().find((item: any) => item.getDomNode()?.isConnected);
        editor.setPosition({ lineNumber: 1, column: editor.getModel().getLineMaxColumn(1) });
        editor.trigger('keyboard', 'type', { text: ' // edited' });
    });
    await typeSelect(page).selectOption('COMPILED_CODE');
    await expect.poll(() => page.evaluate(() => {
        const editor = (window as any).monaco.editor.getEditors().find((item: any) => item.getDomNode()?.isConnected);
        return editor ? { value: editor.getValue(), canUndo: editor.getModel().canUndo() } : null;
    })).toEqual({ value: 'function js_helper() { return "original"; } // edited', canUndo: true });
});

test('an unavailable provider is read-only and an unrelated library save keeps its complete template', async ({ page }) => {
    const state = await install(page, false), original = clone(state.libraries[0].codeTemplates.codeTemplate[0]);
    await open(page);
    await expect(page.getByText('The template source and properties are preserved.', { exact: true })).toBeVisible();
    await expect(typeSelect(page)).toBeDisabled();
    await expect(nameInput(page)).toHaveAttribute('readonly', '');
    await expect(page.locator('.ce-monaco')).toHaveCount(0);
    await page.getByRole('treegrid').getByText('Shared Functions', { exact: true }).click();
    await page.locator('textarea').fill('Changed library description');
    await save(page);
    expect(state.writes[0].updatedCodeTemplates.list.codeTemplate).toEqual([]);
    expect(state.libraries[0].description).toBe('Changed library description');
    expect(state.libraries[0].codeTemplates.codeTemplate[0]).toEqual(original);
    await page.getByRole('treegrid').getByText('Sample Helper', { exact: true }).click();
    await expect(page.getByText('The template source and properties are preserved.', { exact: true })).toBeVisible();
});

test('schema failures prevent all writes while incomplete custom source remains saveable', async ({ page }) => {
    const state = await install(page);
    await open(page);
    await page.getByLabel('Sample function name', { exact: true }).fill('invalid-name');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Enter a valid function name');
    expect(state.writes).toHaveLength(0);
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByLabel('Sample function name', { exact: true }).fill('valid_name');
    await page.getByLabel('Sample source', { exact: true }).fill('command incomplete(');
    await save(page);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].updatedCodeTemplates.list.codeTemplate[0].properties.customSource).toBe('command incomplete(');
    expect(await page.evaluate(() => (window as any).__templateValidationStarted || 0)).toBe(0);
});

test('async provider validation cannot report success after navigating away and back', async ({ page }) => {
    const state = await install(page);
    await open(page);
    await page.getByRole('button', { name: 'Validate Script', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__templateValidationStarted)).toBe(1);
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('button', { name: 'Code Templates', exact: true }).click();
    await page.getByRole('treegrid').getByText('Sample Helper', { exact: true }).click();
    await expect(page.getByLabel('Sample source', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).__finishTemplateValidation(null));
    await expect.poll(() => page.evaluate(() => (window as any).__templateValidationSettled)).toBe(true);
    await expect(page.getByText('Code template validated successfully', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Validate Script', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__templateValidationStarted)).toBe(2);
    await page.evaluate(() => (window as any).__finishTemplateValidation(null));
    await expect(page.getByText('Code template validated successfully', { exact: true })).toBeVisible();
    expect(state.jsValidations).toBe(0);
});

test('custom editors receive read-only state after save permission is revoked', async ({ page }) => {
    const state = await install(page);
    await open(page);
    await page.evaluate(async () => {
        const { platform } = await import(String('@oie/web-shell'));
        platform.setAuthorizationController({ checkTask: (_group: string, task: string) => task !== 'doSaveCodeTemplates' });
    });
    await expect(page.getByLabel('Sample source', { exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Sample function name', { exact: true })).toHaveAttribute('readonly', '');
    await expect(typeSelect(page)).toBeDisabled();
    expect(state.writes).toHaveLength(0);
});

test('custom function declarations reach JavaScript suggestions and the Monaco worker without custom source', async ({ page }) => {
    const state = await install(page), channelId = 'sample-completion-channel';
    state.libraries[0].enabledChannelIds = { string: [channelId] };
    const outside = clone(state.libraries[0]);
    outside.id = 'outside-library';
    outside.enabledChannelIds = { string: ['another-channel'] };
    outside.codeTemplates.codeTemplate = [template('outside-sample', 'Outside Sample', {
        ...sampleProperties(), functionName: 'outside_sample'
    })];
    state.libraries.push(outside);
    const wrongContext = template('wrong-context-sample', 'Wrong Context Sample', {
        ...sampleProperties(), functionName: 'wrong_context_sample'
    });
    wrongContext.contextSet.delegate.contextType = ['GLOBAL_DEPLOY'];
    state.libraries[0].codeTemplates.codeTemplate.push(wrongContext);
    const channel = makeChannel(channelId);
    channel.sourceConnector.transformer.elements = {
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
            '@version': '4.6.0', name: 'JavaScript caller', sequenceNumber: '0', enabled: true, script: '// Call Sample from JavaScript'
        }
    };
    await page.route(`**/api/channels/${channelId}`, route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ channel })
    }));
    await page.goto(`/channels/${channelId}/transformer/0`);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const scope = await import(String('/core/script-completions.js'));
        return scope.getActiveCompletions().map((completion: { name: string }) => completion.name);
    })).toEqual(['sample_function', 'js_helper']);
    const sources = await page.evaluate(async () => {
        const scope = await import(String('/core/script-completions.js'));
        return scope.getActiveLibs();
    });
    expect(sources).toEqual([
        { id: 'sample-1', code: 'function sample_function(value) {}' },
        { id: 'js-1', code: 'function js_helper() { return "original"; }' }
    ]);
    const workerNames = () => page.evaluate(async () => {
        const monaco = (window as any).monaco;
        const language = monaco.languages.typescript || monaco.typescript;
        const access = await language.getJavaScriptWorker();
        const model = monaco.editor.createModel('sample_fun', 'javascript');
        try {
            const worker = await access(model.uri);
            const completion = await worker.getCompletionsAtPosition(model.uri.toString(), 'sample_fun'.length);
            return (completion?.entries || []).map((entry: { name: string }) => entry.name);
        } finally { model.dispose(); }
    });
    await expect.poll(workerNames, { timeout: 10_000 }).toContain('sample_function');
    const names = await workerNames();
    expect(names).not.toContain('outside_sample');
    expect(names).not.toContain('wrong_context_sample');
    const reference = page.locator('.step-item').filter({ has: page.getByText('Sample Helper', { exact: true }) });
    await expect(reference).toHaveAttribute('draggable', 'true');
    const transferred = await reference.evaluate(element => {
        const dataTransfer = new DataTransfer();
        element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        const text = dataTransfer.getData('text/plain');
        element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        return text;
    });
    expect(transferred).toBe('sample_function(value)');
});
