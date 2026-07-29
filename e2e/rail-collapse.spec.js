import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * The left navigation rail collapses via the topbar hamburger to an ICON rail —
 * narrow but still navigable, with labels on hover — and the choice persists
 * (localStorage) across reloads.
 */
test('hamburger collapses and restores the left nav rail, and the choice persists', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');

    const rail = page.locator('.rail');
    const shell = page.locator('.shell');
    const toggle = page.getByRole('button', { name: 'Hide navigation' });
    await expect(rail).toBeVisible();
    await expect(shell).not.toHaveClass(/rail-collapsed/);

    // Collapse → the rail becomes an ICON rail rather than disappearing: narrow,
    // still visible, labels gone but every destination still reachable.
    await toggle.click();
    await expect(shell).toHaveClass(/rail-collapsed/);
    await expect.poll(async () => (await rail.boundingBox())?.width ?? 0).toBeLessThan(80);
    await expect(rail).toBeVisible();
    await expect(page.locator('.rail-item').first()).toBeVisible();
    // The label is still in the DOM (so screen readers and the flyout can use it)
    // but must not render — assert visibility, not presence.
    await expect(page.locator('.rail-item span').first()).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();

    // Collapsing must not introduce a sideways scroller inside a 56px rail — the
    // label flyout is fixed-position and lives outside .rail precisely for this.
    expect(await rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);

    // Hovering an icon reveals its label, so the rail stays usable collapsed.
    await page.locator('.rail-item').first().hover();
    await expect(page.locator('.rail-flyout')).toBeVisible();

    // Persists across a reload.
    await page.reload();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);

    // Restore.
    await page.getByRole('button', { name: 'Show navigation' }).click();
    await expect(page.locator('.shell')).not.toHaveClass(/rail-collapsed/);
    await expect(page.locator('.rail')).toBeVisible();
});
