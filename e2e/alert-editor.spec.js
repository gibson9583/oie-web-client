import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// The alert editor is now a React view (react/views/alert-editor.jsx). Reached
// via New Alert from the list; renders the error-types / regex / channels tree
// row and the actions / template / variables row.
test('New Alert opens the React editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page).toHaveURL(/#\/alerts/);

    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page).toHaveURL(/#\/alerts\/.*\/edit/);

    // Editor panels render (scope to the editor's panel headers — "Channels"
    // also appears as a nav item, so match the header element specifically).
    await expect(page.locator('.panel-header', { hasText: 'Errors (select all that apply)' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Channels' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Actions' })).toBeVisible();
    await expect(page.locator('.panel-header', { hasText: 'Alert Variables' })).toBeVisible();
    // Task pane.
    await expect(page.getByRole('button', { name: 'Save Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Alerts' })).toBeVisible();
});

// Adding actions: via the Add button AND via the right-click menu (Swing parity).
test('alert editor adds an action via the Add button and via right-click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page).toHaveURL(/#\/alerts\/.*\/edit/);

    // Starts with no actions.
    await expect(page.getByText('No actions defined')).toBeVisible();

    // Scope to the Actions panel's table (the Channels tree is also a table.dt).
    const actionRows = page.locator('.panel')
        .filter({ has: page.locator('.panel-header', { hasText: 'Actions' }) })
        .locator('table.dt tbody tr');

    // Add via the Add button — the placeholder is replaced by an actions table.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('No actions defined')).toHaveCount(0);
    await expect(actionRows).toHaveCount(1);

    // Add a second action via the right-click menu.
    await actionRows.first().click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Add Action').click();
    await expect(actionRows).toHaveCount(2);
});
