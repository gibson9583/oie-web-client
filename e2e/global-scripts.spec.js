import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Global Scripts exercises the React <CodeEditor> island + keep-mounted <Tabs>.
test('Global Scripts shows the four script tabs, editor, and task pane', async ({ page }) => {
    await page.goto('/#/global-scripts');
    await expect(page).toHaveURL(/#\/global-scripts/);

    // One tab per script.
    for (const t of ['Deploy', 'Undeploy', 'Preprocessor', 'Postprocessor']) {
        await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    }

    // The CodeEditor island mounts AND fills the view — a broken flex/height
    // chain collapses it to ~0, which toBeVisible() alone would not catch.
    await expect(page.locator('.ce').first()).toBeVisible();
    const box = await page.locator('.ce').first().boundingBox();
    expect(box.height).toBeGreaterThan(200);

    // Portaled task pane: Validate/Import/Export always present; Save is gated on
    // an edit, so it's absent initially.
    await expect(page.getByRole('button', { name: 'Validate Script' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Scripts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Scripts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Scripts' })).toHaveCount(0);
});
