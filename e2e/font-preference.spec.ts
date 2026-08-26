import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * The typeface pair (UI font + data font) as two independent per-user
 * preferences.
 *
 * Two selects rather than curated pairings on purpose: the faces land on
 * disjoint element sets (chrome vs. grids/logs/payloads), so any combination is
 * structurally safe and the only cross-effect is taste. Each option is one data
 * attribute carrying one variable override — the same mechanism density rides —
 * so the tests that matter are independence (one half must not move the other)
 * and the pending-preview contract.
 *
 * Inter + JetBrains Mono are the defaults and are the :root tokens the rest of
 * the suite renders in.
 */

const fontVar = (page: any, name: string) => page.evaluate(
    (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n), name);

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
    await page.setViewportSize({ width: 1280, height: 800 });
});

test('defaults to Inter + JetBrains Mono, the :root tokens', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('inter');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('jetbrains');
    expect(await fontVar(page, '--font-ui')).toContain('Inter');
    expect(await fontVar(page, '--font-mono')).toContain('JetBrains Mono');
});

test('the two halves are independent: each attribute moves only its own token', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.evaluate(() => { document.documentElement.dataset.fontUi = 'martian'; });
    await expect.poll(() => fontVar(page, '--font-ui')).toContain('Martian Mono');
    expect(await fontVar(page, '--font-mono')).toContain('JetBrains Mono');   // data face untouched

    await page.evaluate(() => { document.documentElement.dataset.fontMono = 'plexmono'; });
    await expect.poll(() => fontVar(page, '--font-mono')).toContain('IBM Plex Mono');
    expect(await fontVar(page, '--font-ui')).toContain('Martian Mono');       // and back the other way
});

test('the preference is on the Administrator tab and applies on save', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    const prefs = page.locator('.panel', { hasText: 'User Preferences' });
    // b612 / b612mono appear in exactly one select each, so they pick the pair apart.
    const uiSelect = prefs.locator('select').filter({ has: page.locator('option[value="b612"]') });
    const monoSelect = prefs.locator('select').filter({ has: page.locator('option[value="b612mono"]') });
    await expect(uiSelect).toHaveValue('inter');
    await expect(monoSelect).toHaveValue('jetbrains');

    await uiSelect.selectOption('b612');
    await monoSelect.selectOption('b612mono');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('b612');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('b612mono');

    // And it survives a reload, because it is stored per user.
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('b612');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('b612mono');
});

test('the preferences preview shows the pending faces without applying them', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    const preview = page.locator('.pref-preview');
    await expect(preview).toBeVisible();
    const prefs = page.locator('.panel', { hasText: 'User Preferences' });

    // The name cells answer for --font-ui, the counts column for --font-mono.
    const previewName = () => preview.locator('tbody td:nth-child(2)').first()
        .evaluate((e) => getComputedStyle(e).fontFamily);
    const previewCount = () => preview.locator('tbody td.num').first()
        .evaluate((e) => getComputedStyle(e).fontFamily);

    await prefs.locator('select').filter({ has: page.locator('option[value="b612"]') }).selectOption('b612');
    await expect.poll(previewName).toContain('B612');
    await prefs.locator('select').filter({ has: page.locator('option[value="b612mono"]') }).selectOption('b612mono');
    await expect.poll(previewCount).toContain('B612 Mono');

    /* The point of the preview: the app itself does not change until Save, so a
       half-made choice never disturbs what you are looking at. */
    expect(await page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('inter');
    expect(await page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('jetbrains');

    // Save, and now the app follows.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('b612');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('b612mono');

    /* The return leg needs its own rules: with b612 saved on <html>, the
       defaults must still render as a PENDING choice in the preview — which is
       why the default values have explicit overrides rather than "no rule". */
    await prefs.locator('select').filter({ has: page.locator('option[value="b612"]') }).selectOption('inter');
    await expect.poll(previewName).toContain('Inter');
    await prefs.locator('select').filter({ has: page.locator('option[value="b612mono"]') }).selectOption('jetbrains');
    await expect.poll(previewCount).toContain('JetBrains Mono');
    // Still pending: the app keeps the saved faces until the next Save.
    expect(await page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('b612');
});

test('Restore Defaults immediately reconciles saved fonts and stays clean', async ({ page }) => {
    await page.goto('/settings?tab=administrator');
    const prefs = page.locator('.panel', { hasText: 'User Preferences' });
    const uiSelect = prefs.locator('select').filter({ has: page.locator('option[value="b612"]') });
    const monoSelect = prefs.locator('select').filter({ has: page.locator('option[value="b612mono"]') });

    await uiSelect.selectOption('b612');
    await monoSelect.selectOption('b612mono');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('b612');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('b612mono');

    await page.getByRole('button', { name: 'Restore Defaults', exact: true }).click();
    await expect(uiSelect).toHaveValue('inter');
    await expect(monoSelect).toHaveValue('jetbrains');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('inter');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('jetbrains');

    // The reset was already persisted and applied; leaving must not offer to
    // save a phantom pending edit, and a reload must keep the same defaults.
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontUi)).toBe('inter');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontMono)).toBe('jetbrains');
});
