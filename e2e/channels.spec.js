import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('navigates to Channels and lists channels', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels' }).click();

    await expect(page).toHaveURL(/\/channels/);
    await expect(page.getByText('Demo Started')).toBeVisible();
    await expect(page.getByText('Demo Stopped')).toBeVisible();
    // The Channels task pane offers New Channel.
    await expect(page.getByRole('button', { name: 'New Channel' })).toBeVisible();
});

test('column menu hides, persists, and restores a column', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Channels' }).click();
    await expect(page).toHaveURL(/\/channels/);

    const description = () => page.getByRole('columnheader', { name: 'Description', exact: true });
    // Right-click any column header opens the show/hide-columns menu.
    const openColumnMenu = () => page.getByRole('columnheader', { name: 'Status', exact: true }).click({ button: 'right' });

    await expect(description()).toBeVisible();

    // Hide Description via the header menu → it disappears from the grid.
    await openColumnMenu();
    await page.locator('.ctx-menu').getByRole('button', { name: 'Description' }).click();
    await expect(description()).toHaveCount(0);

    // The choice persists to localStorage across a reload.
    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
    await expect(description()).toHaveCount(0);

    // Restore Default brings every column back.
    await openColumnMenu();
    await page.locator('.ctx-menu').getByRole('button', { name: 'Restore Default' }).click();
    await expect(description()).toBeVisible();

    // Name is pinned — it must never appear as a hideable toggle.
    await openColumnMenu();
    await expect(page.locator('.ctx-menu').getByRole('button', { name: 'Name', exact: true })).toHaveCount(0);
});
