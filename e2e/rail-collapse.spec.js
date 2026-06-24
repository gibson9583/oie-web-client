import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * The topbar hamburger collapses the left nav to a narrow strip of one icon per
 * top-level section (Engine, Dashboard Tasks, Plugins, Other). Clicking a section
 * icon pops out a selector listing that section's items. The collapsed state
 * persists across reloads.
 */
test('hamburger collapses nav to a section-icon rail; clicking an icon pops out its items; persists', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/#/dashboard');
    const channels = page.getByRole('button', { name: 'Channels', exact: true });
    await expect(channels).toBeVisible();

    // Collapse → narrow section-icon rail; items are hidden until popped out.
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);
    await expect(channels).toBeHidden();
    const engineIcon = page.getByRole('button', { name: 'Engine' });
    await expect(engineIcon).toBeVisible();

    // Click the Engine section icon → pop-out lists its items (Channels appears).
    await engineIcon.click();
    await expect(channels).toBeVisible();

    // Guard the contrast regression: items must read clearly on the flyout surface
    // (they were once light-on-light, "visible" to the DOM but invisible on screen).
    const delta = await page.evaluate(() => {
        const fly = document.querySelector('.rail-pane-mini.open .rail-mini-flyout');
        const item = fly && fly.querySelector('.rail-item');
        const sum = (c) => (c.match(/\d+/g) || []).slice(0, 3).reduce((a, b) => a + Number(b), 0);
        return Math.abs(sum(getComputedStyle(fly).backgroundColor) - sum(getComputedStyle(item).color));
    });
    expect(delta).toBeGreaterThan(150);

    // Collapsed mode persists across a reload.
    await page.reload();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);
    await expect(page.getByRole('button', { name: 'Channels', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Engine' })).toBeVisible();

    // Expanding via the hamburger restores the full rail.
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.getByRole('button', { name: 'Channels', exact: true })).toBeVisible();
});
