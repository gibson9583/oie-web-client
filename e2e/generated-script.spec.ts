import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { channelWithSourceElement } from './step-rule-fixtures.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * The transformer's read-only Generated Script tab (issue #76). The pane must
 * fill the tab body: the placeholder with no steps, else the selected step's
 * script.
 */

async function openGeneratedScript(page: any) {
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    await page.getByRole('tab', { name: 'Generated Script', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Generated Script' });
    return { panel, editor: panel.locator('.ce').first() };
}

async function expectFillsPanel(panel: any, editor: any) {
    // A zero-height Monaco can contain the expected text and have full width.
    // Check its actual usable area (Web Support issue #13).
    await expect.poll(async () => (await editor.boundingBox())?.height ?? 0).toBeGreaterThan(100);
    const panelBox = (await panel.boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    expect(editorBox.width).toBeGreaterThan(panelBox.width / 2);
    expect(editorBox.height).toBeGreaterThan(panelBox.height / 2);
    const bodyBox = (await panel.locator('..').boundingBox())!;
    expect(panelBox.height).toBeGreaterThan(bodyBox.height - 2);
    expect(panelBox.height).toBeLessThanOrEqual(bodyBox.height + 2);
}

test('Generated Script shows the placeholder for a new channel', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels');
    await page.getByRole('button', { name: 'New Channel' }).first().click();
    const classic = page.getByRole('button', { name: /Classic/ });
    if (await classic.count()) await classic.first().click();

    const { panel, editor } = await openGeneratedScript(page);
    await expect(editor).toContainText('Select a step to preview its script');
    await expectFillsPanel(panel, editor);
});

test('Generated Script previews the selected step', async ({ page }) => {
    const id = 'gen-script';
    const element = { '@version': '4.6.0', name: 'Step One', sequenceNumber: '0', enabled: true, script: 'logger.info("from step one");\n' };
    const channel = channelWithSourceElement(id, 'transformer', 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', element);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
    await page.goto(`/channels/${id}/edit`);

    const { panel, editor } = await openGeneratedScript(page);
    await expect(editor).toContainText('from step one');
    await expectFillsPanel(panel, editor);
});

const surfaces = [
    { label: 'source transformer', route: 'transformer', connector: 0, target: 'transformer' },
    { label: 'destination transformer', route: 'transformer', connector: 1, target: 'transformer' },
    { label: 'response transformer', route: 'response', connector: 1, target: 'responseTransformer' },
    { label: 'source filter', route: 'filter', connector: 0, target: 'filter' },
    { label: 'destination filter', route: 'filter', connector: 1, target: 'filter' },
];

for (const fallback of [false, true]) {
    for (const surface of surfaces) {
        test(`${surface.label} displays generated non-JS code with ${fallback ? 'textarea fallback' : 'Monaco'}`, async ({ page }, testInfo) => {
            if (fallback) await page.route('**/vendor/monaco/editor.main.js', route => route.abort());
            const id = 'generated-non-js';
            const channel = makeChannel(id);
            const connector = surface.connector === 0 ? channel.sourceConnector : channel.destinationConnectors.connector[0];
            const filter = surface.target === 'filter';
            const className = filter ? 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' : 'com.mirth.connect.plugins.mapper.MapperStep';
            connector[surface.target].elements = { [className]: {
                '@version': '4.6.0', name: 'Preview fixture', sequenceNumber: 0, enabled: true,
                ...(filter
                    ? { operator: 'NONE', field: "msg['PID']", condition: 'EXISTS', values: '' }
                    : { variable: 'target_fhir_base', mapping: "'https://example.test/fhir'", defaultValue: '', replacements: '', scope: 'CHANNEL' }),
            } };
            await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
            await page.goto(`/channels/${id}/${surface.route}/${surface.connector}`);
            const tab = page.getByRole('tab', { name: 'Generated Script', exact: true });
            await tab.click();
            const panel = page.getByRole('tabpanel', { name: 'Generated Script', exact: true });
            const editor = panel.locator('.ce').first();
            if (fallback) await expect(editor.locator('textarea.ce-area')).toBeVisible();
            else await expect(editor.locator('.monaco-editor')).toBeVisible();
            const readEditor = () => editor.evaluate((el: HTMLElement) => {
                const monaco = (window as any).monaco;
                const instance = monaco?.editor.getEditors().find((e: any) => el.contains(e.getDomNode()));
                const area = el.querySelector<HTMLTextAreaElement>('textarea.ce-area');
                return {
                    value: instance?.getValue() ?? area?.value,
                    readOnly: instance ? instance.getOption(monaco.editor.EditorOption.readOnly) : area?.readOnly,
                };
            });
            const expected = filter ? "if(msg['PID'].length > 0)" : "channelMap.put('target_fhir_base'";
            await expect.poll(async () => (await readEditor()).value).toContain(expected);
            expect((await readEditor()).readOnly).toBe(true);
            await expectFillsPanel(panel, editor);
            await page.screenshot({ path: testInfo.outputPath('generated-script.png') });

            // The persistent preview must regenerate after an in-place form edit.
            await page.getByRole('tab', { name: filter ? 'Rule' : 'Step', exact: true }).click();
            const field = page.locator('.step-editor-fill .field').filter({
                has: page.locator('label').filter({ hasText: filter ? /^Field$/ : /^Variable name$/ }),
            }).locator('input');
            await field.fill(filter ? "msg['OBX']" : 'updated_target');
            await tab.click();
            await expect.poll(async () => (await readEditor()).value).toContain(filter ? "if(msg['OBX'].length > 0)" : "channelMap.put('updated_target'");
            await expectFillsPanel(panel, editor);

            // Code view and a smaller viewport must restore a usable inline pane.
            await editor.hover();
            await editor.locator('.ce-pop-btn').click();
            await expect(page.locator('.ce-popout-overlay .ce')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('.ce-popout-overlay')).toHaveCount(0);
            await page.setViewportSize({ width: 1024, height: 768 });
            await expectFillsPanel(panel, editor);
            await page.setViewportSize({ width: 600, height: 900 });
            await expectFillsPanel(panel, editor);
        });
    }
}

test('the wizard embedded transformer also fills its Generated Script pane', async ({ page }) => {
    const id = 'generated-wizard';
    const channel = channelWithSourceElement(id, 'transformer', 'com.mirth.connect.plugins.mapper.MapperStep', {
        '@version': '4.6.0', name: 'Mapper', sequenceNumber: 0, enabled: true,
        variable: 'wizard_target', mapping: "'preview'", defaultValue: '', replacements: '', scope: 'CHANNEL',
    });
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });
    await page.goto(`/channels/${id}/guided`);
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('tab', { name: /^Transformer/ }).click();
    await page.getByRole('tab', { name: 'Generated Script', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Generated Script', exact: true });
    const editor = panel.locator('.ce').first();
    await expect(editor).toContainText('wizard_target');
    await expectFillsPanel(panel, editor);
});
