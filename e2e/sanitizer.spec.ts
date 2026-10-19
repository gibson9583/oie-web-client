import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test('A: the served React and Monaco match dependency provenance and sanitize hover markup', async ({ page, request }) => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    const reactPackage = lock.packages['web-administrator/node_modules/react'] ?? lock.packages['node_modules/react'];
    expect(reactPackage, 'The lockfile must identify the app React dependency').toBeDefined();
    const provenance = await (await request.get('/vendor/monaco/provenance.json')).json();
    expect(provenance.monacoVersion).toBe('0.57.0');
    expect(provenance.sanitizer.version).toBe('3.4.17');
    expect(provenance.embeddedSanitizerExcluded).toBe(true);
    const bundle = await (await request.get('/vendor/monaco/editor.main.js')).body();
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(provenance.editorSha256);

    await mockEngine(page);
    await page.goto('/global-scripts');
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    const reactVersion = await page.evaluate(async () => {
        const { platform } = await import(String('/core/platform.js'));
        return platform.React?.version;
    });
    expect(reactVersion, 'The served shell must use locked React; rebuild with npm run build -w web-administrator before direct Playwright runs').toBe(reactPackage.version);
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
