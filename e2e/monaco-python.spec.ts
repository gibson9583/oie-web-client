import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

async function addPythonEditor(page: Page, id: string, literalInput = false, observeLoad = false) {
    await page.evaluate(async ({ id, literalInput, observeLoad }) => {
        const { createCodeEditor } = await import(String('/core/pkg-ui.js'));
        const { ensureMonaco } = await import(String('/core/monaco.js'));
        const editor = createCodeEditor({ language: 'python', value: '', literalInput, ariaLabel: id,
            completionScope: { context: 'SOURCE_TRANSFORMER' } });
        editor.el.id = id;
        editor.el.style.cssText = 'height: 180px; position: relative; z-index: 1000';
        document.body.appendChild(editor.el);
        ((window as any).__pythonEditors ||= {})[id] = editor;
        if (observeLoad) ((window as any).__pythonReady ||= {})[id] = ensureMonaco('python');
    }, { id, literalInput, observeLoad });
}

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
    await page.goto('/global-scripts');
    await expect(page.locator('.ce-monaco').first()).toBeVisible();
});

test('Rhino stays the default; Python is fetched once on demand and shares Monaco', async ({ page, request }) => {
    expect(await page.evaluate(() => (window as any).monaco.languages.getLanguages().some((language: any) => language.id === 'python'))).toBe(false);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/python\.js/.test(entry.name)).length)).toBe(0);
    const requests: string[] = [];
    page.on('request', request => { if (/\/python\.js/.test(request.url())) requests.push(request.url()); });
    const previousScope = await page.evaluate(async () => (await import(String('/core/script-completions.js'))).activeScope());
    await addPythonEditor(page, 'python-one');
    await addPythonEditor(page, 'python-two', true);
    await expect(page.locator('#python-one.ce-monaco')).toHaveCount(1);
    await expect(page.locator('#python-two.ce-monaco')).toHaveCount(1);
    expect(requests).toHaveLength(1);
    const snapshot = await page.evaluate(async () => {
        const monaco = (window as any).monaco;
        const editor = (window as any).__pythonEditors['python-one'].monaco;
        editor.setValue('def greet(name):\n    return name');
        editor.focus();
        return { language: editor.getModel().getLanguageId(), options: editor.getModel().getOptions(),
            tokens: monaco.editor.tokenize('def greet(name): # Python', 'python').flat().map((token: any) => token.type),
            markers: monaco.editor.getModelMarkers({ resource: editor.getModel().uri }),
            formatSupported: editor.getAction('editor.action.formatDocument')?.isSupported(),
            scope: (await import(String('/core/script-completions.js'))).activeScope(),
            javascript: monaco.editor.getModels().some((model: any) => model.getLanguageId() === 'javascript') };
    });
    expect(snapshot.language).toBe('python');
    expect(snapshot.options).toMatchObject({ insertSpaces: true, tabSize: 4 });
    expect(snapshot.tokens).toContain('keyword.python');
    expect(snapshot.tokens).toContain('comment.python');
    expect(snapshot.markers).toEqual([]);
    expect(snapshot.formatSupported).toBe(false);
    expect(snapshot.scope).toEqual(previousScope);
    expect(snapshot.javascript).toBe(true);
    const provenance = await (await request.get('/vendor/monaco/provenance.json')).json();
    const python = await (await request.get('/vendor/monaco/python.js')).body();
    expect(provenance.optionalLanguages.python.excludedFromEditor).toBe(true);
    expect(createHash('sha256').update(python).digest('hex')).toBe(provenance.optionalLanguages.python.sha256);
});

for (const literalInput of [false, true]) {
    test(`Python ${literalInput ? 'literal' : 'standard'} editor preserves its indentation and has no Rhino completion`, async ({ page }) => {
        await addPythonEditor(page, 'python-input', literalInput);
        await expect(page.locator('#python-input.ce-monaco')).toHaveCount(1);
        await page.evaluate(() => (window as any).__pythonEditors['python-input'].focus());
        await page.keyboard.press('Tab');
        await page.keyboard.insertText('pass');
        expect(await page.evaluate(() => (window as any).__pythonEditors['python-input'].getValue())).toBe('    pass');
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => (window as any).__pythonEditors['python-input'].getValue())).toBe('pass');
        await page.evaluate(() => {
            const editor = (window as any).__pythonEditors['python-input'].monaco;
            editor.setValue('channelM');
            editor.setPosition({ lineNumber: 1, column: 9 });
            editor.trigger('test', 'editor.action.triggerSuggest', {});
        });
        await expect(page.locator('#python-input .suggest-widget.visible .monaco-list-row').filter({ hasText: 'channelMap' })).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).monaco.editor.getModelMarkers({
            resource: (window as any).__pythonEditors['python-input'].monaco.getModel().uri
        }))).toEqual([]);
    });
}

test('delayed Python loads preserve textarea edits and disposal without affecting a concurrent editor', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/vendor/monaco/python.js*', async route => { requests++; await gate; await route.continue(); });
    await addPythonEditor(page, 'python-edited', true);
    await addPythonEditor(page, 'python-disposed');
    await addPythonEditor(page, 'python-survives');
    await page.locator('#python-edited textarea').fill('saved_before_upgrade = True');
    await page.evaluate(() => (window as any).__pythonEditors['python-disposed'].dispose());
    release();
    await expect(page.locator('#python-survives.ce-monaco')).toHaveCount(1);
    expect(requests).toBe(1);
    await expect(page.locator('#python-edited textarea')).toHaveValue('saved_before_upgrade = True');
    await expect(page.locator('#python-edited.ce-monaco, #python-disposed.ce-monaco')).toHaveCount(0);
});

test('a failed optional language keeps the fallback and a later editor retries', async ({ page }) => {
    let requests = 0;
    await page.route('**/vendor/monaco/python.js*', route => {
        requests++;
        return requests === 1 ? route.abort() : route.continue();
    });
    await addPythonEditor(page, 'python-failed', false, true);
    await expect.poll(() => requests).toBe(1);
    // Ensure the first promise settled before requesting a retry.
    expect(await page.evaluate(() => (window as any).__pythonReady['python-failed'])).toBe(null);
    await expect(page.locator('#python-failed textarea')).toHaveCount(1);
    await addPythonEditor(page, 'python-retry');
    await expect(page.locator('#python-retry.ce-monaco')).toHaveCount(1);
    expect(requests).toBe(2);
    await expect(page.locator('.ce-monaco').first()).toBeVisible();
});

test('a timed-out optional load leaves editors usable and does not register after completion', async ({ page }) => {
    await page.clock.install();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/vendor/monaco/python.js*', async route => { requests++; await gate; await route.continue(); });
    await addPythonEditor(page, 'python-timeout', true, true);
    await expect.poll(() => requests).toBe(1);
    await page.clock.fastForward(10_001);
    expect(await page.evaluate(() => (window as any).__pythonReady['python-timeout'])).toBe(null);
    await page.locator('#python-timeout textarea').fill('still_editable = True');
    const finished = page.waitForResponse('**/vendor/monaco/python.js');
    release();
    await finished;
    await page.evaluate(async () => { await import(String('/vendor/monaco/python.js')); });
    expect(await page.evaluate(() => (window as any).monaco.languages.getLanguages().some((language: any) => language.id === 'python'))).toBe(false);
    await addPythonEditor(page, 'python-after-timeout');
    await expect(page.locator('#python-after-timeout.ce-monaco')).toHaveCount(1);
    await expect(page.locator('#python-timeout textarea')).toHaveValue('still_editable = True');
    expect(requests).toBe(2);
});
