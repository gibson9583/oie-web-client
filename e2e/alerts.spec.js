import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Alerts list ported to React (multi-select + selection-gated task pane). The
// editor stays the legacy view.
test('Alerts lists alerts and gates task actions on selection/status', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page).toHaveURL(/\/alerts/);

    await expect(page.getByText('Error Alert')).toBeVisible();
    await expect(page.getByText('Deploy Alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Alert' })).toBeVisible();

    // No selection → single-selection actions hidden.
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toHaveCount(0);

    // Select the disabled alert → Edit/Delete appear; Enable shows (it's off),
    // Disable does not.
    await page.locator('tr', { hasText: 'Deploy Alert' }).first().click();
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable Alert' })).toHaveCount(0);
});

// The alert editor supports adding actions via the Add button AND a right-click
// menu (Swing parity).
test('alert editor adds an action via right-click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'New Alert' }).click();
    await expect(page).toHaveURL(/\/alerts\/.*\/edit/);

    await expect(page.getByText('No actions defined')).toBeVisible();
    await page.getByText('No actions defined').click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Add Action').click();
    await expect(page.getByText('No actions defined')).toHaveCount(0);
});
