import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Row density in the data grids, as a per-user preference.
 *
 * Scoped on purpose. Grids are where the vertical space goes and where someone
 * watching a channel list wants more rows; forms and editors want air, and a
 * single global "density" would have to pick one answer for both. So this one is
 * named for what it changes, and the test that matters most is the negative one:
 * a form control must not move when the grids do.
 *
 * Normal is the default and is the app's baseline spacing, so the rest of the
 * suite keeps describing it.
 */

const rowHeight = (page: any) => page.evaluate(() => {
    const tr = document.querySelector('table.dt tbody tr');
    return tr ? +tr.getBoundingClientRect().height.toFixed(1) : null;
});
const controlHeight = (page: any) => page.evaluate(() => {
    const el = document.querySelector('.filterbar input[role=combobox]');
    return el ? Math.round(el.getBoundingClientRect().height) : null;
});

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('defaults to normal, which is the baseline the rest of the app is drawn at', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tableDensity)).toBe('normal');
});

test('compact and wide move the grid rows, and only the grid rows', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    const normalRow = await rowHeight(page);
    const normalControl = await controlHeight(page);

    await page.evaluate(() => { document.documentElement.dataset.tableDensity = 'compact'; });
    await expect.poll(() => rowHeight(page)).toBeLessThan(normalRow);
    expect(await controlHeight(page)).toBe(normalControl);   // forms keep the baseline

    await page.evaluate(() => { document.documentElement.dataset.tableDensity = 'wide'; });
    await expect.poll(() => rowHeight(page)).toBeGreaterThan(normalRow);
    expect(await controlHeight(page)).toBe(normalControl);
});

test('it reaches every grid, not just the dashboard', async ({ page }) => {
    await page.goto('/channels');
    await expect(page.getByText('Demo Started')).toBeVisible();
    const normal = await rowHeight(page);

    await page.evaluate(() => { document.documentElement.dataset.tableDensity = 'compact'; });
    await expect.poll(() => rowHeight(page)).toBeLessThan(normal);
});

test('the preference is on the Administrator tab and applies on save', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    const select = page.locator('.panel', { hasText: 'User Preferences' })
        .locator('select').filter({ has: page.locator('option[value="compact"]') });
    await expect(select).toHaveValue('normal');

    await select.selectOption('compact');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tableDensity)).toBe('compact');

    // And it survives a reload, because it is stored per user.
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tableDensity)).toBe('compact');
});

test('the preferences preview shows pending choices without applying them', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    const preview = page.locator('.pref-preview');
    await expect(preview).toBeVisible();

    const pick = (value: any) => page.locator('.panel', { hasText: 'User Preferences' })
        .locator('select').filter({ has: page.locator(`option[value="${value}"]`) });
    const previewRow = () => preview.locator('tbody tr').first()
        .evaluate((e) => +e.getBoundingClientRect().height.toFixed(1));

    /* What the preview has to communicate is how many rows fit — a couple of
       sample rows each growing a few pixels reads as no change at all. The frame
       is a fixed height and the list overflows it, so the answer changes visibly. */
    const visibleRows = () => page.evaluate(() => {
        const frame = document.querySelector('.pref-preview-frame')!.getBoundingClientRect();
        return [...document.querySelectorAll('.pref-preview tbody tr')]
            .filter((tr) => tr.getBoundingClientRect().bottom <= frame.bottom + 0.5).length;
    });

    const before = await previewRow();
    const rowsBefore = await visibleRows();
    await pick('compact').selectOption('compact');
    await expect.poll(previewRow).toBeLessThan(before);
    expect(await visibleRows()).toBeGreaterThan(rowsBefore);

    await pick('wide').selectOption('wide');
    await expect.poll(visibleRows).toBeLessThan(rowsBefore);
    await pick('compact').selectOption('compact');

    /* The point of the preview: the app itself does not change until Save, so a
       half-made choice never disturbs what you are looking at. */
    expect(await page.evaluate(() => document.documentElement.dataset.tableDensity)).toBe('normal');
    // Dark, because the app's own default is light — "not light" would pass for
    // the wrong reason.
    await pick('dark').selectOption('dark');
    await expect(preview).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

    // Save, and now the app follows.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.tableDensity)).toBe('compact');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});
