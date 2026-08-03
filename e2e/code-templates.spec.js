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
    // monaco 0.56 uses the EditContext API (no editable textarea to .fill()) —
    // focus the editor and type via the keyboard to dirty the model.
    await page.locator('.ce .monaco-editor').first().click();
    await page.keyboard.type('return msg.trim();');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
});

/* A created entry is appended at the BOTTOM of the tree — below the pane's fold
   once the list is long — and a new template can land under a collapsed
   library. Creation must reveal the selection: TreeTable scrolls the selected
   row into view when the view sets it, and newTemplate expands its parent. */
test('creating a library or template reveals the new entry in the scrolled tree', async ({ page }) => {
    const libs = Array.from({ length: 25 }, (_, i) => ({
        '@version': '4.5.0', id: `lib-${i}`, name: `Library ${String(i).padStart(2, '0')}`, revision: 1,
        includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '',
        codeTemplates: { codeTemplate: [{
            '@version': '4.5.0', id: `tpl-${i}`, name: `Template ${i}`, revision: 1,
            contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
            properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION', code: `function t${i}(s) { return s; }` }
        }] }
    }));
    await mockEngine(page, { 'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: libs } } });
    await page.goto('/code-templates');
    await expect(page.getByText('Library 00', { exact: true })).toBeVisible();

    // The selected row must sit inside its scroll pane's viewport.
    const revealed = () => page.evaluate(() => {
        const row = document.querySelector('tbody tr.selected');
        if (!row) return { ok: false, why: 'no selected row' };
        const pane = row.closest('.overflow-auto');
        const r = row.getBoundingClientRect(), p = pane.getBoundingClientRect();
        return { ok: r.top >= p.top - 1 && r.bottom <= p.bottom + 1 };
    });

    // A new library lands at the very bottom of the long list — and is revealed.
    await page.getByRole('button', { name: 'New Library', exact: true }).click();
    await expect.poll(revealed).toMatchObject({ ok: true });

    // Collapse the first library, then create a template inside it: the library
    // must re-expand and the new template row be revealed.
    const firstRow = page.locator('tbody tr', { hasText: 'Library 00' }).first();
    await firstRow.scrollIntoViewIfNeeded();
    await firstRow.locator('.twisty').click();
    await expect(firstRow).toHaveAttribute('aria-expanded', 'false');
    await firstRow.click();
    await page.getByRole('button', { name: 'New Code Template', exact: true }).click();
    await expect(firstRow).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(revealed).toMatchObject({ ok: true });
    await expect(page.locator('tbody tr.selected')).toContainText('New Code Template');
});
