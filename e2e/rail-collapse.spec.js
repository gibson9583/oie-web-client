import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * The left navigation rail collapses via the topbar hamburger, and the choice
 * persists (localStorage) across reloads.
 */
test('hamburger collapses and restores the left nav rail, and the choice persists', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');

    const rail = page.locator('.rail');
    const shell = page.locator('.shell');
    const toggle = page.getByRole('button', { name: 'Hide navigation' });
    await expect(rail).toBeVisible();
    await expect(shell).not.toHaveClass(/rail-collapsed/);

    // Collapse → the rail closes (zero-width column) and the toggle flips label.
    await toggle.click();
    await expect(shell).toHaveClass(/rail-collapsed/);
    await expect.poll(async () => (await rail.boundingBox())?.width ?? 0).toBeLessThan(2);
    await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();

    // Persists across a reload.
    await page.reload();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    // Restore.
    await page.getByRole('button', { name: 'Show navigation' }).click();
    await expect(page.locator('.shell')).not.toHaveClass(/rail-collapsed/);
    await expect(page.locator('.rail')).toBeVisible();
});
