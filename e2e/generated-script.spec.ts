import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { channelWithSourceElement } from './step-rule-fixtures.js';

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
    const panelBox = (await panel.boundingBox())!;
    const editorBox = (await editor.boundingBox())!;
    expect(editorBox.width).toBeGreaterThan(panelBox.width / 2);
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
