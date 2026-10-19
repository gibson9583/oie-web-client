import { readdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

async function addPluginEditor(page: Page, id: string, literalInput = false, observeLoad = false) {
    await page.evaluate(async ({ id, literalInput, observeLoad }) => {
        const { createCodeEditor } = await import(String('/core/pkg-ui.js'));
        const { ensureMonaco } = await import(String('/core/monaco.js'));
        const editor = createCodeEditor({ language: 'sample-plugin', value: '', literalInput, ariaLabel: id,
            tabSize: 4, insertSpaces: true, detectIndentation: false,
            completionScope: { context: 'SOURCE_TRANSFORMER' } });
        editor.el.id = id;
        editor.el.style.cssText = 'height: 180px; position: relative; z-index: 1000';
        document.body.appendChild(editor.el);
        ((window as any).__pluginEditors ||= {})[id] = editor;
        if (observeLoad) ((window as any).__pluginReady ||= {})[id] = ensureMonaco('sample-plugin');
    }, { id, literalInput, observeLoad });
}

// This grammar exists only in the test plugin response, never in host assets.
const pluginGrammar = `export const tokensProvider = {
    tokenPostfix: '.sample-plugin',
    tokenizer: { root: [[/\\b(command|emit)\\b/, 'keyword'], [/#.*$/, 'comment']] }
};
export const configuration = { comments: { lineComment: '#' } };`;

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
    await page.route('**/plugin-assets/sample-language.js*', route => route.fulfill({ contentType: 'text/javascript', body: pluginGrammar }));
    await page.goto('/global-scripts');
    await expect(page.locator('.ce-monaco').first()).toBeVisible();
    await page.evaluate(async () => {
        const { platform } = await import(String('/core/platform.js'));
        let attempt = 0;
        platform.registerEditorLanguage('sample-plugin', {
            aliases: ['Sample plugin'], extensions: ['.sample'],
            load: () => import(`/plugin-assets/sample-language.js?attempt=${attempt++}`)
        });
    });
});

