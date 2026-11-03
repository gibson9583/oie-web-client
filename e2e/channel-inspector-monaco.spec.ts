import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { expectInspectorCode } from './inspector-code.js';

for (const fallback of [false, true]) {
    test(`Inspector scripts stay read only with ${fallback ? 'the text fallback' : 'Monaco'}`, async ({ page }, info) => {
        if (fallback) await page.route('**/vendor/monaco/editor.main.js', route => route.abort());
        const id = 'inspector-monaco';
        const channel: any = makeChannel(id);
        const script = Array.from({ length: 24 }, (_, i) => `var batch${i} = reader.readLine();`).join('\n');
        channel.sourceConnector.properties.sourceConnectorProperties.processBatch = true;
        channel.sourceConnector.transformer.inboundProperties = { batchProperties: { splitType: 'JavaScript', batchScript: script } };
        await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
        const writes: string[] = [];
        page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
        await page.goto(`/channels/${id}/edit?tab=Inspector`);
        const batch = page.locator('#ci-batch .ci-item');
        await expect(batch.locator('.ce')).toHaveCount(0);
        await batch.locator('summary').click();
        await expectInspectorCode(batch, [script]);
        const beforeHeight = (await batch.locator('.ci-code').boundingBox())!.height;
        await batch.getByRole('button', { name: 'Show full script', exact: true }).click();
        expect((await batch.locator('.ci-code').boundingBox())!.height).toBeGreaterThan(beforeHeight);

        let modelUri = '';
        const focusEditor = () => fallback ? batch.locator('textarea.ce-area').focus() : batch.locator('.monaco-editor').evaluate(el => {
            const m = (window as any).monaco;
            m.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode())).focus();
        });
        if (fallback) {
            await expect(batch.locator('textarea.ce-area')).toHaveJSProperty('readOnly', true);
        } else {
            await expect(batch.locator('.monaco-editor')).toBeVisible();
            const options = await batch.evaluate(el => {
                const m = (window as any).monaco;
                const editor = m.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
                return { readOnly: editor.getOption(m.editor.EditorOption.readOnly), language: editor.getModel().getLanguageId(), uri: editor.getModel().uri.toString() };
            });
            expect(options.readOnly).toBe(true);
            expect(options.language).toBe('javascript');
            modelUri = options.uri;
            await focusEditor();
            const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
            await page.keyboard.press(mac ? 'Meta+f' : 'Control+f');
            await expect(batch.locator('.find-widget')).toBeVisible();
            await page.keyboard.press('Escape');
        }
        await focusEditor();
        await page.keyboard.type('SHOULD_NOT_EDIT');
        await expectInspectorCode(batch, [script]);
        expect(await page.evaluate(async () => {
            const store = await import(String('/core/store.js'));
            return { dirty: store.getState('editingChannelDirty'), script: store.getState('editingChannel').sourceConnector.transformer.inboundProperties.batchProperties.batchScript };
        })).toEqual({ dirty: false, script });
        if (process.env.INSPECTOR_SCREENSHOTS === '1') {
            if (await page.locator('html').getAttribute('data-theme') !== 'light') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
            await page.getByRole('button', { name: 'Print', exact: true }).focus();
            await batch.scrollIntoViewIfNeeded();
            await batch.screenshot({ path: info.outputPath('read-only-script.png') });
            await page.setViewportSize({ width: 430, height: 900 });
            await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
            await expectInspectorCode(batch, [script]);
            await expect(batch.locator(fallback ? 'textarea.ce-area' : '.monaco-editor')).toBeVisible();
            await page.screenshot({ path: info.outputPath('mobile.png') });
            await page.setViewportSize({ width: 1280, height: 720 });
        }

        await batch.locator('summary').click();
        await expect(batch.locator('.ce')).toHaveCount(0);
        if (modelUri) await expect.poll(() => page.evaluate(uri => {
            const m = (window as any).monaco;
            return m.editor.getModel(m.Uri.parse(uri)) == null;
        }, modelUri)).toBe(true);
        await batch.locator('summary').click();
        await expectInspectorCode(batch, [script]);
        if (!fallback) {
            const uri = await batch.evaluate(el => {
                const m = (window as any).monaco;
                return m.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode())).getModel().uri.toString();
            });
            await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
            await expect.poll(() => page.evaluate(uri => {
                const m = (window as any).monaco;
                return m.editor.getModel(m.Uri.parse(uri)) == null;
            }, uri)).toBe(true);
            await expectInspectorCode(batch, [script]);
        }
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('.monaco-editor, textarea.ce-area')).toHaveCount(0);
        await expect(preview.locator('section[aria-labelledby="print-ci-batch"] .ci-code .lc')).toHaveText(script.split('\n'));
        expect(writes).toEqual([]);
    });
}
