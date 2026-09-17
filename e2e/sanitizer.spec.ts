import { createHash } from 'node:crypto';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test('A: the served Monaco bundle matches its patched sanitizer provenance and sanitizes hover markup', async ({ page, request }) => {
    const provenance = await (await request.get('/vendor/monaco/provenance.json')).json();
    expect(provenance.monacoVersion).toBe('0.56.0');
    expect(provenance.sanitizer.version).toBe('3.4.15');
    expect(provenance.embeddedSanitizerExcluded).toBe(true);
    const bundle = await (await request.get('/vendor/monaco/editor.main.js')).body();
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(provenance.editorSha256);

    await mockEngine(page);
    await page.goto('/global-scripts');
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await page.evaluate(() => {
        const monaco = (window as any).monaco;
        (window as any).__unsafeHoverExecuted = false;
        monaco.languages.register({ id: 'sanitizer-probe' });
        monaco.languages.registerHoverProvider('sanitizer-probe', {
            provideHover: () => ({ contents: [{
                value: '<b>Safe hover marker</b><img src="x" onerror="window.__unsafeHoverExecuted=true"><a href="javascript:window.__unsafeHoverExecuted=true">Unsafe link</a>',
                supportHtml: true, isTrusted: true,
            }] }),
        });
        const editor = monaco.editor.getEditors()[0];
        monaco.editor.setModelLanguage(editor.getModel(), 'sanitizer-probe');
        editor.setValue('probe');
        editor.setPosition({ lineNumber: 1, column: 2 });
        editor.focus();
        editor.getAction('editor.action.showHover').run();
    });
    await expect(page.getByText('Safe hover marker', { exact: true })).toBeVisible();
    const hover = page.locator('.monaco-hover').filter({ hasText: 'Safe hover marker' });
    await expect(hover.locator('[onerror], a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__unsafeHoverExecuted)).toBe(false);
});
