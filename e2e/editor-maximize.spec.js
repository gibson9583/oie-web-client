import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { channelWithSourceElement } from './step-rule-fixtures.js';
import { CASES as CONNECTOR_CASES, makeChannel } from './connector-fixtures.js';

/*
 * The code-editor "maximize / full-screen" affordance, in its two shapes:
 *   (B) collapse-the-top-pane — transformer/filter and code templates grow the
 *       editor over the steps grid / metadata form (tagged data-editor-overtake)
 *       while the right Reference / Context panel stays put (.is-editor-max).
 *   (A) fill-the-content-area overlay — connector code fields (JavaScript Writer)
 *       and channel scripts pop the editor to a fixed overlay (.ce-maximized) via
 *       a .ce-max-btn, with Esc to restore.
 */

test('(B) transformer Maximize overtakes the steps grid but keeps the reference panel', async ({ page }) => {
    const id = 'max-tx';
    const element = { '@version': '4.5.0', name: 'Original', sequenceNumber: '0', enabled: true, script: '// hi\n' };
    const channel = channelWithSourceElement(id, 'transformer', 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', element);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();

    const stepsGrid = page.locator('[data-editor-overtake]').first();
    const reference = page.getByRole('button', { name: 'Reference', exact: true });
    await expect(stepsGrid).toBeVisible();
    await expect(reference).toBeVisible();

    await page.getByRole('button', { name: 'Maximize editor' }).click();
    await expect(stepsGrid).toBeHidden();      // steps overtaken
    await expect(reference).toBeVisible();     // reference panel kept

    await page.getByRole('button', { name: /Restore editor/ }).click();
    await expect(stepsGrid).toBeVisible();     // restored
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

test('(A) JavaScript Writer maximizes but keeps the Destination Mappings panel', async ({ page }) => {
    const js = CONNECTOR_CASES.find((c) => c.name === 'JavaScript Writer');
    const id = 'max-jsw';
    const channel = makeChannel(id, { destination: { transportName: 'JavaScript Writer', properties: js.properties() } });
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Destinations', exact: true }).click();
    await page.getByRole('cell', { name: 'JavaScript Writer', exact: true }).first().click();
    await expect(page.locator('.cform-section').first()).toBeVisible();

    const mappings = page.getByText('Destination Mappings', { exact: true });
    await expect(mappings).toBeVisible();

    const editor = page.locator('.ce').first();
    await editor.hover();   // the toggle is opacity:0 until hover
    await editor.getByRole('button', { name: 'Maximize editor' }).click();
    const overlay = page.locator('.ce.ce-maximized');
    await expect(overlay).toHaveCount(1);

    // It fills the connector area (genuinely large) but stops short of the ~240px
    // Destination Mappings rail, which stays visible as the drag source.
    await expect(mappings).toBeVisible();
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeGreaterThan(vp.width * 0.4);
    expect(box.x + box.width).toBeLessThan(vp.width - 200);    // leaves room for the mappings rail

    await page.keyboard.press('Escape');
    await expect(page.locator('.ce.ce-maximized')).toHaveCount(0);
});

test('(A) channel scripts maximize fills flush-left when the nav rail is collapsed (regression)', async ({ page }) => {
    const id = 'max-scripts';
    const channel = makeChannel(id);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    // Collapse the rail via the topbar hamburger — the content grid becomes "0 1fr",
    // so the fixed maximize overlay must start at x=0 (not the old rail width).
    await page.getByRole('button', { name: 'Hide navigation' }).click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    await page.getByRole('button', { name: 'Scripts', exact: true }).click();
    const editor = page.locator('.ce').first();
    await editor.hover();
    await editor.getByRole('button', { name: 'Maximize editor' }).click();

    const overlay = page.locator('.ce.ce-maximized');
    await expect(overlay).toHaveCount(1);
    const box = await overlay.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeLessThan(4);                          // flush to the viewport edge
    expect(box.width).toBeGreaterThan(vp.width * 0.8);      // spans the full content width

    await page.keyboard.press('Escape');
    await expect(page.locator('.ce.ce-maximized')).toHaveCount(0);
});

test('(A) channel scripts maximize clears the nav rail when it is expanded', async ({ page }) => {
    const id = 'max-scripts-exp';
    const channel = makeChannel(id);
    await mockEngine(page, { [`GET /channels/${id}`]: { channel } });

    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('button', { name: 'Scripts', exact: true }).click();
    const editor = page.locator('.ce').first();
    await editor.hover();
    await editor.getByRole('button', { name: 'Maximize editor' }).click();

    const overlay = page.locator('.ce.ce-maximized');
    await expect(overlay).toHaveCount(1);
    const box = await overlay.boundingBox();
    expect(box.x).toBeGreaterThan(4);     // anchored to the right of the expanded rail

    await page.keyboard.press('Escape');
});
