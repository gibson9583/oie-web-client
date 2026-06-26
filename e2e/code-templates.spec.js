import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Code Templates exercises the imperative library/template tree-table (kept
// mounted) + the React <CodeEditor> island + selection-gated Code Template Tasks.
test('Code Templates lists libraries/templates, gates tasks on selection, and edits dirty the Save button', async ({ page }) => {
    await page.goto('/code-templates');
    await expect(page).toHaveURL(/\/code-templates/);

    // Library + its code template render in the tree-table.
    await expect(page.getByText('Demo Library', { exact: true })).toBeVisible();
    await expect(page.getByText('Trim Whitespace', { exact: true })).toBeVisible();
    await expect(page.getByText('1 Library, 1 Code Template', { exact: true })).toBeVisible();

    // Non-contextual task buttons always present; Save Changes gated on edits.
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Code Templates', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Libraries', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);

    // No selection → contextual buttons hidden.
    await expect(page.getByRole('button', { name: 'New Code Template', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toHaveCount(0);

    // Select the library → library-kind tasks appear (New Code Template, Export
    // Library, Delete Library); template-only tasks stay hidden.
    await page.locator('tr', { hasText: 'Demo Library' }).first().click();
    await expect(page.getByRole('button', { name: 'New Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toHaveCount(0);

    // Select the template → template-kind tasks appear (Export Code Template,
    // Delete Code Template, Validate Script); the <CodeEditor> island mounts AND
    // fills the pane (a broken flex/height chain collapses it to ~0).
    await page.locator('tr', { hasText: 'Trim Whitespace' }).first().click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);

    await expect(page.locator('.ce').first()).toBeVisible();
    const box = await page.locator('.ce').first().boundingBox();
    expect(box.height).toBeGreaterThan(150);

    // Editing the code dirties the view → Save Changes appears.
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    await page.locator('.ce textarea').first().fill('return msg.trim();');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
});
