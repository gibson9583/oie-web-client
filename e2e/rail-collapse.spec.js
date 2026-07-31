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

/*
 * Collapsed, the hamburger heads the icon column: it sits directly above the nav
 * icons with nothing between them, so a few pixels of disagreement reads as a
 * misalignment rather than as spacing. Both centres come from the same tokens
 * (--rail-w-icons, --rail-toggle-size), so this pins the arithmetic.
 */
test('the collapsed hamburger shares the icon column\'s centre line', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.locator('.rail-nav')).toBeVisible({ timeout: 15_000 });

    const centreOf = (sel) => page.locator(sel).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
    });

    await page.getByRole('button', { name: 'Hide navigation' }).click();
    await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);
    /* The class lands before the width does — the rail animates 194px → 50px, and
       measuring mid-transition reads the icons half a rail out of position. */
    await expect.poll(async () => (await page.locator('.rail').boundingBox())?.width ?? 0)
        .toBeLessThan(80);

    const ham = await centreOf('.rail-toggle');
    const icon = await centreOf('.rail-nav [data-nav-item] svg');
    expect(Math.abs(ham - icon)).toBeLessThanOrEqual(0.5);

    /* The nudge that moves the hamburger left carries an equal-and-opposite right
       margin, so the title lands exactly where the topbar's own padding, the button
       and the flex gap put it — the shift is the button's alone. Derived from the
       live tokens rather than a measured constant. */
    const expected = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const px = (v) => parseFloat(cs.getPropertyValue(v));
        const gap = parseFloat(getComputedStyle(document.querySelector('.topbar')).columnGap);
        return px('--topbar-pad-x') + px('--rail-toggle-size') + gap;
    });
    const titleLeft = await page.locator('.view-title').evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(titleLeft - expected)).toBeLessThanOrEqual(0.5);
});
