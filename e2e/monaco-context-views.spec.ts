import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test('the find widget shows its tooltips in full', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/global-scripts');
    await page.locator('.ce-monaco .monaco-editor .view-lines').first().click();
    const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
    await page.keyboard.press(mac ? 'Meta+f' : 'Control+f');
    const regex = page.locator('.find-widget [aria-label^="Use Regular Expression"]').first();
    await expect(regex).toBeVisible();
    await regex.hover();
    const tooltip = page.locator('.monaco-hover').filter({ hasText: 'Use Regular Expression' }).first();
    await expect(tooltip).toBeVisible();
    // A point inside the tooltip's top edge must hit the tooltip, not the page beneath a clipping box.
    const visible = await tooltip.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
        return !!hit && element.contains(hit);
    });
    expect(visible).toBe(true);
});
