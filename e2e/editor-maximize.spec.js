import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { channelWithSourceElement } from './step-rule-fixtures.js';
import { CASES as CONNECTOR_CASES, makeChannel } from './connector-fixtures.js';

/*
 * The code-editor "grow / full-screen" affordances, in their two shapes:
 *   (B) collapse-the-top-pane — transformer/filter and code templates grow the
 *       editor over the steps grid / metadata form (tagged data-editor-overtake)
 *       while the right Reference / Context panel stays put (.is-editor-max).
 *   (A) the code view — connector code fields (JavaScript Writer) and channel
 *       scripts open a dedicated full-viewport writing surface (.ce-popout-overlay,
 *       via the .ce-pop-btn corner toggle) with a Back button, a title, and a
 *       variables reference rail; Esc or Back restores the editor to the form.
 */

test('transformer step editor has ONE grow affordance: the code view (no region maximize)', async ({ page }) => {
    const id = 'max-tx';
    const element = { '@version': '4.5.0', name: 'Original', sequenceNumber: '0', enabled: true, script: '// hi\n' };
    const channel = channelWithSourceElement(id, 'transformer', 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', element);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    await expect(page.locator('[data-editor-overtake]').first()).toBeVisible();

    // The duplicate region-maximize button on the Step/Generated Script bar is gone…
    await expect(page.getByRole('button', { name: 'Maximize editor' })).toHaveCount(0);

    // …and the step script's code view is the single way to grow: full viewport,
    // with the REAL Reference / Message Templates / Message Trees panel moved in.
    const editor = page.locator('.ce').first();
    await editor.hover();
    await editor.locator('.ce-pop-btn').click({ force: true });
    const overlay = page.locator('.ce-popout-overlay');
    await expect(overlay).toHaveCount(1);
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThan(vp.width - 4);
    await expect(overlay.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Message Trees', exact: true })).toBeVisible();

    // Esc restores both the editor and the side panel to the transformer layout.
    await page.keyboard.press('Escape');
    await expect(page.locator('.ce-popout-overlay')).toHaveCount(0);
    await expect(page.locator('[data-editor-overtake]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reference', exact: true })).toBeVisible();
});

test('(B) code template Maximize overtakes the library list, keeps the Context panel', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/code-templates');
    await page.getByText('Trim Whitespace', { exact: true }).click();

    const libraryList = page.locator('[data-editor-overtake]').first();   // top tree-table pane
    const context = page.getByText('Select All', { exact: true });        // right-hand Context panel
    await expect(libraryList).toBeVisible();
    await expect(context).toBeVisible();

    await page.getByRole('button', { name: 'Maximize editor' }).click();
    await expect(libraryList).toBeHidden();        // library list overtaken
    await expect(context).toBeVisible();           // Context panel kept
    await expect(page.locator('.ce').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(libraryList).toBeVisible();
});

test('(A) JavaScript Writer opens the code view with velocity variables', async ({ page }) => {
    const js = CONNECTOR_CASES.find((c) => c.name === 'JavaScript Writer');
    const id = 'max-jsw';
    const channel = makeChannel(id, { destination: { transportName: 'JavaScript Writer', properties: js.properties() } });
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Destinations', exact: true }).click();
    await page.getByRole('cell', { name: 'JavaScript Writer', exact: true }).first().click();
    await expect(page.locator('.cform-section').first()).toBeVisible();

    const editor = page.locator('.ce').first();
    await editor.hover();   // the toggle is opacity:0 until hover
    await editor.locator('.ce-pop-btn').click({ force: true });

    const overlay = page.locator('.ce-popout-overlay');
    await expect(overlay).toHaveCount(1);
    // A dedicated full-viewport writing surface…
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThan(vp.width - 4);
    expect(box.height).toBeGreaterThan(vp.height - 4);
    // …with a Back button and the velocity variables rail built in.
    await expect(overlay.getByRole('button', { name: 'Back' })).toBeVisible();
    await expect(overlay.locator('.ce-popout-var', { hasText: 'Encoded Data' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.ce-popout-overlay')).toHaveCount(0);
});

test('(A) channel scripts open the code view full-viewport even with the rail collapsed', async ({ page }) => {
    const id = 'max-scripts';
    const channel = makeChannel(id);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    // Collapse the rail — the code view covers the whole viewport regardless of
    // shell layout (it is appended to document.body).
    await page.getByRole('button', { name: 'Hide navigation' }).click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    await page.getByRole('button', { name: 'Scripts', exact: true }).click();
    const editor = page.locator('.ce').first();
    await editor.hover();
    await editor.locator('.ce-pop-btn').click({ force: true });

    const overlay = page.locator('.ce-popout-overlay');
    await expect(overlay).toHaveCount(1);
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeLessThan(4);                          // flush to the viewport edge
    expect(box.width).toBeGreaterThan(vp.width - 4);        // spans the full viewport
    // Script scope variables + the script's name in the header.
    await expect(overlay.locator('.ce-popout-title')).toHaveText(/script/i);
    await expect(overlay.locator('.ce-popout-var', { hasText: 'Channel Map' }).first()).toBeVisible();

    // Back returns to the Scripts tab with the editor restored in place.
    await overlay.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.ce-popout-overlay')).toHaveCount(0);
    await expect(page.locator('.ce').first()).toBeVisible();
});
