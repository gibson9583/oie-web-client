import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Users is the first view ported to React (DataTableHost + portaled task pane).
test('Users view lists users and gates task actions on selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page).toHaveURL(/#\/users/);

    // Rows render through the React-hosted DataTable.
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Erator', exact: true })).toBeVisible();

    // The (portaled) task pane shows the always-on actions.
    await expect(page.getByRole('button', { name: 'New User' })).toBeVisible();

    // Selection-gated actions are hidden until a row is selected, then appear.
    await expect(page.getByRole('button', { name: 'Edit User' })).toHaveCount(0);
    await page.locator('tr', { hasText: 'operator' }).first().click();
    await expect(page.getByRole('button', { name: 'Edit User' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete User' })).toBeVisible();
});
