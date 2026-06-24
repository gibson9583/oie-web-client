import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Guards Monaco's TypeScript language-service worker, which powers IntelliSense
 * (member completions / hover / signature help from the generated userapi .d.ts).
 *
 * Regression this catches: the worker is spawned from a blob: URL, so the AMD
 * worker bootstrap must be loaded with a FULLY-QUALIFIED same-origin URL — a
 * root-relative importScripts('/vendor/monaco/...') is invalid inside a blob:
 * worker and silently kills the worker (Monaco falls back to the main thread and
 * completions hang). That degraded IntelliSense with no visible error. Here we
 * drive a real completion through the worker and require member results.
 */
test('Monaco TS worker answers member completions (IntelliSense)', async ({ page }) => {
    // Fail loudly if the worker can't load its bootstrap (the regression's signature).
    const workerErrors = [];
    page.on('pageerror', (e) => { if (/importScripts|web worker/i.test(e.message)) workerErrors.push(e.message); });

    await mockEngine(page);
    await page.goto('/#/global-scripts');
    // Monaco must upgrade from the baseline textarea first.
    await page.waitForSelector('.monaco-editor', { timeout: 15000 });

    const result = await page.evaluate(async () => {
        const withTimeout = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + tag)), ms))]);
        const monaco = window.monaco;
        const accessor = await withTimeout(monaco.languages.typescript.getJavaScriptWorker(), 8000, 'getWorker');
        const model = monaco.editor.createModel('DateUtil.', 'javascript');
        try {
            const client = await withTimeout(accessor(model.uri), 8000, 'accessor');
            const info = await withTimeout(client.getCompletionsAtPosition(model.uri.toString(), 'DateUtil.'.length), 8000, 'completions');
            return (info && info.entries || []).map((e) => e.name);
        } finally {
            model.dispose();
        }
    });

    expect(workerErrors, `worker failed to load: ${workerErrors.join('; ')}`).toEqual([]);
    // convertDate is a real DateUtil method declared in the userapi .d.ts — proves
    // the language service read the extra lib through a live worker, not just that
    // some worker exists.
    expect(result).toContain('convertDate');
});