test('Rhino stays the default; the plugin language is fetched once on demand and shares Monaco', async ({ page, request }) => {
    expect(await page.evaluate(() => (window as any).monaco.languages.getLanguages().map((language: any) => language.id).sort()))
        .toEqual(['css', 'hl7v2', 'html', 'javascript', 'json', 'plaintext', 'sql', 'xml']);
    const formats = [
        { language: 'xml', source: '<message id="1"/>', token: 'tag.xml' },
        { language: 'sql', source: 'SELECT value FROM records WHERE id = 1;', token: 'keyword.sql' },
        { language: 'html', source: '<div class="message">Hello</div>', token: 'tag.html' },
        { language: 'css', source: 'div { color: red; }', token: 'attribute.name.css' },
        { language: 'json', source: '{"answer": 1}', token: 'string.key.json' }
    ];
    // Model creation activates each built-in lazy tokenizer. Require real token
    // categories, since registered IDs alone do not prove the grammar survived.
    const models = await page.evaluateHandle(samples => samples.map(sample =>
        (window as any).monaco.editor.createModel(sample.source, sample.language)), formats);
    try {
        for (const sample of formats) {
            await expect.poll(() => page.evaluate(({ language, source }) =>
                (window as any).monaco.editor.tokenize(source, language).flat().map((token: any) => token.type), sample),
            { message: `${sample.language} retains its built-in tokenizer` }).toContain(sample.token);
        }
    } finally {
        await models.evaluate(values => values.forEach((model: any) => model.dispose()));
        await models.dispose();
    }
    expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/sample-language\.js/.test(entry.name)).length)).toBe(0);
    const requests: string[] = [];
    page.on('request', request => { if (/\/sample-language\.js/.test(request.url())) requests.push(request.url()); });
    const previousScope = await page.evaluate(async () => (await import(String('/core/script-completions.js'))).activeScope());
    await addPluginEditor(page, 'sample-plugin-one');
    await addPluginEditor(page, 'sample-plugin-two', true);
    await expect(page.locator('#sample-plugin-one.ce-monaco')).toHaveCount(1);
    await expect(page.locator('#sample-plugin-two.ce-monaco')).toHaveCount(1);
    expect(requests).toHaveLength(1);
    const snapshot = await page.evaluate(async () => {
        const monaco = (window as any).monaco;
        const editor = (window as any).__pluginEditors['sample-plugin-one'].monaco;
        editor.setValue('command greet\n    emit name');
        editor.focus();
        return { language: editor.getModel().getLanguageId(), options: editor.getModel().getOptions(),
            tokens: monaco.editor.tokenize('command greet # plugin language', 'sample-plugin').flat().map((token: any) => token.type),
            markers: monaco.editor.getModelMarkers({ resource: editor.getModel().uri }),
            formatSupported: editor.getAction('editor.action.formatDocument')?.isSupported(),
            scope: (await import(String('/core/script-completions.js'))).activeScope(),
            javascript: monaco.editor.getModels().some((model: any) => model.getLanguageId() === 'javascript') };
    });
    expect(snapshot.language).toBe('sample-plugin');
    expect(snapshot.options).toMatchObject({ insertSpaces: true, tabSize: 4 });
    expect(snapshot.tokens).toContain('keyword.sample-plugin');
    expect(snapshot.tokens).toContain('comment.sample-plugin');
    expect(snapshot.markers).toEqual([]);
    expect(snapshot.formatSupported).toBe(false);
    expect(snapshot.scope).toEqual(previousScope);
    expect(snapshot.javascript).toBe(true);
    const provenance = await (await request.get('/vendor/monaco/provenance.json')).json();
    expect(provenance.builtInLanguages).toEqual({
        definitions: ['css', 'html', 'javascript', 'sql', 'xml'],
        services: ['css', 'html', 'json', 'typescript'],
        definitionDependencies: ['typescript']
    });
    expect(provenance.optionalLanguages).toBeUndefined();
    const assets = readdirSync(new URL('../web-administrator/client/vendor/monaco/', import.meta.url));
    const fonts = assets.filter(name => /^codicon-[\w-]+\.ttf$/.test(name));
    expect(fonts).toHaveLength(1);
    expect(assets.filter(name => !fonts.includes(name)).sort()).toEqual([
        'DOMPurify-LICENSE.txt', 'css.worker.js', 'editor.main.css', 'editor.main.js', 'editor.worker.js',
        'html.worker.js', 'json.worker.js', 'provenance.json', 'ts.worker.js'
    ]);
    const optionalAsset = await request.get('/vendor/monaco/sample-language.js');
    // Missing static paths follow the existing SPA fallback (HTML, not a grammar).
    expect(optionalAsset.headers()['content-type']).not.toContain('javascript');
});

for (const literalInput of [false, true]) {
    test(`Plugin ${literalInput ? 'literal' : 'standard'} editor preserves its indentation and has no Rhino completion`, async ({ page }) => {
        await addPluginEditor(page, 'sample-plugin-input', literalInput);
        await expect(page.locator('#sample-plugin-input.ce-monaco')).toHaveCount(1);
        await page.evaluate(() => (window as any).__pluginEditors['sample-plugin-input'].focus());
        await page.keyboard.press('Tab');
        await page.keyboard.insertText('pass');
        expect(await page.evaluate(() => (window as any).__pluginEditors['sample-plugin-input'].getValue())).toBe('    pass');
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => (window as any).__pluginEditors['sample-plugin-input'].getValue())).toBe('pass');
        await page.evaluate(() => {
            const editor = (window as any).__pluginEditors['sample-plugin-input'].monaco;
            editor.setValue('channelM');
            editor.setPosition({ lineNumber: 1, column: 9 });
            editor.trigger('test', 'editor.action.triggerSuggest', {});
        });
        await expect(page.locator('#sample-plugin-input .suggest-widget.visible .monaco-list-row').filter({ hasText: 'channelMap' })).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).monaco.editor.getModelMarkers({
            resource: (window as any).__pluginEditors['sample-plugin-input'].monaco.getModel().uri
        }))).toEqual([]);
    });
}

test('delayed plugin language loads preserve textarea edits and disposal without affecting a concurrent editor', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/plugin-assets/sample-language.js*', async route => { requests++; await gate; await route.fallback(); });
    await addPluginEditor(page, 'sample-plugin-edited', true);
    await addPluginEditor(page, 'sample-plugin-disposed');
    await addPluginEditor(page, 'sample-plugin-survives');
    await page.locator('#sample-plugin-edited textarea').fill('saved_before_upgrade = True');
    await page.evaluate(() => (window as any).__pluginEditors['sample-plugin-disposed'].dispose());
    release();
    await expect(page.locator('#sample-plugin-survives.ce-monaco')).toHaveCount(1);
    expect(requests).toBe(1);
    await expect(page.locator('#sample-plugin-edited textarea')).toHaveValue('saved_before_upgrade = True');
    await expect(page.locator('#sample-plugin-edited.ce-monaco, #sample-plugin-disposed.ce-monaco')).toHaveCount(0);
});

test('a failed optional language keeps the fallback and a later editor retries', async ({ page }) => {
    let requests = 0;
    await page.route('**/plugin-assets/sample-language.js*', route => {
        requests++;
        return requests === 1 ? route.abort() : route.fallback();
    });
    await addPluginEditor(page, 'sample-plugin-failed', false, true);
    await expect.poll(() => requests).toBe(1);
    // Ensure the first promise settled before requesting a retry.
    expect(await page.evaluate(() => (window as any).__pluginReady['sample-plugin-failed'])).toBe(null);
    await expect(page.locator('#sample-plugin-failed textarea')).toHaveCount(1);
    await addPluginEditor(page, 'sample-plugin-retry');
    await expect(page.locator('#sample-plugin-retry.ce-monaco')).toHaveCount(1);
    expect(requests).toBe(2);
    await expect(page.locator('.ce-monaco').first()).toBeVisible();
});

test('a malformed tokenizer retries after Monaco has already registered its language id', async ({ page }) => {
    let requests = 0;
    await page.route('**/plugin-assets/sample-language.js*', route => {
        requests++;
        return requests === 1 ? route.fulfill({ contentType: 'text/javascript', body:
            "export const configuration = { comments: { lineComment: '!' } }; export const tokensProvider = {};" }) : route.fallback();
    });
    await addPluginEditor(page, 'plugin-malformed', false, true);
    expect(await page.evaluate(() => (window as any).__pluginReady['plugin-malformed'])).toBe(null);
    await expect(page.locator('#plugin-malformed textarea')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).monaco.languages.getLanguages().some((language: any) => language.id === 'sample-plugin'))).toBe(true);
    await addPluginEditor(page, 'plugin-repaired');
    await expect(page.locator('#plugin-repaired.ce-monaco')).toHaveCount(1);
    expect(requests).toBe(2);
    const tokens = await page.evaluate(() => (window as any).monaco.editor.tokenize('command repaired # comment', 'sample-plugin')
        .flat().map((token: any) => token.type));
    expect(tokens).toContain('keyword.sample-plugin');
    expect(tokens).toContain('comment.sample-plugin');
    await expect(page.locator('#plugin-malformed textarea')).toHaveCount(1);
});

test('a timed-out optional load leaves editors usable and does not register after completion', async ({ page }) => {
    await page.clock.install();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/plugin-assets/sample-language.js*', async route => { requests++; await gate; await route.fallback(); });
    await addPluginEditor(page, 'sample-plugin-timeout', true, true);
    await expect.poll(() => requests).toBe(1);
    await page.clock.fastForward(10_001);
    expect(await page.evaluate(() => (window as any).__pluginReady['sample-plugin-timeout'])).toBe(null);
    await page.locator('#sample-plugin-timeout textarea').fill('still_editable = True');
    const finished = page.waitForResponse('**/plugin-assets/sample-language.js?attempt=0');
    release();
    await finished;
    await page.evaluate(async () => { await import(String('/plugin-assets/sample-language.js?attempt=0')); });
    expect(await page.evaluate(() => (window as any).monaco.languages.getLanguages().some((language: any) => language.id === 'sample-plugin'))).toBe(false);
    await addPluginEditor(page, 'sample-plugin-after-timeout');
    await expect(page.locator('#sample-plugin-after-timeout.ce-monaco')).toHaveCount(1);
    await expect(page.locator('#sample-plugin-timeout textarea')).toHaveValue('still_editable = True');
    expect(requests).toBe(2);
});
